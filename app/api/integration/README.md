# Integration Tests

This directory contains integration tests. The goal of Runway's integration tests is to:

1. ensure that the various components of the app work together as expected, making them distinct from unit tests, and
1. test the app in isolation from the various external dependencies, like AWS or the earthmover bundle repo

The main motivation for using integration tests vs. e2e is the ability to provide mocks for external dependencies.

## Moving Parts

We do the following on running tests:

0. Load .env.test
1. Spin up a test Postgres DB
2. Perform migrations
3. Seed data the app needs to do basic stuff (partners, tenants, users, school years, etc)
4. Initiate the app (with some basic mocks)
5. Run tests, which may involve writing to the DB
6. Close the app
7. Close DB connections and spin down the DB container

Currently, everything up through seeding the DB is done once (in [globalSetup.ts](./helpers/setup-and-teardown/global-setup.ts)) and initiating the app is done once per test file (in [per-test-file-setup.ts](./helpers/setup-and-teardown/per-test-file-setup.ts)).

Tests are currently run sequentially (see the `runInBand` setting in the [nx command](../project.json). We might someday want to run test in parallel to speed things up. If we do, we'll need to ensure each test file runs against a dedicated schema so they don't interfere with each other and become flakey. We could give each test file a dedicated schema, either by (A) updating the migrations to run against arbitrary schemas (and updating the .sql files to not reference `public`) or (B) dumping and loading the migrated and seeded DB into custom schemas per test file and pointing the prisma and posrgres client at those schemas. I'm not sure what the performance cost of this route would be or whether it would, in practice, speed things up.

Avoid writing tests in a way that assume sequential processing. This includes sharing global state across test files, reusing IDs across test files, or having one test assume data that a previous test wrote (another form of global state).

Even though we're not running tests in parallel, we still need to be careful about tests interfering with each other via the DB. To prevent that, let's use the following conventions/practices:

- Test files should not modify seed data
- Test files should delete all data they create
- Test files should create new records that they will be able to delete if they need to manipulate data in a way that'll be hard to back out reliably.

Note that if we implement dedicated schemas per test file, we have much more flexibility with how the test interact with the DB.

## Test Data: Xs and As, Fixtures & Factories

There are two source of data that our tests interact with:

1. Fixtures are static objects and loaded as part of the seed process. Tests should not update these.
2. Factories create data on the fly, often with fixtures as inputs, to be used in tests. They might be sent over the API or written to the DB directly.

Some fixtures live at the beginning of the alphabet (e.g. PartnerA) and others a the end (e.g. PartnerX). UserA is part of TenantA and PartnerA, etc. UserX is part of TenantX and PartnerX and should not be able to access stuff that lives in TenantA. The goal of this convention is to make it easy to read tests. This isn't fully elaborated yet, but the general direction would be:

- Partner A -- beginning of alphabet tenants
  - Tenant A
  - Tenant B
  - Tenant C
  - User A (member of tenant A)
  - User AB (member of tenants A and B)
  - User AB2 (another member of tenants A and B)
- Partner X
  - Tenant X
  - Tenant Y
  - Tenant Z
    - ... etc
