This repo contains code for Runway, a software system for integrating data to Ed-Fi. It can be [deployed locally via Docker](#local-deployment) or in [AWS](#aws-deployment).

## Design
The system consists of several components:
1. the Application frontent and backend (see `app/`), with which users interact to set up Ed-Fi connections and run integration jobs
1. the Executor (see `executor/`), which executes Jobs, transforming input data and sending it to an Ed-Fi API

The Executor uses [earthmover](https://github.com/edanalytics/earthmover) to transform input data and [lightbeam](https://github.com/edanalytics/lightbeam)to send it to an Ed-Fi API.


## Usage
You can deploy this app in AWS or locally. Once deployed, see [application features](#application-features) for tips on how to use the app.

### AWS deployment
Coming soon...

### Local deployment
Build the Executor Docker image with
```bash
cd executor && docker build -t runway_executor . && cd ..
```

`docker-compose.yml` stands up containers including:
1. a Postgres database which backs the application
1. the App frontend and backend
1. a Job Executor

Start up the stack with
```bash
docker-compose -f ./docker-compose.yml --env-file .\.env up -d
```
(For an end-to-end working example, you may also want [an Ed-Fi API](https://github.com/Ed-Fi-Alliance-OSS/Ed-Fi-ODS-Docker) running in another Docker stack. You'll also need to modify the Ed-Fi API's credentials to allow writing to the namespace `uri://www.nwea.org`.)

Go to [localhost:3000](http://localhost:3000/) to view the job that's automatically launched when the stack starts. After about 15 seconds, the sample job will begin executing and you should see the status update.

Shut down a running stack with
```bash
docker-compose -f ./docker-compose.yml --env-file .\.env down --volumes
```

The entrypoint for the job_executor is `init.sh`, which calls a "prepare" bash script followed by an "execute" Python script. (Some setup steps are easier to write in bash, others in Python; hence the split.)


### Application features
Coming soon...


## Archived information

### Bundle schemas
This repo also contains a folder `bundleSchemas/` which contains several examples of JSON schemas (which a bundle could provide) that would be turned into form elements on the "create job" part of this app, to collect configuration settings to be passed into the bundle.

Such schemas can be turned into form elements using (for React) [react-jsonschema-form](https://github.com/rjsf-team/react-jsonschema-form) or (for jQuery) [jsonform](https://github.com/jsonform/jsonform), [jsonToForm](https://github.com/mirshahreza/jsonToForm), or [json-editor](https://github.com/json-editor/json-editor).
