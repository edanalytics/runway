import {
  GetLogEventsCommand,
  GetLogEventsCommandOutput,
  ResourceNotFoundException,
} from '@aws-sdk/client-cloudwatch-logs';

// A stand-in for CloudWatch Logs, so the executor logs UI can be worked on
// locally. Enabled with LOCAL_EXECUTOR_LOGS=mock; api/mock-executor-logs.sql
// points local runs at it with task ids of the form mock-<scenario>-<start ms>.
//
// Events have the shape the awslogs driver stores: one event per line of
// container output, so multi-line output and tracebacks arrive split up, and
// executor log lines carry their own timestamp as well as CloudWatch's. Only
// events up to the current time are returned, so a run seeded to start now
// fills in over a few minutes, like a live one.

const LATENCY_MS = 400;

type Event = { timestamp: number; message: string };

const stamp = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 23);

class Script {
  readonly events: Event[] = [];
  constructor(private t: number) {}

  wait(ms: number) {
    this.t += ms;
    return this;
  }

  // Lines written straight to the container's stdout/stderr
  raw(...lines: string[]) {
    for (const message of lines) {
      this.events.push({ timestamp: this.t, message });
      this.t += 1;
    }
    return this;
  }

  // A line from a Python logger with the executor's format; continuation
  // lines of a multi-line message become events of their own
  log(level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR', message: string, name = 'runway') {
    const [first, ...rest] = message.split('\n');
    return this.raw(`${stamp(this.t)} ${name} ${level} ${first}`, ...rest);
  }

  // Output a subprocess wrote while the executor captured it, to be logged later
  captured(name: string, messages: string[], spacingMs = 40) {
    const start = this.t - messages.length * spacingMs;
    return messages.map((m, i) => `${stamp(start + i * spacingMs)} ${name} INFO ${m}`).join('\n');
  }

  now() {
    return this.t;
  }
}

const TASK = {
  bundle: 'assessments/STAAR_Summative',
  inputFile: 'STAAR_EOC_Spring_2026.csv',
};

const start = (s: Script) =>
  s
    .log('DEBUG', 'timing out in 3600 seconds...')
    .log('INFO', 'spinning up')
    .wait(600)
    .raw(
      "{'appDataBasePath': 's3://runway-local-dev-data-integration/ea/district-a/2526/412',",
      " 'appUrls': {'error': 'http://localhost:3333/api/earthbeam/jobs/1180/error',",
      "             'outputFiles': 'http://localhost:3333/api/earthbeam/jobs/1180/output-files',",
      "             'status': 'http://localhost:3333/api/earthbeam/jobs/1180/status',",
      "             'summary': 'http://localhost:3333/api/earthbeam/jobs/1180/summary',",
      "             'unmatchedIds': 'http://localhost:3333/api/earthbeam/jobs/1180/unmatched-ids'},",
      " 'assessmentDatastore': {'clientId': 'b7f3c2a91e4d',",
      "                         'url': 'https://ods.example.org/api'},",
      ` 'bundle': {'branch': 'main', 'path': '${TASK.bundle}'},`,
      " 'crossYearMatchAvailable': False,",
      " 'customDescriptorMappings': {'gradeLevelDescriptors': {'09': 'Ninth grade',",
      "                                                        '10': 'Tenth grade',",
      "                                                        '11': 'Eleventh grade'}},",
      " 'idMatchingMode': 'id_based',",
      " 'inputFiles': {'INPUT_FILE': {'encoding': None,",
      "                               'is_plausible_non_utf8': False,",
      `                               'path': 's3://runway-local-dev-data-integration/ea/district-a/2526/412/input/INPUT_FILE__${TASK.inputFile}'}},`,
      " 'inputParams': {'API_YEAR': 2026, 'FORMAT': 'Standard', 'STUDENT_ID_NAME': 'edFi_studentUniqueID'},",
      " 'sendToOds': True}"
    );

const bundleRefresh = (s: Script) =>
  s
    .log('INFO', 'beginning action: refresh_bundle_code')
    .wait(1800)
    .raw(
      'From https://github.com/edanalytics/earthmover_edfi_bundles',
      '   3f2a1b4..9c8d7e6  main       -> origin/main',
      "Already on 'main'",
      "Your branch is behind 'origin/main' by 2 commits, and can be fast-forwarded.",
      '  (use "git pull" to update your local branch)',
      'Updating 3f2a1b4..9c8d7e6',
      'Fast-forward',
      ` ${TASK.bundle}/earthmover.yaml | 4 ++--`,
      ' 1 file changed, 2 insertions(+), 2 deletions(-)'
    );

// set_action stops announcing actions once the run has succeeded
const deps = (s: Script, announce = true) => {
  if (announce) s.log('INFO', 'beginning action: earthmover_deps').wait(300);
  s.log('INFO', 'installing packages...', 'earthmover').wait(2400);
  s.log('INFO', "installing 'student_ids' from git ...", 'earthmover').wait(3100);
  s.log('INFO', `installing 'assessment' from local path packages/${TASK.bundle}...`, 'earthmover');
  return s.wait(200).log('INFO', 'done!', 'earthmover');
};

const roster = (s: Script) => {
  s.log('INFO', 'beginning action: get_student_roster').wait(400);
  s.log('INFO', 'starting...', 'lightbeam');
  s.log('INFO', 'fetching from endpoint `students`...', 'lightbeam').wait(9200);
  s.log('INFO', 'finished fetching `students` (12418 records)', 'lightbeam');
  s.log('INFO', 'fetching from endpoint `studentEducationOrganizationAssociations`...', 'lightbeam');
  s.wait(11400);
  s.log('INFO', 'finished fetching `studentEducationOrganizationAssociations` (14902 records)', 'lightbeam');
  return s.log('DEBUG', 'uploading artifact ROSTER');
};

const files = (s: Script) => {
  s.log('INFO', 'beginning action: get_input_files').wait(1300);
  s.log('INFO', 'encoding detected for input file: utf-8');
  s.log('DEBUG', 'encoding detection ran for 0.84 seconds');
  for (const [name, count] of [
    ['gradeLevelDescriptors', 3],
    ['assessmentReportingMethodDescriptors', 0],
    ['performanceLevelDescriptors', 0],
  ] as const) {
    s.log('DEBUG', `mapping ${name}...`).log('DEBUG', `Mapped ${count} ${name} values`);
  }
  return s;
};

const emStart = (s: Script) => {
  s.log('INFO', 'beginning action: earthmover_run');
  s.log('INFO', "Student ID types in Ed-Fi roster: ['District', 'State']");
  s.log('INFO', 'em_runtime is set as: 142.3');
  s.wait(4200).log(
    'INFO',
    `earthmover stdout: ${s.captured('earthmover', [
      'starting...',
      'skipping hashing and run-logging (no `state_file` defined in config)',
      'compiling project...',
      'done!',
    ])}`
  );
  return s.wait(38000);
};

const EM_RUN_LINES = [
  'starting...',
  'skipping hashing and run-logging (no `state_file` defined in config)',
  'verifying input files...',
  'processing source `input`...',
  'processing source `roster`...',
  'processing transformation `input_with_student_ids`...',
  'processing transformation `student_id_match_rates`...',
  'processing destination `match_rates`...',
  'processing transformation `assessment_records`...',
  'processing transformation `student_assessments`...',
  'processing transformation `student_objective_assessments`...',
  'processing destination `studentAssessments`...',
  'processing destination `studentObjectiveAssessments`...',
  'processing destination `assessments`...',
  'processing destination `objectiveAssessments`...',
];

const MATCH_RATE_ROW = (matches: number, rate: string) =>
  `{'source_column_name': 'edFi_studentUniqueID', 'edfi_column_name': 'State', 'num_rows': '4210', 'num_matches': '${matches}', 'match_rate': '${rate}'}`;

const emSuccess = (s: Script) => {
  s.log('INFO', `earthmover stdout: ${s.captured('earthmover', [...EM_RUN_LINES, 'done!'], 2500)}`);
  s.log('INFO', 'Ed-Fi ID State matches studentUniqueId (98.7% of non-null records match)');
  s.log('INFO', `at least some records matched - match rates by ID: [${MATCH_RATE_ROW(4155, '0.9869')}]`);
  return s.log('DEBUG', 'uploading artifact MATCH_RATES');
};

const lightbeamSend = (s: Script, rejected: number) => {
  s.log('INFO', 'beginning action: lightbeam_send').wait(500);
  s.log('INFO', 'starting...', 'lightbeam');
  s.log('INFO', 'validating by default since `send` called without `validate`...', 'lightbeam');
  for (const [endpoint, n, secs] of [
    ['assessments', 1, 1],
    ['objectiveAssessments', 12, 2],
    ['studentAssessments', 4155, 41],
    ['studentObjectiveAssessments', 4155 * 12, 96],
  ] as const) {
    s.log('INFO', `sending endpoint ${endpoint} with ${n} records...`, 'lightbeam').wait(secs * 1000);
    if (endpoint === 'studentAssessments' && rejected) {
      for (let i = 0; i < rejected; i++) {
        const line = 17 + i * 3;
        s.log(
          'WARNING',
          `  (at line ${line} of studentAssessments.jsonl) 409: "The value supplied for the related 'student' resource does not exist."`,
          'lightbeam'
        ).wait(25);
      }
    }
    const ok = endpoint === 'studentAssessments' ? n - rejected : n;
    const status = rejected && endpoint === 'studentAssessments' ? `{201: ${ok}, 409: ${rejected}}` : `{201: ${ok}}`;
    s.log('INFO', `finished processing endpoint ${endpoint}! Status counts: ${status}`, 'lightbeam');
  }
  return s.log('INFO', 'all done!', 'lightbeam').log('DEBUG', 'uploading artifact LB_SEND_RESULTS');
};

const uploadAndFinish = (s: Script) => {
  s.log('WARNING', 'earthmover run failed to match some student IDs');
  s.log('DEBUG', 'Sending student ID match info').log('DEBUG', 'uploading artifact UNMATCHED_STUDENTS');
  s.log('INFO', 'beginning action: upload_output').wait(900);
  for (const f of ['assessments', 'objectiveAssessments', 'studentAssessments', 'studentObjectiveAssessments']) {
    s.log('INFO', `uploading output: ${f}.jsonl -> ea/district-a/2526/412/output/${f}.jsonl`).wait(300);
  }
  s.log('DEBUG', 'Notifying app of output set at ea/district-a/2526/412/output');
  s.log('DEBUG', 'Sending summary');
  return s.log('INFO', 'spinning down');
};

// Fuzzy matching keeps running after the run reports done
const backgroundMatching = (s: Script) => {
  s.wait(400).log('INFO', 'installing earthmover deps...');
  deps(s.wait(100), false);
  s.log('INFO', 'running match_candidates_wrapper...').wait(1200);
  s.log('INFO', 'encoding detected for input file: utf-8');
  s.log('DEBUG', 'encoding detection ran for 0.79 seconds').wait(31000);
  s.log(
    'INFO',
    `earthmover stdout: ${s.captured('earthmover', [
      'starting...',
      'processing source `input`...',
      'processing transformation `candidates`...',
      'processing destination `candidates`...',
      'done!',
    ])}`
  );
  s.log('DEBUG', 'uploading artifact CANDIDATES').log('INFO', 'candidates.jsonl uploaded!');
  s.log('INFO', 'querying IDRS with 55 candidates in 1 batch').wait(6400);
  s.log('INFO', 'matches written!').log('DEBUG', 'uploading artifact IDRS_MATCHES');
  return s.log('INFO', 'matches.json uploaded!');
};

const failAndShutDown = (s: Script, traceback: string[], uploads: string[]) => {
  s.raw('Traceback (most recent call last):', ...traceback);
  s.log('INFO', 'uploading remaining artifacts');
  for (const a of uploads) s.log('DEBUG', `uploading artifact ${a}`);
  return s.log('INFO', 'spinning down');
};

const throughFiles = (startMs: number) => {
  const s = new Script(startMs);
  [start, bundleRefresh, deps, roster, files].forEach((step) => step(s));
  return s;
};

const SCENARIOS: Record<string, (startMs: number) => Event[]> = {
  success: (t) => {
    const s = throughFiles(t);
    [emStart, emSuccess].forEach((step) => step(s));
    lightbeamSend(s, 55);
    return backgroundMatching(uploadAndFinish(s)).events;
  },

  // Enough events to need several pages
  long: (t) => {
    const s = throughFiles(t);
    [emStart, emSuccess].forEach((step) => step(s));
    lightbeamSend(s, 3500);
    return uploadAndFinish(s).events;
  },

  'earthmover-error': (t) => {
    const s = emStart(throughFiles(t));
    const err = `${stamp(s.now() - 900)} earthmover ERROR (at \`transformations.assessment_records\` defined in \`packages/${TASK.bundle}/earthmover.yaml\` near line 88) \`add_columns\` operation failed: column \`ScaleScore\` not found`;
    s.log(
      'INFO',
      `earthmover stdout: ${s.captured('earthmover', EM_RUN_LINES.slice(0, 9), 2500)}`
    );
    s.log('INFO', `earthmover stderr: ${err}`);
    s.log('ERROR', 'earthmover encountered an error');
    return failAndShutDown(
      s,
      [
        '  File "/executor/executor/executor.py", line 128, in execute',
        '    self.orchestrate_earthmover()',
        '  File "/executor/executor/executor.py", line 476, in orchestrate_earthmover',
        '    self.earthmover_run(self.student_id_wrapper_earthmover, artifact.EM_RESULTS.path)',
        '  File "/executor/executor/executor.py", line 556, in earthmover_run',
        '    raise Exception(em.stderr)',
        `Exception: ${err}`,
      ],
      ['ROSTER', 'EM_RESULTS']
    ).events;
  },

  'insufficient-matches': (t) => {
    const s = emStart(throughFiles(t));
    s.log('INFO', `earthmover stdout: ${s.captured('earthmover', [...EM_RUN_LINES, 'done!'], 2500)}`);
    s.log('INFO', `at least some records matched - match rates by ID: [${MATCH_RATE_ROW(1768, '0.42')}]`);
    s.log('DEBUG', 'too many unmatched students. Halting run');
    return failAndShutDown(
      s,
      [
        '  File "/executor/executor/executor.py", line 128, in execute',
        '    self.orchestrate_earthmover()',
        '  File "/executor/executor/executor.py", line 488, in orchestrate_earthmover',
        '    self.enforce_match_threshold()',
        '  File "/executor/executor/executor.py", line 842, in enforce_match_threshold',
        '    raise ValueError(f"insufficient ID matches to continue (highest rate {self.highest_match_rate} < required {config.REQUIRED_ID_MATCH_RATE}; ID column name: {self.highest_match_id_name}; Ed-Fi ID type: {self.highest_match_id_type})")',
        'ValueError: insufficient ID matches to continue (highest rate 0.42 < required 0.5; ID column name: edFi_studentUniqueID; Ed-Fi ID type: State)',
      ],
      ['ROSTER', 'MATCH_RATES', 'EM_RESULTS']
    ).events;
  },

  // The stream exists but the container hasn't written to it yet
  empty: () => [],
};

export class MockExecutorLogsClient {
  async send(command: GetLogEventsCommand): Promise<GetLogEventsCommandOutput> {
    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

    const { logStreamName = '', nextToken, limit = 10000 } = command.input;
    const [, scenario, startMs] = logStreamName.match(/mock-([a-z-]+)-(\d+)$/) ?? [];
    if (!SCENARIOS[scenario]) {
      // Any other scenario name, e.g. mock-missing-…, is a stream that doesn't exist
      throw new ResourceNotFoundException({
        message: 'The specified log stream does not exist.',
        $metadata: {},
      });
    }

    const events = SCENARIOS[scenario](Number(startMs)).filter((e) => e.timestamp <= Date.now());
    const from = nextToken ? Number(nextToken.split('/')[1]) : 0;
    const page = events.slice(from, from + limit);
    // Like CloudWatch, hand back the same token once there's nothing further
    return { $metadata: {}, events: page, nextForwardToken: `f/${from + page.length}` };
  }
}
