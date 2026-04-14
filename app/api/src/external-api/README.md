# External API

The External API allows external systems to programmatically submit jobs to Runway and retrieve processed output files using OAuth2 bearer tokens.

## Configuration

### Environment Variables

| Variable          | Required | Description                                                                                                                                                                                                                           |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OAUTH2_ISSUER`   | Yes      | The OIDC issuer URL (e.g., `https://idp.example.com/realms/my-realm`). The API uses OIDC discovery to fetch the JWKS for token validation. If not set, the external API will be disabled; the rest of the app will function normally. |
| `OAUTH2_AUDIENCE` | No       | Only used for local development. Deployed environments automatically expect the audience to match the backend URL.                                                                                                                    |

### Identity Provider Client Setup

Configure an OAuth2/OIDC client in your identity provider with:

1. **Grant type**: Client credentials (for machine-to-machine access)
2. **Audience**: Set to match the Runway backend URL (e.g., `https://api.runway.example.com`)
3. **Scopes**: The token's `scope` claim must include:
   - `create:jobs` — Required to create and start jobs
   - `read:jobs` — Required to list output sets
   - `read:jobs:output-files` — Required to fetch presigned download links for output files
   - `partner:<code>` — One or more partner scopes (e.g., `partner:acme`) to authorize access to specific partners

### Token Claims

The access token must include the following claims:

| Claim         | Required | Description                                                                                        |
| ------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `client_id`   | Yes\*    | The OAuth2 client ID. Used to attribute jobs to the API client.                                    |
| `azp`         | Yes\*    | Authorized party. Used as fallback if `client_id` is not present.                                  |
| `client_name` | No       | Display name for the API client. If provided, shown in the Runway UI for jobs created via the API. |

\* At least one of `client_id` or `azp` must be present. Most OAuth2 providers include `client_id` by default in client credentials tokens.

### Local Development

The local Keycloak instance (started by `docker compose`) comes pre-configured with a `runway-api` client for the external API. No additional IdP setup is needed.

The client is configured in [`api/keycloak/config.yaml`](../../../api/keycloak/config.yaml) with the `create:jobs`, `read:jobs`, `read:jobs:output-files`, and `partner:ea` scopes and an audience of `runway-local`.

Get a token and verify it:

```bash
# Obtain a token from local Keycloak
TOKEN=$(curl -s -X POST http://localhost:8080/realms/example/protocol/openid-connect/token \
  -d "grant_type=client_credentials" \
  -d "client_id=runway-api" \
  -d "client_secret=api-secret-123" | jq -r '.access_token')

# Verify it against the local API
curl -X POST http://localhost:3333/api/v1/token/verify \
  -H "Authorization: Bearer $TOKEN"
```

## API Usage

All requests must include:

```
Authorization: Bearer <access_token>
```

### Endpoints

| Method | Endpoint                                     | Description                                            |
| ------ | -------------------------------------------- | ------------------------------------------------------ |
| POST   | `/api/v1/jobs`                               | Create a job and get presigned S3 upload URLs          |
| POST   | `/api/v1/jobs/:jobUid/start`                 | Start a job after uploading files                      |
| GET    | `/api/v1/output-sets`                        | List output sets for successful runs                   |
| POST   | `/api/v1/output-sets/:setUid/download-links` | Get presigned download URLs for files in an output set |
| POST   | `/api/v1/token/verify`                       | Verify a token and see which partners it authorizes    |

### Workflow Overview

There are two related but independent flows:

1. **Job submission flow**: Use `POST /api/v1/jobs` and `POST /api/v1/jobs/:jobUid/start` to create and launch jobs through the external API.
2. **Output retrieval flow**: Use `GET /api/v1/output-sets` and `POST /api/v1/output-sets/:setUid/download-links` to discover and download processed JSONL output files for successful runs.

The output retrieval endpoints are not limited to jobs created through the external API. They can be used to pull output files for any job, whether created via the API or the web app, as long as the caller has the required partner scope and read scopes.

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
    "scope": "create:jobs read:jobs read:jobs:output-files partner:<partner_code>",
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

**Limitation:** `/api/v1/token/verify` currently requires the `create:jobs` scope, so a token intended only for output retrieval cannot use this endpoint for validation.

---

## Job Submission Flow

Use this flow when you want to create and run a job through the external API.

### Step 1: Create the Job

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
| `schoolYear` | string | Yes      | 4-digit end year of the school year (e.g., `2026` for 2025–26)           |
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
    "schoolYear": "2026",
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

### Step 2: Upload Files to S3

Use the presigned URLs from the previous response to upload your input files. You can use any HTTP client—no AWS SDK required.

```bash
curl -X PUT \
  -H "Content-Type: application/octet-stream" \
  --data-binary @input_file.csv \
  "<presigned_url>"
```

---

### Step 3: Start the Job

`POST /api/v1/jobs/:jobUid/start`

After uploading all files, tell Runway to start the job:

```bash
curl -X POST \
  --url <runway_api_url>/api/v1/jobs/<job_uid>/start \
  --header 'Authorization: Bearer <token>'
```

Returns `202 Accepted` on success.

---

## Output Retrieval Flow

Use this flow when you want to discover and download processed output files from successful runs.

### Step 1: List Output Sets

`GET /api/v1/output-sets`

Use this endpoint to poll for processed output sets from successful runs.

### Required Scope

- `read:jobs`

### Query Parameters

| Field          | Type    | Required | Description                                                              |
| -------------- | ------- | -------- | ------------------------------------------------------------------------ |
| `partner`      | string  | Yes      | Partner code. Must match a `partner:<code>` scope on the token.          |
| `tenant`       | string  | No       | Filter to a tenant code                                                  |
| `schoolYear`   | string  | No       | 4-digit school-year end year (for example `2026`)                        |
| `sentToOds`    | boolean | No       | Filter to output sets that were or were not sent to an ODS               |
| `createdAfter` | string  | No       | ISO 8601 timestamp. Only output sets created after this value are listed |
| `bundle`       | string  | No       | Filter to a bundle key such as `assessments/PSAT_SAT`                    |

### Example Request

```bash
curl -G \
  --url <runway_api_url>/api/v1/output-sets \
  --header 'Authorization: Bearer <token>' \
  -d 'partner=acme' \
  -d 'tenant=acme' \
  -d 'sentToOds=false' \
  -d 'createdAfter=2026-03-01T00:00:00Z'
```

### Response

The response is a flat array of output sets ordered by `createdAt` ascending.

```json
[
  {
    "uid": "f1a2b3c4-d5e6-7890-abcd-ef1234567890",
    "files": ["studentAssessments.jsonl", "objectiveAssessments.jsonl"],
    "sentToOds": false,
    "createdAt": "2026-03-15T14:30:00Z",
    "jobUid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "partner": "acme",
    "tenant": "acme",
    "schoolYear": "2026",
    "bundle": "assessments/PSAT_SAT"
  }
]
```

---

### Step 2: Get Download Links for an Output Set

`POST /api/v1/output-sets/:setUid/download-links`

Use the output set `uid` from the previous step to fetch presigned download links for all files in the set.

### Required Scope

- `read:jobs:output-files`

### Example Request

```bash
curl -X POST \
  --url <runway_api_url>/api/v1/output-sets/<set_uid>/download-links \
  --header 'Authorization: Bearer <token>'
```

### Response

```json
{
  "downloadLinks": {
    "studentAssessments.jsonl": "https://s3.amazonaws.com/bucket/path/studentAssessments.jsonl?X-Amz-...",
    "objectiveAssessments.jsonl": "https://s3.amazonaws.com/bucket/path/objectiveAssessments.jsonl?X-Amz-..."
  }
}
```

Presigned URLs have a 1-hour TTL, but will also expire early if the API server's AWS session credentials rotate before the TTL elapses (whichever comes first). API consumers should treat download links as short-lived and request a fresh set if a download fails.

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
| 404    | Resource not found or not accessible to this token                     |
| 503    | External API disabled (issuer not configured)                          |
