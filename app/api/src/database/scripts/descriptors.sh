# This script assumes that runway, earthmover_edfi_bundles, and stadium_south_carolina
# are all in the same parent directory. It will checkout the appropriate branches
# for each repo, pull the latest changes, and then build the sql scripts to
# insert both bundle and custom descriptor mappings.
#
# Primary mode is one bundle at a time: pass --bundle-key to process a single
# bundle listed in the bundle repo's registry.json. Omit it to process every
# registered bundle. Either way, output is written per bundle:
#   output/<bundle>_bundle_descriptor_mappings.sql
#   output/<bundle>_custom_descriptor_mappings.sql
# --force is only needed when the output files for the bundle(s) being processed
# already exist.

partner_id=""
bundle_key=""
force=false

usage() {
  echo "Usage: $0 -p|--partner-id <id> [-b|--bundle-key <key>] [--force]"
  echo "  -b|--bundle-key   exact registry.json path (e.g. assessments/MAP_Growth)."
  echo "                    If omitted, all bundles in registry.json are processed."
}

while [ $# -gt 0 ]; do
  case "$1" in
    -p|--partner-id)
      partner_id="$2"
      shift 2
      ;;
    -b|--bundle-key)
      bundle_key="$2"
      shift 2
      ;;
    --force)
      force=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [ -z "$partner_id" ]; then
  echo "Error: --partner-id is required."
  usage
  exit 1
fi

repos_dir="../../../../../.."
bundle_repo="$repos_dir/earthmover_edfi_bundles"
bundle_branch="main"
git -C $bundle_repo fetch
git -C $bundle_repo checkout $bundle_branch
git -C $bundle_repo pull --ff-only

sc_repo="$repos_dir/stadium_south_carolina"
sc_branch="main"
git -C $sc_repo fetch
git -C $sc_repo checkout $sc_branch
git -C $sc_repo pull --ff-only
sc_bundle_path="$sc_repo/airflow/dags/earthmover"

# registry.json gives us all the bundles that support a Runway integration, and is
# also how we validate the requested bundle key.
registry_path="$bundle_repo/registry.json"
registry_paths=$(jq -r '.assessments[].path' "$registry_path")

if [ -n "$bundle_key" ]; then
  # The bundle key must exactly match a path in registry.json.
  if ! echo "$registry_paths" | grep -qxF "$bundle_key"; then
    echo "Error: bundle '$bundle_key' not found in $registry_path."
    echo "Available bundles:"
    echo "$registry_paths" | sed 's/^/  /'
    exit 1
  fi
  bundle_paths="$bundle_key"
else
  bundle_paths="$registry_paths"
fi

mkdir -p output

# Check (and optionally clear) output files up front so we don't leave a half-written set behind.
existing_files=""
for path in $bundle_paths; do
  bundle_name="${path##*/}"
  for file in "output/${bundle_name}_bundle_descriptor_mappings.sql" "output/${bundle_name}_custom_descriptor_mappings.sql"; do
    if [ -f "$file" ]; then
      if [ "$force" = true ]; then
        rm -f "$file"
      else
        existing_files="$existing_files
  $file"
      fi
    fi
  done
done

if [ -n "$existing_files" ]; then
  echo "Error: the following output files already exist. Remove them before running this script OR run with --force:"
  echo "$existing_files"
  exit 1
fi

# For each bundle we get the default mappings from the bundle repo via the _metadata.yaml
# file. We then look for a corresponding file in the SC repo (which has no registry.json
# or _metadata.yaml files) and grab the corresponding mappings.
transform_script="node desc-mapping-insert.js"
for path in $bundle_paths; do
  bundle_name="${path##*/}"
  bundle_mapping_file="output/${bundle_name}_bundle_descriptor_mappings.sql"
  custom_mapping_file="output/${bundle_name}_custom_descriptor_mappings.sql"

  echo "Processing $path"
  for desc_file in $(cat "$bundle_repo/$path/_metadata.yaml" | yq -r '.descriptor_mapping_files // [] | .[]'); do
    desc_type="${desc_file%.csv}"
    if [ -f "$bundle_repo/$path/seeds/$desc_file" ]; then
      cat "$bundle_repo/$path/seeds/$desc_file" | $transform_script -p "$partner_id" -b "$path" -d "$desc_type" -t "bundle" >> "$bundle_mapping_file"

      if [ -f "$sc_bundle_path/$path/seeds/$desc_file" ]; then
        cat "$sc_bundle_path/$path/seeds/$desc_file" | $transform_script -p "$partner_id" -b "$path" -d "$desc_type" -t "custom" >> "$custom_mapping_file"
      else
        # This is fine. Not all mappings in the bundle registry will have a corresponding file in SC
        echo "No custom mapping file found for $path/$desc_file"
      fi

    else
      echo "No bundle mapping file found for $path/$desc_file"
    fi
  done
done
