import baseConfig from './jest.config.js';

export default {
  ...baseConfig,
  testPathIgnorePatterns: ['\\\\node_modules\\\\'],
  collectCoverage: false
};
