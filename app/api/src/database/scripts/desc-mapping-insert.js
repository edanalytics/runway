const Papa = require('papaparse');
const { uniq } = require('lodash');

/**
 * Use this script as part of loading descriptor mappings into Runway.
 * This script transforms a CSV that contains custom descriptor mappings
 * or default mappings from the Earthmover bundle into an INSERT statement
 * for the corresponding table. You must specify the mapping type explicitly
 * using the -t/--type argument to choose between bundle_descriptor_mapping
 * or custom_descriptor_mapping tables.
 *
 * It accepts CSV input via stdin and writes to stdout, allowing for flexibility in how
 * you source the CSV. You could grab the CSV from the filesystem if you know where it is:
 * node desc-mapping-insert.js -p ea -b "assessments/PSAT_SAT" -d "gradeLevelDescriptors" -t "bundle" < sc_gradelevel_desc.csv
 *
 * Or you could curl it:
 * curl https://github.com/edanalytics/earthmover_edfi_bundles/blob/main/assessments/PSAT_SAT/gradeLevelDescriptors.csv | node desc-mapping-insert.js -p sc -b "assessments/PSAT_SAT" -d "gradeLevelDescriptors" -t "bundle"
 *
 * The script requires the following arguments:
 * -p, --partner-id <id>        Partner ID (optional, defaults to 'sc')
 * -b, --bundle-key <key>       Bundle key (required)
 * -d, --descriptor-type <type> Descriptor type (required)
 * -t, --type <type>            Mapping type: "custom" or "bundle" (required)
 *
 * The script will write the INSERT statement to stdout.
 *
 */

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      console.log(`Usage: node desc-mapping-insert.js [OPTIONS] < input.csv
      
Options:
  -p, --partner-id <id>        Partner ID (optional, defaults to 'sc')
  -b, --bundle-key <key>       Bundle key (required)
  -d, --descriptor-type <type> Descriptor type (required)
  -t, --type <type>            Mapping type: "custom" or "bundle" (required)
  -h, --help                   Show this help message

Example:
  node desc-mapping-insert.js -p ea -b "assessments/PSAT_SAT" -d "gradeLevelDescriptors" -t "bundle" < input.csv`);
      process.exit(0);
    }

    if ((arg === '-p' || arg === '--partner-id') && i + 1 < args.length) {
      parsed.partner_id = args[++i];
    } else if ((arg === '-b' || arg === '--bundle-key') && i + 1 < args.length) {
      parsed.bundle_key = args[++i];
    } else if ((arg === '-d' || arg === '--descriptor-type') && i + 1 < args.length) {
      parsed.descriptor_type = args[++i];
    } else if ((arg === '-t' || arg === '--type') && i + 1 < args.length) {
      parsed.type = args[++i];
    }
  }

  // Set default values
  if (!parsed.partner_id) {
    parsed.partner_id = 'sc';
  }

  if (parsed.bundle_key && !parsed.bundle_key.startsWith('assessments/')) {
    parsed.bundle_key = `assessments/${parsed.bundle_key}`;
  }

  // Validate type argument
  if (parsed.type && !['custom', 'bundle'].includes(parsed.type)) {
    console.error('Error: Type must be either "custom" or "bundle"');
    console.error('Use -h or --help for usage information');
    process.exit(1);
  }

  // Validate required arguments
  const required = ['bundle_key', 'descriptor_type', 'partner_id', 'type'];
  const missing = required.filter((key) => !parsed[key]);

  if (missing.length > 0) {
    console.error(
      `Error: Missing required arguments: ${missing
        .map((key) => `--${key.replace('_', '-')}`)
        .join(', ')}`
    );
    console.error('Use -h or --help for usage information');
    process.exit(1);
  }

  return parsed;
}

const { partner_id, bundle_key, descriptor_type, type } = parseArgs();

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputData += chunk;
});
process.stdin.on('end', () => {
  try {
    const csv = Papa.parse(inputData, { header: true, skipEmptyLines: true, delimiter: ',' });
    if (csv.errors && csv.errors.length > 0) {
      console.error('CSV parsing errors:', csv.errors);
      process.exit(1);
    }

    if (!csv.data || csv.data.length === 0) {
      console.error('No data found in CSV input');
      process.exit(1);
    }

    /**
     * CSVs from the *bundle* repo have all the info we need: LHS and edfi_default_descriptor.
     * However, CSVs with *custom* mappings do NOT have all the info we need, so they're a
     * bit trickier to construct. They have the LHS and the custom descriptor, but not the
     * edfi_default_descriptor. How do we get that? We do the following:
     * - load bundle descriptor mappings first! These need to be in place so the query to
     *   insert custom mappings can reference them
     * - Create a CTE based on the custom mappings CSV and join it to the bundle descriptor
     *   mappings previously loaded.
     *   - This works when the LHS is unique... which it usually is... but it's not guaranteed.
     *   - When the LHS is not unique (for custom mappings), we print an error and you need to
     *     load those by hand. That's fine. It's just one file in this initial set of assessments
     *     and by the time we're loading more maybe we'll have a UI.
     *     - There are ways we could solve this if we want to. We could rewrite this script to
     *       accept the bundle csv and the custom csv at the same time and merge the two... OR
     *       we could assign rown numbers to the mappings in the CTE and the bundle mappings we
     *       join in -- that doesn't guarantee that the mappings are correct from a semantic
     *       standpoint (e.g. an Ed-Fi "2" could be mapped to an SC "Eleventh Grade") but, that
     *       doesn't matter for these mappings. Earthmover just needs the descriptor to be associated
     *       with the assessment type and doesn't care what EdFi descriptor it's mapped to. Still,
     *       that'd be confusing to see in the DB so best avoided.
     *     - But again, given that it's one file, I think it's fine to punt on handling this complexity.
     *   - The script looks at whether the LHS is not unique in the custom mapping and assumes that
     *     a non-unique LHS in the SC file will also have a non-unique LHS in the bundle file. That
     *     is, in fact the case, so I'm going with that assumption in the code.
     *     There is one case where the SC file is unique but the bundle file is not and that just
     *     requires some manual cleanup. You get a FK error when trying to load it.
     *     https://github.com/edanalytics/stadium_south_carolina/pull/492/files#r2395523936
     */
    const lhsHeaders = csv.meta.fields.filter((field) => field !== 'edfi_descriptor'); // edfi_descriptor not gauranteed to be the rightmost column
    const makeLhsJson = (row) =>
      `${JSON.stringify(Object.fromEntries(lhsHeaders.map((header) => [header, row[header]])))}`;
    const descriptorValue = (row) => row['edfi_descriptor']; // custom mappings also use "edfi_descriptor" column name
    const makeRowStr = (row) =>
      `(${row.map((value) => (value === '' ? 'null' : `'${value}'`)).join(',')})`;

    if (type === 'bundle') {
      const bundleMappingQuery = `
      INSERT INTO bundle_descriptor_mapping (bundle_key, descriptor_type, left_hand_side_columns, edfi_default_descriptor)
        VALUES ${csv.data
          .map((row) => [bundle_key, descriptor_type, makeLhsJson(row), descriptorValue(row)])
          .map(makeRowStr)
          .join(',\n')}
        ON CONFLICT DO NOTHING;`;
      // Write only the SQL to stdout
      process.stdout.write(bundleMappingQuery + '\n');
    } else if (
      // is LHS for custom mapping unique?
      uniq(csv.data.map((row) => JSON.stringify(makeLhsJson(row)))).length == csv.data.length
    ) {
      const customMappingQuery = `WITH custom_mappings AS (
        SELECT * FROM (VALUES ${csv.data
          .map((row) => [
            bundle_key,
            descriptor_type,
            makeLhsJson(row),
            descriptorValue(row),
            partner_id,
          ])
          .map(makeRowStr)
          .join(',\n')})
        as t(bundle_key, descriptor_type, left_hand_side_columns, custom_descriptor, partner_id)          
      ),
      custom_mapping_plus_edfi_default AS (
        SELECT custom_mappings.*, bdm.edfi_default_descriptor
        FROM custom_mappings
        LEFT JOIN bundle_descriptor_mapping AS bdm  -- left join to identify custom mappings without a corresponding bundle mapping, these should error
          ON custom_mappings.bundle_key = bdm.bundle_key
          AND custom_mappings.descriptor_type = bdm.descriptor_type
          AND custom_mappings.left_hand_side_columns::jsonb = bdm.left_hand_side_columns
      )
      INSERT INTO custom_descriptor_mapping 
        (bundle_key, descriptor_type, left_hand_side_columns, custom_descriptor, partner_id, edfi_default_descriptor)
      SELECT bundle_key, descriptor_type, left_hand_side_columns::jsonb, custom_descriptor, partner_id, edfi_default_descriptor
      FROM custom_mapping_plus_edfi_default
      ON CONFLICT (bundle_key, descriptor_type, left_hand_side_columns, partner_id, edfi_default_descriptor)
        DO UPDATE SET custom_descriptor = EXCLUDED.custom_descriptor;`; // until we switch to a GUI, use the script to update mappings that have a unique LHS... after the csv has been updated

      process.stdout.write(customMappingQuery + '\n');
    } else {
      console.error(`MANUAL UPDATE REQUIRED: LHS not unique for custom mapping file. Load these mappings manually.
          Bundle: ${bundle_key} 
          Descriptor Type: ${descriptor_type}`);
    }
    // Write only the SQL to stdout
  } catch (error) {
    // write errors to stderr so they don't contaminate the output
    console.error('Error processing CSV:', error.message);
    process.exit(1);
  }
});
