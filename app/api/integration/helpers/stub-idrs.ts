import { AppConfigService } from '../../src/config/app-config.service';
import { IdrsCredentialsService } from '../../src/idrs/idrs-credentials.service';

/**
 * Stubs IDRS's config so the real credentials service runs against fakes:
 * only AWS is faked here, and the caller stubs `fetch` for the OAuth server
 * and IDRS. Each partner's OAuth client is `<partnerId>-client`. Returns the
 * stubbed config.
 */
export const stubIdrsConfig = ({ idrsUrl, tokenUrl }: { idrsUrl: string; tokenUrl: string }) => {
  // Tokens are cached per app instance, and the app is shared across tests.
  const idrsCredentials = app.get(IdrsCredentialsService);
  (idrsCredentials as unknown as { cache: Map<string, unknown> }).cache.clear();

  const config = app.get(AppConfigService);
  jest.spyOn(config, 'idrsOauthTokenUrl').mockReturnValue(tokenUrl);
  jest.spyOn(config, 'idrsUrl').mockReturnValue(idrsUrl);
  jest.spyOn(config, 'getIdrsConnectionInfo').mockImplementation(async (partnerId: string) => ({
    clientId: `${partnerId}-client`,
    clientSecret: `${partnerId}-secret`,
  }));
  return config;
};
