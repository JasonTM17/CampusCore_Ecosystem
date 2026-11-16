/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // Cold transform caches (first run after a change, CI) exceed jest's 5 s default on heavy screens.
  testTimeout: 30000,
  globalSetup: '<rootDir>/tests/jest-global-setup.js',
  testMatch: ['<rootDir>/tests/component/**/*.test.(ts|tsx|js|jsx)', '<rootDir>/tests/a11y/**/*.test.(ts|tsx|js|jsx)', '<rootDir>/tests/visual/**/*.test.(ts|tsx|js|jsx)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|native-base|react-native-svg)',
  ],
  // expo-modules-core is hoisted to the top level under SDK 58; map it
  // explicitly so jest-expo setup can resolve it regardless of layout.
  moduleNameMapper: {
    '^expo-modules-core(/.*)?$': '<rootDir>/node_modules/expo-modules-core$1',
  },
};
