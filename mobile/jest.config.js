/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/component/**/*.test.(ts|tsx|js|jsx)', '<rootDir>/tests/a11y/**/*.test.(ts|tsx|js|jsx)', '<rootDir>/tests/visual/**/*.test.(ts|tsx|js|jsx)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|native-base|react-native-svg)',
  ],
  // expo-modules-core is nested under node_modules/expo/node_modules by npm
  // (peerOptional react-native-worklets@^0.10 conflicts with hoisted 0.13.0
  // required by @expo/ui); map it explicitly so jest-expo setup can resolve it.
  moduleNameMapper: {
    '^expo-modules-core(/.*)?$': '<rootDir>/node_modules/expo/node_modules/expo-modules-core$1',
  },
};
