-- We might not get the email consistently from the IdP.
-- We don't need it right now but would later if we want to 
-- do notifications. We'll need to figure out then how to 
-- consistently get the email.
ALTER TABLE public."user" ALTER COLUMN email DROP NOT NULL;