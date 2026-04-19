/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.(ts|tsx|js)', '**/*.(test|spec).(ts|tsx|js)'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
    '^.+\\.js$': ['ts-jest', { useESM: false }],
  },
  collectCoverageFrom: ['src/**/*.(ts|tsx)', '!src/**/*.d.ts', '!src/types/**'],
  // AGENTS ARE NOT AUTHORIZED TO CHANGE THE COVERAGE THRESHOLDS
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
    './src/resolvers/**': {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
    './src/frontend/**': {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons'],
  },
  // Transform ESM-only packages (e.g. uuid) so Jest can process them
  transformIgnorePatterns: ['node_modules/(?!(uuid)/)'],
  // @forge/testing-framework shims — fake @forge/* modules for local testing
  moduleNameMapper: {
    '^@forge/api$': '<rootDir>/.testing-framework/dist/shims/forge-api/index.js',
    '^@forge/kvs$': '<rootDir>/.testing-framework/dist/shims/forge-kvs/index.js',
    '^@forge/bridge$': '<rootDir>/.testing-framework/dist/shims/forge-bridge/index.js',
    '^@forge/react$': '<rootDir>/.testing-framework/dist/shims/forge-react/index.js',
    '^@forge/resolver$': '<rootDir>/.testing-framework/dist/shims/forge-resolver/index.js',
    '^@forge/events$': '<rootDir>/.testing-framework/dist/shims/forge-events/index.js',
    '^@forge/testing-framework$': '<rootDir>/.testing-framework/dist/index.js',
  },
};
