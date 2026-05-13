import { AppConfigService } from 'api/src/config/app-config.service';
import { partnerA } from '../fixtures/context-fixtures/partner-fixtures';

const EDU_ENV_VARS = [
  'EDU_SNOWFLAKE_USERNAME',
  'EDU_SNOWFLAKE_URL',
  'EDU_SNOWFLAKE_SCHEMA',
  'EDU_SNOWFLAKE_PUBLIC_KEY',
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

  describe('eduCredsExist', () => {
    it('returns false when no env vars are set and no AWS secret exists', async () => {
      const exists = await configService.eduCredsExist(partnerA.id);
      expect(exists).toBe(false);
    });

    it('returns true when local env vars are set', async () => {
      process.env.EDU_SNOWFLAKE_USERNAME = 'snowflake-user';
      process.env.EDU_SNOWFLAKE_URL = 'https://example.snowflakecomputing.com';
      process.env.EDU_SNOWFLAKE_SCHEMA = 'edu_stg.public';
      process.env.EDU_SNOWFLAKE_PUBLIC_KEY = Buffer.from('public-key').toString('base64');
      process.env.EDU_SNOWFLAKE_PRIVATE_KEY = Buffer.from('private-key').toString('base64');

      const exists = await configService.eduCredsExist(partnerA.id);
      expect(exists).toBe(true);
    });
  });

  describe('getEduConnectionInfo', () => {
    it('returns null when no env vars are set and no AWS secret exists', async () => {
      const info = await configService.getEduConnectionInfo(partnerA.id);
      expect(info).toBeNull();
    });

    it('returns a connection info object built from env vars when set', async () => {
      const privateKey = Buffer.from('private-key-content').toString('base64');
      const publicKey = Buffer.from('public-key-content').toString('base64');
      process.env.EDU_SNOWFLAKE_USERNAME = 'snowflake-user';
      process.env.EDU_SNOWFLAKE_URL = 'https://example.snowflakecomputing.com';
      process.env.EDU_SNOWFLAKE_SCHEMA = 'edu_stg.public';
      process.env.EDU_SNOWFLAKE_PUBLIC_KEY = publicKey;
      process.env.EDU_SNOWFLAKE_PRIVATE_KEY = privateKey;

      const info = await configService.getEduConnectionInfo(partnerA.id);
      expect(info).toEqual({
        username: 'snowflake-user',
        url: 'https://example.snowflakecomputing.com',
        schema: 'edu_stg.public',
        publicKey: Buffer.from('public-key-content'),
        privateKey: Buffer.from('private-key-content'),
      });
    });
  });
});
