SET app.current_user_username = 'DBA';
SET app.current_user_id = '-1';

CREATE FUNCTION update_meta()
RETURNS TRIGGER AS $$
DECLARE
	user_id integer;
BEGIN
	  BEGIN
        user_id := current_setting('app.current_user_id')::integer;
        IF user_id < 0 THEN
            -- "APP" or "DBA" value, not real user, which violates FK
            user_id := NULL;
        END IF;
    EXCEPTION
        WHEN others THEN
            -- this case applies only to backchannel or anonymous access
            user_id := NULL;
    END;

    NEW.modified_on = now();
    NEW.modified_by_id = user_id;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE FUNCTION create_meta()
RETURNS TRIGGER AS $$
DECLARE
	user_id integer;
BEGIN
	  BEGIN
        user_id := current_setting('app.current_user_id')::integer;
        IF user_id < 0 THEN
            -- "APP" or "DBA" value, not real user, which violates FK
            user_id := NULL;
        END IF;
    EXCEPTION
        WHEN others THEN
            -- this case applies only to backchannel or anonymous access
            user_id := NULL;
    END;

    NEW.created_on = now();
    NEW.created_by_id = user_id;
    RETURN NEW;
END;
$$ language 'plpgsql';