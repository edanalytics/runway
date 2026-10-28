import { Injectable } from '@nestjs/common';
import {
  IdrsCredentials,
  IdrsCredentialsError,
  IdrsCredentialsService,
  IdrsReadinessErrorCode,
} from './idrs-credentials.service';

@Injectable()
export class IdrsReadinessService {
  constructor(private readonly credentials: IdrsCredentialsService) {}

  async checkPartner(
    partnerId: string
  ): Promise<
    | { status: 'SUCCESS'; data: null }
    | { status: 'ERROR'; code: IdrsReadinessErrorCode; cause: string }
  > {
    const failure = (code: IdrsReadinessErrorCode, cause: string) =>
      ({ status: 'ERROR', code, cause } as const);
    let credentials: IdrsCredentials;
    try {
      credentials = await this.credentials.getCredentials(partnerId, { useCache: false });
    } catch (err) {
      return err instanceof IdrsCredentialsError
        ? failure(err.code, err.message)
        : failure(
            'identity_service_unavailable',
            `credentials failed (${err instanceof Error ? err.name : 'unknown'})`
          );
    }

    let response: Response;
    try {
      response = await fetch(`${credentials.url.replace(/\/+$/, '')}/token/verify`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${credentials.token}` },
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      return failure(
        'identity_service_unavailable',
        `verification failed (${err instanceof Error ? err.name : 'unknown'})`
      );
    }
    if (response.status !== 200) {
      return failure(
        [401, 403].includes(response.status) ? 'idrs_not_ready' : 'identity_service_unavailable',
        `verification rejected with status ${response.status}`
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return failure('identity_service_unavailable', 'verification response was not JSON');
    }
    const scopes =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).scopes
        : undefined;
    if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) {
      return failure('identity_service_unavailable', 'verification scopes malformed');
    }
    if (!scopes.includes(`partner:${partnerId}`) || !scopes.includes('student:identity:read')) {
      return failure('idrs_not_ready', 'verification missing required scopes');
    }
    return { status: 'SUCCESS', data: null };
  }
}
