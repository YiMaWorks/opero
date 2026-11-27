// 项目的安装包（后台 packages.ts）：按端（安卓 / iPhone / Mac / Windows / Linux）× 渠道（测试 / 正式）一格，每格只留最新。
// 这里：看每格现在是哪个包、下载、开分享链接（带二维码，扫码装安卓包）、删；把包拖进来或点「上传」放进去（按扩展名认端）。
// 员工那边用 MCP 的 package_upload / package_list / package_get / package_share，发布环境选「存进安装包」会自动放。
import { useRef, useState } from 'react'
import qrcode from 'qrcode-generator'
import { Apple, Copy, Download, Laptop, Link2, Monitor, Smartphone, Terminal, Trash2, Upload } from 'lucide-react'
import type { AppPackage, PkgChannel, PkgPlatform, Workspace } from '../types'
import { toast, useStore } from '../store'
import { call } from '../live'
import { Section, Segmented, Sheet, Tag } from './ui'

export const PLATS: { p: PkgPlatform; label: string; exts: string[]; icon: typeof Smartphone; color: string }[] = [
  { p: 'android', label: '安卓', exts: ['apk', 'aab'], icon: Smartphone, color: '#22A06B' },
  { p: 'ios', label: 'iPhone / iPad', exts: ['ipa'], icon: Apple, color: '#334155' },
  { p: 'mac', label: 'Mac', exts: ['dmg', 'pkg'], icon: Laptop, color: '#64748B' },
  { p: 'windows', label: 'Windows', exts: ['msix', 'msixbundle', 'appx', 'msi', 'exe'], icon: Monitor, color: '#0EA5E9' },
  { p: 'linux', label: 'Linux', exts: ['appimage', 'deb', 'rpm'], icon: Terminal, color: '#F97316' },
]
export const CHANNEL_LABEL: Record<PkgChannel, string> = { test: '测试', prod: '正式' }
const platOf = (name: string) => PLATS.find((x) => x.exts.includes((name.split('.').pop() ?? '').toLowerCase()))?.p
const size = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const when = (ts: number) => { const d = new Date(ts); return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const fileUrl = (x: AppPackage) => `api/packages/${encodeURIComponent(x.id)}/file`
export const shareUrl = (token: string) => new URL(`dl/${token}`, document.baseURI).href

/** 传一个文件（带进度）：请求体就是文件，后台边收边写 */
function uploadFile(w: Workspace, f: File, platform: PkgPlatform, channel: PkgChannel, onProgress: (pct: number) => void): Promise<AppPackage> {
  return new Promise((resolve, reject) => {
    const q = new URLSearchParams({ name: f.name, platform, channel })
    const x = new XMLHttpRequest()
    x.open('POST', `api/workspaces/${encodeURIComponent(w.id)}/packages?${q}`)
    x.setRequestHeader('X-Opero', '1')
    x.withCredentials = true
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    x.onload = () => { let j: any = {}; try { j = JSON.parse(x.responseText) } catch { /* 不是 JSON */ } x.status < 300 ? resolve(j) : reject(new Error(j.message ?? (x.status === 413 ? '包太大：后台最多 2 GB；前面有 nginx 的话要放开 client_max_body_size（见 code/server/scripts/nginx.conf）' : `上传失败（${x.status}）`))) }
    x.onerror = () => reject(new Error('上传断了，检查网络再试'))
    x.send(f)
  })
}

/** 项目页 / 发布页里的「安装包」一节 */
export function PackagesSection({ w }: { w: Workspace }) {
  const all = useStore((s) => s.packages)
  const list = all.filter((x) => x.ws === w.id)
  const [channel, setChannel] = useState<PkgChannel>('test')
  const [busy, setBusy] = useState<{ name: string; pct: number } | null>(null)
  const [drag, setDrag] = useState(false)
  const [shareOf, setShareOf] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const want = useRef<{ platform?: PkgPlatform; channel: PkgChannel }>({ channel: 'test' })
  const send = async (f: File, platform?: PkgPlatform, ch: PkgChannel = channel) => {
    const p = platform ?? platOf(f.name)
    if (!p) { toast(`认不出「${f.name}」是哪个端的包：要 .apk / .aab / .ipa / .dmg / .pkg / .msix / .exe / .msi / .AppImage / .deb / .rpm`); return }
    const old = list.find((x) => x.platform === p && x.channel === ch)
    if (old && !confirm(`「${PLATS.find((x) => x.p === p)!.label} · ${CHANNEL_LABEL[ch]}」现在是 ${old.file}${old.version ? `（${old.version}）` : ''}，换成 ${f.name}？\n\n每格只留最新一个，旧的会删掉。`)) return
    setBusy({ name: f.name, pct: 0 })
    try { await uploadFile(w, f, p, ch, (pct) => setBusy({ name: f.name, pct })); toast('已放进安装包') } catch (e) { toast((e as Error).message) }
    setBusy(null)
  }
  const pick = (platform?: PkgPlatform, ch: PkgChannel = channel) => { want.current = { platform, channel: ch }; input.current?.click() }
  const remove = async (x: AppPackage) => { if (confirm(`删掉 ${x.file}？`)) await call('DELETE', `/api/packages/${encodeURIComponent(x.id)}`, undefined, '已删') }
  const rows = PLATS.filter((pl) => list.some((x) => x.platform === pl.p))
  const shared = list.find((x) => x.id === shareOf)
  return (
    <Section title={`安装包 · ${list.length}`} right={<button className="btn ghost sm" disabled={!!busy} onClick={() => pick()}><Upload size={14} /> 上传</button>}>
      <input ref={input} type="file" hidden accept=".apk,.aab,.ipa,.dmg,.pkg,.msix,.msixbundle,.appx,.msi,.exe,.AppImage,.appimage,.deb,.rpm"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void send(f, want.current.platform, want.current.channel) }} />
      <div className={'pkg' + (drag ? ' drag' : '')}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true) } }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void send(f) }}>
        {rows.map((pl) => (
          <div key={pl.p} className="pkg-row">
            <span className="pkg-plat"><pl.icon size={18} color={pl.color} /><b>{pl.label}</b></span>
            {(['test', 'prod'] as PkgChannel[]).map((ch) => {
              const x = list.find((y) => y.platform === pl.p && y.channel === ch)
              return x ? (
                <div key={ch} className="pkg-cell">
                  <div className="pkg-cell-head"><Tag tone={ch === 'prod' ? 'primary' : undefined}>{CHANNEL_LABEL[ch]}</Tag>{x.version && <b className="mono" data-no-i18n="">{x.version}</b>}{x.signed === true ? <Tag tone="ok">已签名</Tag> : x.signed === false ? <Tag tone="warn">没签名</Tag> : null}{x.share && x.share.until > Date.now() && <Tag>分享中</Tag>}</div>
                  <span className="pkg-file mono" title={x.file} data-no-i18n="">{x.file}</span>
                  <span className="pkg-meta">{`${size(x.size)} · ${when(x.at)} · ${x.by}`}</span>
                  {x.note && <span className="pkg-note" data-no-i18n="">{x.note}</span>}
                  <span className="pkg-acts">
                    <a className="btn default sm" href={fileUrl(x)} download><Download size={14} /> 下载</a>
                    <button className="btn ghost sm" onClick={() => setShareOf(x.id)}><Link2 size={14} /> 分享</button>
                    <button className="btn ghost sm" title="换一个包" onClick={() => pick(pl.p, ch)}><Upload size={14} /></button>
                    <button className="btn ghost sm" title="删掉" onClick={() => remove(x)}><Trash2 size={14} /></button>
                  </span>
                </div>
              ) : (
                <button key={ch} className="pkg-cell empty" onClick={() => pick(pl.p, ch)}><Upload size={15} />{`${CHANNEL_LABEL[ch]}：还没有，点这里上传`}</button>
              )
            })}
          </div>
        ))}
        <div className="pkg-drop" onClick={() => pick()}>
          {busy ? (
            <span className="pkg-up"><i className="spinner" /><span>{`正在传 ${busy.name} · ${busy.pct}%`}</span><i className="pkg-bar"><b style={{ width: `${busy.pct}%` }} /></i></span>
          ) : (
            <>
              <span className="pkg-drop-main"><Upload size={18} /><b>{list.length ? '把新包拖进来，或者点这里选' : '还没有安装包：把 apk / ipa / dmg / msix… 拖进来，或者点这里选'}</b></span>
              <span className="pkg-drop-sub" onClick={(e) => e.stopPropagation()}>放进<Segmented value={channel} onChange={setChannel} options={[{ value: 'test', label: '测试' }, { value: 'prod', label: '正式' }]} />· 按扩展名认端 · 每格只留最新</span>
            </>
          )}
        </div>
        <p className="hint">员工编出包会自己放进来（发布环境选「存进安装包」就是编完签好自动放）；苹果、Windows 在你电脑上打的包拖进来就行。</p>
      </div>
      {shared && <ShareSheet x={shared} onClose={() => setShareOf(null)} />}
    </Section>
  )
}

/** 分享：开链接（7 / 30 天）、二维码（扫码直接下）、复制、关掉 */
function ShareSheet({ x, onClose }: { x: AppPackage; onClose: () => void }) {
  const on = !!x.share && x.share.until > Date.now()
  const [days, setDays] = useState('7')
  const url = on ? shareUrl(x.share!.token) : ''
  const qr = (() => { if (!url) return ''; const q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }) })()
  const toggle = (d: number) => call('POST', `/api/packages/${encodeURIComponent(x.id)}/share`, { days: d }, d ? '分享链接已打开' : '已关掉分享链接')
  return (
    <Sheet title={`分享 ${x.file}`} onClose={onClose}>
      <div className="pkg-share">
        {on ? (
          <>
            <div className="pkg-qr" dangerouslySetInnerHTML={{ __html: qr }} />
            <p className="sub">{`手机扫码就能下载${x.platform === 'android' ? '、安装' : ''}；${new Date(x.share!.until).toLocaleDateString()} 前有效。之后换了新包，这个链接下到的也是新的。`}</p>
            <div className="pkg-link"><input readOnly value={url} onFocus={(e) => e.currentTarget.select()} /><button className="btn primary sm" onClick={() => navigator.clipboard?.writeText(url).then(() => toast('已复制链接'))}><Copy size={14} /> 复制</button></div>
            {x.platform === 'ios' && <p className="field-hint">iPhone / iPad 的 .ipa 不能直接装：要 TestFlight、企业签名，或者装到登记过的设备上。</p>}
            <div className="row-actions"><button className="btn ghost sm" onClick={() => toggle(0)}>关掉链接</button><button className="btn ghost sm" onClick={() => toggle(30)}>延长到 30 天</button></div>
          </>
        ) : (
          <>
            <p className="sub">开一个下载链接给测试同事：不用登录 Opero，扫码就能下。有效期过了自动失效，随时能关。</p>
            <Segmented value={days} onChange={setDays} options={[{ value: '1', label: '1 天' }, { value: '7', label: '7 天' }, { value: '30', label: '30 天' }]} />
            <button className="btn primary" onClick={() => toggle(Number(days))}><Link2 size={15} /> 开分享链接</button>
          </>
        )}
      </div>
    </Sheet>
  )
}
