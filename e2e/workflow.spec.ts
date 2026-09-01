import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The whole product, driven the way a judge will drive it.
 *
 * Every tool call here goes through `document.modelContext.executeTool` in the
 * Tool Inspector — the same interface an agent uses — so this suite exercises
 * the real WebMCP path, not a shortcut into the handlers.
 */

async function loadSample(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'or load a sample dataset' }).click()
  await expect(page.getByText('sample_sales.csv')).toBeVisible()
}

/** Moves the trust dial the way a person does: by clicking its label. */
async function setTrust(page: Page, level: 'sealed' | 'aggregates' | 'raw') {
  const label = { sealed: 'Sealed', aggregates: 'Aggregates', raw: 'Raw' }[level]
  await page.getByTestId('trust-dial').getByText(label, { exact: true }).click()
  await expect(page.getByTestId(`trust-${level}`)).toBeChecked()
}

async function openInspector(page: Page) {
  const toggle = page.getByTestId('inspector-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await expect(page.getByTestId('tool-list')).toBeVisible()
}

async function selectTool(page: Page, name: string) {
  await page.getByTestId('tool-list').getByText(name, { exact: true }).click()
}

/** Calls a tool through the WebMCP interface and returns the parsed result. */
async function callTool(
  page: Page,
  name: string,
  args: unknown,
): Promise<Record<string, unknown>> {
  await selectTool(page, name)
  await page.getByTestId('tool-args').fill(JSON.stringify(args, null, 2))
  await page.getByTestId('tool-run').click()

  const result = page.getByTestId('tool-result')
  await expect(result).toBeVisible()
  return JSON.parse((await result.textContent()) ?? '{}') as Record<string, unknown>
}

// ---------------------------------------------------------------------------

test.describe('loading data', () => {
  test('parses a dataset entirely in the browser', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      if (request.url().startsWith('http') && !request.url().includes('localhost')) {
        requests.push(request.url())
      }
    })

    await loadSample(page)

    await expect(page.getByText('20 rows')).toBeVisible()
    await expect(page.getByText('6 columns')).toBeVisible()

    // Nothing left the machine while loading and parsing the file.
    expect(requests).toEqual([])
  })

  test('shows the report as empty until something is added', async ({ page }) => {
    await loadSample(page)
    await expect(page.getByText('The report is empty')).toBeVisible()
  })

  test('a person can remove their dataset again', async ({ page }) => {
    await loadSample(page)
    await page.getByRole('button', { name: 'Remove sample_sales.csv' }).click()

    await expect(page.getByText('No dataset loaded yet.')).toBeVisible()
  })
})

test.describe('WebMCP tool discovery', () => {
  test('registers tools and grows the set when a dataset arrives', async ({
    page,
  }) => {
    await page.goto('/')
    await openInspector(page)

    // With nothing loaded only the two always-available tools are offered.
    await expect(page.getByTestId('tool-list').getByRole('listitem')).toHaveCount(2)
    await expect(page.getByText('list_datasets', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'or load a sample dataset' }).click()

    // toolchange fires and the data tools appear without a reload. Eight are
    // available: the two that always are, five that need a dataset at the
    // default "aggregates" level, and clear_workspace. sample_rows is not
    // offered until the dial reaches "raw"; the two block-editing tools stay
    // hidden until the report actually has a block to edit.
    await expect(
      page.getByTestId('tool-list').getByRole('listitem'),
    ).toHaveCount(8)
    await expect(page.getByText('query_dataset', { exact: true })).toBeVisible()
    await expect(page.getByText('sample_rows', { exact: true })).toBeHidden()
  })

  test('the trust dial registers and withdraws tools in front of the person', async ({
    page,
  }) => {
    await loadSample(page)
    await openInspector(page)
    const items = page.getByTestId('tool-list').getByRole('listitem')
    await expect(items).toHaveCount(8)

    // Raw: the one tool that can reveal a record appears, human-gated.
    await setTrust(page, 'raw')
    await expect(items).toHaveCount(9)
    await expect(page.getByText('sample_rows', { exact: true })).toBeVisible()

    // Sealed: everything that computes from the data is withdrawn.
    await setTrust(page, 'sealed')
    await expect(items).toHaveCount(3)
    await expect(page.getByText('list_datasets', { exact: true })).toBeVisible()
    await expect(page.getByText('add_note', { exact: true })).toBeVisible()
    await expect(page.getByText('clear_workspace', { exact: true })).toBeVisible()
    await expect(page.getByText('query_dataset', { exact: true })).toBeHidden()

    // Back to aggregates: the analysis tools return, the raw one does not.
    await setTrust(page, 'aggregates')
    await expect(items).toHaveCount(8)
    await expect(page.getByText('query_dataset', { exact: true })).toBeVisible()
    await expect(page.getByText('sample_rows', { exact: true })).toBeHidden()
  })

  test('withdraws tools again when the dataset is removed', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)
    await expect(page.getByText('query_dataset', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Remove sample_sales.csv' }).click()

    await expect(page.getByText('query_dataset', { exact: true })).toBeHidden()
  })

  test('publishes a schema and annotations for each tool', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)
    await selectTool(page, 'query_dataset')

    await expect(page.getByText('readOnlyHint:')).toBeVisible()
    await page.getByText('Input schema').click()
    await expect(page.getByText('"additionalProperties"').first()).toBeVisible()
  })
})

test.describe('agent analysis workflow', () => {
  test('lists datasets without revealing any cell value', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)

    const result = await callTool(page, 'list_datasets', {})
    const text = JSON.stringify(result)

    expect(text).toContain('sample_sales')
    expect(text).not.toContain('Ada Lovelace')
    expect(text).not.toContain('Enterprise')
  })

  test('profiles a column with statistics only', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)

    const result = await callTool(page, 'describe_columns', {
      dataset: 'sample_sales',
      columns: ['deal_size'],
    })

    const profiles = result.profiles as Record<string, unknown>[]
    expect(profiles[0]?.type).toBe('number')
    expect(profiles[0]?.mean).toBeGreaterThan(0)
  })

  test('runs an aggregate query', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)

    const result = await callTool(page, 'query_dataset', {
      dataset: 'sample_sales',
      groupBy: ['region'],
      aggregate: [{ op: 'sum', column: 'deal_size' }],
      orderBy: [{ column: 'sum_of_deal_size', direction: 'desc' }],
    })

    expect(result.rows).toBeTruthy()
    expect((result.rows as unknown[]).length).toBe(4)
  })

  test('reports data quality findings', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)

    const result = await callTool(page, 'detect_anomalies', {
      dataset: 'sample_sales',
    })

    expect(Array.isArray(result.anomalies)).toBe(true)
  })

  test('refuses a query that would return raw rows', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)

    const result = await callTool(page, 'query_dataset', {
      dataset: 'sample_sales',
      aggregate: [],
    })

    expect((result.error as Record<string, string>).code).toBe('invalid_input')
  })

  test('returns an actionable error for a misspelled column', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)

    const result = await callTool(page, 'query_dataset', {
      dataset: 'sample_sales',
      groupBy: ['regoin'],
      aggregate: [{ op: 'count' }],
    })

    const error = result.error as Record<string, unknown>
    expect(error.code).toBe('unknown_column')
    expect(error.availableColumns).toContain('region')
  })
})

test.describe('the shared report', () => {
  test('an agent chart appears in the human report, badged as the agent’s', async ({
    page,
  }) => {
    await loadSample(page)
    await openInspector(page)

    await callTool(page, 'add_chart', {
      dataset: 'sample_sales',
      title: 'Revenue by region',
      type: 'bar',
      groupBy: 'region',
      aggregate: { op: 'sum', column: 'deal_size' },
    })

    await expect(
      page.getByRole('heading', { name: 'Revenue by region' }),
    ).toBeVisible()
    await expect(page.getByText('Added by agent').first()).toBeVisible()
    await expect(page.locator('svg[role="img"]').first()).toBeVisible()
  })

  test('an agent note renders as text, never as markup', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)

    await callTool(page, 'add_note', {
      title: 'Findings',
      markdown: 'Revenue is **concentrated**. <img src=x onerror="window.__xss=1">',
    })

    await expect(page.getByRole('heading', { name: 'Findings' })).toBeVisible()
    await expect(page.locator('.markdown strong')).toHaveText('concentrated')

    // The payload rendered as text and executed nothing.
    expect(await page.evaluate(() => (window as never as Record<string, unknown>).__xss)).toBeUndefined()
    await expect(page.locator('.markdown img')).toHaveCount(0)
  })

  test('a human can delete what an agent added', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)
    await callTool(page, 'add_note', { title: 'Temporary', markdown: 'Delete me.' })

    await expect(page.getByRole('heading', { name: 'Temporary' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove Temporary' }).click()

    await expect(page.getByText('The report is empty')).toBeVisible()
  })

  test('a report filter narrows every chart at once', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)

    await callTool(page, 'add_chart', {
      dataset: 'sample_sales',
      title: 'Deals by region',
      type: 'bar',
      groupBy: 'region',
      aggregate: { op: 'count' },
    })

    const result = await callTool(page, 'set_report_filter', {
      dataset: 'sample_sales',
      where: [{ column: 'status', op: 'eq', value: 'won' }],
    })

    // 14 of the 20 sample rows have status 'won'.
    expect(result.matchedRows).toBe(14)
    await expect(page.getByText(/Report filtered/)).toBeVisible()
  })
})

test.describe('the human approval gate', () => {
  test('below raw, the raw-row tool is not offered at all', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)

    // Nothing to select, nothing to call, nothing to prompt about.
    await expect(page.getByText('sample_rows', { exact: true })).toBeHidden()
    await expect(page.getByTestId('approval-modal')).toBeHidden()
    await expect(page.getByTestId('rows-released')).toHaveText('0')

    // The agent is told why, if it asks.
    const result = await callTool(page, 'list_datasets', {})
    const privacy = result.privacy as Record<string, unknown>
    expect(privacy.trustLevel).toBe('aggregates')
    expect(privacy.rawRowAccess).toBe('disabled')
  })

  test('turning the dial down while the prompt is open withdraws the request', async ({
    page,
  }) => {
    await loadSample(page)
    await setTrust(page, 'raw')
    await openInspector(page)

    await selectTool(page, 'sample_rows')
    await page.getByTestId('tool-args').fill(
      JSON.stringify({
        dataset: 'sample_sales',
        rows: 2,
        reason: 'Checking two records before the person changes their mind.',
      }),
    )
    await page.getByTestId('tool-run').click()
    await expect(page.getByTestId('approval-modal')).toBeVisible()

    // The modal blocks the pointer, so reach the dial the way a keyboard or
    // another control would. Withdrawing the tool aborts its pending request:
    // the prompt closes on its own and nothing is released.
    await page.getByTestId('trust-aggregates').dispatchEvent('click')
    await expect(page.getByTestId('trust-aggregates')).toBeChecked()

    await expect(page.getByTestId('approval-modal')).toBeHidden()
    await expect(
      page.getByTestId('tool-list').getByText('sample_rows', { exact: true }),
    ).toBeHidden()
    await expect(page.getByTestId('rows-released')).toHaveText('0')
    // The refusal is on the record like any other call.
    await expect(page.getByTestId('ledger-list').first()).toContainText('sample_rows')
    await expect(page.getByTestId('ledger-list').first()).toContainText('refused')
  })

  test('a denied request releases nothing', async ({ page }) => {
    await loadSample(page)
    await setTrust(page, 'raw')
    await openInspector(page)

    await selectTool(page, 'sample_rows')
    await page.getByTestId('tool-args').fill(
      JSON.stringify({
        dataset: 'sample_sales',
        rows: 2,
        reason: 'The totals look wrong and I want to check two records.',
      }),
    )
    await page.getByTestId('tool-run').click()

    const modal = page.getByTestId('approval-modal')
    await expect(modal).toBeVisible()
    // The agent's own words are shown to the person deciding.
    await expect(modal).toContainText('The totals look wrong')

    await page.getByTestId('approval-deny').click()

    const result = JSON.parse(
      (await page.getByTestId('tool-result').textContent()) ?? '{}',
    )
    expect(result.error.code).toBe('approval_denied')
    await expect(page.getByTestId('rows-released')).toHaveText('0')
  })

  test('an approved request releases exactly what was asked for', async ({
    page,
  }) => {
    await loadSample(page)
    await setTrust(page, 'raw')
    await openInspector(page)

    await selectTool(page, 'sample_rows')
    await page.getByTestId('tool-args').fill(
      JSON.stringify({
        dataset: 'sample_sales',
        rows: 2,
        columns: ['region', 'status'],
        reason: 'Confirming how status is spelled in the raw data.',
      }),
    )
    await page.getByTestId('tool-run').click()

    await expect(page.getByTestId('approval-modal')).toBeVisible()
    await page.getByTestId('approval-approve').click()

    const result = JSON.parse(
      (await page.getByTestId('tool-result').textContent()) ?? '{}',
    )
    expect(result.rows).toHaveLength(2)
    expect(result.columns).toEqual(['region', 'status'])

    // The ledger records the release prominently.
    await expect(page.getByTestId('rows-released')).toHaveText('2')
  })

  test('the escape key denies, so the safe answer is the easy one', async ({
    page,
  }) => {
    await loadSample(page)
    await setTrust(page, 'raw')
    await openInspector(page)

    await selectTool(page, 'sample_rows')
    await page.getByTestId('tool-args').fill(
      JSON.stringify({
        dataset: 'sample_sales',
        reason: 'Just having a look at the underlying records.',
      }),
    )
    await page.getByTestId('tool-run').click()

    await expect(page.getByTestId('approval-modal')).toBeVisible()
    await page.keyboard.press('Escape')

    const result = JSON.parse(
      (await page.getByTestId('tool-result').textContent()) ?? '{}',
    )
    expect(result.error.code).toBe('approval_denied')
  })
})

test.describe('the egress ledger', () => {
  test('itemises every call, including refusals', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)

    await callTool(page, 'list_datasets', {})
    await callTool(page, 'query_dataset', { dataset: 'ghost', aggregate: [{ op: 'count' }] })

    const rows = page.getByTestId('ledger-list').getByRole('listitem')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('refused')
  })

  test('counts characters released and keeps raw rows at zero for aggregates', async ({
    page,
  }) => {
    await loadSample(page)
    await openInspector(page)

    await callTool(page, 'query_dataset', {
      dataset: 'sample_sales',
      groupBy: ['region'],
      aggregate: [{ op: 'count' }],
    })

    await expect(page.getByTestId('rows-released')).toHaveText('0')
    await expect(page.getByText('characters', { exact: true })).toBeVisible()
    await expect(page.getByTestId('ledger-list')).toContainText('characters')
  })

  test('keeps a running balance of what is held against what has left', async ({
    page,
  }) => {
    await page.goto('/')
    const balance = page.getByTestId('egress-balance')
    await expect(balance).toHaveText(/0 B kept local · 0 B released/)

    await page.getByRole('button', { name: 'or load a sample dataset' }).click()
    // The sample is just under a kilobyte; it is now held in this tab.
    await expect(page.getByTestId('kept-local')).toHaveText(/^\d{3} B$/)
    await expect(page.getByTestId('released')).toHaveText('0 B')

    await openInspector(page)
    await callTool(page, 'query_dataset', {
      dataset: 'sample_sales',
      groupBy: ['region'],
      aggregate: [{ op: 'sum', column: 'deal_size' }],
    })

    // What left is a few hundred bytes of aggregates, not the file.
    const released = await page.getByTestId('released').textContent()
    expect(released).toMatch(/^\d+ B$/)
    expect(Number.parseInt(released ?? '0', 10)).toBeGreaterThan(0)
    const keptLocal = await page.getByTestId('kept-local').textContent()
    expect(Number.parseInt(keptLocal ?? '0', 10)).toBeGreaterThan(
      Number.parseInt(released ?? '0', 10),
    )
  })
})

test.describe('clearing the workspace', () => {
  test('needs approval and then removes everything', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)
    await callTool(page, 'add_note', { markdown: 'Something to lose.' })

    await selectTool(page, 'clear_workspace')
    await page.getByTestId('tool-args').fill(JSON.stringify({ confirm: true }))
    await page.getByTestId('tool-run').click()

    await expect(page.getByTestId('approval-modal')).toBeVisible()
    await page.getByTestId('approval-approve').click()

    await expect(page.getByText('No dataset loaded yet.')).toBeVisible()
    await expect(page.getByText('The report is empty')).toBeVisible()
  })

  test('a denied clear changes nothing', async ({ page }) => {
    await loadSample(page)
    await openInspector(page)
    await callTool(page, 'add_note', { markdown: 'Keep me.' })

    await selectTool(page, 'clear_workspace')
    await page.getByTestId('tool-args').fill(JSON.stringify({ confirm: true }))
    await page.getByTestId('tool-run').click()

    await expect(page.getByTestId('approval-modal')).toBeVisible()
    await page.getByTestId('approval-deny').click()

    await expect(page.getByText('sample_sales.csv')).toBeVisible()
  })
})
