CREATE EXTENSION pgcrypto;

CREATE TABLE IF NOT EXISTS connections (
    id serial NOT NULL PRIMARY KEY,
    contype varchar NOT NULL,
    host varchar,
    port int,
    user_or_key varchar,
    encrypted_password_or_secret bytea,
    path_or_database varchar,
    schema varchar
);
TRUNCATE connections;
INSERT INTO connections (id, contype, host, port, user_or_key, encrypted_password_or_secret, path_or_database) VALUES
    (1, 'edfi', 'host.docker.internal', 443, 'populated', encrypt('populatedSecret'::bytea, 'asdf1234', 'aes'), '/api'),
    (2, 'snowflake', 'edanalytics-test', 443, 'loader_prod', encrypt('notarealpassword'::bytea, 'asdf1234', 'aes'), 'raw')
;

CREATE TABLE IF NOT EXISTS jobs (
    id serial NOT NULL PRIMARY KEY,
    data jsonb NOT NULL
);
TRUNCATE jobs;
INSERT INTO jobs (id, data) VALUES 
(
    1,
    '{
        "active": true,
        "schedule": null,
        "metadata": {
            "status": "new",
            "last_run": null,
            "next_run": null
        },
        "bundle": {
            "connection": "https://github.com/edanalytics/earthmover_edfi_bundles",
            "path": "assessments/MAP_Growth",
            "params": {
                "STUDENT_ID_NAME": "StudentID"
            }
        },
        "assessment": {
            "source": "local",
            "path": "/storage/AssessmentResults.csv"
        },
        "ods_connection": 1,
        "snowflake_connection": null,
        "logs": {
            "earthmover_run": null,
            "lightbeam_validate": null,
            "lightbeam_send": null
        }
    }'::jsonb
),
(   2,
    '{
    "assessmentDatastore": {
        "apiYear": "2024",
        "url": "https://host.docker.internal:443/api",
        "clientId": "populated",
        "clientSecret": "populatedSecret"
    },
    "bundle": {
        "path": "assessments/STAAR_Summative",
        "branch": "feature/registry"
    },
    "inputFiles": {
        "INPUT_FILE": "sample_anonymized_file.txt",
        "SUPPLEMENT": "file:///path/on/executor/filesystem"
    },
    "inputParams": {
        "API_YEAR": "2024",
        "FORMAT": "Standard"
    },
    "appDataBasePath": "s3://runway-local-dev-data-integration/ea/runway-local-example-tenant/2/23/",
    "appUrls": {
        "status": "http://host.docker.internal:3001/status/2"
        "error": "http://host.docker.internal:3001/status/2"
    }
}'::jsonb
)
-- encrypt(data bytea, key bytea, type text) returns bytea
-- i.e., select convert_from(encrypt('mysensitivedata'::bytea, 'supersecurekey', 'aes'),'SQL_ASCII');
-- decrypt(data bytea, key bytea, type text) returns bytea
-- i.e., select convert_from(decrypt('encrypteddata'::bytea, 'supersecurekey', 'aes'),'SQL_ASCII');
-- https://www.postgresql.org/docs/current/pgcrypto.html#PGCRYPTO-RAW-ENC-FUNCS