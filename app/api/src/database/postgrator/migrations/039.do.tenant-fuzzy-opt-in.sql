-- A partner admin's standing instruction that new jobs in a tenant use fuzzy
-- matching, whatever the partner's id_matching_mode: a row means opted in.
-- Rows are only inserted and deleted. Read by JobsService.createJob; existing
-- jobs keep their snapshot.
CREATE TABLE public.tenant_fuzzy_opt_in (
    tenant_code VARCHAR NOT NULL,
    partner_id VARCHAR NOT NULL,
    created_by_id INTEGER REFERENCES public."user" (id) ON DELETE SET NULL,
    created_on TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_code, partner_id),
    FOREIGN KEY (tenant_code, partner_id) REFERENCES public.tenant (code, partner_id) ON DELETE CASCADE
);
CREATE TRIGGER create_meta BEFORE INSERT ON public.tenant_fuzzy_opt_in FOR EACH ROW EXECUTE FUNCTION create_meta();
