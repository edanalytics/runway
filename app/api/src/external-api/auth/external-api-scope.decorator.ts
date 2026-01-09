import { SetMetadata } from '@nestjs/common';

export const EXTERNAL_API_SCOPE_KEY = 'externalApiScopes';
export const EXTERNAL_API_RESOURCE_SCOPES = [
  'create:jobs',
  'read:jobs',
  'update:jobs',
  'delete:jobs',
] as const;

export type ExternalApiScopeType =
  | (typeof EXTERNAL_API_RESOURCE_SCOPES)[number]
  | `partner:${string}`;

export const ExternalApiScope = (...scopes: ExternalApiScopeType[]) =>
  SetMetadata(EXTERNAL_API_SCOPE_KEY, scopes);
