/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@crm-replica/shared$': '<rootDir>/../../packages/shared/src',
    '^@crm-replica/server/(.*)$': '<rootDir>/../server/src/$1',
  },
};
