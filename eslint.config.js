// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // supabase/ holds Deno edge-function code (different runtime + globals).
    ignores: ['dist/**', 'node_modules/**', '.expo/**', 'supabase/**'],
  },
]);
