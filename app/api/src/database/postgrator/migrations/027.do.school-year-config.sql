CREATE TABLE school_year_config (
  partner_id VARCHAR NOT NULL REFERENCES partner(id),
  school_year_id VARCHAR NOT NULL REFERENCES school_year(id),
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  send_to_ods BOOLEAN NOT NULL DEFAULT true,
  created_by_id INT REFERENCES "user"(id),
  created_on TIMESTAMP(6) NOT NULL DEFAULT now(),
  modified_by_id INT REFERENCES "user"(id),
  modified_on TIMESTAMP(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_id, school_year_id)
);

CREATE TRIGGER create_meta BEFORE INSERT ON public.school_year_config FOR EACH ROW EXECUTE FUNCTION create_meta();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.school_year_config FOR EACH ROW EXECUTE FUNCTION update_meta();

-- Seed from existing active ODS configs:
-- every partner+year combo that currently has a non-retired ODS config
-- gets is_enabled=true, send_to_ods=true.
INSERT INTO school_year_config (partner_id, school_year_id, is_enabled, send_to_ods)
SELECT DISTINCT oc.partner_id, oc.school_year_id, true, true
FROM ods_config oc
WHERE oc.retired = false;
