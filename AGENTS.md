# Runway — AI Agent Context

> Context for AI coding assistants (Claude Code, Codex, Cursor, etc.). Update as the project evolves.

Runway is a UI for integrating K-12 education data to the [Ed-Fi](https://www.ed-fi.org/) standard, built on top of [earthmover](https://github.com/edanalytics/earthmover) (data transformation) and [lightbeam](https://github.com/edanalytics/lightbeam) (Ed-Fi API loading).

## Components

- **`app/`** — Node.js monorepo (NX workspace): NestJS backend + React frontend
- **`executor/`** — Python job executor (earthmover + lightbeam)
- **`cloudformation/`** — AWS deployment templates

## App Layout (`app/`)

```
app/
├── api/                # NestJS backend
│   ├── src/            # Application source
│   │   └── database/   # Prisma schema + Postgrator migrations
│   └── integration/    # Integration tests + helpers
├── fe/                 # React frontend
├── models/             # Shared TypeScript types
└── utils/              # Shared utilities
```

## Tech Stack

- **Frontend**: React 18, **Chakra UI v2** (custom tokens: `blue.50`, `pink.100`, `gray.50`, `green.100`), TanStack Router + Query, react-hook-form
- **Backend**: NestJS, Prisma ORM, PostgreSQL, Passport.js (OIDC for UI auth), [jose](https://github.com/panva/jose) (JWT for external API auth)
- **Build**: NX monorepo, TypeScript throughout `app/`
- **CI**: GitHub Actions — `.github/workflows/app_ci_pipeline.yml`

## Testing

### App tests (run from `app/`)

**Full suite — CI/local parity** (spins up a Dockerized test DB in CI and local runs):

```bash
npm run api:test
```

**Quick integration tests — local dev** (starts the test DB if needed, leaves it running):

```bash
npm run api:test:integration:local
```

To run integration suites in more than one git worktree at once, give each worktree its own test DB port and Compose project in `app/api/.env.test.local` (see `app/api/integration/README.md`).

**Unit tests** (no DB or Docker required):

```bash
npx nx test-unit api
```

Prefer integration tests; write a unit test only when integration tests can't practically reach the logic (e.g. code behind mocked AWS clients, like task-size selection in `executor.aws.service.spec.ts`). Unit tests are `*.spec.ts` files next to the code they test in `api/src/`, and must assert behavior that can really break — not just that mocks were called. Both suites run as part of `npm run api:test`.

**Typechecking:**

```bash
npm run api:typecheck
npm run fe:typecheck
```

## Database Migrations

Schema changes follow this workflow (all commands run from `app/`):

1. Write a SQL migration file in `app/api/src/database/postgrator/migrations/`
2. Present the SQL for review and get explicit user approval
3. Run `npm run api:migrate-local-dev` to apply the migration to the local dev DB
4. Run `npm run prisma:pull-and-generate` to introspect the DB and regenerate the Prisma schema + client
5. Verify the Prisma schema diff contains all and only the expected changes

**Do not edit `schema.prisma` directly** — it is generated from the database via `prisma:pull-and-generate`. The SQL migration is the source of truth.

The one exception is typing JSON columns with `prisma-json-types-generator`: add a `/// [TypeName]` line directly above the field, and declare `TypeName` in the `PrismaJson` namespace in `app/models/src/utils/prisma-json-types.ts`, where both the API and the frontend see it. Re-introspection preserves these annotations on existing fields, so they survive `prisma:pull-and-generate`.

Migrations run automatically at the start of the integration test suite. If tests fail with schema errors, a missing or mismatched migration is the likely cause.

The generated Prisma client lives in `node_modules` and isn't committed, so after pulling or merging changes to `schema.prisma` or `prisma-json-types.ts`, run `npm run prisma:generate-client`. Typecheck errors on Prisma JSON fields, such as `'run.job.template' is of type 'unknown'`, mean the client is stale.

## Architecture

### Deployed Infrastructure

- **App**: Elastic Beanstalk (EC2 + ALB), frontend on S3 + CloudFront
- **Executor**: ECS Fargate (3 task sizes: small/medium/large). The app picks the size per run: `medium` by default, `large` when the job's input files total at least `ECS_FILE_SIZE_THRESHOLD_MB` (default 100)
- **Database**: RDS PostgreSQL (private subnet)
- **Network**: VPC with public + private subnets across 2 AZs
- **CI/CD**: CodePipeline + CodeBuild → Beanstalk deploy + ECR push
- **Security**: WAF on ALB, IAM scoped roles, Secrets Manager
- **Monitoring**: CloudWatch dashboards + alarms, EventBridge → Slack via Lambda

### Job Execution Flow

```mermaid
sequenceDiagram
    participant User as Browser
    participant App as App (NestJS)
    participant DB as PostgreSQL
    participant S3 as AWS S3
    participant ECS as AWS ECS Fargate
    participant Exec as Executor (Python)
    participant ODS as Ed-Fi ODS API

    User->>App: POST /jobs (create job)
    App->>DB: Create Job + JobFile records
    App->>S3: Generate presigned upload URL
    App-->>User: { jobId, uploadLocations[] }

    User->>S3: PUT file (direct upload via presigned URL)

    User->>App: PUT /jobs/{id}/start
    App->>DB: Create Run record
    App->>ECS: RunTask (Fargate) with INIT_TOKEN, INIT_JOB_URL, AWS creds

    ECS->>Exec: Container starts
    Exec->>App: GET /api/earthbeam/jobs/{runId} (init handshake)
    App-->>Exec: Auth token + job definition (files, ODS creds, bundle, callback URLs)

    Exec->>ODS: lightbeam fetch (student roster)
    Exec->>S3: Download input files
    Exec->>Exec: earthmover run (transform data)
    Exec->>ODS: lightbeam send (load to ODS)
    Exec->>S3: Upload output artifacts
    Exec->>App: POST /output-files (path + sentToOds → app lists S3, saves run_output_file_set)

    Exec->>App: POST /status, /error, /summary, /unmatched-ids
    Exec->>App: POST /status {action: done}

    App->>S3: List output files → create RunOutputFile records

    User->>App: GET /jobs/{id}/output-files/{name}
    App->>S3: Generate presigned download URL
```

### AWS Dependencies

| Service | Used By | Purpose |
|---|---|---|
| **S3** | App + Executor | File storage — presigned upload/download URLs, executor artifact I/O |
| **ECS Fargate** | App | Launches executor container |
| **STS** | App | Generates scoped temporary credentials for executor S3 access |
| **SSM Parameter Store** | App | ECS cluster/subnet/task definition config |
| **Secrets Manager** | App | Database credentials, app config |
| **EventBridge** | App | Run-completion notifications (Slack, etc.) |
| **ECR** | CI/CD | Executor Docker image registry |

### Key Files — AWS Touchpoints

- `app/api/src/files/file.service.ts` — S3 presigned URL generation
- `app/api/src/earthbeam/executor/executor.aws.service.ts` — ECS task launch, STS assume role
- `app/api/src/event-emitter/event-emitter.service.ts` — EventBridge notifications
- `app/api/src/config/app-config.service.ts` — Secrets Manager + SSM reads

### Key Files — App ↔ Executor Communication

- `app/api/src/earthbeam/api/earthbeam-api.controller.ts` — HTTP callback endpoints the executor calls
- `app/api/src/earthbeam/api/earthbeam-api.service.ts` — Job payload assembly, run completion
- `app/api/src/idrs/idrs-credentials.service.ts` — IDRS OAuth token minting + per-partner cache
- `app/models/src/dtos/earthbeam-api.dto.ts` — Job payload shape
- `executor/executor/executor.py` — Main executor: S3 operations, HTTP callbacks, earthmover/lightbeam invocation

### Executor Lifecycle

1. **Init**: GET `INIT_JOB_URL` with `INIT_TOKEN` → receives auth token + job URL
2. **Job fetch**: GET job URL → full job definition (files, ODS creds, bundle, callback URLs)
3. **Bundle refresh**: git fetch/checkout/pull the earthmover bundle
4. **Roster fetch**: `lightbeam fetch` student roster from ODS, upload artifact to S3
5. **File download**: Download user-uploaded input files from S3
6. **Transform**: `earthmover run` against the ODS roster (with encoding detection + retry)
7. **Cross-year retry** (when `crossYearMatchAvailable` and the first pass produced unmatched students): GET `appUrls.roster` for the cross-year NDJSON roster, write to a `.jsonl` file, and re-run `earthmover` against it using the same ID type.
8. **Load**: `lightbeam send` to Ed-Fi ODS
9. **Report**: POST summary, unmatched IDs, errors to app via callback URLs
10. **Output files**: POST output file path + `sentToOds` flag to `/output-files` callback; app validates path, lists S3, saves `run_output_file_set`
11. **Done**: POST status `{action: DONE, status: success|failure}`

In the fuzzy matching modes the executor also calls `appUrls.identityService` immediately before using IDRS, exchanging its run-scoped bearer token for `{ token, url }`. See ID matching modes below. (Executor-side IDRS use is EDFIAL-481.)

### Cross-Year Matching Flow

When cross-year matching runs, the executor progresses through each stage of processing for both rosters before moving on, to avoid mixed-status jobs (e.g., a file failing "insufficient matches" against the ODS roster but succeeding against the cross-year roster, when those matches really belonged in the ODS).

```mermaid
flowchart TD
    Input[Uploaded input rows] --> T1[earthmover: match + transform<br/>against ODS roster]
    T1 -->|on success, if crossYearMatchAvailable<br/>and step 7 triggered| T2[earthmover: match + transform<br/>against cross-year EDU roster]
    T1 -->|on success, otherwise| Load
    T2 -->|both transforms succeeded| Load[lightbeam send<br/>ODS-matched rows → ODS]
    Load -->|ODS load succeeded| App[POST results to Runway app<br/>ODS-matched + cross-year-matched rows<br/>exposed via API]
    App -.fetched by.-> EDU[EDU / external API consumers]
```

Cross-year-matched rows are never sent to the ODS — they're only made available through the Runway app's API, which EDU and other external consumers query.

### Roster sources & no-ODS year selectability

A roster is the student lookup the executor matches input rows against. Source precedence:

1. **ODS** — for `sendToOds` years, the executor fetches the roster from the ODS API.
2. **EDU** — the cross-year roster from EDU (Snowflake), pulled via `appUrls.roster` as NDJSON when `crossYearMatchAvailable`. Two roles: for ODS years, it's the second-pass match for IDs that didn't match the ODS roster (see Cross-Year Matching Flow — those rows are never sent to the ODS); for no-ODS (`sendToOds=false`) years, it's the roster source, preferred over the S3 file (the executor handles this preference).
3. **S3 roster file** — the fallback for no-ODS years when cross-year matching is unavailable (`__rosters/...jsonl`). The app omits `rosterFilePath` from the payload when `crossYearMatchAvailable` is true (it would be a dangling pointer).

A no-ODS year is **selectable** at job creation, and shows **green** ("roster available") on the ODS-config page, when a roster file exists **OR** the partner has cross-year matching enabled. The executor payload's `crossYearMatchAvailable` is the same partner setting (`crossYearMatchingEnabled`) — there is no creds/connection check at run-prep time. The admin enable endpoint requires working EDU creds to turn the toggle on; once on, the EDU connection is an assumed dependency like postgres or S3: if EDU is unavailable mid-run, the run fails loudly at roster-fetch time rather than silently degrading to weaker matching. (In practice a tenant has either a roster file or an EDU connection, not both, so there is no fallback to preserve.)

All of this applies to the `id_based` and `id_based_fuzzy_background` modes. Pure `fuzzy` does no roster matching at all, so the payload carries neither roster source — but the existing no-ODS selectability gate is unchanged, so a no-ODS fuzzy job is still only creatable when a roster file exists or cross-year matching is enabled. Widening that is follow-on work.

### ID matching modes

How student identities are resolved is a per-partner setting, `id_matching_mode`, snapshotted onto each job at creation (`JobsService.createJob` writes it explicitly; the column default is migration safety only). Every run of a job uses that snapshot, so changing the partner setting affects only jobs created afterwards. There is no configuration UI yet.

| Mode | Authoritative path | Roster matching | `appUrls.identityService` / `appUrls.studentMatchResults` |
|---|---|---|---|
| `id_based` | Existing ID-based processing | ODS / EDU / S3 as above | absent |
| `id_based_fuzzy_background` | Existing ID-based processing | ODS / EDU / S3 as above | present |
| `fuzzy` | IDRS fuzzy matching | none — `appUrls.roster` and `rosterFilePath` are both omitted | present |

`crossYearMatchAvailable` still mirrors the live partner setting in every mode; in `fuzzy` it only tells the executor that IDRS results may span years.

**Credential handoff.** The payload never carries an IDRS token. The executor calls `GET /earthbeam/jobs/:runId/identity-service` with its run-scoped bearer token, which is the whole trust boundary: it names the run, hence the partner whose connection info may be returned. The callback deliberately has no mode check, no run-status check (background fuzzy work continues after the run reports `done`) and no one-call limit.

One IDRS service per deployment at `IDRS_URL`, with each partner addressed by request path and authenticated as its own OAuth client. The app loads that partner's `{ clientId, clientSecret }` from the `{ENVLABEL}-idrs-connection-info-{partnerId}` secret, uncached and bounded to 5s, then mints a client-credentials token from the shared `IDRS_OAUTH_TOKEN_URL` (one request, bounded to 5s) with `audience` set to `IDRS_URL` verbatim and `scope` of `student:identity:read partner:<partner-id>`. Locally, `IDRS_CLIENT_ID` / `IDRS_CLIENT_SECRET` stand in for the secret. Tokens are cached per partner per app instance while more than ten minutes of life remain; anything shorter or without a usable `expires_in` is returned but not cached. The `url` returned to the executor is the full student-search route — `IDRS_URL` plus `/partners/{partnerId}/tenants/{tenantCode}/students/search` — because the executor calls it as-is. `IDRS_URL` itself is never rewritten; it is also the OAuth audience, which must match verbatim.

Every failure is the same response, `500 identity_service_unavailable`: the executor only distinguishes 200 from non-200, so a finer taxonomy would have bought nothing it could act on. Diagnosis comes from the log line at the callback boundary (run id, partner id, elapsed time, upstream error name or status); credentials, tokens, OAuth bodies and the callback response are never logged. `AppConfigService.getIdrsConnectionInfo` follows the adjacent EDU getter — null for missing or malformed config, real AWS failures thrown.

Rollout order: set `IDRS_OAUTH_TOKEN_URL` and `IDRS_URL` and deploy an executor that implements EDFIAL-481, both once per deployment; then, per partner, provision the secret and change the partner's mode. There is no enable-time preflight — an `id_based` executor calling the unadvertised callback gets a `500` and a `no IDRS connection info for partner <id>` log, which is expected and harmless.

The executor step is a hard prerequisite, not an ordering preference. An executor that predates EDFIAL-481 ignores `idMatchingMode` and `appUrls.identityService` entirely, so a partner switched to either fuzzy mode gets the old roster-based path against a payload built for the new one: pure fuzzy omits both roster sources the old executor unconditionally reads. Deploying the app itself is safe at any time while every partner is still `id_based`.

The config and secret steps are owned by the cloud engineering team and happen outside this repo: neither `IDRS_OAUTH_TOKEN_URL` nor `IDRS_URL` is threaded through `cloudformation/` (unlike `OAUTH2_ISSUER` or `UM_CONFIG_SECRET`), and the per-partner `{ENVLABEL}-idrs-connection-info-{partnerId}` secrets are provisioned directly. Don't add the stack wiring here — coordinate with cloud eng instead.

#### Student match results

The Executor posts IDRS match results — each group of input details with the suggestions IDRS returned for it — to `POST /api/earthbeam/jobs/:runId/student-match-results` (`StudentMatchResultsService`), advertised as `appUrls.studentMatchResults` alongside the identity service. Today it sends only students IDRS could not resolve. Sending auto-matched students too would need a way to record the automatic resolution; otherwise they would look like students awaiting review. It is unrelated to the older `unmatchedIds` callback.

The body is a JSON array of `EarthbeamApiStudentMatchResultDto` (`app/models`): a `correlation_id` (opaque, 1–128 characters), a `candidate` object of input details, and a possibly empty `matches` array whose entries carry a `student_unique_id`, a numeric `score` and roster details. It is stored exactly as sent, with unknown keys kept and nothing normalized, so fields IDRS adds later are already stored when the app starts using them, and malformed details — which may be why a record needs review — survive verbatim.

Three tables hold it: `student_input_details`, keyed by `(job_id, correlation_id)`; `student_match_result`, one row per input group per run, present even when the run found no suggestions; and `student_match_suggestion`, keyed by `(result_id, ordinal)`, a position within a result rather than a student identity. Job, partner and tenant come from the authenticated run, never the body, and composite `(run_id, job_id)` foreign keys enforce it.

**Validation.** The DTO checks the shape, and the columns the fields land in back it up. One rule is the DTO's alone: that `matches` is an array, since the array lands in no column; without the check, a missing `matches` would be stored as "IDRS found nothing". Any rejection rolls back the whole request.

**Duplicate correlation ids** within a request aren't checked: the DTO can't see across records, and the Executor sends one entry per correlation id. If it ever sent duplicates, a shared id means the same input and therefore the same matches. Duplicates without matches collapse into one input row and one result. Duplicates with matches collide on the suggestion primary key, so the request fails with nothing written. Stored data could be wrong only if a correlation id were attached to the wrong input or matches at the source, which the app doesn't guard against.

| Status | Meaning |
|---|---|
| 201 | Stored, or a retry that changed nothing. Empty body. The same as the other Executor callbacks, one of which the Executor checks for exactly 201 |
| 400 | The body doesn't match the DTO. `message` names each failing record by index and rule, e.g. `[3] matches must be an array`, never a value. The app doesn't log 400s, so the Executor should log this body |
| 401 / 403 | Missing token, or a token for a different run |
| 404 | No such run |
| 413 | Body over the JSON parser limit: Nest's default, pending the agreed cap (below) |
| 500 | The database rejected the payload, or persistence failed. Nothing was written. The app logs the SQLSTATE, never the message, since a constraint violation's detail quotes the failing row. A payload containing a NUL character (`\u0000`) always lands here, since PostgreSQL's `jsonb` cannot store one; retrying the same bytes fails the same way |

**Retries and runs.** A retry re-sends exactly what was already sent; the Executor never re-queries IDRS for a group it has reported. So a retry is a no-op: the first report of a group wins, and nothing stored is rewritten. A job's first run is the one that extracts input details and calls IDRS, so it establishes every input row. Results are keyed by run so that a later search of the same input, such as rematching (not yet built), adds history rather than overwriting it.

Each request is one transaction, for atomicity: a failure between the three inserts would otherwise leave a result with no suggestions, which looks like a genuine no-match and which a retry cannot repair. No row lock is taken: every insert is `ON CONFLICT DO NOTHING` against a unique key, so overlapping requests, such as a timed-out retry racing its original, still store one consistent dataset.

This endpoint never changes run state; acting on a failure is the Executor's job. In `fuzzy` it fails the run; in `id_based_fuzzy_background` it stops only the background processing. That mode is watched through app and Executor logs, with no background-failure UI.

**Outstanding:** the request byte limit is not yet set. The endpoint currently runs under Nest's default JSON parser, so a large batch is rejected by that default rather than by an agreed limit. Confirm the cap and any record cap with cloud engineering and the Executor, then register a route-scoped parser for this route only — check the `SizeRestrictions_BODY` rule in `cloudformation/templates/0-waf.yml` against deployed behavior rather than assuming the app-side constant is sufficient.

`GET /api/jobs/:jobId/student-match-results` (`JobsService.getStudentMatchResults`) returns a job's students to match, for review; no frontend reads it yet. It is tenant-scoped like the job's other reads, and needs `job.match-results.read`, which every role has. Across tenants it also needs `job.metatenant.match-results.read`, which only support users have: each match-results route pairs its privilege with a `job.metatenant` one of the same name, as the output-file routes do, since the results expose students' details. It returns `{ counts, students }`, where `counts` is `{ total, toReview, ready, excluded }`: every student has exactly one status, so the statuses add up to the total. Each student carries its input details, its `status` and `decision` (see **Decisions**), and every run's result for it, ordered by run, with each result's suggestions in ordinal order. Students are ordered by correlation id for a stable order (the ids are opaque hashes, so it isn't file order). Result ids come back as strings because they are `BIGINT`, and scores as numbers. The details and roster JSON come back as stored, in snake_case. The counts and the students are read in one snapshot, so they agree.

There is no pagination. A real review queue is under 10 students, a few hundred at most; thousands means the file needs fixing, not reviewing. Past `MATCH_REVIEW_STUDENT_LIMIT` (1,000) the endpoint returns `counts` with `students: null`, and doesn't fetch the students.

**Decisions.** `POST /api/jobs/:jobId/student-match-results/:correlationId/decisions` saves a match to one of a student's suggestions or to a search hit, excludes the student from the job, or clears either, returning the student to review rather than restoring an earlier decision. The body is `{ replacesVersion, kind, resultId?, ordinal?, searchHit? }`, with `kind` one of `match`, `exclude` or `clear`. Only a match names a target: either a suggestion, by `resultId`, a string since it is `BIGINT`, and `ordinal`; or a `searchHit`, `{ searchDetails, studentUniqueId, score, rosterDetails }`, a hit as **Search** (below) returned it with the details it was found with. With a `searchHit`, `resultId` and `ordinal` are ignored; a null `searchHit` is the same as none. An exclude or clear ignores every target. The endpoint needs `job.match-results.update`, which every role has, and across tenants also `job.metatenant.match-results.update`, which only support users have. It works only on `fuzzy` jobs. Any other mode is 403 for every role, checked in the handler from the job's own mode. The body is validated first, so a malformed body is 400 in any mode.

Decisions are append-only, in `student_match_decision`. Each write inserts the student's next `seq`, from 1 with no gaps. The app never updates rows, and they are deleted only with their job. A student's current decision is their highest `seq`, and a `clear` there means they have none. Their `status` follows from it (`studentMatchStatus`): `match` is `ready`, `exclude` is `excluded`, and `clear` or none is `to-review`. `decided_by_id` and `decided_on` are written by the insert; the table has no audit triggers. A match to a suggestion references it by `(result_id, ordinal)` and copies nothing from it, and composite foreign keys ensure the suggestion comes from a search for the same student. A match to a search hit stores the hit on the decision row instead, in `student_unique_id`, `score`, `roster_details` and `search_details`, with the search details as search sends them to IDRS. A check allows exactly one of the two targets. The rest of the hit is stored as sent, without searching again or rechecking its school years, and nothing else about the search is stored.

A decision's `seq` is also its `version`, the concurrency token. A write names, as `replacesVersion`, the version of the decision it saw, or null if it saw none, and a single guarded insert writes the next `seq` only if that is still current: the latest row for a version, or no rows or a clear for null. Two racing writes compute the same `seq`, so the primary key refuses the loser in the same statement. Clears never reach the client, which only ever sees a decision or none. Since `seq` never restarts, a decision cleared and made again has a new version, so a view of the old one is refused. A view of no decision stays current across a decision made and cleared, since the student is undecided again, just as it showed.

A match to a suggestion must pick from the student's latest result, the one from the highest run. New results never invalidate a decision already made, so a current match can point into an earlier result. That's why the read returns every result.

| Status | Meaning |
|---|---|
| 201 | `{ decision }`: the student's current decision, which is null after a clear. A decision is `{ version, kind, resultId, ordinal, searchHit, decidedBy, decidedOn }`. `searchHit` is null unless the match is to a hit, and then `resultId` and `ordinal` are null |
| 400 | The body doesn't match the DTO, or `invalid_target`: the suggestion isn't in one of this student's results |
| 401 / 403 | Not logged in, another tenant, no privilege, or not a `fuzzy` job |
| 404 | `not_found`: the job has no such student. An unknown job is also a 404, with Nest's body and no `code` |
| 409 `decision_changed` | `replacesVersion` isn't the current decision's, or a clear has nothing to clear. Nothing was written |
| 409 `results_changed` | A match to an earlier result: a later run has searched again. Nothing was written |
| 500 | An unexpected database failure, logged with the job id and SQLSTATE, never the message. If it came after the insert, the decision was saved, and a retry gets a 409. A search hit containing a NUL character (`\u0000`) always lands here, since PostgreSQL's `text` and `jsonb` cannot store one; retrying the same bytes fails the same way |

The coded errors (404, 400 `invalid_target`, 409) have the body `{ statusCode, code, message }`: the page acts on `code`, and `message` is for generic error display. Neither carries student data. On a 409 the page refetches. A 400 from DTO validation has Nest's own body, with no `code`.

**Search.** `POST /api/jobs/:jobId/student-match-results/:correlationId/search` searches IDRS for one of the job's students with a reviewer's details, to find a student IDRS didn't suggest. It's a POST because the details are student data, which stay out of URLs, and it stores nothing. It needs `job.match-results.search`, which every role has, and across tenants also `job.metatenant.match-results.search`, which only support users have. Like decisions, it works only on `fuzzy` jobs, and the body is validated first.

The body is IDRS's own input, in its snake_case: `{ first_name?, last_name?, birth_date?, school_ids?, student_ids? }`, the shape of the stored input details. It's validated against IDRS's input schema: strings, a real `YYYY-MM-DD`, integer `school_ids` and string `student_ids`, with null the same as absent. Only those five fields are forwarded, since the global `ValidationPipe` keeps unknown keys and IDRS rejects them. A student unique id in `student_ids` finds that student, if the other details don't conflict. Inputs are bounded only by the JSON body limit: they go only to IDRS and, for a saved hit, into one JSONB column, so per-field caps would guard nothing more. The app sends one input, under the student's correlation id, to the job's tenant's search route, with the partner's token from the same credentials service and cache as the identity-service callback, and a 20 s timeout.

The response is `{ hits: [{ studentUniqueId, score, rosterDetails }] }`, in IDRS's order, highest score first. `rosterDetails` is the match as IDRS returned it, minus `student_unique_id` and `score`. Hits are kept by the school-year rule (`isLoadableSearchHit`): with the partner's `crossYearMatchingEnabled` on, every hit, since those partners can deliver any student outside the ODS, as cross-year matches are; off, only hits whose `school_years` (Ed-Fi end years) include the job's `endYear`. The setting is read live at each search, as the Executor payload reads it. The Executor's suggestion filter must apply the same rule.

| Status | Meaning |
|---|---|
| 200 | `{ hits }`, possibly empty. IDRS answers a tenant it doesn't know with no matches, not an error |
| 400 | The body doesn't match the DTO |
| 401 / 403 | Not logged in, another tenant, no privilege, or not a `fuzzy` job |
| 404 | `not_found`: the job has no such student. IDRS isn't called. An unknown job is also a 404, with Nest's body and no `code` |
| 500 | An unexpected failure, such as the database's in the student lookup. It has Nest's body, and no `student match search:` log line |
| 502 `identity_service_unavailable` | IDRS couldn't answer: missing config or connection info, a token failure, a timeout, any non-200 (including a 400 and 404 `partner_not_found`) or a malformed response |

The 404 and 502 have the coded body, as for decisions. Each search logs one line: the job, partner and user ids, the outcome and the duration; on success, how many hits IDRS returned and how many were kept; and for a 502 its cause: a credentials error, as the identity-service callback logs it, or IDRS's status, the error's name or a malformed response. Neither that line nor any error body carries search terms, hits, IDRS bodies or the correlation id, except Nest's 400 for malformed JSON, which quotes the body back to its sender.

Job reads (`GET /api/jobs`, `GET /api/jobs/:jobId`) carry `idMatchingMode` and `studentMatchCounts`, the review read's `counts` from the same query. Their `total` never goes down. Status is computed by `GetJobDto` from these, so `toGetJobDto` requires the counts: set them with `JobsService.withStudentMatchCounts`, whose single query reads only the given jobs.

The mode decides who reads the results and whether they affect the status:

- **`id_based_fuzzy_background`**: only `PartnerAdmin` and `SupportUser`, through `job.match-results.background.read`. The mode exists for them to check suggestions before a partner switches to fuzzy. The ID-based run has already delivered, so nothing can be decided and the counts leave the status alone.
- **`fuzzy`** (and `id_based`): any user with `job.match-results.read`. In fuzzy mode, a successful last run with any outstanding students makes the job `complete with errors`, which can be marked resolved, as with unmatched student IDs. Students with a saved match are outstanding, since a saved match delivers nothing on its own; excluded students aren't.

### S3 Path Structure

```
{partnerId}/{tenantCode}/{schoolYearId}/{jobId}/input/{templateKey}__{fileName}
{partnerId}/{tenantCode}/{schoolYearId}/{jobId}/output/{artifactFileName}
__rosters/{partnerId}/{tenantCode}/{schoolYearEndYear}/*
```

## Development Conventions

- **Commits**: lowercase subject + body explaining the "why"
- **API**: NestJS controller → service. Services use Prisma directly, including for transactions and raw SQL; there is no separate repository layer
- **Error handling**: Services return result objects (`{ status: 'SUCCESS', data }` / `{ status: 'ERROR', code }`) for expected failure modes; unexpected errors throw. Controllers map error results to HTTP exceptions. Services should not import or throw HTTP exceptions.
- **FE**: Chakra UI v2 with custom design tokens; prefer inline readable code over extracted helpers for short logic
- **FE colors**: use the theme's color tokens (`app/fe/src/app/theme/index.ts`), not new hex values, and keep text at WCAG AA contrast (4.5:1) against its background. That rules out light accents like `blue.200` as text on white, and dark panels in the light UI
- **Icons**: `app/fe/src/assets/icons/`
- **Data fetching and suspense**:
  - Critical data → `useSuspenseQuery` in the component, `ensureQueryData` in an ancestor loader.
  - Optional data → `useQuery` with a fallback value. Optionally `prefetchQuery` in a loader to warm the cache.
  - Never `useSuspenseQuery` on a query only reached via `prefetchQuery` — a failed prefetch will re-suspend.
  - Scope prefetches to the route that needs them, not `__root`.
  - Always `await` or `return` a prefetch from the loader — fire-and-forget won't warm the cache in time. Pair `prefetchQuery` with a soft fallback (`data ?? default`) in the component, since errored prefetches leave the cache empty.
  - Per-major-route pending/error UI via TanStack Router's `pendingComponent` and `errorComponent` (set on the section's parent route, e.g., `/ods-configs`). Route-level pending covers all sub-routes; the top-level React `<Suspense>` in `app.tsx` is only a safety net for unexpected suspends.
- **Documentation**: When changing behavior described in nearby docs (README.md, AGENTS.md, code comments), update the docs in the same commit. When creating a commit, review changed files for references to documentation and flag any that may need updating.
