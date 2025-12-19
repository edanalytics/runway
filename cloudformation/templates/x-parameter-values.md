## Runway Deployment Parameters

Below is a list of parameters, their descriptions, and additional context needed to deploy a properly configured Runway environment. Some parameters come with default values, and users can keep these defaults to simplify their deployment unless their use case requires different customization.

Please note that descriptions, values, and available parameters may evolve over time as maintainers continue to improve and update the codebase.

### Parameters

- **Stack name** - Name your stack something unique and related to your environment.

**Environment information**
- **S3SourceBucket** - The name of the S3 bucket in which Runway templates are sourced. This is the bucket you created in Step 1 of the deployment steps.
- **EnvLabel** - Unique name for your environment. Generally will align with the **Stack name** and be included in your S3 source bucket name.
- **DomainName** - Fully qualified domain name to create wild card certificate for.
- **HostedZoneId** - The route 53 Hosted Zone that was created as a prerequisite to deploying Runway.
- **SNSTopicArn** - Optionally add ARN of SNS topic to publish Route53 HealthCheck Alarms. SNS topic should be deployed separately.
- **SlackWebhookURL** - Optionally add a Slack webhook URL to surface alerts from the Job Executor tasks. 

**Database (RDS Postgres) information**
- **DBInstanceClass** - The preferred instance class for your RDS instance. 
- **EngineVersion** - Choose the RDS Postgres Engine Version from the list of allowed values. 
- **DBName** - The preferred name for your RDS Postgres server.
- **DBAllocatedStorage** - The allocated storage size for your RDS Postgres server. 
- **DBMultiAZ** - Choose whether you want to enable availability of your RDS Postgres server in multiple Availability Zones. 
- **DBBackupRetentionPeriod** - The number of days to keep snapshots of the database.
- **PreferredBackupWindow** - The daily time range (in UTC) during which you want to create automated backups for your RDS instance.
- **PreferredMaintenanceWindow** - The weekly time range (in UTC) during which system maintenance can occur on your RDS instance.
- **DBSnapshotIdentifier** - Optionallly add a name or ARN of the DB snapshot from which you want to restore (leave blank to create an empty database).
- **DeployAlerts** - Choose whether you want to deploy SNS topic and database monitoring alerts.
- **ParentSSHBastionStack** - Optionally associate SSH stack to Runway resources. This is an EA specific template that is deployed separately.
- **EnableIAMDatabaseAuthentication** - Choose whether to enable mapping of Amazon Web Services Identity and Access Management (IAM) accounts to database accounts.

**Elastic Beanstalk information**
- **BeanstalkMinInstances** - The minimum number of EC2 instances managed by the Auto Scaling Group.
- **BeanstalkMaxInstances** - The maximum number of EC2 instances managed by the Auto Scaling Group.
- **InstanceTypes** - Size of the EC2 machines to host the Docker containers.
- **LogRetentionInDays** - Number of days to keep Beanstalk logs in CloudWatch Logs.
- **HealthCheckPath** - Application path for the load balancer to determine application health.
- **CodeEnv** - Environment string that dictates which local config file is in use.
- **WebACLArn** - Optionally provide the ARN of a WAF to attach to the Application Load Balancer.
- **DeploymentStrategy** - Beanstalk deployment strategy for platform updates and application versions.
- **BeanstalkPlatformUpdateTime** - Beanstalk Platform update day and time (in UTC) using the format 'Day:HH:MM' (e.g., Wed:15:30). Platform updates will be disabled if no value is specified. 
- **BundleBranch** - Name of the bundle branch in the [earthmover Ed-Fi bundles repository](https://github.com/edanalytics/earthmover_edfi_bundles).

**S3 Cloudfront Information**
- **S3FrontEndBucket** - Name of the S3 bucket containing the front end web files.
    - **S3FrontEndBucketStatus** - Choose `Create the S3 Bucket` if `S3FrontEndBucket` does not exist. Do not change this value if updating an existing stack.
- **WildcardDomain** - Choose whether to accept requests from `*.DomainName`
- **DefaultRootObject** - The frontend file to serve when the root DomainName is requested.
    - **RedirectErrors** - Choose whether to redirect 400, 403, and 404 errors to the DefaultRootObject.
- **ViewerProtocolPolicy** - Policy for the HTTP behavior in CloudFront. 
- **AllowedMethods** - Allowed HTTP methods.
- **CachedMethods** - Cached HTTP methods. 
- **CachePolicy** - Policy for how CloudFront should cache contents. 
- **Compress** - Choose whether to compress CloudFront responses.
- **ResponseHeadersPolicy** - Policy to specify the HTTP headers that CloudFront removes or adds in responses that it sends to viewers. 

**App CodePipeline information**
- **GitHubConnectionArn** - ARN of the GitHub Connection that was created as a prerequisite to deploying Runway.
- **GitHubRepo** - Name of the forked Runway Github repository.
- **GitHubBranch** - Name of the branch in the GitHub repo to build from.
- **CreateS3Bucket** - Choose whether to create S3 bucket named 'codepipeline-artifact-store-{AWS::Region}-{AWS::AccountId}' in your AWS account. Only choose `Create the S3 bucket` for the very first deployment of Runway in your AWS account. Do not change this value if updating an existing stack.
- **ViteAlternateMatomoUrl** - Internal to EA. Not needed for open-source deployments. Leave blank. 
- **ViteAlternateMatomoSiteId** - Internal to EA. Not needed for open-source deployments. Leave blank. 
- **ViteAlternateMatomoSubdomain** - Internal to EA. Not needed for open-source deployments. Leave blank. 

**ECS Information**
- **CreateEcsServiceLinkedRole** - Choose whether to create an ECS Service Linked Role in your AWS account. This role enables Amazon ECS to manage your cluster. If it already exists in your account, select False.

**VPC Network Configuration**
- **VpcId** - The VPC ID for where to deploy Runway resources. This is supposed to be created as a prerequisite before deploying Runway.
- **PublicSubnet1Id** - The Subnet ID of a Public Subnet in one of the Availability Zones. Must be configured before Runway deployment.
- **PublicSubnet2Id** - The Subnet ID of a Public Subnet in one of the Availability Zones. Must be configured before Runway deployment.
- **PrivateSubnet1Id** - The Subnet ID of a Private Subnet in one of the Availability Zones. Must be configured before Runway deployment.
- **PrivateSubnet2Id** - The Subnet ID of a Private Subnet in one of the Availability Zones. Must be configured before Runway deployment.