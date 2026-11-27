// 凭证管理：按分类列出来；新增 = 选分类 → 选类型 → 照着步骤去那个平台拿（有直达按钮）→ 贴进来 → 测试连接 → 保存。
// 谁能用不在这里定：在员工资料「能用的凭证」里勾（EmployeeCredsSection）。
import { useState } from 'react'
import type { Credential, CredGroup, Employee } from '../types'
import { toast, useStore } from '../store'
import { call } from '../live'
import { CRED_META, fillUrl, groupMeta, typeLabel, typeMeta, type CredType } from '../credmeta'
import { parseConn, type ConnInfo } from '../connstr'
import { Drawer, Empty, Field, PageHeader, Row, Section, Segmented, Tag, Toggle } from '../components/ui'
import { IconPlus } from '../components/icons'
import { headNav, type PageProps } from './nav'
import { EnvPicker, envTone } from './live'
import { SignCertFields } from './live3'
import { EmpName } from '../components/EmpName'

/** 目录里没有的类型（消息渠道里存的、以前存的）：照原样能改 */
const GENERIC: CredType = { kind: '', fields: [], user: { label: '用户名 / 附加密钥', optional: true }, secret: { label: '值' }, guide: { steps: ['这是以前存的或别处（消息渠道）存的凭证：值加密存着，要换就贴新的'] } }
/** 分类的颜色（卡片上的图标） */
const GROUP_COLOR: Record<string, string> = { 代码仓库: '#5B4FE9', 数据库: '#0EA5E9', 服务器: '#10B981', 云账号: '#F59E0B', AI: '#8B5CF6', 签名证书: '#EC4899', 消息渠道: '#14B8A6', 其它: '#64748B' }
type TestRes = { ok: boolean; msg: string; user?: string; details?: { title: string; items: string[]; total?: number }[]; write?: boolean | null }
/** 贴的连接串是别的类型：先换类型（表单会重建），拆出来的值带过去 */
let carry: ConnInfo | null = null

const copy = (t: string) => { navigator.clipboard?.writeText(t).catch(() => {}); toast('已复制') }
const usersOf = (emps: Employee[], id: string) => emps.filter((e) => e.creds?.includes(id))

function StatusTag({ c }: { c: Credential }) {
  if (!c.test) return null
  return c.test.ok ? <Tag tone="ok">能用</Tag> : <Tag tone="danger">连不上</Tag>
}

// ======================= 列表 =======================
export function LiveCredentialsPage({ params, nav }: PageProps) {
  const list = useStore((s) => s.credentials)
  const emps = useStore((s) => s.employees)
  const [tab, setTab] = useState<string>(params.group ?? '全部')
  const groups = CRED_META.filter((g) => !g.goto)
  const shown = tab === '全部' ? list : list.filter((c) => c.group === tab)
  return (
    <div className="page">
      <PageHeader title="凭证" sub="密码、令牌加密存着；员工用的时候 Opero 代它去连，明文不给 AI" {...headNav(nav)}
        right={<button className="btn primary sm" onClick={() => nav.push({ page: 'credentialEdit', params: tab === '全部' ? {} : { group: tab } })}><IconPlus /> 新增凭证</button>} />
      <div className="page-body">
        <div className="pad chips">
          {['全部', ...groups.map((g) => g.group)].map((g) => {
            const n = g === '全部' ? list.length : list.filter((c) => c.group === g).length
            return <button key={g} className={'chip' + (tab === g ? ' on' : '')} onClick={() => setTab(g)}>{g}{n ? ` · ${n}` : ''}</button>
          })}
        </div>
        {tab !== '全部' && <p className="pad sub">{groupMeta(tab)?.desc}</p>}
        {shown.length === 0 && (
          <div className="pad">
            <Empty>{tab === '全部' ? '还没有凭证' : `还没有「${tab}」凭证`}</Empty>
            <div className="row-actions center"><button className="btn primary" onClick={() => nav.push({ page: 'credentialEdit', params: tab === '全部' ? {} : { group: tab } })}><IconPlus /> 新增{tab === '全部' ? '凭证' : `「${tab}」凭证`}</button></div>
          </div>
        )}
        {(tab === '全部' ? groups.map((g) => g.group as string).concat(['消息渠道']) : [tab]).map((g) => {
          const items = shown.filter((c) => c.group === g)
          if (!items.length) return null
          return (
            <Section key={g} title={tab === '全部' ? g : undefined}>
              {items.map((c) => {
                const us = usersOf(emps, c.id)
                return (
                  <Row key={c.id} chevron onClick={() => nav.push({ page: 'credentialEdit', params: { id: c.id } })}
                    title={<>{c.name} <Tag tone={envTone(c.env)}>{c.env}</Tag> <StatusTag c={c} /> {!c.aiAllowed && <Tag>只有你能用</Tag>}</>}
                    sub={`${typeLabel(c.group, c.kind)} · ${!c.aiAllowed ? '员工不能用' : us.length ? `给 ${us.map((e) => e.name).join('、')} 用` : '还没给员工用'}`} />
                )
              })}
            </Section>
          )
        })}
      </div>
    </div>
  )
}

// ======================= 新增 / 编辑 =======================
export function LiveCredentialEditPage({ params, nav }: PageProps) {
  const existing = useStore((s) => s.credentials.find((x) => x.id === params.id))
  const emps = useStore((s) => s.employees)
  const [group, setGroup] = useState<CredGroup | ''>(existing?.group ?? (params.group as CredGroup) ?? '')
  const gm = group ? groupMeta(group) : undefined
  const [kind, setKind] = useState<string>(existing?.kind ?? (gm?.types.find((x) => x.kind.toLowerCase() === String(params.kind ?? '').toLowerCase())?.kind) ?? gm?.types[0]?.kind ?? '')
  const t = group ? typeMeta(group, kind) ?? (existing ? GENERIC : undefined) : undefined

  // ---- 第一步：选分类 ----
  if (!group || !gm) {
    return (
      <div className="page">
        <PageHeader title="新增凭证" sub="先选是哪一类" {...headNav(nav)} />
        <div className="page-body">
          <div className="tiles">
            {CRED_META.map((g) => (
              <button key={g.group} className="tile" onClick={() => {
                if (g.goto) { nav.push({ page: g.goto.page }); return }
                setGroup(g.group); setKind(g.types[0]?.kind ?? '')
              }}>
                <span className="tile-head"><span className="tile-ico" style={{ background: `color-mix(in srgb, ${GROUP_COLOR[g.group] ?? '#5B4FE9'} 14%, transparent)`, color: GROUP_COLOR[g.group] ?? '#5B4FE9' }}>{g.group.slice(0, 1)}</span><b>{g.group}</b></span>
                <span className="sub">{g.desc}</span>
                <span className="tile-n">{g.goto ? g.goto.label : g.types.map((x) => x.label ?? x.kind).slice(0, 5).join(' · ') + (g.types.length > 5 ? ' …' : '')}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }
  return <CredForm key={`${group}/${kind}`} existing={existing} group={group} kind={kind} t={t} setKind={setKind} back={() => (existing || params.group ? nav.back() : setGroup(''))} nav={nav} emps={emps} />
}

function CredForm({ existing, group, kind, t, setKind, back, nav, emps }: {
  existing?: Credential; group: CredGroup; kind: string; t?: CredType; setKind: (k: string) => void; back: () => void; nav: PageProps['nav']; emps: Employee[]
}) {
  const gm = groupMeta(group)!
  const source = useStore((s) => s.dataSources.find((d) => d.credential === existing?.id))
  const [carried] = useState(() => { const c = carry; carry = null; return c })
  const initMeta = () => Object.fromEntries((t?.fields ?? []).map((f) => [f.key, (carried as Record<string, string | undefined> | null)?.[f.key] ?? existing?.meta?.[f.key] ?? f.def ?? '']))
  const [meta, setMeta] = useState<Record<string, string>>(initMeta)
  const [user, setUser] = useState(carried?.user ?? existing?.user ?? (t?.user && t.user !== 'auto' ? t.user.def ?? '' : ''))
  const [secret, setSecret] = useState(carried?.password ?? '')
  const [conn, setConn] = useState('')
  // 贴连接串：认出来就拆进下面各格（类型不对先换类型）
  const pasteConn = (v: string) => {
    setConn(v)
    const c = parseConn(v)
    if (!c) return
    if (c.kind && c.kind !== kind && groupMeta(group)?.types.some((x) => x.kind === c.kind)) { carry = c; setKind(c.kind); return }
    setMeta((m) => ({ ...m, ...(c.host ? { host: c.host } : {}), ...(c.port ? { port: c.port } : {}), ...(c.db ? { db: c.db } : {}) }))
    if (c.user) setUser(c.user)
    if (c.password) setSecret(c.password)
    toast(`认出来了：${[c.kind, c.host, c.db].filter(Boolean).join(' · ')}${c.password ? '，密码也填好了' : '，密码要自己填'}`)
  }
  const [name, setName] = useState(existing?.name ?? '')
  const [env, setEnv] = useState(existing?.env ?? '生产')
  const [aiAllowed, setAiAllowed] = useState(existing?.aiAllowed ?? true)
  const [writable, setWritable] = useState(source?.writable ?? false)
  const [test, setTest] = useState<TestRes | null>(existing?.test ? { ok: existing.test.ok, msg: existing.test.msg, details: existing.test.details } : null)
  const [busy, setBusy] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  const isDbSql = group === '数据库' && ['MySQL', 'MariaDB', 'PostgreSQL', 'SQL Server', 'Oracle'].includes(kind)
  const body = () => ({ group, kind, meta, user: t?.user === 'auto' ? undefined : user, secret: secret || undefined, name: name.trim() || undefined, env, aiAllowed, ...(isDbSql ? { writable } : {}) })
  const missing = (t?.fields ?? []).filter((f) => !f.optional && !meta[f.key]?.trim()).map((f) => f.label)
    .concat(t?.user && t.user !== 'auto' && !t.user.optional && !user.trim() ? [t.user.label] : [])
    .concat(!existing && !secret ? [t?.secret.label ?? '值'] : [])

  const runTest = async () => {
    if (missing.length) { toast(`先填：${missing.join('、')}`); return }
    setBusy('test'); setTest(null)
    const r = await call<TestRes>('POST', '/api/credentials/test', { ...body(), id: existing?.id })
    setBusy('')
    if (r) setTest(r)
  }
  const save = async () => {
    if (missing.length) { toast(`先填：${missing.join('、')}`); return }
    setBusy('save')
    const r = await call<Credential>(existing ? 'PUT' : 'POST', existing ? `/api/credentials/${existing.id}` : '/api/credentials', body())
    setBusy('')
    if (!r) return
    toast(r.test && !r.test.ok ? `已保存，但测试没通过：${r.test.msg}` : '已加密保存')
    // 代码仓库：存好直接用它接入项目；其它回去
    if (!existing && group === '代码仓库' && r.test?.ok) nav.push({ page: 'workspaceAdd', params: { credential: r.id } })
    else nav.back()
  }
  const reveal = async () => {
    if (shown !== null) { setShown(null); return }
    const r = await call<{ value: string }>('POST', `/api/credentials/${existing!.id}/reveal`)
    if (r) setShown(r.value)
  }
  const remove = async () => {
    if (!existing || !confirm(`删掉「${existing.name}」？${group === '数据库' ? '「数据」里的这个库也会去掉；' : ''}用到它的服务器 / 仓库会连不上，员工那边的授权也会去掉`)) return
    if (await call('DELETE', `/api/credentials/${existing.id}`, undefined, '已删除')) nav.back()
  }
  const link = t?.guide.link ? fillUrl(t.guide.link.url, meta, t) : ''
  const users = existing ? usersOf(emps, existing.id) : []

  return (
    <div className="page">
      <PageHeader title={existing ? existing.name : `新增「${group}」凭证`} sub={existing ? `${group} · ${typeLabel(group, kind)}` : gm.desc} onBack={back}
        right={<button className="btn primary sm" disabled={busy === 'save'} onClick={save}>{busy === 'save' ? '保存中…' : '保存'}</button>} />
      <div className="page-body form">
        {gm.note && <div className="banner b-info">{gm.note}</div>}
        {(!existing || !typeMeta(group, kind)) && gm.types.length > 1 && (
          <Field label="类型">
            <div className="chips">{gm.types.map((x) => <button key={x.kind} type="button" className={'chip' + (x.kind === kind ? ' on' : '')} onClick={() => setKind(x.kind)}>{x.label ?? x.kind}</button>)}</div>
          </Field>
        )}

        {t && (
          <div className="cred-guide">
            <b>怎么拿</b>
            {t.guide.link && (link
              ? <a className="btn primary" href={link} target="_blank" rel="noreferrer">{t.guide.link.label} ↗</a>
              : <p className="field-hint">先在下面填地址，这里会出现直达按钮</p>)}
            <ol className="exec-howto">{t.guide.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            {t.guide.perms && <p className="field-hint">要给的权限：{t.guide.perms}</p>}
            {t.guide.snippet && (
              <div className="cred-snippet">
                <div className="cred-snippet-head"><span>{t.guide.snippet.label}</span><button type="button" className="btn ghost sm" onClick={() => copy(t.guide.snippet!.code.split('{db}').join(meta.db || (/MySQL|MariaDB/.test(kind) ? '*' : '库名')))}>复制</button></div>
                <pre className="console small" data-no-i18n="">{t.guide.snippet.code.split('{db}').join(meta.db || (/MySQL|MariaDB/.test(kind) ? '*' : '库名'))}</pre>
              </div>
            )}
          </div>
        )}

        {group === '签名证书' ? <SignCertFields key={kind} kind={kind} onChange={setSecret} /> : t && (
          <>
            {group === '数据库' && !existing && (
              <Field label="连接串（有就贴，没有跳过）" hint="项目配置里那一串：mysql://用户:密码@地址:3306/库、jdbc:…、Server=…;Database=…、mysql -h … 都认，贴进来自动拆到下面">
                <input className="mono" value={conn} onChange={(e) => pasteConn(e.target.value)} placeholder="mysql://user:pass@10.0.0.5:3306/shop" autoComplete="off" spellCheck={false} />
              </Field>
            )}
            {t.fields.length > 0 && (
              <div className="inline-form">
                {t.fields.map((f) => (
                  <Field key={f.key} label={f.optional ? `${f.label}（可选）` : f.label} hint={f.hint}>
                    <input value={meta[f.key] ?? ''} onChange={(e) => setMeta((m) => ({ ...m, [f.key]: e.target.value }))} placeholder={f.placeholder ?? f.def} inputMode={f.numeric ? 'numeric' : undefined} autoComplete="off" />
                  </Field>
                ))}
              </div>
            )}
            {t.user && t.user !== 'auto' && (
              <Field label={t.user.optional ? `${t.user.label}（可选）` : t.user.label}>
                <input value={user} onChange={(e) => setUser(e.target.value)} placeholder={t.user.placeholder} autoComplete="off" />
              </Field>
            )}
            {t.user === 'auto' && existing?.user && <Row title="账号" right={existing.user} sub="测试时自动认出来的" />}
            <Field label={existing ? `${t.secret.label}（留空 = 不改）` : t.secret.label} hint="加密存起来；员工要用时由 Opero 代它去连，明文不给 AI">
              {t.secret.multiline
                ? <textarea className="mono code-edit" rows={5} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t.secret.placeholder} />
                : <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t.secret.placeholder ?? '••••••••'} autoComplete="new-password" />}
            </Field>
            {t.secret.file && (
              <label className="btn ghost sm">从文件读<input type="file" hidden onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                if (f.size > 64 * 1024) { toast('文件太大，不像密钥'); return }
                setSecret(await f.text())
              }} /></label>
            )}
          </>
        )}

        {t?.testable && (
          <div className="row-actions start">
            <button className="btn default" disabled={!!busy} onClick={runTest}>{busy === 'test' ? '在连…' : '测试连接'}</button>
          </div>
        )}
        {test && <div className={'banner ' + (test.ok ? 'b-ok' : 'b-warn')}>{test.ok ? '✓ ' : '没通过：'}{test.msg}</div>}
        {test?.ok && test.details?.map((d) => (
          <div key={d.title} className="cred-read">
            <b>{d.title}</b>
            <ul data-no-i18n="">{d.items.map((x) => <li key={x}>{x}</li>)}</ul>
            {d.total && <span className="sub">还有 {d.total - d.items.length} 个没列出来</span>}
          </div>
        ))}
        {isDbSql && test?.ok && test.write === true && !writable && <p className="field-hint">这个账号其实能改数据：建议给员工换一个只读账号（上面有建账号的语句），或者保持「允许改数据」关着，员工就只能查</p>}

        {isDbSql && (
          <div className="lrow boxed">
            <span className="row-main"><span className="row-title">允许改数据</span><span className="row-sub">关着 = 只能查（推荐：给生产库接只读账号）；开着员工改数据也要你点确认</span></span>
            <Toggle on={writable} onChange={setWritable} />
          </div>
        )}
        <Field label="名字（可选）" hint="不填自动起，比如「MySQL · 10.0.0.5/shop」「GitHub · 你的账号」"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="自动起" /></Field>
        <Field label="环境标签"><EnvPicker value={env} onChange={setEnv} /></Field>
        <div className="lrow boxed">
          <span className="row-main"><span className="row-title">允许 AI 员工使用</span><span className="row-sub">关掉 = 只有你本人能用；开着也要在员工资料「能用的凭证」里给那个员工勾上</span></span>
          <Toggle on={aiAllowed} onChange={setAiAllowed} />
        </div>

        {existing && (
          <Section title="谁在用">
            {users.length
              ? users.map((e) => <Row key={e.id} title={<EmpName e={e} />} sub={e.title} chevron onClick={() => nav.push({ page: 'employee', params: { id: e.id } })} />)
              : <Empty>还没给员工用：打开员工资料 →「能用的凭证」勾上它</Empty>}
            {!users.length && emps.length > 0 && <div className="pad chips">{emps.map((e) => <button key={e.id} className="chip" onClick={() => nav.push({ page: 'employee', params: { id: e.id } })}>{e.name} ›</button>)}</div>}
          </Section>
        )}
        {existing && group === '代码仓库' && (
          <div className="row-actions start"><button className="btn default" onClick={() => nav.push({ page: 'workspaceAdd', params: { credential: existing.id } })}>用它接入一个仓库</button></div>
        )}
        {existing && (
          <Section title="明文">
            <Row title={shown !== null ? <span className="mono small" data-no-i18n="">{shown || '（空）'}</span> : '••••••••••••'} right={<button className="btn default sm" onClick={reveal}>{shown !== null ? '隐藏' : '查看'}</button>} />
            <Row title="删掉这个凭证" danger onClick={remove} />
          </Section>
        )}
        <p className="hint">看明文、删除要先验证本人；新增、修改直接存，都记进操作记录。</p>
      </div>
    </div>
  )
}

// ======================= 员工资料：能用的凭证 =======================
// 员工资料里只列给了的；「授权凭证」从右边滑出全部凭证（能搜、按分类筛），勾好点确定。凭证再多也不挤
export function EmployeeCredsSection({ e, nav }: { e: Employee; nav: PageProps['nav'] }) {
  const creds = useStore((s) => s.credentials)
  const [open, setOpen] = useState(false)
  const mine = creds.filter((c) => (e.creds ?? []).includes(c.id))
  const save = (p: Partial<Pick<Employee, 'creds' | 'credGroups'>>) => call('PUT', `/api/employees/${e.id}`, { ...e, ...p }, '已保存')
  return (
    <Section title={`能用的凭证 · ${mine.length}`} right={<button className="btn ghost sm" onClick={() => setOpen(true)}>授权凭证</button>}>
      {mine.length === 0 && <Empty>还没给它凭证：点右上角「授权凭证」选</Empty>}
      {mine.map((c) => (
        <Row key={c.id} title={<>{c.name} {!c.aiAllowed && <Tag>只有你能用</Tag>}</>} sub={`${c.group} · ${typeLabel(c.group, c.kind)}`}
          right={<button className="btn ghost sm" onClick={() => save({ creds: (e.creds ?? []).filter((x) => x !== c.id) })}>收回</button>} />
      ))}
      {(e.credGroups ?? []).length > 0 && <p className="hint">以后新加的「{(e.credGroups ?? []).join('、')}」凭证会自动给它</p>}
      {open && <CredPicker e={e} onClose={() => setOpen(false)} onSave={(p) => { void save(p); setOpen(false) }} onManage={() => { setOpen(false); nav.push({ page: 'credentials' }) }} />}
    </Section>
  )
}

function CredPicker({ e, onClose, onSave, onManage }: { e: Employee; onClose: () => void; onSave: (p: Partial<Pick<Employee, 'creds' | 'credGroups'>>) => void; onManage: () => void }) {
  const creds = useStore((s) => s.credentials)
  const [sel, setSel] = useState<string[]>(e.creds ?? [])
  const [auto, setAuto] = useState<string[]>(e.credGroups ?? [])
  const [q, setQ] = useState('')
  const [g, setG] = useState('全部')
  const groups = ['全部', ...CRED_META.map((x) => x.group as string).filter((x) => creds.some((c) => c.group === x))]
  const shown = creds.filter((c) => (g === '全部' || c.group === g) && (!q || `${c.name} ${c.kind} ${c.group}`.toLowerCase().includes(q.toLowerCase())))
  const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))
  return (
    <Drawer title={`给「${e.name}」授权凭证`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onManage}>管理凭证</button><span className="grow" /><button className="btn ghost" onClick={onClose}>取消</button><button className="btn primary" onClick={() => onSave({ creds: sel, credGroups: auto })}>确定（{sel.length}）</button></>}>
      <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={`搜 ${creds.length} 个凭证`} autoFocus />
      <div className="chips">{groups.map((x) => <button key={x} type="button" className={'chip' + (g === x ? ' on' : '')} onClick={() => setG(x)}>{x}</button>)}</div>
      {shown.length === 0 && <Empty>没有符合的凭证</Empty>}
      {shown.map((c) => (
        <label key={c.id} className="pick-check" title={c.aiAllowed ? '' : '这个凭证设成了只有你本人能用'}>
          <input type="checkbox" checked={sel.includes(c.id)} disabled={!c.aiAllowed} onChange={() => toggle(c.id)} />
          <span className="grow"><b>{c.name}</b><span>{c.group} · {typeLabel(c.group, c.kind)}{!c.aiAllowed ? ' · 只有你能用' : ''}</span></span>
          <Tag tone={envTone(c.env)}>{c.env}</Tag>
        </label>
      ))}
      {g !== '全部' && (
        <label className="pick-check"><input type="checkbox" checked={auto.includes(g)} onChange={() => setAuto((x) => (x.includes(g) ? x.filter((y) => y !== g) : [...x, g]))} /><span className="grow"><b>以后新加的「{g}」凭证也自动给它</b></span></label>
      )}
    </Drawer>
  )
}
