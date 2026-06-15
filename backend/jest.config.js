'use strict';

module.exports = {
  testEnvironment: 'node',
  setupFiles: ['./tests/envSetup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  moduleNameMapper: {
    '^fabric-contract-api$': '<rootDir>/tests/__mocks__/fabric-contract-api.js',
    '^sharp$': '<rootDir>/tests/__mocks__/sharp.js',
    '^@napi-rs/canvas$': '<rootDir>/tests/__mocks__/@napi-rs/canvas.js',
  },
  testTimeout: 30000,
};
