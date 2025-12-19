import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';

interface IEdfiConnection {
  host: string;
  clientId: string;
  clientSecret: string;
  year: number;
}

@Injectable()
export class EdfiService {
  constructor(private readonly httpService: HttpService) {}

  private async getAuthEndpoint(connectionInfo: IEdfiConnection) {
    const baseApiUrl = connectionInfo.host.endsWith('/')
      ? connectionInfo.host.slice(0, -1)
      : connectionInfo.host;

    const res = await lastValueFrom(this.httpService.get(baseApiUrl));
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
  ): Promise<{ status: 'SUCCESS' } | { status: 'ERROR'; type: 'AUTH' | 'YEAR' }> {
    let accessToken: string;
    try {
      accessToken = await this.getAccessToken(connectionInfo);
    } catch (e) {
      return { status: 'ERROR', type: 'AUTH' };
    }

    return { status: 'SUCCESS' };
  }
}
