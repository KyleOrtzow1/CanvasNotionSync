export default {
  transform: {},
  testEnvironment: 'node',
  setupFiles: ['./test/setup.js'],
  testPathIgnorePatterns: ['\\\\node_modules\\\\', 'notion-rate-limiter\\.integration\\.test\\.js$'],
  collectCoverageFrom: ['src/**/*.js'],
  coverageThreshold: {
    global: { branches: 60, functions: 70, lines: 70, statements: 70 }
  }
};
