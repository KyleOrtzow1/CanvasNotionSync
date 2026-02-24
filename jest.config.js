export default {
  transform: {},
  testEnvironment: 'node',
  setupFiles: ['./test/setup.js'],
  collectCoverageFrom: ['src/**/*.js'],
  coverageThreshold: {
    global: { branches: 60, functions: 70, lines: 70, statements: 70 }
  }
};
