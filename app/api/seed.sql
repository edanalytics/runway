-- Seed data for local development.
-- All statements are idempotent (ON CONFLICT DO NOTHING).
-- Run from app/ via: docker compose exec -T db bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < api/seed.sql

\echo oidc_config
INSERT INTO public.oidc_config (id, issuer, client_id, client_secret, user_id_claim, tenant_code_claim, require_role, roles_claim)
VALUES ('local-keycloak-oidc', 'http://localhost:8080/realms/example', 'runway-local', 'big-secret-123', 'preferred_username', 'tenant_code', false, 'roles')
ON CONFLICT (id) DO UPDATE SET roles_claim = EXCLUDED.roles_claim;

\echo identity_provider
INSERT INTO public.identity_provider (id, fe_home, oidc_config_id)
VALUES ('local-keycloak', 'http://localhost:4200', 'local-keycloak-oidc')
ON CONFLICT (id) DO NOTHING;

\echo partner
INSERT INTO public.partner (id, name, idp_id)
VALUES ('ea', 'ea-local', 'local-keycloak')
ON CONFLICT (id) DO NOTHING;

\echo school_year
INSERT INTO public.school_year (id, start_year, end_year)
VALUES ('2324', 2023, 2024),
       ('2425', 2024, 2025),
       ('2526', 2025, 2026)
ON CONFLICT (id) DO NOTHING;

\echo school_year_config
INSERT INTO public.school_year_config (partner_id, school_year_id, is_enabled, send_to_ods)
VALUES ('ea', '2324', true, false),
       ('ea', '2425', true, false),
       ('ea', '2526', true, true)
ON CONFLICT (partner_id, school_year_id) DO NOTHING;
