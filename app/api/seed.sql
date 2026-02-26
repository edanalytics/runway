-- Seed data for local development.
-- All statements are idempotent (ON CONFLICT DO NOTHING).
-- Run from app/ via: docker compose exec -T db bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < api/seed.sql

-- Keycloak OIDC config
INSERT INTO public.oidc_config (id, issuer, client_id, client_secret, user_id_claim, tenant_code_claim, require_role)
VALUES ('local-keycloak-oidc', 'http://localhost:8080/realms/example', 'runway-local', 'big-secret-123', 'preferred_username', 'tenant_code', false)
ON CONFLICT (id) DO NOTHING;

-- Local Keycloak identity provider
INSERT INTO public.identity_provider (id, fe_home, oidc_config_id)
VALUES ('local-keycloak', 'http://localhost:4200', 'local-keycloak-oidc')
ON CONFLICT (id) DO NOTHING;

-- Partner
INSERT INTO public.partner (id, name, idp_id)
VALUES ('ea', 'ea-local', 'local-keycloak')
ON CONFLICT (id) DO NOTHING;

-- School year
INSERT INTO public.school_year (id, start_year, end_year)
VALUES ('2526', 2025, 2026)
ON CONFLICT (id) DO NOTHING;

-- Earthmover bundles
INSERT INTO public.earthmover_bundle (key)
VALUES ('assessments/STAAR_Interim'),
       ('assessments/STAAR_Summative'),
       ('assessments/PSAT_SAT'),
       ('assessments/ASVAB'),
       ('assessments/Dibels_Next_Benchmark'),
       ('assessments/Dibels_8_Benchmark'),
       ('assessments/ACCESS'),
       ('assessments/EOCEP'),
       ('assessments/i-Ready'),
       ('assessments/WIN'),
       ('assessments/SC_READY'),
       ('assessments/MAP_Growth'),
       ('assessments/ACT'),
       ('assessments/STAR'),
       ('assessments/TX_KEA'),
       ('assessments/CIRCLE'),
       ('assessments/SC_Alternate_Assessment'),
       ('assessments/IB')
ON CONFLICT (key) DO NOTHING;

-- Partner ↔ bundle associations
INSERT INTO public.partner_earthmover_bundle (partner_id, earthmover_bundle_key)
VALUES ('ea', 'assessments/STAAR_Interim'),
       ('ea', 'assessments/STAAR_Summative'),
       ('ea', 'assessments/PSAT_SAT'),
       ('ea', 'assessments/ASVAB'),
       ('ea', 'assessments/Dibels_Next_Benchmark'),
       ('ea', 'assessments/Dibels_8_Benchmark'),
       ('ea', 'assessments/ACCESS'),
       ('ea', 'assessments/EOCEP'),
       ('ea', 'assessments/i-Ready'),
       ('ea', 'assessments/WIN'),
       ('ea', 'assessments/SC_READY'),
       ('ea', 'assessments/MAP_Growth'),
       ('ea', 'assessments/ACT'),
       ('ea', 'assessments/STAR'),
       ('ea', 'assessments/TX_KEA'),
       ('ea', 'assessments/CIRCLE'),
       ('ea', 'assessments/SC_Alternate_Assessment'),
       ('ea', 'assessments/IB')
ON CONFLICT (partner_id, earthmover_bundle_key) DO NOTHING;
