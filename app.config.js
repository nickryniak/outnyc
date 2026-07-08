// =============================================================================
// OutNYC: dynamic Expo config (app.config.js)
// =============================================================================
// Spreads app.json unchanged, and lets CI point static web exports at a base
// path (GitHub Pages serves the app under /outnyc). Local dev and native
// builds are unaffected: EXPO_BASE_URL is only set in the deploy workflow.
// =============================================================================

module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...config.experiments,
    ...(process.env.EXPO_BASE_URL ? { baseUrl: process.env.EXPO_BASE_URL } : {}),
  },
});
