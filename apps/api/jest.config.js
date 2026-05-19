module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'], // MODIFIED: include TS test files
  rootDir: 'src', // MODIFIED: scope tests to source directory
  testRegex: '.*\\.spec\\.ts$', // MODIFIED: spec filename pattern
  transform: { // MODIFIED: ts-jest v29 transform syntax
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: { allowJs: true } }], // MODIFIED: ts-jest transformer config
  },
  collectCoverageFrom: ['**/*.(t|j)s'], // NEW: coverage sources
  coverageDirectory: '../coverage', // NEW: coverage output directory
  testEnvironment: 'node', // MODIFIED: node runtime for Nest tests
  moduleNameMapper: { // NEW: explicit Prisma resolution for monorepo tests
    '^@prisma/client$': '<rootDir>/../node_modules/@prisma/client', // NEW: map Prisma client
  },
};
