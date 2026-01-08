/**
 * This interface is used by AppConfigService to define the
 * environmnet variables available via ConfigService.
 *
 * Note that all environment variables are strings. If it should
 * be a different datatype, write a custom getter in AppConfigService
 * to cast it to the appropriate type.
 */

export interface IEnvironmentVariables {
  MY_URL: string;
  FE_URL: string;
  SESSION_SECRET: string;

  POSTGRES_USER?: string;
  POSTGRES_PASSWORD?: string;
  POSTGRES_DB?: string;
  POSTGRES_SSL?: string;
  POSTGRES_PORT?: string;
  POSTGRES_HOST?: string;

  POSTGRES_CONFIG_SECRET?: string;
  DB_SYNCHRONIZE?: string;
  NODE_ENV: string;
  AWS_REGION: string;
  ENVLABEL: string;

  JWT_ENCRYPTION_KEY?: string;
  JWT_ENCRYPTION_KEY_SECRET?: string;
  ODS_CREDS_ENCRYPTION_KEY?: string;
  ODS_CREDS_ENCRYPTION_KEY_SECRET?: string;

  BUNDLE_BRANCH: string;
  S3_FILE_UPLOAD_BUCKET: string;
  TIMEOUT_SECONDS: string; // executor timeout
  EXTERNAL_API_TOKEN_ISSUER?: string; // token issuer for external API
  EXTERNAL_API_TOKEN_AUDIENCE?: string; // token audience for external API
}
