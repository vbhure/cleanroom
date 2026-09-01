import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { workspace } from '../state/workspace'
import { Sidebar } from './Sidebar'

/**
 * The trust dial is the person's side of the privacy boundary. These tests
 * pin down that it reads from and writes to the one store the tool layer
 * consults, so what the person sees selected is what the agent gets.
 */

beforeEach(() => {
  workspace.reset()
})

afterEach(() => {
  cleanup()
  workspace.reset()
})

describe('the trust dial', () => {
  it('offers exactly the three levels, in order of what they release', () => {
    render(<Sidebar />)

    const radios = screen.getAllByRole('radio')
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual([
      'sealed',
      'aggregates',
      'raw',
    ])
    expect(screen.getByRole('radio', { name: 'Sealed' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Aggregates' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Raw' })).toBeInTheDocument()
  })

  it('reflects the store: aggregates is selected by default', () => {
    render(<Sidebar />)

    expect(screen.getByRole('radio', { name: 'Aggregates' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Raw' })).not.toBeChecked()
    expect(screen.getByTestId('trust-hint')).toHaveTextContent(/only aggregates/)
  })

  it('writes to the store when the person picks a level', () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByTestId('trust-raw'))
    expect(workspace.getState().trustLevel).toBe('raw')
    expect(screen.getByRole('radio', { name: 'Raw' })).toBeChecked()
    expect(screen.getByTestId('trust-hint')).toHaveTextContent(/your decision/)

    fireEvent.click(screen.getByTestId('trust-sealed'))
    expect(workspace.getState().trustLevel).toBe('sealed')
    expect(screen.getByRole('radio', { name: 'Sealed' })).toBeChecked()
    expect(screen.getByTestId('trust-hint')).toHaveTextContent(/withdrawn/)
  })

  it('follows a change made elsewhere, such as a reset', () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByTestId('trust-raw'))
    expect(screen.getByRole('radio', { name: 'Raw' })).toBeChecked()

    act(() => workspace.setTrustLevel('sealed'))
    expect(screen.getByRole('radio', { name: 'Sealed' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Raw' })).not.toBeChecked()
  })

  it('marks the selected option visibly, and the raw one as the risky one', () => {
    render(<Sidebar />)

    const raw = screen.getByTestId('trust-raw').closest('label')
    const aggregates = screen.getByTestId('trust-aggregates').closest('label')
    expect(aggregates).toHaveClass('trustOptionActive')
    expect(raw).not.toHaveClass('trustOptionActive')

    fireEvent.click(screen.getByTestId('trust-raw'))
    expect(raw).toHaveClass('trustOptionActive')
    expect(aggregates).not.toHaveClass('trustOptionActive')
  })

  it('keeps the minimum group size beside it, still owned by the person', () => {
    render(<Sidebar />)

    const input = screen.getByLabelText('Minimum group size') as HTMLInputElement
    expect(input.value).toBe('1')

    fireEvent.change(input, { target: { value: '4' } })
    expect(workspace.getState().minGroupSize).toBe(4)
  })
})
