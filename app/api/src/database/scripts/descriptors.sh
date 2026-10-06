# This script assumes that the runway and earthmover_edfi_bundles repos
# are in the same parent directory. It also assumes the N drive has been mounted.
# It will checkout the appropriate branches for each repo, pull the latest changes, and then build the sql scripts to 
# insert both bundle and custom descriptor mappings.

partner_id="morenet" 
bundle_mapping_file="output/bundle_descriptor_mappings.sql"
custom_mapping_file="output/custom_descriptor_mappings.sql"

if [ -f "$bundle_mapping_file" ] || [ -f "$custom_mapping_file" ]; then
  if [ "$1" == '--force' ]; then
    rm "$bundle_mapping_file"
    rm "$custom_mapping_file"
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

partner_bundle_path="/mnt/n/texas_esc_4/data/runway/descriptor_overrides/$partner_id"

# registry.json gives us all the bundles that suport a Runway integration.
# Based on this, we get the default mappings from the each bundle in the bundle repo 
# via the metadata.yaml file. We then look for corresponding descriptor mapping file in the Runway folder 
# and grab the corresponding mappings.
registry_path="$bundle_repo/registry.json"
transform_script="node desc-mapping-insert.js"
for path in $(cat "$registry_path" | jq -r '.assessments[].path'); do
  for desc_file in $(cat "$bundle_repo/$path/_metadata.yaml" | yq -r '.descriptor_mapping_files // [] | .[]'); do
    desc_type="${desc_file%.csv}"
    if [ -f "$bundle_repo/$path/seeds/$desc_file" ]; then
      cat "$bundle_repo/$path/seeds/$desc_file" | $transform_script -p "$partner_id" -b "$path" -d "$desc_type" -t "bundle" >> "$bundle_mapping_file"
      
      assessment_folder="${path#*assessments/}"
      if [ -f "$partner_bundle_path/$assessment_folder/$desc_file" ]; then
        cat "$partner_bundle_path/$assessment_folder/$desc_file" | $transform_script -p "$partner_id" -b "$path" -d "$desc_type" -t "custom" >> "$custom_mapping_file"
      else
        # This is fine. Not all mappings in the bundle registry will have a corresponding file in SC
        echo "No custom mapping file found for $path/$desc_file"
      fi

    else
      echo "No bundle mapping file found for $path/$desc_file"
    fi
  done
done

