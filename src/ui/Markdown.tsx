/**
 * A deliberately small markdown renderer.
 *
 * Notes in the report are written by an agent, and an agent's output is
 * influenced by whatever was in the person's file. So this never touches
 * `innerHTML` or `dangerouslySetInnerHTML`: it parses a restricted grammar and
 * builds React elements. There is no sink for an injected tag to reach, which
 * is a stronger position than sanitising markup after the fact.
 *
 * Links are rendered only for http and https URLs, and never as anything that
 * could navigate the page on its own.
 */

import type { JSX, ReactNode } from 'react'

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g

/** Only these schemes may become a clickable link. */
function safeHref(url: string): string | undefined {
  const trimmed = url.trim()
  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) return trimmed
  return undefined
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const parts = text.split(INLINE)

  parts.forEach((part, index) => {
    if (part === '') return
    const key = `${keyPrefix}-${index}`

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      nodes.push(<strong key={key}>{part.slice(2, -2)}</strong>)
      return
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      nodes.push(<em key={key}>{part.slice(1, -1)}</em>)
      return
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      nodes.push(<code key={key}>{part.slice(1, -1)}</code>)
      return
    }

    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) {
      const label = link[1] as string
      const href = safeHref(link[2] as string)
      if (href) {
        nodes.push(
          <a key={key} href={href} rel="noreferrer noopener" target="_blank">
            {label}
          </a>,
        )
      } else {
        // An unsafe scheme renders as plain text, so nothing is hidden from
        // the reader and nothing is clickable.
        nodes.push(<span key={key}>{part}</span>)
      }
      return
    }

    nodes.push(<span key={key}>{part}</span>)
  })

  return nodes
}

function renderMarkdown(source: string): JSX.Element[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: JSX.Element[] = []

  let paragraph: string[] = []
  let list: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const text = paragraph.join(' ')
    blocks.push(
      <p key={`p-${blocks.length}`}>{renderInline(text, `p-${blocks.length}`)}</p>,
    )
    paragraph = []
  }

  const flushList = () => {
    if (list.length === 0) return
    const items = list
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {items.map((item, index) => (
          <li key={index}>{renderInline(item, `li-${blocks.length}-${index}`)}</li>
        ))}
      </ul>,
    )
    list = []
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === '') {
      flushParagraph()
      flushList()
      continue
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushParagraph()
      flushList()
      const level = (heading[1] as string).length
      const content = heading[2] as string
      const key = `h-${blocks.length}`
      const children = renderInline(content, key)

      if (level === 1) blocks.push(<h3 key={key}>{children}</h3>)
      else if (level === 2) blocks.push(<h4 key={key}>{children}</h4>)
      else blocks.push(<h5 key={key}>{children}</h5>)
      continue
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed)
    if (bullet) {
      flushParagraph()
      list.push(bullet[1] as string)
      continue
    }

    flushList()
    paragraph.push(trimmed)
  }

  flushParagraph()
  flushList()

  return blocks
}

export function Markdown({ source }: { source: string }) {
  return <div className="markdown">{renderMarkdown(source)}</div>
}
