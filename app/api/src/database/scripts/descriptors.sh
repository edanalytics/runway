# This script assumes that runway, earthmover_edfi_bundles, and stadium_south_carolina
# are all in the same parent directory. It will checkout the appropriate branches
# for each repo, pull the latest changes, and then build the sql scripts to 
# insert both bundle and custom descriptor mappings.

partner_id=""
bundle_key=""
force=false

usage() {
  echo "Usage: $0 -p|--partner-id <id> [-b|--bundle-key <key>] [--force]"
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

bundle_mapping_file="output/bundle_descriptor_mappings.sql"
custom_mapping_file="output/custom_descriptor_mappings.sql"

if [ -f "$bundle_mapping_file" ] || [ -f "$custom_mapping_file" ]; then
  if [ "$force" = true ]; then
    rm -f "$bundle_mapping_file"
    rm -f "$custom_mapping_file"
  else
    echo "Error: $bundle_mapping_file and/or $custom_mapping_file already exists. Please remove them before running this script OR run with --force."
    exit 1
  fi
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


# registry.json gives us all the bundles that suport a Runway integration.
# Based on this, we get the default mappings from the each bundle in the bundle repo 
# via the metadata.yaml file. We then look for a corresponding file in the SC repo 
# (which has no registry.json or metadata.yaml files) and grab the corresponding mappings.
registry_path="$bundle_repo/registry.json"
transform_script="node desc-mapping-insert.js"
for path in $(cat "$registry_path" | jq -r '.assessments[].path'); do
  if [ -n "$bundle_key" ] && [ "$path" != "$bundle_key" ]; then
    continue
  fi
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

