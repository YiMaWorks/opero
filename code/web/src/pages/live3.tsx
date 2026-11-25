// 真的一套：域名（DNS）、日志、签名证书的上传表单（发布在 release.tsx）
import { useEffect, useState } from 'react'
import type { Domain, LogSource, Server } from '../types'
import { requireVerify, toast, useStore } from '../store'
import { api, call } from '../live'
import { Empty, Field, PageHeader, Row, Section, Segmented } from '../components/ui'
import { headNav, type PageProps } from './nav'
import { PathInput } from '../components/PathPicker'


// ======================= 域名 =======================
export function DomainsPage({ nav }: PageProps) {
  const list = useStore((s) => s.domains)
  const creds = useStore((s) => s.credentials)
  const emps = useStore((s) => s.employees)
  const cloud = creds.filter((c) => c.group === '云账号' && (/cloudflare|阿里云/i.test(c.kind) || !c.meta))
  const [cred, setCred] = useState(cloud[0]?.id ?? '')
  const [zones, setZones] = useState<{ provider: Domain['provider']; domains: string[] } | null>(null)
  const [zErr, setZErr] = useState('')
  useEffect(() => {
    setZones(null); setZErr('')
    if (!cred) return
    api<{ provider: Domain['provider']; domains: string[] }>('GET', `/api/credentials/${cred}/zones`).then(setZones).catch((e) => setZErr((e as Error).message))
  }, [cred])
  const add = (domain: string) => zones && call('POST', '/api/domains', { domain, provider: zones.provider, cred }, `已登记 ${domain}`)
  return (
    <div className="page">
      <PageHeader title="域名" sub="登记后在员工档案里开给员工，它就能改解析" {...headNav(nav)} />
      <div className="page-body">
        <Section flush>
          {list.length === 0 && <Empty>还没有登记域名</Empty>}
          {list.map((d) => (
            <Row key={d.id} title={d.domain} sub={`${d.provider === 'aliyun' ? '阿里云' : 'Cloudflare'} · ${creds.find((c) => c.id === d.cred)?.name ?? '凭证不在了'} · 能改的员工：${emps.filter((e) => (e.dns ?? []).includes(d.id)).map((e) => e.name).join('、') || '还没有'}`}
              chevron onClick={() => nav.push({ page: 'domain', params: { id: d.id } })} />
          ))}
        </Section>
        <Section title="登记域名">
          <div className="pad">
            <div className="field-label">用哪个云账号（阿里云 / Cloudflare）</div>
            <div className="chips">
              {cloud.map((c) => <button key={c.id} className={'chip' + (cred === c.id ? ' on' : '')} onClick={() => setCred(c.id)}>{c.name}</button>)}
              <button className="chip" onClick={() => nav.push({ page: 'credentialEdit', params: { group: '云账号' } })}>+ 新增云账号</button>
            </div>
            {cloud.length === 0 && <p className="hint">先加一个阿里云或 Cloudflare 的云账号（有一步步的说明和直达链接），这里会列出它下面的域名</p>}
          </div>
          {cred && (
            <div className="pad">
              <div className="field-label">这个账号下的域名（点一个登记）</div>
              {!zones && !zErr && <span className="sub"><i className="spinner" /> 在读…</span>}
              {zErr && <div className="banner b-warn">读不到域名：{zErr}</div>}
              {zones && (
                <div className="chips">
                  {zones.domains.map((x) => { const done = list.some((d) => d.domain === x); return <button key={x} className={'chip' + (done ? ' on' : '')} disabled={done} onClick={() => add(x)} data-no-i18n="">{done ? '✓ ' : '+ '}{x}</button> })}
                  {zones.domains.length === 0 && <span className="sub">这个账号下没有域名（或者令牌没给读域名的权限）</span>}
                </div>
              )}
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

interface Rec { id: string; rr: string; type: string; value: string; ttl: number; priority?: number }
export function DomainPage({ params, nav }: PageProps) {
  const d = useStore((s) => s.domains.find((x) => x.id === params.id))
  const [recs, setRecs] = useState<Rec[] | null>(null)
  const [err, setErr] = useState('')
  const [f, setF] = useState({ rr: '@', type: 'A', value: '', ttl: '600' })
  const servers = useStore((s) => s.servers)
  // A 记录填服务器的公网地址：点一下
  const ips = [...new Set(servers.map((x) => x.ip).filter((x): x is string => !!x && /^\d+\.\d+\.\d+\.\d+$/.test(x) && !/^(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(x)))]
  const load = () => call<Rec[]>('GET', `/api/domains/${params.id}/records`).then((r) => { if (r) { setRecs(r); setErr('') } else setErr('读不到记录：看看凭证对不对') })
  useEffect(() => { load() }, [params.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="page"><PageHeader title="域名" {...headNav(nav)} /><Empty>找不到</Empty></div>
  const save = () => (call('POST', `/api/domains/${d.id}/records`, { ...f, ttl: Number(f.ttl) || undefined }, '已保存').then((r) => { if (r) { setF({ ...f, value: '' }); load() } }))
  const del = (r: Rec) => { if (confirm(`删掉 ${r.rr} ${r.type} ${r.value}？`)) requireVerify('删解析记录', () => call('DELETE', `/api/domains/${d.id}/records/${encodeURIComponent(r.id)}`, undefined, '已删').then(load)) }
  return (
    <div className="page">
      <PageHeader title={d.domain} sub={d.provider === 'aliyun' ? '阿里云' : 'Cloudflare'} {...headNav(nav)} right={<button className="btn default sm" onClick={load}>刷新</button>} />
      <div className="page-body">
        {err && <div className="pad"><div className="banner b-warn">{err}</div></div>}
        <Section title={`解析记录 · ${recs?.length ?? '…'}`} flush>
          {(recs ?? []).map((r) => (
            <Row key={r.id} title={<span className="mono" data-no-i18n="">{r.rr} · {r.type}</span>} sub={<span className="mono small" data-no-i18n="">{r.value}{r.priority ? ` · ${r.priority}` : ''} · TTL {r.ttl}</span>}
              onClick={() => setF({ rr: r.rr, type: r.type, value: r.value, ttl: String(r.ttl) })}
              right={<button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); del(r) }}>删</button>} />
          ))}
        </Section>
        <Section title="加 / 改一条（同主机记录 + 类型就是改）">
          <div className="pad form">
            <p className="field-hint">点上面一条记录就是改它</p>
            <Field label="主机记录">
              <div className="chips">{[...new Set(['@', 'www', 'api', 'admin', ...(recs ?? []).map((r) => r.rr)])].slice(0, 14).map((x) => <button key={x} type="button" className={'chip mono' + (f.rr === x ? ' on' : '')} onClick={() => setF({ ...f, rr: x })} data-no-i18n="">{x}</button>)}<input className="chip-input" value={f.rr} onChange={(e) => setF({ ...f, rr: e.target.value })} placeholder="别的" /></div>
            </Field>
            <Field label="类型"><div className="chips">{['A', 'CNAME', 'TXT', 'AAAA', 'MX', 'NS', 'SRV', 'CAA'].map((t) => <button key={t} type="button" className={'chip' + (f.type === t ? ' on' : '')} onClick={() => setF({ ...f, type: t })}>{t}</button>)}</div></Field>
            <Field label="记录值">
              {f.type === 'A' && ips.length > 0 && <div className="chips">{ips.map((x) => <button key={x} type="button" className={'chip mono' + (f.value === x ? ' on' : '')} onClick={() => setF({ ...f, value: x })} data-no-i18n="">{x} <span className="sub">{servers.find((s) => s.ip === x)?.name}</span></button>)}</div>}
              {f.type === 'CNAME' && <div className="chips">{[...new Set((recs ?? []).filter((r) => r.rr !== f.rr && (r.type === 'A' || r.type === 'CNAME')).map((r) => (r.rr === '@' ? d.domain : `${r.rr}.${d.domain}`)))].slice(0, 8).map((x) => <button key={x} type="button" className={'chip mono' + (f.value === x ? ' on' : '')} onClick={() => setF({ ...f, value: x })} data-no-i18n="">{x}</button>)}</div>}
              <input value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder={f.type === 'A' ? '服务器 IP' : f.type === 'CNAME' ? 'xxx.example.com' : ''} />
            </Field>
            <Field label="TTL"><div className="chips">{[['60', '1 分钟'], ['600', '10 分钟'], ['3600', '1 小时']].map(([v, l]) => <button key={v} type="button" className={'chip' + (f.ttl === v ? ' on' : '')} onClick={() => setF({ ...f, ttl: v })}>{l}</button>)}</div></Field>
            <button className="btn primary" disabled={!f.rr.trim() || !f.value.trim()} onClick={save}>保存</button>
          </div>
        </Section>
        <div className="pad row-actions"><button className="btn ghost" onClick={() => { if (confirm(`不再管理 ${d.domain}？（解析本身不受影响）`)) call('DELETE', `/api/domains/${d.id}`, undefined, '已去掉').then(() => nav.back()) }}>去掉这个域名</button></div>
      </div>
    </div>
  )
}

// ======================= 签名证书：上传 keystore + 密码，拼成一份加密存的值 =======================
/** 从签名文件里读出别名（不用你填）：JKS 直接按格式读；PKCS12（新版 keytool 默认）找 friendlyName（私钥那一段不加密，能读到） */
function keystoreAliases(b: Uint8Array): string[] {
  const out: string[] = []
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
  if (u32(0) === 0xfeedfeed) {
    // JKS：magic、版本、条目数；每条：类型、别名（2 字节长度 + UTF-8）、时间……
    try {
      let i = 12
      const n = u32(8)
      const utf = () => { const len = (b[i] << 8) | b[i + 1]; const t = new TextDecoder().decode(b.subarray(i + 2, i + 2 + len)); i += 2 + len; return t }
      for (let k = 0; k < n && i < b.length; k++) {
        const tag = u32(i); i += 4
        out.push(utf()); i += 8
        if (tag === 1) { i += 4 + u32(i); const certs = u32(i); i += 4; for (let c = 0; c < certs; c++) { utf(); i += 4 + u32(i) } }
        else { utf(); i += 4 + u32(i) }
      }
    } catch { /* 读一半也行 */ }
    return out
  }
  // PKCS12：OID 1.2.840.113549.1.9.20（friendlyName）后面是 SET { BMPString }
  const oid = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x14]
  for (let i = 0; i + oid.length + 4 < b.length; i++) {
    if (!oid.every((x, j) => b[i + j] === x)) continue
    let k = i + oid.length
    if (b[k] !== 0x31) continue
    k += b[k + 1] & 0x80 ? 2 + (b[k + 1] & 0x7f) : 2
    if (b[k] !== 0x1e) continue
    const len = b[k + 1]
    let t = ''
    for (let j = 0; j < len; j += 2) t += String.fromCharCode((b[k + 2 + j] << 8) | b[k + 3 + j])
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}
export function SignCertFields({ onChange }: { onChange: (secret: string) => void }) {
  const [v, setV] = useState({ keystore: '', file: '', storePass: '', alias: '', keyPass: '' })
  const [aliases, setAliases] = useState<string[] | null>(null)
  const [diffKey, setDiffKey] = useState(false)
  const up = (p: Partial<typeof v>) => { const n = { ...v, ...p }; setV(n); onChange(n.keystore && n.storePass && n.alias ? JSON.stringify({ keystore: n.keystore, storePass: n.storePass, alias: n.alias, keyPass: n.keyPass || undefined }) : '') }
  return (
    <>
      <Field label="签名文件（.jks / .keystore / .p12）">
        <label className="btn default sm">{v.file || '选文件'}<input type="file" hidden accept=".jks,.keystore,.p12,.pfx" onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          if (f.size > 256 * 1024) { toast('文件太大，不像签名证书'); return }
          const b = new Uint8Array(await f.arrayBuffer())
          let bin = ''
          for (const x of b) bin += String.fromCharCode(x)
          const al = keystoreAliases(b)
          setAliases(al)
          up({ keystore: btoa(bin), file: f.name, alias: al.length === 1 ? al[0] : v.alias })
        }} /></label>
      </Field>
      <Field label="密钥库密码"><input type="password" value={v.storePass} onChange={(e) => up({ storePass: e.target.value })} autoComplete="new-password" /></Field>
      {aliases && aliases.length === 1
        ? <Row title="别名（从文件里读出来的）" right={<span className="mono" data-no-i18n="">{v.alias}</span>} />
        : aliases && aliases.length > 1
          ? <Field label="用哪个别名"><div className="chips">{aliases.map((x) => <button key={x} type="button" className={'chip mono' + (v.alias === x ? ' on' : '')} onClick={() => up({ alias: x })} data-no-i18n="">{x}</button>)}</div></Field>
          : <Field label="别名（alias）" hint={v.file ? '没能从文件里读出来，填生成时 -alias 后面那个' : '选了文件会自动读出来'}><input value={v.alias} onChange={(e) => up({ alias: e.target.value })} autoComplete="off" /></Field>}
      <label className="nowrap sub"><input type="checkbox" checked={diffKey} onChange={(e) => { setDiffKey(e.target.checked); if (!e.target.checked) up({ keyPass: '' }) }} /> 密钥密码和密钥库密码不一样</label>
      {diffKey && <Field label="密钥密码"><input type="password" value={v.keyPass} onChange={(e) => up({ keyPass: e.target.value })} autoComplete="new-password" /></Field>}
    </>
  )
}

// ======================= 服务器详情：日志（登记多个 + 看） =======================
const LOG_KIND: Record<LogSource['kind'], string> = { file: '文件', dir: '目录', service: '系统服务' }
type Src = { service?: string; file?: string; dir?: string }
export function LogViewer({ s }: { s: Server }) {
  const serverId = s.id
  const [services, setServices] = useState<string[] | null>(null)
  const loadServices = () => { if (services === null) call<{ services: string[] }>('GET', `/api/servers/${serverId}/services`).then((r) => setServices(r?.services ?? [])) }
  // 登记的日志（可以多个）：员工的日志扫描不指定就扫这些。加一条、删一条都直接存
  const regs = s.logSrc ?? []
  const [draft, setDraft] = useState<LogSource | null>(null)
  const saveRegs = (list: LogSource[], msg: string) => call('PUT', `/api/servers/${serverId}`, { logSrc: list.map(({ kind, path }) => ({ kind, path: path.trim() })) }, msg)
  const [src, setSrc] = useState<Src>({})
  const [srcKind, setSrcKind] = useState<'service' | 'file'>('service')
  const [file, setFile] = useState('')
  const [lines, setLines] = useState(200)
  const [kw, setKw] = useState('')
  const [text, setText] = useState<string | null>(null)
  const [follow, setFollow] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = async (x = src) => {
    if (!x.service && !x.file && !x.dir) return
    setBusy(true)
    const q = new URLSearchParams({ lines: String(lines), ...(x.service ? { service: x.service } : x.dir ? { dir: x.dir } : { file: x.file! }) })
    const r = await call<{ text: string }>('GET', `/api/servers/${serverId}/logs?${q}`)
    setBusy(false)
    if (r) setText(r.text)
  }
  const view = (x: Src) => { setSrc(x); void load(x) }
  const viewReg = (l: LogSource) => view(l.kind === 'service' ? { service: l.path } : l.kind === 'dir' ? { dir: l.path } : { file: l.path })
  useEffect(() => { if (!follow) return; const t = window.setInterval(() => load(), 5000); return () => clearInterval(t) }, [follow, src, lines]) // eslint-disable-line react-hooks/exhaustive-deps
  const lv = (l: string) => (/error|fail|fatal|panic|exception|refused|denied|critical|traceback/i.test(l) ? 'log-err' : /warn|deprecated|timeout|retry/i.test(l) ? 'log-warn' : '')
  const shown = (text ?? '').split('\n').filter((l) => !kw || l.toLowerCase().includes(kw.toLowerCase()))
  const cur = src.service ?? src.dir ?? src.file
  return (
    <>
      <Section title={`登记的日志 · ${regs.length}`} right={!draft && <button className="btn ghost sm" onClick={() => setDraft({ kind: 'dir', path: '' })}>+ 登记日志</button>}>
        {regs.length === 0 && !draft && <p className="pad sub">还没登记。登记后，日志值班员工只说「扫一下这台」就会把这些全扫一遍。</p>}
        {regs.map((l, i) => (
          <Row key={i} icon={<span className="kind-badge">{LOG_KIND[l.kind]}</span>} title={<span className="mono" data-no-i18n="">{l.path}</span>}
            right={<span className="row-actions"><button className="btn default sm" onClick={() => viewReg(l)}>看</button><button className="btn ghost sm" onClick={() => saveRegs(regs.filter((_, j) => j !== i), '已删')}>删</button></span>} />
        ))}
        {draft && (
          <div className="pad form">
            <Segmented value={draft.kind} onChange={(v) => setDraft({ kind: v, path: '' })} options={(Object.keys(LOG_KIND) as LogSource['kind'][]).map((k) => ({ value: k, label: LOG_KIND[k] }))} />
            {draft.kind === 'service'
              ? <select value={draft.path} onFocus={loadServices} onChange={(e) => setDraft({ ...draft, path: e.target.value })}><option value="">选一个服务…</option>{(services ?? []).map((x) => <option key={x} value={x}>{x}</option>)}</select>
              : <PathInput server={serverId} value={draft.path} onChange={(v) => setDraft({ ...draft, path: v })} files={draft.kind === 'file'} dirs={draft.kind === 'dir'} placeholder={draft.kind === 'dir' ? '/var/log/myapp（扫里面所有的 *.log）' : '/var/log/myapp/app.log（可以带 *）'} />}
            <div className="row-actions">
              <button className="btn ghost sm" onClick={() => setDraft(null)}>取消</button>
              <button className="btn primary sm" disabled={!draft.path.trim()} onClick={async () => { if (await saveRegs([...regs, draft], '已登记')) setDraft(null) }}>登记</button>
            </div>
          </div>
        )}
        <p className="pad hint">只读，不会改日志。目录 = 扫里面所有的 *.log；文件可以带 *（比如 /var/log/nginx/*.log）；系统服务看 journalctl。</p>
      </Section>
      <Section title="看日志" right={<span className="sub">最后几行，错误标红</span>}>
        <div className="pad form">
          <div className="log-bar">
            <Segmented value={srcKind} onChange={(v) => setSrcKind(v)} options={[{ value: 'service', label: '系统服务' }, { value: 'file', label: '文件' }]} />
            {srcKind === 'service'
              ? <select className="grow" value={src.service ?? ''} onFocus={loadServices} onChange={(e) => view({ service: e.target.value || undefined })}><option value="">选一个服务…</option>{(services ?? []).map((x) => <option key={x} value={x}>{x}</option>)}</select>
              : <PathInput server={serverId} value={file} onChange={setFile} files placeholder="/var/log/…" onEnter={(v) => v && view({ file: v })} />}
          </div>
          <div className="log-bar">
            <div className="chips">{[100, 200, 500, 1000].map((n) => <button key={n} type="button" className={'chip' + (lines === n ? ' on' : '')} onClick={() => setLines(n)}>{n} 行</button>)}</div>
            <span className="log-sep" />
            <div className="chips">{['ERROR', 'WARN', 'Exception'].map((x) => <button key={x} type="button" className={'chip mono' + (kw === x ? ' on' : '')} onClick={() => setKw(kw === x ? '' : x)} data-no-i18n="">{x}</button>)}</div>
            <input className="log-kw" value={['ERROR', 'WARN', 'Exception'].includes(kw) ? '' : kw} onChange={(e) => setKw(e.target.value)} placeholder="只看包含…" />
            <span className="grow" />
            <label className="nowrap sub"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> 自动刷新</label>
            <button className="btn default sm" disabled={busy || !cur} onClick={() => load()}>{busy ? '…' : '刷新'}</button>
          </div>
          {cur && <p className="field-hint" data-no-i18n="">{cur}</p>}
        </div>
        {text !== null && (
          <pre className="console log-view" data-no-i18n="">
            {shown.map((l, i) => <div key={i} className={lv(l)}>{l || ' '}</div>)}
          </pre>
        )}
      </Section>
    </>
  )
}
