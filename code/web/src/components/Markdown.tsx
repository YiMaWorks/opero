// AI 回复按 Markdown 显示（KidLock 的约定：AI 回复一律走这里，不要自己 pre-wrap）。
// 只认常用的几种：代码块 ``` · 行内 `代码` · **加粗** · [链接](地址) · 列表 · 引用 · 标题。直接生成 React 元素，不用 innerHTML。
import type { ReactNode } from 'react'
import { toast } from '../store'

export function Markdown({ text }: { text: string }) {
  return <div className="md">{blocks(text)}</div>
}

function blocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(/^```(\w*)/)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++])
      i++
      const code = body.join('\n')
      out.push(
        <pre key={key++}>
          <button className="copy" onClick={() => { navigator.clipboard?.writeText(code); toast('已复制') }}>复制</button>
          <code>{code}</code>
        </pre>,
      )
      continue
    }
    if (!line.trim()) { i++; continue }
    const h = line.match(/^#{1,6}\s+(.*)/)
    if (h) { out.push(<h4 key={key++}>{inline(h[1])}</h4>); i++; continue }
    if (/^>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''))
      out.push(<blockquote key={key++}>{inline(body.join(' '))}</blockquote>)
      continue
    }
    const ul = /^\s*[-*]\s+/
    const ol = /^\s*\d+[.)]\s+/
    if (ul.test(line) || ol.test(line)) {
      const re = ul.test(line) ? ul : ol
      const items: string[] = []
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ''))
      const lis = items.map((t, n) => <li key={n}>{inline(t)}</li>)
      out.push(re === ul ? <ul key={key++}>{lis}</ul> : <ol key={key++}>{lis}</ol>)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|>|\s*[-*]\s+|\s*\d+[.)]\s+)/.test(lines[i])) para.push(lines[i++])
    out.push(<p key={key++}>{para.flatMap((t, n) => (n ? [<br key={'b' + n} />, ...inline(t)] : inline(t)))}</p>)
  }
  return out
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    if (m[1]) out.push(<code key={k++}>{m[1].slice(1, -1)}</code>)
    else if (m[2]) out.push(<b key={k++}>{m[2].slice(2, -2)}</b>)
    else if (m[3]) out.push(<a key={k++} href={m[4]} target="_blank" rel="noreferrer">{m[3].slice(1, m[3].indexOf(']'))}</a>)
    last = m.index + m[0].length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}
