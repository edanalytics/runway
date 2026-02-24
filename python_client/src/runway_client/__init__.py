import json
import logging
import os
from datetime import datetime
from datetime import timedelta
from textwrap import dedent
from typing import Optional
from urllib.parse import urlparse

import requests
from pydantic import BaseModel
from pydantic import HttpUrl
from pydantic import SecretStr
from requests import Response
from requests import request

logger = logging.getLogger(__name__)


def dumps(obj, indent: int = 2) -> str:
    """Convenience function to dump with indent."""
    return json.dumps(obj, indent=indent, default=str)


def response_to_str(response: Response) -> str:
    msg = f"""
        Status Code: {response.status_code}
        URL: {response.url}
        Body: {response.text}
    """
    msg = dedent(msg)
    return msg


class RunwayResponseError(Exception):
    pass


class TokenResponse(BaseModel):
    access_token: SecretStr
    scope: str
    expires_in: int
    token_type: str

    expires_at: datetime

    def __init__(self, **data) -> None:
        expires_at = (
            datetime.now()
            + timedelta(seconds=data["expires_in"])
            # Take off some time to avoid being cute with the cutoff.
            - timedelta(seconds=10)
        )
        super().__init__(**data, expires_at=expires_at)

    def is_expired(self) -> bool:
        return datetime.now() >= self.expires_at

    def to_header(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token.get_secret_value()}"}


class RunwayClient(BaseModel):
    """
    A client for the Runway API.

    Parameters:

    - `runway_base_url`: The base URL for the Runway API, like https://api.<env_name>.runwayloader.org/api/v1
    - `auth_base_url`: The EA Auth0 base URL to request Bearer tokens to use with Runway.
    - `client_id`: The client ID for the Runway API.
    - `client_secret`: The client secret for the Runway API.
    - `partner_code`: The partner code that is the parent to tenant codes. Requests to Runway are allowed only for the partner/tenant pairs configured.

    Developer notes:

    - On the first request, a Bearer token is fetched and cached, along with its
      expiration. Very basic logic is implemented to check for
      expiration, just in case the client is long-lived.
    - Methods succeed if they don't raise an exception.
    """

    runway_base_url: HttpUrl
    runway_instance_url: HttpUrl

    auth_base_url: HttpUrl

    client_id: str
    client_secret: SecretStr
    partner_code: str

    token: Optional[TokenResponse] = None

    def __init__(self, **data) -> None:
        # TODO: Validate the base url specifies api/v<version>

        base_url = data.get("runway_base_url")
        if not base_url:
            raise ValueError("runway_base_url is required")

        instance_url = urlparse(base_url)._replace(path="").geturl()

        data["runway_base_url"] = base_url
        data["runway_instance_url"] = instance_url

        super().__init__(**data)

    def _path(self, endpoint) -> str:
        """Convenience method to join the base URL with a Runway endpoint."""

        # Using os.path.join because urljoin doesn't handle omitted slashes on
        # the left-hand side.
        return os.path.join(self.runway_base_url.encoded_string(), endpoint)

    def _post(
        self,
        endpoint: str,
        data: Optional[dict[str, str]] = None,
        headers: dict[str, str] = {},
    ) -> Response:
        """Convenience method to make POST requests to Runway."""

        if self.token is None or self.token.is_expired():
            self.set_token()

        headers.update(self.token.to_header())
        url = self._path(endpoint)

        logger.debug(f"Sending POST to {url}")

        response = request("POST", url, data=data, headers=headers)
        self.check_log_raise(response)

        return response

    def check_log_raise(self, response: Response):
        """
        Convenience method to check for an error response, log, and raise.
        """

        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError as e:
            raise RunwayResponseError(response_to_str(response)) from e

    def set_token(self):
        logger.debug(
            f"Fetching new authentication token from {self.auth_base_url} "
            f"for partner_code={self.partner_code}"
        )
        data = {
            "grant_type": "client_credentials",
            # Auth0 rejects the request if the audience url has a trailing
            # slash. We don't have to check whether it's there, because HttpUrl
            # always includes it at the end of the url domain part.
            "audience": self.runway_instance_url.encoded_string()[:-1],
            "client_id": self.client_id,
            "client_secret": self.client_secret.get_secret_value(),
            "scope": f"create:jobs partner:{self.partner_code}",
        }

        url = os.path.join(self.auth_base_url.encoded_string(), "oauth/token")
        response = request("POST", url, data=data)
        self.check_log_raise(response)

        obj = response.json()
        token = TokenResponse(**obj)

        self.token = token

    def verify_token(self):
        """
        Request Runway to verify the cached Bearer token.

        A valid token means that it is authorized to request a job with the
        given Runway instance URL and partner code. It does not verify
        whether the token has expired.
        """

        logger.debug("Verifying authentication token with Runway")
        self._post("token/verify")

    def request_runway_job(
        self,
        tenant_code: str,
        bundle_name: str,
        input_files: dict[str, str],
        bundle_params: dict[str, str],
        school_year: str,
    ) -> dict[str, str]:
        """
        Request a Runway Job.

        Parameters correspond to familiar Earthbeam/earthmover parameters:

        - `tenant_code`: Must be a tenant code associated with the partner code set at the class level.
        - `bundle_name`: Looks like `assessments/PSAT_SAT`
        - `input_files`: Looks like `{"INPUT_FILE": "/path/to/sat.csv"}`.
        - `bundle_params`: Looks like `{"TEST_TYPE": "SAT"}`
        - `school_year`: Looks like "2526" to represent 2025-2026.

        This function returns a Runway job request object, which looks like:

        ```json
        {
            "uid": "<job request id>",
            "uploadUrls": {
                "INPUT_FILE": "<s3_presigned_url>"
            }
        }
        ```

        The workflow is to use the presigned URL to upload the input files to
        S3, then use the job id to tell Runway to start processing the S3 files.

        This function does *not* validate the structure or content of these
        parameters. Runway is responsible for validating the request. If any
        parameters are invalid, Runway will return an HTTP 40X status code and a
        JSON object describing the error like this:

        ```json
        {
            "message": "No ODS found for school year: 2026",
            "error": "Bad Request",
            "statusCode": 400
        }
        ```

        If there is more than one error, Runway will report the first it finds.
        """

        data = {
            "partner": self.partner_code,
            "tenant": tenant_code,
            "bundle": bundle_name,
            "files": input_files,
            "params": bundle_params,
            "schoolYear": school_year,
        }
        logger.info(f"Requesting Runway job with parameters:\n{dumps(data)}")

        data = json.dumps(data)
        response = self._post(
            "jobs", data=data, headers={"Content-Type": "application/json"}
        )
        self.check_log_raise(response)
        job = response.json()

        logger.info(f"Runway job returned:\n{dumps(job)}")

        return job

    def upload_to_s3(self, job: dict[str, str], input_files: dict[str, str]):
        """
        Upload input files to S3.

        Parameters:

        - `job`: A Runway job object as returned by `request_runway_job(...)`
        - `input_files`: Looks like `{"INPUT_FILE": "/path/to/sat.csv"}`.

        If a file fails to upload, the response is logged and an exception is
        raised.
        """
        job_uid = job["uid"]

        logger.info(f"Starting S3 upload for job {job_uid}: {len(input_files)} file(s)")

        for name, path in input_files.items():
            logger.info(f"Uploading file {name} at path {path} to S3")

            presigned_s3_url = job["uploadUrls"][name]

            with open(path, "rb") as fp:
                response = request("PUT", presigned_s3_url, data=fp)
                self.check_log_raise(response)

            logger.info(f"Successfully uploaded {name} to S3")

        logger.info(f"Completed S3 upload for job {job_uid}")

    def start_job(self, job: dict[str, str]):
        """
        Tell Runway to start processing assessment files uploaded to S3.

        Call this function after `upload_to_s3(...)` completes successfully.

        Parameters:

        - `job`: A Runway Job object as returned by `request_runway_job(...)`

        If Runway rejects the request, the response is logged and an exception
        is raised. This does not check any status related to processing the
        assessments.
        """
        job_uid = job["uid"]

        logger.info(f"Starting Runway job {job_uid}")

        response = self._post(f"jobs/{job_uid}/start")
        self.check_log_raise(response)

    def load_files(
        self,
        tenant_code: str,
        bundle_name: str,
        input_files: dict[str, str],
        bundle_params: dict[str, str],
        school_year: str,
    ):
        logger.info("Starting Runway workflow")

        job = self.request_runway_job(
            tenant_code, bundle_name, input_files, bundle_params, school_year
        )
        self.upload_to_s3(job, input_files)
        self.start_job(job)

        logger.info("Completed Runway workflow")
