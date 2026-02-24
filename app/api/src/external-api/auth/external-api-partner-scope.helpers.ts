import { ExternalApiScopeType } from './external-api-scope.decorator';

export const extractAllowedPartnerCodesFromScopes = (scopes: ExternalApiScopeType[]): string[] => {
  return scopes.filter((scope) => scope.startsWith('partner:')).map((scope) => scope.split(':')[1]);
};

export const isPartnerAllowed = (scopes: ExternalApiScopeType[], partnerCode: string): boolean => {
  return extractAllowedPartnerCodesFromScopes(scopes).includes(partnerCode);
};
