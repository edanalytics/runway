This repo contains code for Runway, a software system for integrating data to Ed-Fi. It can be [deployed locally via Docker](#local-deployment) or in [AWS](#aws-deployment).

Runway is a friendly UI over our open source tools [Earthmover](https://github.com/edanalytics/earthmover) and [Lightbeam](https://github.com/edanalytics/lightbeam) for loading flat files (particularly assessments) to an Ed-Fi ODS. But note that Runway itself is not open source, but non-commercial. It is free to use for Education Agencies and non-profits, but requires a license for for-profit entities. See our [license](LICENSE.md) for details.

## Design
The system consists of several components:
1. the Application frontent and backend (see `app/`), with which users interact to set up Ed-Fi connections and run integration jobs
1. the Executor (see `executor/`), which executes Jobs, transforming input data and sending it to an Ed-Fi API

The Executor uses [earthmover](https://github.com/edanalytics/earthmover) to transform input data and [lightbeam](https://github.com/edanalytics/lightbeam)to send it to an Ed-Fi API.


## Usage
You can deploy this app in AWS or locally. Once deployed, see [application features](#application-features) for tips on how to use the app.

### AWS deployment
**Prerequisites:**
1. You must have an AWS account
2. You must have deployed a custom VPC, 2 public subnets, and 2 private subnets before deploying the Runway templates. It is not advisable for users to use the default VPC initially deployed by AWS.
3. You must have created a Hosted Zone and NS record for the domain at which you intend to deploy your Runway environment(s).
4. You must have created a GitHub Connection in AWS CodePipeline between your GitHub and AWS accounts. 

If you would like more guidance and support with deploying Runway in AWS, please reach out to our team using [this form](https://edanalytics.atlassian.net/helpcenter/products-and-services/portal/15/group/45/create/1121).

**AWS Console Deployment Steps:**
1. In your AWS account, navigate to S3 and create an S3 bucket with a unique name that will be used to hold the Runway CloudFormation templates. Example bucket name:
    - `{OrgName}-{ProductName}-{EnvironmentType}-cloudformation`
    - `educationanalytics-runway-dev-cloudformation`
2. Fork the Runway repository under your own Github account and use the `main` branch.
3. Upload the contents inside of the cloudformation folder into your S3 bucket. Make sure the S3 bucket contains both `lambdas` and `templates` folders with their respective files inside. 
4. Copy the S3 URL for the `templates > 1-main.yml` file.
5. Navigate to the CloudFormation console in AWS. Create a new stack with new resources.
6. Select `Choose an existing template > Amazon S3 URL` and paste your copied URL for the `1-main.yml` file into the field. Click `Next`. 
7. Enter stack parameter values. Please read [the doc here](./cloudformation/templates/x-parameter-values.md) for more information on parameter values and descriptions.
8. Navigate through the next screens on the console until you are able to start the deployment.

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


### External API
Runway exposes an API for programmatic job submission, allowing external systems to create and start jobs without using the UI. The API requires OAuth2 bearer tokens from a configured identity provider. See [the External API README](./app/api/src/external-api/README.md) for configuration and usage instructions.

### Application features
Coming soon...

This repo also contains a folder `bundleSchemas/` which contains several examples of JSON schemas (which a bundle could provide) that would be turned into form elements on the "create job" part of this app, to collect configuration settings to be passed into the bundle.

Such schemas can be turned into form elements using (for React) [react-jsonschema-form](https://github.com/rjsf-team/react-jsonschema-form) or (for jQuery) [jsonform](https://github.com/jsonform/jsonform), [jsonToForm](https://github.com/mirshahreza/jsonToForm), or [json-editor](https://github.com/json-editor/json-editor).
