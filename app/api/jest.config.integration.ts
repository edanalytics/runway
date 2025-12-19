/* eslint-disable */
export default {
  displayName: 'api-integration',
  preset: '../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],

  // global setup is run in a separate process from setupFiles and setupFilesAfterEnv
  // and so cannot share global context with tests, though it does share global context
  // with globalTeardown
  globalSetup: '<rootDir>/integration/helpers/setup-and-teardown/global-setup.ts',
  globalTeardown: '<rootDir>/integration/helpers/setup-and-teardown/global-teardown.ts',

  // setupFiles and setupFilesAfterEnv are run for each test file.
  // Code is run in a VM, which may impact how code is built and run. For example,
  // without the --experimental-vm-modules flag, this code will not be able to use
  // dynamic imports (which is how we currently load Postgrator).
  setupFiles: [
    // run once per test-file, BEFORE jest is loaded
  ],
  setupFilesAfterEnv: [
    // run once per test-file, AFTER jest is loaded, before tests run.
    // Code must be wrapped in a beforeAll/Each or afterAll/Each block or it won't run.
    '<rootDir>/integration/helpers/setup-and-teardown/per-test-file-setup.ts',
  ],
};
