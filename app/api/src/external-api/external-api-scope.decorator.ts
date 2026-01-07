import { SetMetadata } from '@nestjs/common';

export const EXTERNAL_API_SCOPE_KEY = 'externalApiScopes';
const externalApiScopes = ['create:jobs', 'read:jobs', 'update:jobs', 'delete:jobs'] as const;

export type ExternalApiScopeType = (typeof externalApiScopes)[number];

export const ExternalApiScope = (...scopes: ExternalApiScopeType[]) =>
  SetMetadata(EXTERNAL_API_SCOPE_KEY, scopes);

