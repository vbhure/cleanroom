/**
 * Bar and line charts as plain SVG.
 *
 * No chart library: the two shapes we need are a few dozen lines each, and a
 * dependency-free page keeps the containment claim easy to audit. Colours come
 * from CSS custom properties so both themes work without a second code path.
 */

import type { CellValue, ColumnType } from '../data/types'
import type { ChartType } from '../state/workspace'
import { formatCell } from './format'

export interface ChartPoint {
  label: CellValue
  value: number | null
}

export interface ChartProps {
  type: ChartType
  points: ChartPoint[]
  labelType: ColumnType
  valueLabel: string
}

const WIDTH = 720
const HEIGHT = 260
const PADDING = { top: 16, right: 16, bottom: 44, left: 56 }

const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom

export function Chart({ type, points, labelType, valueLabel }: ChartProps) {
  const plottable = points.filter(
    (point): point is { label: CellValue; value: number } => point.value !== null,
  )

  if (plottable.length === 0) {
    return (
      <p className="chartEmpty">
        Nothing to plot — every group in this chart has no value.
      </p>
    )
  }

  const values = plottable.map((point) => point.value)
  const rawMax = Math.max(...values)
  const rawMin = Math.min(...values, 0)

  // A flat series would collapse to a zero-height plot; give it room.
  const max = rawMax === rawMin ? rawMax + 1 : rawMax
  const min = rawMin
  const span = max - min

  const y = (value: number) =>
    PADDING.top + PLOT_HEIGHT - ((value - min) / span) * PLOT_HEIGHT

  const ticks = [min, min + span / 2, max]
  const baseline = y(Math.max(min, 0))

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${type} chart of ${valueLabel} across ${plottable.length} groups`}
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className="chartGridLine"
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className="chartAxisLabel" x={PADDING.left - 8} y={y(tick) + 4}>
              {formatNumber(tick)}
            </text>
          </g>
        ))}

        {type === 'bar'
          ? renderBars(plottable, y, baseline, labelType)
          : renderLine(plottable, y, labelType)}
      </svg>
      <figcaption className="chartCaption">{valueLabel}</figcaption>
    </figure>
  )
}

function renderBars(
  points: { label: CellValue; value: number }[],
  y: (value: number) => number,
  baseline: number,
  labelType: ColumnType,
) {
  const slot = PLOT_WIDTH / points.length
  const barWidth = Math.max(2, Math.min(48, slot * 0.65))

  return (
    <>
      {points.map((point, index) => {
        const centre = PADDING.left + slot * (index + 0.5)
        const top = y(point.value)

        return (
          <g key={index}>
            <rect
              className="chartBar"
              x={centre - barWidth / 2}
              y={Math.min(top, baseline)}
              width={barWidth}
              height={Math.max(1, Math.abs(baseline - top))}
              rx={2}
            >
              <title>{`${formatCell(point.label, labelType)}: ${formatNumber(point.value)}`}</title>
            </rect>
            {points.length <= 14 ? (
              <text
                className="chartTickLabel"
                x={centre}
                y={HEIGHT - PADDING.bottom + 18}
              >
                {truncate(formatCell(point.label, labelType), 12)}
              </text>
            ) : null}
          </g>
        )
      })}
    </>
  )
}

function renderLine(
  points: { label: CellValue; value: number }[],
  y: (value: number) => number,
  labelType: ColumnType,
) {
  const step = points.length === 1 ? 0 : PLOT_WIDTH / (points.length - 1)
  const x = (index: number) =>
    points.length === 1 ? PADDING.left + PLOT_WIDTH / 2 : PADDING.left + step * index

  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.value)}`)
    .join(' ')

  return (
    <>
      <path className="chartLine" d={path} fill="none" />
      {points.map((point, index) => (
        <g key={index}>
          <circle
            className="chartPoint"
            cx={x(index)}
            cy={y(point.value)}
            r={points.length > 40 ? 1.5 : 3}
          >
            <title>{`${formatCell(point.label, labelType)}: ${formatNumber(point.value)}`}</title>
          </circle>
          {points.length <= 10 ? (
            <text
              className="chartTickLabel"
              x={x(index)}
              y={HEIGHT - PADDING.bottom + 18}
            >
              {truncate(formatCell(point.label, labelType), 12)}
            </text>
          ) : null}
        </g>
      ))}
    </>
  )
}

function formatNumber(value: number): string {
  const magnitude = Math.abs(value)
  if (magnitude >= 1_000_000) return `${round(value / 1_000_000)}M`
  if (magnitude >= 1_000) return `${round(value / 1_000)}k`
  return String(round(value))
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`
}
