import { describe, expect, it } from 'vitest'
import netlifyToml from '../../netlify.toml?raw'
import viteConfig from '../../vite.config.ts?raw'

/**
 * The containment guarantee is written down twice: once in `vite.config.ts`,
 * which embeds it into the built markup so it travels with the artifact, and
 * once in `netlify.toml`, which sends it as an HTTP header. Two copies of a
 * security policy drift, and a drifted copy is worse than one copy because it
 * reads as deliberate.
 *
 * These tests are the lock. They read both files as text — deliberately, so
 * that neither has to import the other and the build graph stays as it is —
 * and fail if the policies stop agreeing.
 */

/** The directive list from the PORTABLE_CSP array literal in vite.config.ts. */
function embeddedDirectives(): string[] {
  const block = viteConfig.match(/const PORTABLE_CSP = \[([\s\S]*?)\]\.join/)
  if (!block) throw new Error('PORTABLE_CSP is no longer an array literal')

  const literal = block[1] as string
  return [...literal.matchAll(/"([^"]+)"/g)].map((match) => match[1] as string)
}

/** The Content-Security-Policy value from the site-wide header block. */
function headerDirectives(): string[] {
  const header = netlifyToml.match(/Content-Security-Policy = "([^"]+)"/)
  if (!header) throw new Error('netlify.toml no longer sets a CSP header')

  return (header[1] as string).split(';').map((part) => part.trim())
}

describe('the two copies of the Content-Security-Policy', () => {
  it('agree on every directive the built markup carries', () => {
    const embedded = embeddedDirectives()
    const header = headerDirectives()

    expect(embedded.length).toBeGreaterThan(0)
    for (const directive of embedded) {
      expect(header, `header is missing "${directive}"`).toContain(directive)
    }
  })

  it('differ by exactly frame-ancestors, which a <meta> CSP cannot express', () => {
    const extra = headerDirectives().filter(
      (directive) => !embeddedDirectives().includes(directive),
    )

    expect(extra).toEqual(["frame-ancestors 'none'"])
  })

  it('forbid every channel that could carry a row off this device', () => {
    // connect-src covers fetch, XHR, WebSocket, EventSource and sendBeacon.
    // The other two are channels it does not govern: a worker gets its own
    // policy and never sees a <meta> CSP, and a nested document is a second
    // network stack. WebRTC is the known remaining gap — see docs/SECURITY.md.
    for (const directive of [
      "connect-src 'none'",
      "worker-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "form-action 'none'",
    ]) {
      expect(embeddedDirectives(), directive).toContain(directive)
      expect(headerDirectives(), directive).toContain(directive)
    }
  })

  it('carries no directive this browser would only warn about', () => {
    // A directive Chromium does not recognise is logged as a console error on
    // every page load, and e2e/smoke.spec.ts asserts the console is clean.
    // `webrtc` is the one we wanted and cannot yet have.
    expect(embeddedDirectives().map((directive) => directive.split(' ')[0])).not.toContain(
      'webrtc',
    )
    expect(headerDirectives().map((directive) => directive.split(' ')[0])).not.toContain(
      'webrtc',
    )
  })

  it('never relaxes script execution, which is what kept Ajv out', () => {
    expect(embeddedDirectives()).toContain("script-src 'self'")
    expect(viteConfig).not.toContain('unsafe-eval')
    expect(viteConfig).not.toContain('unsafe-inline')
    expect(netlifyToml).not.toContain('unsafe-eval')
    expect(netlifyToml).not.toContain('unsafe-inline')
  })
})
