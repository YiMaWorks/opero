// 真的一套：发布记录 / 发布详情（回滚）、域名（DNS）、签名证书的上传表单
import { useEffect, useState } from 'react'
import type { Domain, LiveRelease, ReleaseStep } from '../types'
import { requireVerify, toast, useStore } from '../store'
import { call } from '../live'
import { Empty, Field, PageHeader, Row, Section, Segmented, Tag } from '../components/ui'
import { headNav, type PageProps } from './nav'

const STEP: Record<ReleaseStep['k'], string> = { build: '编译', checkout: '核对产物', transfer: '发到服务器', sign: '签名', deploy: '部署', health: '检查', rollback: '退回上一版' }
const ST: Record<LiveRelease['status'], { label: string; tone: 'primary' | 'ok' | 'danger' }> = { running: { label: '发布中', tone: 'primary' }, success: { label: '成功', tone: 'ok' }, failed: { label: '失败', tone: 'danger' } }
const when = (ts: number) => new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const dur = (r: LiveRelease) => (r.ended ? `${Math.max(1, Math.round((r.ended - r.started) / 1000))} 秒` : '')

// ======================= 发布记录 =======================
export function LiveReleasesPage({ params, nav }: PageProps) {
  const list = useStore((s) => s.liveReleases)
  const wss = useStore((s) => s.workspaces)
  const [ws, setWs] = useState<string>(params.ws ?? '')
  const rows = [...list].filter((r) => !ws || r.ws === ws).sort((a, b) => b.started - a.started)
  const targets = wss.flatMap((w) => (w.deploys ?? []).map((d) => ({ w, d })))
  return (
    <div className="page">
      <PageHeader title="发布" sub="每个工作空间的发布目标：编译、签名、部署、检查，失败自动退回上一版" {...headNav(nav)} />
      <div className="page-body">
        {targets.length === 0 && <div className="pad"><div className="banner b-info">还没有发布环境：到「工作空间」里点一个项目 →「编译」「发布环境」里设。</div></div>}
        {targets.length > 0 && (
          <Section title="发布环境">
            {targets.map(({ w, d }) => (
              <Row key={d.id} title={`${w.name} → ${d.name}`} sub={`${w.buildCfg ? '编译 · ' : ''}${d.sign ? '签名 · ' : ''}部署${d.health ? ' · 检查' : ''} · 员工${d.ai === 'auto' ? '能直接发' : d.ai === 'off' ? '不许发' : '发前问你'}${d.last ? ` · 上次 ${d.last} ${d.lastOk ? '成功' : '失败'}` : ''}`}
                chevron onClick={() => nav.push({ page: 'workspace', params: { id: w.id } })} />
            ))}
          </Section>
        )}
        <div className="pad">
          <select value={ws} onChange={(e) => setWs(e.target.value)}>
            <option value="">全部项目</option>{wss.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <Section title={`发布记录 · ${rows.length}`} flush>
          {rows.length === 0 && <Empty>还没有发过</Empty>}
          {rows.map((r) => (
            <Row key={r.id} chevron onClick={() => nav.push({ page: 'release', params: { id: r.id } })}
              title={<><Tag tone={ST[r.status].tone}>{ST[r.status].label}</Tag> {wss.find((w) => w.id === r.ws)?.name ?? '?'} → {r.targetName}{r.rollbackOf ? '（回滚）' : ''}</>}
              sub={<><span className="mono small" data-no-i18n="">{r.version || '…'}</span> · {r.by} · {when(r.started)}{dur(r) ? ` · ${dur(r)}` : ''}</>} />
          ))}
        </Section>
      </div>
    </div>
  )
}

export function LiveReleasePage({ params, nav }: PageProps) {
  const r = useStore((s) => s.liveReleases.find((x) => x.id === params.id))
  const w = useStore((s) => s.workspaces.find((x) => x.id === r?.ws))
  const [full, setFull] = useState<LiveRelease | null>(null)
  useEffect(() => { call<LiveRelease>('GET', `/api/releases/${params.id}`).then((x) => x && setFull(x)) }, [params.id, r?.status])
  const x = full && r && full.status === r.status ? { ...r, tail: full.tail } : r ?? full
  if (!x) return <div className="page"><PageHeader title="发布" {...headNav(nav)} /><Empty>找不到</Empty></div>
  const rollback = () => {
    if (!confirm(`回滚到 ${x.version}？会在目标服务器上用这个版本留着的产物重新部署${x.kept ? '' : '（产物已经清掉了，会按这个提交重新编）'}`)) return
    requireVerify(`回滚 ${w?.name ?? ''} → ${x.targetName} 到 ${x.version}`, () => call<LiveRelease>('POST', `/api/releases/${x.id}/rollback`, undefined, '已开始回滚').then((n) => n && nav.push({ page: 'release', params: { id: n.id } })))
  }
  return (
    <div className="page">
      <PageHeader title={`${w?.name ?? ''} → ${x.targetName}`} sub={x.rollbackOf ? '回滚' : '发布'} {...headNav(nav)} />
      <div className="page-body">
        <Section>
          <Row title="状态" right={<Tag tone={ST[x.status].tone}>{ST[x.status].label}</Tag>} />
          <Row title="版本" right={<span className="mono small" data-no-i18n="">{x.version || '…'}</span>} />
          {x.sha && <Row title="提交" right={<span className="mono small" data-no-i18n="">{x.sha.slice(0, 12)}</span>} />}
          <Row title="谁发的" right={x.by} />
          <Row title="时间" right={`${when(x.started)}${dur(x) ? ` · ${dur(x)}` : ''}`} />
          {x.note && <Row title="说明" sub={<span data-no-i18n="">{x.note}</span>} />}
          {x.status === 'success' && <Row title="产物" right={x.kept ? '留着（能回滚）' : '已清掉'} />}
        </Section>
        <Section title="步骤">
          {x.steps.filter((s) => s.s !== 'skipped').map((s) => (
            <Row key={s.k} title={STEP[s.k]} sub={s.msg ? <span data-no-i18n="">{s.msg}</span> : undefined}
              right={<Tag tone={s.s === 'done' ? 'ok' : s.s === 'failed' ? 'danger' : s.s === 'running' ? 'primary' : 'mute'}>{s.s === 'done' ? '✓' : s.s === 'failed' ? '失败' : s.s === 'running' ? '进行中' : '等着'}</Tag>} />
          ))}
        </Section>
        {x.error && <Section title="原因"><pre className="console" data-no-i18n="">{x.error}</pre></Section>}
        {x.tail && <Section title="输出（最后一段）"><pre className="console" data-no-i18n="">{x.tail}</pre></Section>}
        {x.status === 'success' && <div className="pad row-actions"><button className="btn default" onClick={rollback}>回滚到这个版本</button></div>}
      </div>
    </div>
  )
}

// ======================= 域名 =======================
export function DomainsPage({ nav }: PageProps) {
  const list = useStore((s) => s.domains)
  const creds = useStore((s) => s.credentials)
  const emps = useStore((s) => s.employees)
  const [f, setF] = useState<{ domain: string; provider: Domain['provider']; cred: string }>({ domain: '', provider: 'cloudflare', cred: '' })
  const add = async () => { if (await call('POST', '/api/domains', f, '已登记')) setF({ ...f, domain: '' }) }
  return (
    <div className="page">
      <PageHeader title="域名" sub="登记后在员工档案里开给员工，它就能改解析" {...headNav(nav)} />
      <div className="page-body">
        <Section flush>
          {list.length === 0 && <Empty>还没有登记域名</Empty>}
          {list.map((d) => (
            <Row key={d.id} title={d.domain} sub={`${d.provider === 'aliyun' ? '阿里云' : 'Cloudflare'} · ${creds.find((c) => c.id === d.cred)?.name ?? '凭证不在了'} · 能改的员工：${emps.filter((e) => (e.dns ?? []).includes(d.id)).map((e) => e.name).join('、') || '没有'}`}
              chevron onClick={() => nav.push({ page: 'domain', params: { id: d.id } })} />
          ))}
        </Section>
        <Section title="登记一个域名">
          <div className="pad form">
            <Field label="域名"><input value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder="example.com" /></Field>
            <Field label="在哪家"><Segmented value={f.provider} onChange={(v) => setF({ ...f, provider: v })} options={[{ value: 'cloudflare', label: 'Cloudflare' }, { value: 'aliyun', label: '阿里云' }]} /></Field>
            <Field label="用哪个凭证" hint={f.provider === 'aliyun' ? '「云账号」凭证：用户名填 AccessKeyId，值填 AccessKeySecret（建议用只有 DNS 权限的子账号）' : '「云账号」凭证：值填 Cloudflare API 令牌（权限只给这个域名的 DNS 编辑）'}>
              <select value={f.cred} onChange={(e) => setF({ ...f, cred: e.target.value })}>
                <option value="">选一个</option>{creds.filter((c) => c.group === '云账号').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <button className="btn primary" disabled={!f.domain.trim() || !f.cred} onClick={add}>登记</button>
          </div>
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
  const [f, setF] = useState({ rr: '', type: 'A', value: '', ttl: '600' })
  const load = () => call<Rec[]>('GET', `/api/domains/${params.id}/records`).then((r) => { if (r) { setRecs(r); setErr('') } else setErr('读不到记录：看看凭证对不对') })
  useEffect(() => { load() }, [params.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="page"><PageHeader title="域名" {...headNav(nav)} /><Empty>找不到</Empty></div>
  const save = () => requireVerify(`改解析 ${f.rr}.${d.domain}`, () => call('POST', `/api/domains/${d.id}/records`, { ...f, ttl: Number(f.ttl) || undefined }, '已保存').then((r) => { if (r) { setF({ ...f, value: '' }); load() } }))
  const del = (r: Rec) => { if (confirm(`删掉 ${r.rr} ${r.type} ${r.value}？`)) requireVerify('删解析记录', () => call('DELETE', `/api/domains/${d.id}/records/${encodeURIComponent(r.id)}`, undefined, '已删').then(load)) }
  return (
    <div className="page">
      <PageHeader title={d.domain} sub={d.provider === 'aliyun' ? '阿里云' : 'Cloudflare'} {...headNav(nav)} right={<button className="btn default sm" onClick={load}>刷新</button>} />
      <div className="page-body">
        {err && <div className="pad"><div className="banner b-warn">{err}</div></div>}
        <Section title={`解析记录 · ${recs?.length ?? '…'}`} flush>
          {(recs ?? []).map((r) => (
            <Row key={r.id} title={<span className="mono" data-no-i18n="">{r.rr} · {r.type}</span>} sub={<span className="mono small" data-no-i18n="">{r.value}{r.priority ? ` · ${r.priority}` : ''} · TTL {r.ttl}</span>}
              right={<button className="btn ghost sm" onClick={() => del(r)}>删</button>} />
          ))}
        </Section>
        <Section title="加 / 改一条（同主机记录 + 类型就是改）">
          <div className="pad form">
            <div className="inline-form">
              <Field label="主机记录"><input value={f.rr} onChange={(e) => setF({ ...f, rr: e.target.value })} placeholder="@ / www / api" /></Field>
              <Field label="类型"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'].map((t) => <option key={t}>{t}</option>)}</select></Field>
              <Field label="TTL"><input value={f.ttl} onChange={(e) => setF({ ...f, ttl: e.target.value })} inputMode="numeric" /></Field>
            </div>
            <Field label="记录值"><input value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
            <button className="btn primary" disabled={!f.rr.trim() || !f.value.trim()} onClick={save}>保存</button>
          </div>
        </Section>
        <div className="pad row-actions"><button className="btn ghost" onClick={() => { if (confirm(`不再管理 ${d.domain}？（解析本身不受影响）`)) call('DELETE', `/api/domains/${d.id}`, undefined, '已去掉').then(() => nav.back()) }}>去掉这个域名</button></div>
      </div>
    </div>
  )
}

// ======================= 签名证书：上传 keystore + 密码，拼成一份加密存的值 =======================
export function SignCertFields({ onChange }: { onChange: (secret: string) => void }) {
  const [v, setV] = useState({ keystore: '', file: '', storePass: '', alias: '', keyPass: '' })
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
          up({ keystore: btoa(bin), file: f.name })
        }} /></label>
      </Field>
      <Field label="密钥库密码"><input type="password" value={v.storePass} onChange={(e) => up({ storePass: e.target.value })} autoComplete="new-password" /></Field>
      <Field label="别名（alias）"><input value={v.alias} onChange={(e) => up({ alias: e.target.value })} autoComplete="off" /></Field>
      <Field label="密钥密码（和密钥库密码一样就不填）"><input type="password" value={v.keyPass} onChange={(e) => up({ keyPass: e.target.value })} autoComplete="new-password" /></Field>
    </>
  )
}

// ======================= 服务器详情：看日志 =======================
export function LogViewer({ serverId }: { serverId: string }) {
  const [services, setServices] = useState<string[] | null>(null)
  const [src, setSrc] = useState<{ service?: string; file?: string }>({})
  const [file, setFile] = useState('')
  const [lines, setLines] = useState(200)
  const [kw, setKw] = useState('')
  const [text, setText] = useState<string | null>(null)
  const [follow, setFollow] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = async (s = src) => {
    if (!s.service && !s.file) return
    setBusy(true)
    const q = new URLSearchParams({ lines: String(lines), ...(s.service ? { service: s.service } : { file: s.file! }) })
    const r = await call<{ text: string }>('GET', `/api/servers/${serverId}/logs?${q}`)
    setBusy(false)
    if (r) setText(r.text)
  }
  useEffect(() => { if (!follow) return; const t = window.setInterval(() => load(), 5000); return () => clearInterval(t) }, [follow, src, lines]) // eslint-disable-line react-hooks/exhaustive-deps
  const lv = (l: string) => (/error|fail|fatal|panic|exception|refused|denied|critical|traceback/i.test(l) ? 'log-err' : /warn|deprecated|timeout|retry/i.test(l) ? 'log-warn' : '')
  const shown = (text ?? '').split('\n').filter((l) => !kw || l.toLowerCase().includes(kw.toLowerCase()))
  return (
    <Section title="日志" right={<span className="sub">只读：最后几行，关键字过滤，错误标红</span>}>
      <div className="pad form">
        <div className="inline-form">
          <select value={src.service ?? ''} onFocus={() => services === null && call<{ services: string[] }>('GET', `/api/servers/${serverId}/services`).then((r) => setServices(r?.services ?? []))}
            onChange={(e) => { const s = { service: e.target.value || undefined }; setSrc(s); load(s) }}>
            <option value="">选一个服务…</option>{(services ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <input className="mono" value={file} onChange={(e) => setFile(e.target.value)} placeholder="或者日志文件 /var/log/…" onKeyDown={(e) => { if (e.key === 'Enter' && file.trim()) { const s = { file: file.trim() }; setSrc(s); load(s) } }} />
        </div>
        <div className="inline-form">
          <select value={lines} onChange={(e) => setLines(Number(e.target.value))}>{[100, 200, 500, 1000, 2000].map((n) => <option key={n} value={n}>最后 {n} 行</option>)}</select>
          <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="只看包含…" />
          <button className="btn default sm" disabled={busy || (!src.service && !src.file)} onClick={() => load()}>{busy ? '…' : '刷新'}</button>
          <label className="nowrap sub"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> 每 5 秒刷新</label>
        </div>
      </div>
      {text !== null && (
        <pre className="console log-view" data-no-i18n="">
          {shown.map((l, i) => <div key={i} className={lv(l)}>{l || ' '}</div>)}
        </pre>
      )}
    </Section>
  )
}
