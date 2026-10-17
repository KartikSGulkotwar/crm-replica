/** @type {import('jest').Config} */
const shared = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Use the shared package's TypeScript source so tests don't need a prior build.
  moduleNameMapper: { '^@crm-replica/shared$': '<rootDir>/../../packages/shared/src' },
};

module.exports = {
  projects: [
    // Fast tests with no external services.
    { ...shared, displayName: 'unit', roots: ['<rootDir>/src'], testRegex: '\\.spec\\.ts$' },
    // Boots the real app against Postgres and Redis (docker compose up).
    {
      ...shared,
      displayName: 'e2e',
      roots: ['<rootDir>/test'],
      testRegex: '\\.e2e-spec\\.ts$',
      setupFiles: ['<rootDir>/test/setup-env.ts'],
    },
  ],
};
