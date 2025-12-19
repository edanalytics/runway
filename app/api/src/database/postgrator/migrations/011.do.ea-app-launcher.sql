ALTER TABLE public.oidc_config ADD COLUMN embedded_claims_claim varchar;
COMMENT on COLUMN public.oidc_config.embedded_claims_claim IS 'Claim that contains a stringified JSON object with additional claims that extend those on the token.';

ALTER TABLE public.oidc_config ADD COLUMN partner_claim varchar;
COMMENT on COLUMN public.oidc_config.partner_claim IS 'If populated, the partner in this claim must match the partner associated with the IdP registration.';
