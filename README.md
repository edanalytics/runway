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

You can run Runway locally and use it to load to your ODS without any dependence on AWS.

See [app/README.md](app/README.md) for full local instructions
