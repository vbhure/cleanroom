/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * The Content-Security-Policy that enforces Cleanroom's core promise.
 *
 * `connect-src 'none'` removes the page's ability to make *any* network
 * request — fetch, XHR, WebSocket, EventSource, sendBeacon. A dataset loaded
 * into the browser therefore cannot be transmitted anywhere, by us or by
 * anything we accidentally ship. Anyone can verify this in DevTools.
 *
 * Two further directives close channels `connect-src` does not govern:
 *   `worker-src 'none'`  a worker gets its own policy, and a <meta> CSP does
 *                        not reach it at all
 *   `frame-src 'none'`   a nested document is a second page with a second
 *                        network stack
 * We use neither, so forbidding them costs nothing.
 *
 * `webrtc 'block'` would close the third — a peer connection is not a fetch,
 * and no fetch directive stops one — but Chromium does not yet recognise the
 * directive and logs a console error for it on every load. Shipping a policy
 * the browser ignores buys nothing and costs the clean console this project
 * asserts in its own smoke test, so the gap is documented in docs/SECURITY.md
 * rather than papered over.
 *
 * `frame-ancestors` is deliberately absent here: it is meaningless in a <meta>
 * CSP and browsers log a warning when it appears there. It is delivered as an
 * HTTP header instead (see netlify.toml). The two copies are kept in step by
 * a test — src/security/csp.test.ts — rather than by memory.
 */
const PORTABLE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

/**
 * Embeds the CSP into the built index.html so the guarantee travels with the
 * artifact rather than depending on host configuration. Netlify additionally
 * sends it as an HTTP header, which is stronger; this is defence in depth and
 * keeps the promise intact if the app is ever served from somewhere else.
 *
 * Applied on build only — Vite's dev server needs a WebSocket for HMR, which
 * `connect-src 'none'` would block.
 */
function embedCsp(): Plugin {
  return {
    name: 'cleanroom-embed-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${PORTABLE_CSP}" />`,
        ),
    },
  }
}

export default defineConfig({
  plugins: [react(), embedCsp()],
  preview: {
    // Mirror production headers locally so `npm run preview` and the E2E suite
    // exercise the real policy.
    headers: {
      'Content-Security-Policy': `${PORTABLE_CSP}; frame-ancestors 'none'`,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
})
