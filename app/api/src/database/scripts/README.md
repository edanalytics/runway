# Descriptor mapping scripts

Scripts for generating the SQL that loads descriptor mappings into Runway.

| Script | Purpose |
|---|---|
| `desc-mapping-insert.js` | Transforms a single descriptor mapping CSV (stdin) into an `INSERT` statement (stdout). |
| `descriptors.sh` | Orchestrator — walks the bundle registry, finds the matching CSVs in the bundle and SC repos, and pipes each through `desc-mapping-insert.js`. |

There are two mapping tables:

- `bundle_descriptor_mapping` — the default mappings shipped with an earthmover bundle (`-t bundle`)
- `custom_descriptor_mapping` — a partner's overrides (`-t custom`)

**Load order matters.** The custom-mapping SQL joins to `bundle_descriptor_mapping` to
resolve `edfi_default_descriptor`, so the bundle mappings must already be in the database
before you run the custom ones.

## Prerequisites

- `jq`, `yq`, and Node available on `PATH`
- Dependencies installed in `app/` (`npm install`) — the script requires `papaparse` and `lodash`
- `earthmover_edfi_bundles` and `stadium_south_carolina` cloned as **siblings of `runway`**:

  ```
  repos/
  ├── runway/
  ├── earthmover_edfi_bundles/
  └── stadium_south_carolina/
  ```

`descriptors.sh` fetches, checks out `main`, and fast-forwards both sibling repos, so
commit or stash any local work in them first.

## Running the orchestrator

Run from this directory (paths are relative to it):

```bash
cd app/api/src/database/scripts

# One bundle — the key must exactly match a path in the bundle repo's registry.json
bash descriptors.sh --partner-id sc --bundle-key assessments/MAP_Growth

# Every bundle in registry.json
bash descriptors.sh --partner-id sc

# Overwrite existing output for the bundles being processed
bash descriptors.sh --partner-id sc --bundle-key assessments/MAP_Growth --force
```

(The file has no shebang and isn't marked executable, hence `bash descriptors.sh` rather
than `./descriptors.sh`.)

Output lands in `output/`, one pair of files per bundle:

```
output/MAP_Growth_bundle_descriptor_mappings.sql
output/MAP_Growth_custom_descriptor_mappings.sql
```

Without `--force` the script aborts up front if any target file already exists, so it
never leaves a half-written set behind.

Messages like `No custom mapping file found for assessments/X/gradeLevelDescriptors.csv`
are expected — not every registered bundle mapping has an SC override.

## When the custom descriptor file isn't in the SC repo

`descriptors.sh` only looks in one place for custom mappings:

```
../../../../../../stadium_south_carolina/airflow/dags/earthmover/<bundle-key>/seeds/<descriptorType>.csv
```

If the file lives somewhere else — a partner that isn't South Carolina, a CSV emailed to
you, a branch that hasn't merged yet — skip the orchestrator and call
`desc-mapping-insert.js` directly. It reads CSV on stdin and writes SQL to stdout, so the
source can be anything.

### From a file anywhere on disk

```bash
cd app/api/src/database/scripts

node desc-mapping-insert.js \
  -p sc \
  -b "assessments/PSAT_SAT" \
  -d "gradeLevelDescriptors" \
  -t custom \
  < ~/Downloads/sc_gradelevel_desc.csv \
  > output/PSAT_SAT_custom_descriptor_mappings.sql
```

### From a branch of the SC repo that isn't `main`

```bash
git -C ../../../../../../stadium_south_carolina show \
  my-branch:airflow/dags/earthmover/assessments/PSAT_SAT/seeds/gradeLevelDescriptors.csv \
  | node desc-mapping-insert.js -p sc -b "assessments/PSAT_SAT" -d "gradeLevelDescriptors" -t custom \
  > output/PSAT_SAT_custom_descriptor_mappings.sql
```

### From a URL

Make sure you fetch the **raw** CSV, not the GitHub HTML page:

```bash
curl -sL https://raw.githubusercontent.com/edanalytics/earthmover_edfi_bundles/main/assessments/PSAT_SAT/seeds/gradeLevelDescriptors.csv \
  | node desc-mapping-insert.js -p ea -b "assessments/PSAT_SAT" -d "gradeLevelDescriptors" -t bundle \
  > output/PSAT_SAT_bundle_descriptor_mappings.sql
```

### Appending several descriptor types into one file

Use `>>` after the first `>` so each descriptor type adds to the same script:

```bash
for desc in gradeLevelDescriptors assessmentReportingMethodDescriptors; do
  node desc-mapping-insert.js -p sc -b "assessments/PSAT_SAT" -d "$desc" -t custom \
    < "/path/to/csvs/$desc.csv" \
    >> output/PSAT_SAT_custom_descriptor_mappings.sql
done
```

### Dropping a file in so `descriptors.sh` picks it up

If you'd rather keep using the orchestrator, put the CSV at the path it expects in your
local SC checkout and run the script as normal. Just remember `descriptors.sh` does a
`git checkout main` + `pull --ff-only` on that repo — an untracked file survives that, a
committed one on another branch does not.

## `desc-mapping-insert.js` arguments

| Flag | Required | Notes |
|---|---|---|
| `-p`, `--partner-id` | no | Defaults to `sc`. Only used for custom mappings. |
| `-b`, `--bundle-key` | yes | E.g. `assessments/PSAT_SAT`. An `assessments/` prefix is added if you omit it. |
| `-d`, `--descriptor-type` | yes | The CSV's basename without `.csv`, e.g. `gradeLevelDescriptors`. |
| `-t`, `--type` | yes | `bundle` or `custom` — selects the target table. |
| `-h`, `--help` | — | Usage. |

### CSV shape

One column must be named `edfi_descriptor`; it holds the Ed-Fi descriptor for bundle files
and the partner's descriptor for custom files. Every other column, in whatever order, is
treated as the left-hand side and serialized into the `left_hand_side_columns` JSON. Empty
values become SQL `null`.

### The "MANUAL UPDATE REQUIRED" message

Custom mappings are matched back to their bundle row by left-hand-side value. If a custom
CSV has duplicate left-hand sides, that match is ambiguous, so the script prints

```
MANUAL UPDATE REQUIRED: LHS not unique for custom mapping file. Load these mappings manually.
```

to stderr and emits **no SQL** for that file. Those rows have to be written by hand. See
the long comment in `desc-mapping-insert.js` for the reasoning and the options considered.

Note that errors go to stderr and SQL to stdout, so a redirected output file stays clean —
but it also means a failed run can leave you with an empty or partial `.sql` file. Check
the console output before loading.

## Loading the SQL

Review the generated SQL, then apply bundle mappings before custom ones:

```bash
psql "$DATABASE_URL" -f output/PSAT_SAT_bundle_descriptor_mappings.sql
psql "$DATABASE_URL" -f output/PSAT_SAT_custom_descriptor_mappings.sql
```

Bundle inserts are `ON CONFLICT DO NOTHING`; custom inserts upsert `custom_descriptor` on
conflict, so re-running after a CSV edit updates existing rows. A foreign-key error on the
custom load means a custom mapping had no matching bundle row — either the bundle mappings
weren't loaded first, or the left-hand sides don't line up between the two CSVs.
