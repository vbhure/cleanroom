import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Layout guards.
 *
 * A judge may open this on a laptop, a large monitor, or a phone. The page must
 * never scroll sideways, and the three regions must stay reachable.
 */

const VIEWPORTS = [
  { name: 'laptop', width: 1280, height: 720 },
  { name: 'small laptop', width: 1024, height: 768 },
  { name: 'wide', width: 1920, height: 1080 },
  { name: 'phone', width: 390, height: 844 },
] as const

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test('the page never scrolls sideways', async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/')

      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
    })

    test('stays within the viewport once data and tools are on screen', async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/')

      await page.getByRole('button', { name: 'or load a sample dataset' }).click()
      await page.getByTestId('inspector-toggle').click()
      await page.getByTestId('tool-list').getByText('query_dataset', { exact: true }).click()

      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
    })

    test('keeps all three regions reachable', async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/')
      await page.getByRole('button', { name: 'or load a sample dataset' }).click()

      // Each region may need scrolling to reach, but must exist and be visible
      // once scrolled to.
      for (const region of ['Data and privacy controls', 'Report', 'Egress ledger']) {
        const locator = page.getByRole(
          region === 'Report' ? 'main' : 'complementary',
          { name: region },
        )
        await locator.scrollIntoViewIfNeeded()
        await expect(locator).toBeVisible()
      }
    })
  })
}

test.describe('long content', () => {
  test('a wide result table scrolls inside its own container', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    await page.getByRole('button', { name: 'or load a sample dataset' }).click()
    await page.getByTestId('inspector-toggle').click()

    await page.getByTestId('tool-list').getByText('add_chart', { exact: true }).click()
    await page.getByTestId('tool-args').fill(
      JSON.stringify({
        dataset: 'sample_sales',
        title: 'Deals by rep',
        type: 'bar',
        groupBy: 'rep',
        aggregate: { op: 'count' },
      }),
    )
    await page.getByTestId('tool-run').click()
    await expect(page.getByTestId('tool-result')).toBeVisible()

    await page.getByText('Underlying figures').click()

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  })
})
