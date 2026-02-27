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

This handles everything: environment files, node dependencies, Prisma client generation, Docker services (Postgres, Keycloak, S3Mock), database migrations, seed data, and executor setup. It's idempotent — safe to re-run after pulling updates.

```bash
./init.sh
```

The script will prompt you to choose an executor mode (docker or python). See [Running the executor locally](#running-the-executor-locally) for details.

If you already have a local instance of Keycloak that you prefer, feel free to use that instead. You will have to configure an OIDC client that matches the seed IdP registration in [api/seed.sql](api/seed.sql) (or update the seed to match a client you already have configured in Keycloak).

**Bundles**: Assessment bundles are synced automatically from the [earthmover_edfi_bundles registry](https://github.com/edanalytics/earthmover_edfi_bundles). To refresh bundles from the registry at any time:

```bash
cd api && bash sync-bundles.sh
```

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

### Testing in-development bundles

If using local Runway to test a bundle that is not on the main branch, you can follow these steps:
  1. Connect to the locally-running backend database at localhost:5432
  2. Add your bundle to the earthmover_bundle table, then the partner_earthmover_bundle table
  3. Make sure you have pushed an update to the bundle registry on your branch by running `python create-registry.py assessments`
  4. You should see the bundle as an option on the "load a new assessment" page 

## OSS required attributions

This project uses [caniuse-lite](https://caniuse.com) which is based on [caniuse.com](caniuse.com).
