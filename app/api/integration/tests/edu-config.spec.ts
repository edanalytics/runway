import { AppConfigService } from 'api/src/config/app-config.service';
import { partnerA } from '../fixtures/context-fixtures/partner-fixtures';

const EDU_ENV_VARS = [
  'NODE_ENV',
  'EDU_SNOWFLAKE_USERNAME',
  'EDU_SNOWFLAKE_ACCOUNT',
  'EDU_SNOWFLAKE_DATABASE',
  'EDU_SNOWFLAKE_SCHEMA',
  'EDU_SNOWFLAKE_PRIVATE_KEY',
] as const;

describe('AppConfigService — EDU Snowflake config', () => {
  let configService: AppConfigService;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    configService = app.get(AppConfigService);
  });

  beforeEach(() => {
    for (const key of EDU_ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // The env-var fallback in AppConfigService is gated on NODE_ENV=development.
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    for (const key of EDU_ENV_VARS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  describe('getEduConnectionInfo', () => {
    it('returns null when no env vars are set and no AWS secret exists', async () => {
      const info = await configService.getEduConnectionInfo(partnerA.id);
      expect(info).toBeNull();
    });

    it('returns a connection info object built from env vars when set', async () => {
      const privateKey = Buffer.from('private-key-content').toString('base64');
      process.env.EDU_SNOWFLAKE_USERNAME = 'snowflake-user';
      process.env.EDU_SNOWFLAKE_ACCOUNT = 'example';
      process.env.EDU_SNOWFLAKE_DATABASE = 'edu_stg';
      process.env.EDU_SNOWFLAKE_SCHEMA = 'public';
      process.env.EDU_SNOWFLAKE_PRIVATE_KEY = privateKey;

      const info = await configService.getEduConnectionInfo(partnerA.id);
      expect(info).toEqual({
        username: 'snowflake-user',
        account: 'example',
        database: 'edu_stg',
        schema: 'public',
        privateKey: Buffer.from('private-key-content'),
      });
    });
  });
});
