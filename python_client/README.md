# Python RunwayClient

The `RunwayClient` is a slim Python wrapper around Runway's REST API to trigger
jobs programmatically. See the Slite design document for more information:
[DIIP 17: API-triggered jobs](https://edanalytics.slite.com/app/docs/eJ7maazQl3s5vP)

## Installation

To install locally, specify the path to `runway_python_client`, like:

```shell
pip install ./runway/python_client
```

This project was built with `uv`, so this works too:

```shell
uv pip install ./runway/python_client
```

To install from Github, use the subdirectory syntax:

```shell
pip install "git+https://github.com/edanalytics/runway.git#subdirectory=python_client"
```

The name of the installed module is `runway_client`, so after installing, you'd
import like:

```python
from runway_client import RunwayClient
```

## Running the Client

To get started, you'll need four things:

1. Client Id and Secret for requesting tokens
2. Base URL for requesting tokens
3. Base URL for Runway API
4. A sample assessment file

After installing, you can then instantiate the client and trigger a job like
this:

```python
from runway_client import RunwayClient

client = RunwayClient(
  runway_base_url="https://api.<instance name>-<env>.runwayloader.org/api/v1",
  auth_base_url="https://<name>.<env>.us.auth0.com",
  client_id="<client id>",
  client_secret="<client secret>",
  partner_code="ea",
)

client.load_files(
  tenant_code="ea",
  bundle_name="assessments/PSAT_SAT",
  input_files={"INPUT_FILE": "/path/to/sat.csv"},
  bundle_params={"TEST_TYPE": "SAT"},
  school_year="2526",
)
```

Executing `load_files(...)` will:

1. Request authorization from Auth0 using the client id, secret, and partner
   code.
2. Request Runway to create a job for the assessment files. If the bundle
   parameters are valid, Runway will return a job id, as well as S3 presigned
   URLs per file.
3. Upload assessment files to S3.
4. Request Runway to begin processing the assessment files.

`RunwayClient` will do some basic validation of its constructor arguments, but
it does not validate the bundle parameters. Runway validates each request. An
exception is raised for failed requests.

Neither the Runway API nor the client will report the status of processing the
assessment files. To check the status and results, you'll need to go to the
Runway UI.
