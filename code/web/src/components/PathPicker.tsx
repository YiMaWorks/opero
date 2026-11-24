// 选服务器上的目录 / 文件：网页上所有填服务器路径的地方旁边都有「选…」，点开一层层点进去选，也能直接手填。
// 后台 GET /api/servers/:id/ls 列一层（只读）。base：只能在这个目录里面选，选出来是相对它的路径（比如仓库里的子目录）。
import { useEffect, useState } from 'react'
import { api } from '../live'
import { Sheet } from './ui'

interface Entry { name: string; dir: boolean; size: number; time?: string }

const join = (a: string, b: string) => (a === '/' ? '' : a) + '/' + b
const parent = (p: string) => (p === '/' ? '/' : p.slice(0, p.lastIndexOf('/')) || '/')
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(0)} KB` : n < 1 << 30 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${(n / (1 << 30)).toFixed(1)} GB`)

/** 路径输入框 + 「选…」按钮。files：选文件（日志等）；dirs + files 都开：目录和文件都能选 */
export function PathInput({ server, value, onChange, placeholder, files, dirs = !files, base, disabled, onEnter }: {
  server?: string; value: string; onChange: (v: string) => void; placeholder?: string
  files?: boolean; dirs?: boolean; base?: string; disabled?: boolean; onEnter?: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="path-input">
      <input className="mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.(value.trim())} />
      <button type="button" className="btn default sm" disabled={disabled || !server} title={server ? '' : '先选服务器'} onClick={() => setOpen(true)}>选…</button>
      {open && server && (
        <PathPicker server={server} start={value} files={files} dirs={dirs} base={base}
          onPick={(p) => { setOpen(false); onChange(p); onEnter?.(p) }} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}

export function PathPicker({ server, start, files, dirs = true, base, onPick, onClose }: {
  server: string; start?: string; files?: boolean; dirs?: boolean; base?: string; onPick: (path: string) => void; onClose: () => void
}) {
  const root = base?.replace(/(.)\/+$/, '$1') || '/'
  // 从现在填的那个位置开始：填的是文件就从它所在的目录开始
  const first = () => {
    const s = (start ?? '').trim()
    if (!s) return root
    const abs = base ? (s === '.' ? root : join(root, s.replace(/^\.?\/+/, ''))) : s.startsWith('/') ? s : root
    return abs.includes('*') ? parent(abs.slice(0, abs.indexOf('*'))) : abs.replace(/(.)\/+$/, '$1')
  }
  const [path, setPath] = useState(first)
  const [list, setList] = useState<Entry[] | null>(null)
  const [err, setErr] = useState('')
  const [typed, setTyped] = useState('')
  const [hidden, setHidden] = useState(false)
  const inside = (p: string) => !base || p === root || p.startsWith(root === '/' ? '/' : root + '/')

  const load = async (p: string, fallback = true) => {
    setList(null); setErr('')
    try {
      const r = await api<{ path: string; entries: Entry[] }>('GET', `/api/servers/${server}/ls?path=${encodeURIComponent(p)}`)
      setPath(r.path); setList(r.entries)
    } catch (e) {
      // 填的路径不存在（或者是个文件）：退到上一层
      if (fallback && p !== root && p !== '/') return load(inside(parent(p)) ? parent(p) : root, true)
      setPath(p); setList([]); setErr((e as Error).message || '打不开这个目录')
    }
  }
  useEffect(() => { void load(path) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const out = (p: string) => (base ? (p === root ? '.' : p.slice(root.length + (root === '/' ? 0 : 1))) : p)
  const crumbs = path === '/' ? [] : path.split('/').filter(Boolean)
  const shown = (list ?? []).filter((e) => (hidden || !e.name.startsWith('.')) && (e.dir || files))

  return (
    <Sheet title={files && !dirs ? '选文件' : files ? '选文件或目录' : '选目录'} onClose={onClose} size="lg">
      <div className="pick">
        <div className="pick-crumbs" data-no-i18n="">
          <button className="link" disabled={!inside('/')} onClick={() => load('/', false)}>/</button>
          {crumbs.map((c, i) => {
            const p = '/' + crumbs.slice(0, i + 1).join('/')
            return <span key={p}><button className="link" disabled={!inside(p)} onClick={() => load(p, false)}>{c}</button>{i < crumbs.length - 1 ? ' / ' : ''}</span>
          })}
        </div>
        <div className="pick-list">
          {path !== root && inside(parent(path)) && <button className="pick-row" onClick={() => load(parent(path), false)}><span className="pick-ico">↩</span><span className="pick-name">上一层</span></button>}
          {list === null && <div className="pick-empty"><i className="spinner" /> 在读…</div>}
          {list !== null && !shown.length && <div className="pick-empty">{err || (files ? '空的' : '这里面没有子目录')}</div>}
          {shown.map((e) => (
            <button key={e.name} className={'pick-row' + (e.dir ? ' dir' : '')} onClick={() => (e.dir ? load(join(path, e.name), false) : onPick(out(join(path, e.name))))}>
              <span className="pick-ico">{e.dir ? '📁' : '📄'}</span>
              <span className="pick-name" data-no-i18n="">{e.name}</span>
              <span className="pick-meta">{e.dir ? '' : size(e.size)}{e.time ? `  ${e.time}` : ''}</span>
            </button>
          ))}
        </div>
        <div className="pick-foot">
          <label className="nowrap sub"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> 显示隐藏的</label>
          <input className="mono" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="或者输入路径，回车跳过去"
            onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim().startsWith('/')) { const p = typed.trim(); setTyped(''); void load(inside(p) ? p : root) } }} />
        </div>
        <div className="row-actions">
          <button className="btn ghost" onClick={onClose}>取消</button>
          {dirs && <button className="btn primary" disabled={list === null || !!err} onClick={() => onPick(out(path))}>选这个目录{base ? '' : `：${path}`}</button>}
        </div>
        {files && <p className="field-hint">点文件就选中它{dirs ? '；要整个目录就点「选这个目录」' : ''}</p>}
      </div>
    </Sheet>
  )
}
