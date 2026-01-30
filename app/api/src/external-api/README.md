# External API

The External API allows external systems to programmatically submit jobs to Runway using OAuth2 bearer tokens.

## Configuration

### Environment Variables

| Variable                      | Required | Description                                                                                                                                                                                                                           |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXTERNAL_API_TOKEN_ISSUER`   | Yes      | The OIDC issuer URL (e.g., `https://idp.example.com/realms/my-realm`). The API uses OIDC discovery to fetch the JWKS for token validation. If not set, the external API will be disabled; the rest of the app will function normally. |
| `EXTERNAL_API_TOKEN_AUDIENCE` | No       | Only used for local development. Deployed environments automatically expect the audience to match the backend URL.                                                                                                                    |

### Identity Provider Client Setup

Configure an OAuth2/OIDC client in your identity provider with:

1. **Grant type**: Client credentials (for machine-to-machine access)
2. **Audience**: Set to match the Runway backend URL (e.g., `https://api.runway.example.com`)
3. **Scopes**: The token's `scope` claim must include:
   - `create:jobs` — Required to create and start jobs
   - `partner:<code>` — One or more partner scopes (e.g., `partner:acme`) to authorize access to specific partners

## API Usage

All requests must include:

```
Authorization: Bearer <access_token>
```

### Endpoints

| Method | Endpoint                     | Description                                         |
| ------ | ---------------------------- | --------------------------------------------------- |
| POST   | `/api/v1/jobs`               | Create a job and get presigned S3 upload URLs       |
| POST   | `/api/v1/jobs/:jobUid/start` | Start a job after uploading files                   |
| POST   | `/api/v1/token/verify`       | Verify a token and see which partners it authorizes |

### Workflow Overview

1. **Obtain a token** from your identity provider using client credentials
2. **Create a job**: `POST /api/v1/jobs` — Returns presigned S3 upload URLs
3. **Upload files** to the presigned URLs
4. **Start the job**: `POST /api/v1/jobs/:jobUid/start`

---

## Step 1: Obtain an Access Token

Request a token from your identity provider using the client credentials flow:

```bash
curl --request POST \
  --url <issuers_token_endpoint> \
  --header 'Content-Type: application/json' \
  --data '{
    "client_id": "<client_id>",
    "client_secret": "<client_secret>",
    "audience": "<api_audience>",
    "scope": "create:jobs partner:<partner_code>",
    "grant_type": "client_credentials"
  }'
```

### Test Your Token

You can verify your token is configured correctly:

```bash
curl --request POST \
  --url <runway_api_url>/api/v1/token/verify \
  --header 'Authorization: Bearer <token>'
```

This endpoint verifies that the token is signed by the expected issuer, has the correct audience, and includes the `create:jobs` scope. The response indicates which partner(s) the token is authorized to operate on.

---

## Step 2: Create the Job

`POST /api/v1/jobs`

This request initializes the job in Runway. Runway will:

- Validate that the requested bundle exists and is enabled for the partner
- Validate that the payload meets the requirements specified in the bundle's [`_metadata.yml`](https://github.com/edanalytics/earthmover_edfi_bundles/blob/main/assessments/ACT/_metadata.yaml)
- Validate that an ODS exists for the requested school year and tenant
- Create a job record
- Generate presigned S3 upload URLs for the input files

### Request Body

| Field        | Type   | Required | Description                                                              |
| ------------ | ------ | -------- | ------------------------------------------------------------------------ |
| `partner`    | string | Yes      | Partner code. Must match the `partner:<code>` scope in the access token. |
| `tenant`     | string | Yes      | Tenant code associated with the partner                                  |
| `bundle`     | string | Yes      | Bundle identifier, formatted as `assessments/<bundle-name>`              |
| `schoolYear` | string | Yes      | 4-digit school year in Y1Y2 format (e.g., `2526` for 2025–26)            |
| `files`      | object | Yes      | Map of file keys to filenames (see below)                                |
| `params`     | object | No       | Map of parameter names to values (see below)                             |

The keys in `files` and `params` correspond to the `env_var` values in the bundle's [`_metadata.yml`](https://github.com/edanalytics/earthmover_edfi_bundles/blob/main/assessments/ACT/bundle_metadata.yml). The values in `files` are the filenames (used for display in the UI and naming on S3—do not include path information).

### Example Request

```bash
curl --request POST \
  --url <runway_api_url>/api/v1/jobs \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "partner": "acme",
    "tenant": "acme",
    "bundle": "assessments/PSAT_SAT",
    "schoolYear": "2526",
    "files": {
      "INPUT_FILE": "sat_results.csv"
    },
    "params": {
      "TEST_TYPE": "SAT"
    }
  }'
```

### Response

| Field        | Type   | Description                                  |
| ------------ | ------ | -------------------------------------------- |
| `uid`        | string | Unique identifier for the created job        |
| `uploadUrls` | object | Map of file keys to presigned S3 upload URLs |

```json
{
  "uid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "uploadUrls": {
    "INPUT_FILE": "https://s3.amazonaws.com/bucket/path?X-Amz-..."
  }
}
```

---

## Step 3: Upload Files to S3

Use the presigned URLs from the previous response to upload your input files. You can use any HTTP client—no AWS SDK required.

```bash
curl -X PUT \
  -H "Content-Type: application/octet-stream" \
  --data-binary @input_file.csv \
  "<presigned_url>"
```

---

## Step 4: Start the Job

`POST /api/v1/jobs/:jobUid/start`

After uploading all files, tell Runway to start the job:

```bash
curl -X POST \
  --url <runway_api_url>/api/v1/jobs/<job_uid>/start \
  --header 'Authorization: Bearer <token>'
```

Returns `202 Accepted` on success.

---

## API Documentation

For detailed request/response schemas:

- **Swagger UI**: Run the app locally and navigate to `/api` on the backend URL
- **DTOs**: See [`app/models/src/dtos/external-api/job.v1.dto.ts`](../../../models/src/dtos/external-api/job.v1.dto.ts)

## Error Responses

| Status | Meaning                                                                |
| ------ | ---------------------------------------------------------------------- |
| 401    | Missing or invalid token                                               |
| 403    | Insufficient scopes or unauthorized partner                            |
| 400    | Invalid request (missing required input, unexpected input files, etc.) |
| 503    | External API disabled (issuer not configured)                          |
