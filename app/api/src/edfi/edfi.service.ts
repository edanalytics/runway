import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import type { AxiosRequestConfig } from 'axios';
import { lastValueFrom } from 'rxjs';
import { AppConfigService } from '../config/app-config.service';
import {
  assertAllowedUrl,
  findDisallowedUrlError,
  publicOnlyHttpsAgent,
} from './outbound-url-guard';

// Overall deadline per request, so a slow or unresponsive host doesn't hold it open.
const REQUEST_TIMEOUT_MS = 10_000;

// For logging, reduce a user-entered host to its origin, since the field may hold userinfo,
// query parameters, or text pasted into the wrong field.
const describeHost = (host: string) => {
  try {
    return new URL(host).origin;
  } catch {
    return '(unparseable URL)';
  }
};

interface IEdfiConnection {
  host: string;
  clientId: string;
  clientSecret: string;
}

@Injectable()
export class EdfiService {
  private readonly logger = new Logger(EdfiService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly appConfig: AppConfigService
  ) {}

  /**
   * The ODS host is user-supplied and the auth endpoint comes from the host's response.
   * Outside of dev (where the ODS is often on localhost), limit requests to both to https
   * and public addresses, including across redirects.
   */
  private requestConfig(url: string): AxiosRequestConfig {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    if (this.appConfig.isDevEnvironment()) return { signal };
    assertAllowedUrl(url);
    return {
      signal,
      httpsAgent: publicOnlyHttpsAgent,
      // A proxy would resolve the host itself, so the agents' address check wouldn't apply.
      proxy: false,
      beforeRedirect: (options) => {
        assertAllowedUrl(options.href);
      },
    };
  }

  private async getAuthEndpoint(connectionInfo: IEdfiConnection) {
    const baseApiUrl = connectionInfo.host.endsWith('/')
      ? connectionInfo.host.slice(0, -1)
      : connectionInfo.host;

    const res = await lastValueFrom(
      this.httpService.get(baseApiUrl, this.requestConfig(baseApiUrl))
    );
    if (res.status !== 200) {
      throw new Error('Failed to get auth endpoint');
    }

    const authEndpopint = res.data?.urls?.oauth;
    return authEndpopint ?? `${baseApiUrl}/oauth/token`;
  }

  private async getAccessToken(connectionInfo: IEdfiConnection) {
    const { clientId, clientSecret } = connectionInfo;
    const authEndpoint = await this.getAuthEndpoint(connectionInfo);

    const res = await lastValueFrom(
      this.httpService.post(
        authEndpoint,
        {
          grant_type: 'client_credentials',
        },
        {
          ...this.requestConfig(authEndpoint),
          headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          },
        }
      )
    );

    if (res.status !== 200) {
      throw new Error('Failed to get access token');
    }

    return res.data.access_token;
  }

  async testConnection(
    connectionInfo: IEdfiConnection
  ): Promise<{ status: 'SUCCESS' } | { status: 'ERROR'; type: 'AUTH' }> {
    try {
      await this.getAccessToken(connectionInfo);
    } catch (e) {
      const blocked = findDisallowedUrlError(e);
      if (blocked) {
        this.logger.warn(
          `Blocked ODS request for host ${describeHost(connectionInfo.host)}: ${blocked.message}`
        );
      }
      return { status: 'ERROR', type: 'AUTH' };
    }

    return { status: 'SUCCESS' };
  }
}
