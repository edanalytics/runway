import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PoolConfig } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { IEnvironmentVariables } from './env-vars.interface';
import { keyBy } from 'lodash';
import { SSMClient, GetParametersCommand, Parameter } from '@aws-sdk/client-ssm';

type ParameterWithNameAndValue = Required<Pick<Parameter, 'Name' | 'Value'>>;

export type UmConfig = {
  syncCron: string;
  url: string;
  auth0Domain: string;
  clientId: string;
  clientSecret: string;
  audience: string;
};

/**
 * AppConfigService is a wrapper on the @nestjs/config package's
 * ConfigService. It allows us to define custom getters, including
 * async getters for when config values are stored outside of environment
 * variables (e.g. in AWS Secrets Manager).
 *
 * Use AppConfigService throughout the app rather than ConfigService.
 *
 * Note that by wrapping ConfigService instead of subclassing it,
 * we don't have access to ConfigService/Module functionality unless
 * we specifically implement it. I took this approach to make the
 * AppConfigService's functionality easier to grasp and because we
 * probably don't need a lot of the functionality that @nestjs/config
 * package offers.
 */

@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);
  constructor(private readonly configService: ConfigService<IEnvironmentVariables>) {}

  get<K extends keyof IEnvironmentVariables>(key: K): IEnvironmentVariables[K] | undefined {
    return this.configService.get(key, { infer: true });
  }

  /*********************************************************************
   * CUSTOM GETTER FUNCTIONS.
   * Use custom getters to:
   * - Cast values from environment variables to a more usable type
   * - Consruct more complex config objects
   * - Look up config differently based on the environnment. For example,
   *   you might look for config in an AWS secret if a secret is available
   *   and otherwise fall back to environment variables.
   * *******************************************************************
   */

  isDevEnvironment(): boolean {
    // if NODE_ENV is not set, then assume we're in a prod environment, for safety
    return this.get('NODE_ENV') === 'development';
  }

  syncDbWithModels(): boolean {
    return this.get('DB_SYNCHRONIZE')?.toLowerCase() === 'true';
  }

  async postgresPoolConfig(): Promise<PoolConfig> {
    const postgresConfigSecret = this.get('POSTGRES_CONFIG_SECRET');
    if (postgresConfigSecret) {
      const configFromSecret = await this.getAWSSecret(postgresConfigSecret);
      if (typeof configFromSecret !== 'object') {
        throw new Error(`Value for AWS secret ${postgresConfigSecret} must be an object`);
      }

      return {
        user: configFromSecret['username'],
        password: configFromSecret['password'],
        database: configFromSecret['dbname'],
        port: Number(configFromSecret['port']),
        host: configFromSecret['host'],
        ssl: true,
      };
    }

    return {
      user: this.get('POSTGRES_USER'),
      password: this.get('POSTGRES_PASSWORD'),
      database: this.get('POSTGRES_DB'),
      port: Number(this.get('POSTGRES_PORT')) ?? 5432,
      host: this.get('POSTGRES_HOST') ?? 'localhost',
      ssl: this.get('POSTGRES_SSL') !== 'false',
    };
  }

  async encryptionKey(): Promise<string | Buffer | undefined> {
    const encryptionKeySecret = this.get('ODS_CREDS_ENCRYPTION_KEY_SECRET');
    if (encryptionKeySecret) {
      return this.getBufferFromAWSSecret(encryptionKeySecret);
    }
    return this.get('ODS_CREDS_ENCRYPTION_KEY');
  }

  async getJwtKey(): Promise<string | Buffer | undefined> {
    const jwtKeySecret = this.get('JWT_ENCRYPTION_KEY_SECRET');
    if (jwtKeySecret) {
      return this.getBufferFromAWSSecret(jwtKeySecret);
    }
    return this.get('JWT_ENCRYPTION_KEY');
  }

  /**
   * EDU Snowflake connection info for cross-year ID matching. Looks for an
   * AWS secret named `<ENVLABEL>-edu-connection-info-<partnerId>`; falls back
   * to EDU_SNOWFLAKE_* env vars only in local development. Returns null when no
   * creds are available — caller decides how to handle. Throws on real AWS
   * failures (IAM, throttling, network, malformed JSON) so the roster
   * endpoint can surface a 5xx rather than masquerading as 409 "creds
   * missing"; only ResourceNotFoundException collapses to null.
   */
  async getEduConnectionInfo(partnerId: string): Promise<{
    username: string;
    account: string;
    database: string;
    schema: string;
    privateKey: Buffer;
    // Optional: when unset, Snowflake falls back to the user's defaults.
    warehouse?: string;
    role?: string;
  } | null> {
    if (this.isDevEnvironment()) {
      const username = process.env.EDU_SNOWFLAKE_USERNAME;
      const account = process.env.EDU_SNOWFLAKE_ACCOUNT;
      const database = process.env.EDU_SNOWFLAKE_DATABASE;
      const schema = process.env.EDU_SNOWFLAKE_SCHEMA;
      const privateKey = process.env.EDU_SNOWFLAKE_PRIVATE_KEY;
      if (!username || !account || !database || !schema || !privateKey) {
        return null;
      }
      return {
        username,
        account,
        database,
        schema,
        privateKey: Buffer.from(privateKey, 'base64'),
        // Optional: when unset, Snowflake falls back to the user's defaults.
        warehouse: process.env.EDU_SNOWFLAKE_WAREHOUSE,
        role: process.env.EDU_SNOWFLAKE_ROLE,
      };
    }

    const envLabel = this.get('ENVLABEL');
    if (!envLabel) {
      throw new Error('ENVLABEL must be set in order to retrieve EDU connection info');
    }
    const secretName = `${envLabel}-edu-connection-info-${partnerId}`;
    let secret: string | Record<string, string>;
    try {
      // Uncached: cred-rotation handling lives in EduSnowflakePoolService,
      // and the existence check there does a fresh fetch each time so a
      // process restart isn't required to pick up new values.
      secret = await this.fetchAWSSecret(secretName);
    } catch (err) {
      if (err instanceof Error && err.name === 'ResourceNotFoundException') {
        return null;
      }
      this.logger.warn(
        `failed to load EDU connection info for partner ${partnerId}: ${
          err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        }`
      );
      throw err;
    }
    if (typeof secret !== 'object') {
      return null;
    }
    const { username, account, database, schema, privateKey, warehouse, role } = secret;
    if (!username || !account || !database || !schema || !privateKey) {
      return null;
    }
    return {
      username,
      account,
      database,
      schema,
      privateKey: Buffer.from(privateKey, 'base64'),
      // Optional: when unset, Snowflake falls back to the user's defaults.
      warehouse,
      role,
    };
  }

  bundleBranch(): string {
    return this.get('BUNDLE_BRANCH') ?? 'main';
  }

  s3Bucket(): string {
    return this.get('S3_FILE_UPLOAD_BUCKET')!;
  }

  // Roster files don't need to live in the same bucket as job uploads.
  // For now they share a bucket, but this can be split to a dedicated
  // env var if rosters move to a separate bucket.
  rosterBucket(): string {
    return this.get('S3_FILE_UPLOAD_BUCKET')!;
  }

  executorCallbackBaseUrl(): string | undefined {
    if (this.get('LOCAL_EXECUTOR') === 'docker') {
      const port = process.env.PORT || 3333;
      return `http://host.docker.internal:${port}`;
    }
    return this.get('MY_URL');
  }

  getExternalApiConfig(): { issuerUrl: string | undefined; audience: string | undefined } {
    const issuerUrl = this.get('OAUTH2_ISSUER');
    const audience = this.get('OAUTH2_AUDIENCE') ?? this.get('MY_URL'); // OAUTH2_AUDIENCE is only used for running locally. Deployed envs should use the API url
    return { issuerUrl, audience };
  }

  async UmConfig(): Promise<UmConfig | null> {
    const syncCron = this.get('UM_SYNC_CRON') ?? '* * * * *';
    const configSecret = this.get('UM_CONFIG_SECRET');
    if (configSecret) {
      const secret = await this.fetchAWSSecret(configSecret);
      if (typeof secret !== 'object') {
        throw new Error(`Value for AWS secret ${configSecret} must be an object`);
      }
      return {
        syncCron,
        url: secret['url'],
        auth0Domain: secret['auth0Domain'],
        clientId: secret['clientId'],
        clientSecret: secret['clientSecret'],
        audience: secret['audience'],
      };
    }

    const url = this.get('UM_URL');
    const auth0Domain = this.get('UM_AUTH0_DOMAIN');
    const clientId = this.get('UM_CLIENT_ID');
    const clientSecret = this.get('UM_CLIENT_SECRET');
    const audience = this.get('UM_AUDIENCE');

    if (!syncCron || !url || !auth0Domain || !clientId || !clientSecret || !audience) {
      return null;
    }

    return { syncCron, url, auth0Domain, clientId, clientSecret, audience };
  }

  // Jobs whose input files total at least this many bytes run on the large
  // ECS task instead of medium. Null when unset or unparseable; the caller
  // decides the default.
  ecsFileSizeThresholdBytes(): number | null {
    const raw = this.get('ECS_FILE_SIZE_THRESHOLD_MB');
    if (!raw) return null; // not configured
    const mb = Number(raw);
    if (!Number.isFinite(mb)) {
      this.logger.warn(`ECS_FILE_SIZE_THRESHOLD_MB is set but not a number: "${raw}"; ignoring`);
      return null;
    }
    return mb * 1024 * 1024;
  }

  async ecsConfig(): Promise<{
    cluster: string;
    taskDefinition: { small: string; medium: string; large: string };
    subnets: string[];
    securityGroups: string[];
    taskRole: string;
    containerName: { small: string; medium: string; large: string };
  }> {
    const envLabel = this.get('ENVLABEL');
    if (!envLabel) {
      throw new Error('ENVLABEL must be set in order to retrieve ECS config');
    }

    const paramNameMap = {
      cluster: `/ecs/environments/${envLabel}/EcsClusterArn`,
      taskDefinitionSmall: `/ecs/environments/${envLabel}/EcsTaskDefinitionSmallArn`,
      taskDefinitionMedium: `/ecs/environments/${envLabel}/EcsTaskDefinitionMediumArn`,
      taskDefinitionLarge: `/ecs/environments/${envLabel}/EcsTaskDefinitionLargeArn`,
      subnets: `/environments/runway/PrivateSubnetIds`, // does not use envLabel
      securityGroups: `/environments/${envLabel}/LambdaDefaultSG`,
      taskRole: `/ecs/environments/${envLabel}/EcsTaskRoleArn`,
    };
    const paramNames = Object.values(paramNameMap);

    const parameters = await this.getParameters(paramNames);
    if (!parameters) {
      throw new Error('No parameters found for ECS task config');
    }

    const parameterIndex = keyBy(parameters, 'Name');
    if (
      paramNames.some((name) => !parameterIndex[name] || parameterIndex[name].Value === undefined)
    ) {
      throw new Error('Parameter store does not have all required values for ECS task config');
    }

    const cluster = parameterIndex[paramNameMap.cluster].Value;
    const taskDefinition = {
      small: parameterIndex[paramNameMap.taskDefinitionSmall].Value,
      medium: parameterIndex[paramNameMap.taskDefinitionMedium].Value,
      large: parameterIndex[paramNameMap.taskDefinitionLarge].Value,
    };
    const securityGroups = [parameterIndex[paramNameMap.securityGroups].Value];
    const subnets = parameterIndex[paramNameMap.subnets].Value.split(', ').map((subnet: string) =>
      subnet.replace(/'/g, '').trim()
    );
    const taskRole = parameterIndex[paramNameMap.taskRole].Value;

    return {
      cluster,
      taskDefinition,
      subnets,
      securityGroups,
      taskRole,
      containerName: {
        small: `${envLabel}-JobExecutorSmall`,
        medium: `${envLabel}-JobExecutorMedium`,
        large: `${envLabel}-JobExecutorLarge`,
      },
    };
  }

  /*********************************************************************
   * HELPERS
   * These are private because, generally, app code should call a custom
   * getter  defined above and that getter can then use these helpers.
   * *******************************************************************
   */
  private readonly secretsClient = new SecretsManagerClient({
    region: this.get('AWS_REGION'),
  });

  private readonly secretsCache: Map<string, string | Record<string, string>> = new Map();

  private async getAWSSecret(secretName: string): Promise<string | Record<string, string>> {
    const cachedValue = this.secretsCache.get(secretName);
    if (cachedValue) {
      return cachedValue;
    }
    const secretValue = await this.fetchAWSSecret(secretName);
    this.secretsCache.set(secretName, secretValue);
    return secretValue;
  }

  private async fetchAWSSecret(secretName: string): Promise<string | Record<string, string>> {
    const secretValueRaw = await this.secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretName })
    );

    if (secretValueRaw.SecretString === undefined) {
      throw new Error(`No values defined for AWS Secret ${secretName}`);
    }

    let secretValue: Record<string, string> | string | undefined = undefined;
    try {
      secretValue = JSON.parse(secretValueRaw.SecretString);
    } catch (error) {
      secretValue = secretValueRaw.SecretString; // plain text secret if we can't parse the JSON
    }

    if (secretValue === undefined) {
      throw new Error(`Unable to parse value for secret ${secretName}`);
    }

    return secretValue;
  }

  private async getBufferFromAWSSecret(secretName: string): Promise<Buffer> {
    const secretValue = await this.getAWSSecret(secretName);
    if (typeof secretValue !== 'string') {
      throw new Error(`Value for AWS secret ${secretName} must be a base64-encoded string`);
    }
    return Buffer.from(secretValue, 'base64');
  }

  private readonly ssmClient = new SSMClient({ region: this.get('AWS_REGION') });
  private isPopulatedParameter(param: Parameter): param is ParameterWithNameAndValue {
    return param.Value !== undefined && param.Name !== undefined;
  }
  private allArePopulatedParameters(params: Parameter[]): params is ParameterWithNameAndValue[] {
    return params.every((p) => this.isPopulatedParameter(p));
  }
  // TODO: maybe cache?
  private async getParameters(paramNames: string[]): Promise<ParameterWithNameAndValue[]> {
    const command = new GetParametersCommand({ Names: paramNames, WithDecryption: true });
    const response = await this.ssmClient.send(command);
    const parameters = response.Parameters;
    if (!parameters) {
      throw new Error(`No parameters found for: ${paramNames}`);
    }
    if (!this.allArePopulatedParameters(parameters)) {
      throw new Error(`Some parameters are missing values: ${paramNames}`);
    }
    return parameters;
  }
}
