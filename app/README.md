# Runway, the app

## Provenance

This app is built on the [SE team's starter repo](https://github.com/edanalytics/ts_app_base_se), which is a basic CRUD app built as a Typescript monorepo with a React front-end, a Node/NestJS back-end, and a couple of libraries shared between them. See the starter repo's [README](https://github.com/edanalytics/ts_app_base_se/blob/main/README.md) for more on motivations, design choices, and tooling decisions.

## READMEs

READMEs serve two purposes in this repo. First, READMEs lay out some of the high-level considerations, principles, and approaches for how the app is designed. These should be of the changes-very-rarely variety and should not be concerned with the specifics of implementation. The code itself is always the source of truth for how things actually work. The README only provides context.

Second, the README gives step-by-step instructions for developers interacting with the repo: how to run the app locally, perform migrations, run test suites, etc.

I am not the only README in this repo. You might also enjoy:

- [api/README.md](api/README.md)
- [fe/README.md](fe/README.md)
- [common-ui/README.md](common-ui/README.md)
- [utils/README.md](utils/README.md)
- [models/README.md](models/README.md)

## Running Locally

All the instructions below assume you're working out of the app/ directory. If not there already, get there with:

```bash
cd app
```

### Set up your Workspace

#### 1. Run the setup script.

This sets up environment variables, install node dependencies, and generate the Prisma client, among other things. You can indicate whether you intend to run the executor on your host machine or in a container (see below). If you're actively making changes to the executor, it's much faster to run it in "bare" Python on your machine. If not, the script builds the executor image so it's ready to run.

```bash
bash init.sh
```

#### 2. Start Postgres & Keycloak

Postgres is the primary datastore. [Keycloak](https://github.com/keycloak/keycloak) is an IdP we can run locally. We run both in Docker for local dev.

```bash
docker compose -f api/docker-compose.yml up
```

If you already have a local instance of Keycloak that you prefer, feel free to use that instead. You will have to configure an OIDC client that matches the seed IdP registration below (or update the seed registration to match a client you already have configured in Keycloak).

#### 3. Seed an IdP Registration & School Year

Your app needs to know how to talk to your local Keycloak so you can log in. We also need to seed a school year to get going.

Open your favorite Postgres client, connect to the DB you just started in Docker (see your [.env](api/.env) for connection params), and run this command:

```sql
INSERT INTO public.oidc_config (id,issuer,client_id,client_secret, user_id_claim, tenant_code_claim, require_role)
VALUES ('local-keycloak-oidc','http://localhost:8080/realms/example','runway-local','big-secret-123', 'preferred_username', 'tenant_code', false);

INSERT INTO public.identity_provider(id, fe_home, oidc_config_id)
VALUES ('local-keycloak','http://localhost:4200','local-keycloak-oidc');

INSERT INTO public.partner (id, name, idp_id)
VALUES ('ea','ea-local', 'local-keycloak');

INSERT INTO public.school_year (id, start_year, end_year)
VALUES ('2526', 2025, 2026);

INSERT INTO public.earthmover_bundle (key)
VALUES ('assessments/STAAR_Interim'),
('assessments/STAAR_Summative'),
('assessments/PSAT_SAT'),
('assessments/ASVAB'),
('assessments/Dibels_Next_Benchmark'),
('assessments/Dibels_8_Benchmark'),
('assessments/ACCESS'),
('assessments/EOCEP'),
('assessments/i-Ready'),
('assessments/WIN'),
('assessments/SC_READY'),
('assessments/MAP_Growth'),
('assessments/ACT'),
('assessments/STAR'),
('assessments/TX_KEA'),
('assessments/CIRCLE'),
('assessments/SC_Alternate_Assessment'),
('assessments/IB');

INSERT INTO public.partner_earthmover_bundle (partner_id, earthmover_bundle_key)
VALUES ('ea','assessments/STAAR_Interim'),
('ea','assessments/STAAR_Summative'),
('ea','assessments/PSAT_SAT'),
('ea','assessments/ASVAB'),
('ea','assessments/Dibels_Next_Benchmark'),
('ea','assessments/Dibels_8_Benchmark'),
('ea','assessments/ACCESS'),
('ea','assessments/EOCEP'),
('ea','assessments/i-Ready'),
('ea','assessments/WIN'),
('ea','assessments/SC_READY'),
('ea','assessments/MAP_Growth'),
('ea','assessments/ACT'),
('ea','assessments/STAR'),
('ea','assessments/TX_KEA'),
('ea','assessments/CIRCLE'),
('ea','assessments/SC_Alternate_Assessment'),
('ea','assessments/IB');

```

**Note**: You can add assessments to `earthmover_bundle` and `partner_earthmover_bundle` at any time to make additional bundles available for local testing.

### Run the App

Now that you have your environment all set up, it's time to run the app.

#### 1. Start the Backend API

```bash
npx nx run api:serve
```

You'll see some output as NestJS bootstraps. If you get this message, you're ready to go:

```
LOG 🚀 Application is running on: http://localhost:3333/api
```

#### 2. Start the Frontend Server

```bash
npx nx run fe:serve
```

Visit [http://localhost:4200](http://localhost:4200) to see the app

_Warning: If you click the http://localhost:4200 link from the terminal output in VS Code, your browser might swap out localhost for 127.0.0.1 which will result in a CORS error. If this happens, replace 127.0.0.1 with locahost and you'll be fine._

#### 3. Log in

There are two methods to log in as a given user:

1. Username and password. More typing but perhaps more familiar.

   1. Click the Login button in the app
   1. Enter a username and password for one of the users configured in Keycloak.
      - You can see the initial users in the [Keycloak config file](api/keycloak/config.yaml)
      - username and password are the same for these users (e.g. dev/dev)

1. Impersonation in Keycloak. More clicks in Keycloak, but more flexible and cooler. If you find yourself switching between different users, impersonation is the way to go.

   1. Log into the [keycloak](http://localhost:8080) admin console
      1. admin/admin is the default admin username/password
   1. Select the `Example` realm in the upper left
   1. Go to the [Users page](http://localhost:8080/admin/master/console/#/example/users)
   1. Select a user or create a new one
   1. Within the user record, select `Impersonate` from the Action menu in the upper right
   1. Go to http://localhost:4200 and click the login button. When you get redirected to Keycloak, Keycloak will authenticate you as the user you just impersonated.

#### 4. Configure an ODS

You'll need a valid (even if nono-prod) place to send data in order to run local jobs.

### Running the executor locally

In deployed environments, the executor runs as a Task in Elastic Container Service (ECS). Locally, the app initiate the executor based on the `LOCAL_EXECUTOR` environment variable:

- `LOCAL_EXECUTOR=python`: The app spawns a Python process that runs alongside the app's Node process. In this mode, you don't need to rebuild the docker image for new code to take effect, but there's no formal isolation from anything else on your system (the bundles repo and python venv are all copied into the Runway repo).
- `LOCAL_EXECUTOR=docker`: The app spins up a Docker container. Any executor code changes only take effect when you rebuild the image, but the overall setup is more similar to production.

In both local modes, file uploads and executor artifacts are written to the `storage` directory in the repo root, mimicking the S3 path structure in production.

## OSS required attributions

This project uses [caniuse-lite](https://caniuse.com) which is based on [caniuse.com](caniuse.com).
