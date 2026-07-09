#!/usr/bin/env node
// =============================================================================
// OutNYC: PWA shell injection (scripts/inject-web-shell.js)
// =============================================================================
// `expo export` with web.output "single" always emits its stock HTML template
// (app/+html.tsx is only honored by "static" output), so this script rewrites
// dist/index.html after every export to make the site installable: manifest,
// icons, iOS home-screen metadata, and service-worker registration.
//
// Usage: node scripts/inject-web-shell.js [distDir]
//   EXPO_BASE_URL prefixes absolute URLs ('' locally, /outnyc on GitHub Pages),
//   mirroring app.config.js. Idempotent: re-running is a no-op.
// =============================================================================

const fs = require('fs');
const path = require('path');

const MARKER = '<!-- outnyc-pwa-shell -->';
const BASE = process.env.EXPO_BASE_URL || '';

const distDir = process.argv[2] || 'dist';
const indexPath = path.join(distDir, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error(`inject-web-shell: ${indexPath} not found. Run \`expo export --platform web\` first.`);
  process.exit(1);
}

let html = fs.readFileSync(indexPath, 'utf8');

if (html.includes(MARKER)) {
  console.log('inject-web-shell: already injected, nothing to do.');
  process.exit(0);
}

// Let content extend into the safe areas on notched iPhones; the app handles
// insets itself via react-native-safe-area-context.
html = html.replace(
  'content="width=device-width, initial-scale=1, shrink-to-fit=no"',
  'content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"'
);

const headTags = `    ${MARKER}
    <meta name="description" content="Paint your free time on a week grid and OutNYC plans real New York evenings around it." />
    <meta name="color-scheme" content="light" />
    <meta name="theme-color" content="#FFFFFF" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="OutNYC" />
    <link rel="apple-touch-icon" href="${BASE}/apple-touch-icon.png" />
    <link rel="manifest" href="${BASE}/manifest.json" />
    <link rel="icon" type="image/png" sizes="64x64" href="${BASE}/favicon.png" />
    <style>
      /* Station-white behind everything so overscroll rubber-banding and the
         pre-hydration frame match the app canvas instead of flashing. */
      html, body { background-color: #FFFFFF; }
      body { overscroll-behavior-y: none; }
    </style>
    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
          navigator.serviceWorker.register('${BASE}/sw.js').catch(function () {});
        });
      }
    </script>
  </head>`;

if (!html.includes('</head>')) {
  console.error('inject-web-shell: no </head> in index.html; the export template changed. Fix this script.');
  process.exit(1);
}
html = html.replace('</head>', headTags);

fs.writeFileSync(indexPath, html);
console.log(`inject-web-shell: injected PWA shell into ${indexPath} (base: '${BASE || '/'}')`);
