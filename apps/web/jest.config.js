/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        // Relax for tests — no need for full Next.js JSX transform
        jsx: 'react-jsx',
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
        allowJs: true,
      },
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
};
