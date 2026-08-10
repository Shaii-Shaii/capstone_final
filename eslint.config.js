// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    files: ['supabase/functions/**/*.ts'],
    rules: {
      // Deno resolves npm: specifiers at runtime; Node's ESLint resolver does not.
      'import/no-unresolved': 'off',
    },
  },
]);
