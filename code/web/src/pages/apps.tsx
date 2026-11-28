// 应用（插件）：服务器 · 发布 · 凭证 · 数据 · 触发器 · 插件 · 操作记录
import { auditLabel } from '../auditLabels'
import { useState } from 'react'
import type { Channel, CredGroup, Credential, EnvTag, KbDoc, Trigger } from '../types'
import {
  addChannel, addKbDoc, addServer, audit, runFlow, toggleChannel, empName, requireVerify, saveCredential, saveQuery, saveTrigger, set, toast, toggleTrigger, togglePlugin, uid, useStore,
} from '../store'
import { Avatar } from '../components/Avatar'
import { Empty, Field, Meter, PageHeader, Row, Section, Segmented, Sheet, StatusDot, Table, Tag, Toggle } from '../components/ui'
import { IconCheck, IconPlus } from '../components/icons'
import { headNav, type PageProps } from './nav'
import { LIVE } from '../mode'
import { AppIcon } from '../components/AppIcon'

const envTone = (e: EnvTag) => (e === '生产' ? 'danger' : e === '测试' ? 'warn' : 'mute')
const ENVS: { value: EnvTag; label: string }[] = [{ value: '开发', label: '开发' }, { value: '测试', label: '测试' }, { value: '生产', label: '生产' }]

// ---------- 应用首页 ----------
/** 这套 Opero 的配置（不放在「我」里）：应用页下面一组、电脑侧栏「应用」下面一段 */
export const DEMO_CONFIG: { page: any; name: string; desc: string }[] = [
  { page: 'usage', name: '用量和成本', desc: '每个员工花了多少、每月预算' },
  { page: 'system', name: '系统设置', desc: '生产保护、每轮小结、AI 用不了时、提醒发到哪、开机向导' },
  { page: 'customize', name: '定制和二开', desc: '这套 Opero 是你的：改菜单、加插件、合并官方新版' },
  { page: 'about', name: '关于 Opero', desc: '版本、开源许可' },
]

export function AppsPage({ nav }: PageProps) {
  const s = useStore((x) => x)
  const tiles: { page: any; name: string; desc: string; n: string; letter: string }[] = [
    { page: 'servers', name: '服务器', desc: 'Agent、监控、日志、只读命令', n: `${s.servers.length} 台`, letter: '服' },
    { page: 'releases', name: '发布', desc: '应用、环境、发布记录、回滚', n: `${s.apps.length} 个应用`, letter: '发' },
    { page: 'credentials', name: '凭证', desc: '你在公司有的权限，带进来就有', n: `${s.credentials.length} 个账号`, letter: '权' },
    { page: 'channels', name: '消息渠道', desc: '邮件、Slack、Telegram… 交给消息助理', n: `${s.channels.filter((c) => c.inbound).length} 个在收`, letter: '信' },
    { page: 'knowledge', name: '知识库', desc: '所有员工共用的资料，按需查', n: `${s.kb.length} 份`, letter: '知' },
    { page: 'flows', name: '流程', desc: '做过的事存成步骤，下次不经过 AI', n: `${s.flows.length} 个`, letter: '流' },
    { page: 'data', name: '数据', desc: '查库、修数据（快照撤销）', n: `${s.dataSources.length} 个库`, letter: '数' },
    { page: 'triggers', name: '触发器', desc: '报警 / 定时 / Webhook → 员工', n: `${s.triggers.filter((t) => t.enabled).length} 个开着`, letter: '触' },
    { page: 'plugins', name: '插件', desc: '装上的能力，二开都做成插件', n: `${s.plugins.length} 个`, letter: '插' },
    { page: 'audit', name: '操作记录', desc: '员工做了什么，出事时翻、需要时撤销', n: `${s.audit.length} 条`, letter: '记' },
  ]
  return (
    <div className="page">
      <PageHeader title="应用" sub="插件提供的能力；员工用它们干活，你也可以直接看" {...headNav(nav)}
        right={<button className="btn default sm" onClick={() => nav.push({ page: 'customize' })}>定制和二开</button>} />
      <div className="page-body">
        <div className="tiles">
          {tiles.map((t) => (
            <button key={t.page} className="tile" onClick={() => nav.push({ page: t.page })}>
              <span className="tile-head"><AppIcon page={t.page} fallback={t.letter} /><b>{t.name}</b></span>
              <span className="sub">{t.desc}</span>
              <span className="tile-n">{t.n}</span>
            </button>
          ))}
        </div>
        <Section title="这套 Opero 的配置">{DEMO_CONFIG.map((a) => <Row key={a.page} icon={<AppIcon page={a.page} size={34} />} title={a.name} sub={a.desc} chevron onClick={() => nav.push({ page: a.page })} />)}</Section>
      </div>
    </div>
  )
}

// ---------- 服务器 ----------
export function ServersPage({ nav }: PageProps) {
  const list = useStore((s) => s.servers)
  return (
    <div className="page">
      <PageHeader title={LIVE ? '服务器' : '服务器和电脑'} sub={LIVE ? 'Opero 用你的 SSH 账号代员工去连；员工只看到结果' : 'Agent 主动连出，不开端口；你自己的电脑也能接'} {...headNav(nav)}
        right={<button className="btn primary sm" onClick={() => nav.push({ page: 'serverAdd' })}><IconPlus /> 接入</button>} />
      <div className="page-body">
        <Section flush>
          {list.map((s) => (
            <Row key={s.id} chevron onClick={() => nav.push({ page: 'server', params: { id: s.id } })}
              icon={<span className="ws-icon">{s.name.slice(0, 1)}</span>}
              title={<><StatusDot tone={s.online ? 'ok' : 'danger'} /> {s.name} <Tag tone={envTone(s.env)}>{s.env}</Tag></>}
              sub={LIVE ? `${s.online ? `CPU ${s.cpu}% · 内存 ${s.mem}% · 磁盘 ${s.disk}%` : '连不上'} · ${s.ip}` : `CPU ${s.cpu}% · 内存 ${s.mem}% · 磁盘 ${s.disk}% · Agent ${s.agent}`} />
          ))}
        </Section>
      </div>
    </div>
  )
}

export function ServerPage({ params, nav }: PageProps) {
  const s = useStore((x) => x.servers.find((v) => v.id === params.id))
  const [cmd, setCmd] = useState('df -h /')
  const [out, setOut] = useState<string | null>(null)
  if (!s) return <div className="page"><PageHeader title="服务器" {...headNav(nav)} /><Empty>找不到</Empty></div>
  const run = () => {
    if (/\b(rm|mv|chmod|chown|kill|reboot|systemctl\s+(restart|stop|start)|>)/.test(cmd)) {
      setOut('拒绝：这是写操作。只读命令才能在这里直接跑；要改服务器请跟「运维」说。')
      return
    }
    setOut('…')
    setTimeout(() => setOut(`$ ${cmd}\nFilesystem      Size  Used Avail Use% Mounted on\n/dev/root        97G   ${s.disk}G   ${100 - s.disk}G  ${s.disk}% /`), 500)
    audit({ via: '—', action: 'server.cmd', target: s.name, level: '读', result: '成功', how: '本人（只读命令）' })
  }
  return (
    <div className="page">
      <PageHeader title={s.name} sub={`${s.ip} · ${s.os}`} {...headNav(nav)} />
      <div className="page-body">
        <div className="pad meters">
          <Meter label="CPU" value={s.cpu} /><Meter label="内存" value={s.mem} /><Meter label="磁盘" value={s.disk} />
        </div>
        <Section title="基本">
          <Row title="状态" right={<><StatusDot tone={s.online ? 'ok' : 'danger'} /> {s.online ? '在线' : '离线'}</>} />
          <Row title="环境" right={<Tag tone={envTone(s.env)}>{s.env}</Tag>} />
          <Row title="Agent" right={`v${s.agent} · 自动升级`} />
          <Row title="策略" sub="只读命令直接跑，改东西先确认 · 资源上限 内存 70% CPU 90%" />
        </Section>
        <Section title="服务">
          {s.services.map((v) => (
            <Row key={v.name} title={v.name} right={<Tag tone={v.status === '运行中' ? 'ok' : v.status === '异常' ? 'danger' : 'mute'}>{v.status}</Tag>} />
          ))}
        </Section>
        <Section title="最近动态">
          {s.logs.map((l) => <Row key={l} title={<span className="mono small">{l}</span>} />)}
        </Section>
        <Section title="只读命令" right={<span className="sub">认不出的一律当写操作拒绝</span>}>
          <div className="pad">
            <div className="inline-form">
              <input className="mono" value={cmd} onChange={(e) => setCmd(e.target.value)} />
              <button className="btn primary" onClick={run}>运行</button>
            </div>
            {out && <pre className="console">{out}</pre>}
          </div>
        </Section>
        <div className="pad row-actions">
          <button className="btn default" onClick={() => nav.openChat('ops')}>让运维看看</button>
        </div>
      </div>
    </div>
  )
}

export function ServerAddPage({ nav }: PageProps) {
  const [name, setName] = useState('')
  const [env, setEnv] = useState<EnvTag>('测试')
  const [state, setState] = useState<'idle' | 'waiting' | 'done'>('idle')
  const [kind, setKind] = useState<'server' | 'mac' | 'win'>('server')
  const token = 'opr_' + 'x7k2m9q4'
  // 服务器和你自己的电脑用的是同一个 Agent：电脑上以你的用户跑（不要管理员权限），只主动连出
  const cmd = kind === 'win'
    ? `下载 https://opero.example.com/opero-agent-setup.exe 双击安装，按提示粘贴令牌 ${token}`
    : `curl -fsSL https://opero.example.com/agent.sh | bash -s -- ${token}${kind === 'mac' ? ' --desktop' : ''}`
  const wait = () => {
    setState('waiting')
    setTimeout(() => {
      setState('done')
      addServer({ id: uid('sv'), name: name || (kind === 'server' ? 'new-server' : '我的电脑'), ip: kind === 'server' ? '10.0.3.12' : '本机', env,
        os: kind === 'server' ? 'Ubuntu 24.04 · 2 核 4G' : kind === 'mac' ? 'macOS · 你的电脑' : 'Windows · 你的电脑', agent: '2.0.1', online: true, cpu: 3, mem: 18, disk: 12,
        services: [{ name: 'opero-agent', status: '运行中' }], logs: ['刚接入'] })
    }, 1600)
  }
  return (
    <div className="page">
      <PageHeader title="接入机器" {...headNav(nav)} />
      <div className="page-body form">
        <Field label="接什么" hint="你自己的电脑也用同一个 Agent：员工能在你电脑的项目目录里干活；只主动连出，不开端口">
          <Segmented value={kind} onChange={setKind} options={[{ value: 'server', label: '服务器' }, { value: 'mac', label: '我的电脑（Mac / Linux）' }, { value: 'win', label: '我的电脑（Windows）' }]} />
        </Field>
        <Field label="名字"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'server' ? '比如：AWS-test2' : '比如：我的 MacBook'} /></Field>
        <Field label="环境标签" hint="只用来做生产保护和提醒，不参与权限"><Segmented value={env} onChange={setEnv} options={ENVS} /></Field>
        <Field label={kind === 'server' ? '在那台服务器上用 root 运行（一次性令牌，10 分钟有效）' : '在你的电脑上用你自己的用户运行，不要管理员权限（一次性令牌，10 分钟有效）'}>
          <div className="cmd-box mono">{cmd}<button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(cmd).catch(() => {}); toast('已复制') }}>复制</button></div>
        </Field>
        {state === 'idle' && <button className="btn primary block" onClick={wait}>我已经运行了</button>}
        {state === 'waiting' && <div className="banner b-info"><i className="spinner" /> 等它连上来…</div>}
        {state === 'done' && (
          <>
            <div className="banner b-ok"><IconCheck size={14} /> 已连接：Ubuntu 24.04 · Agent 2.0.1，开发用户和工作区已建好</div>
            <button className="btn primary block" onClick={nav.back}>完成</button>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- 发布 ----------
const relTone = (s: string) => (s === '成功' ? 'ok' : s === '失败' ? 'danger' : s === '已回滚' ? 'warn' : 'info')
export function ReleasesPage({ params, nav }: PageProps) {
  const apps = useStore((s) => s.apps)
  const recs = useStore((s) => s.releases)
  const [tab, setTab] = useState<'records' | 'apps'>(params.tab === 'apps' ? 'apps' : 'records')
  const setAi = (appId: string, env: EnvTag, v: 'auto' | 'ask' | 'off') =>
    set((s) => ({ apps: s.apps.map((a) => (a.id !== appId ? a : { ...a, envs: a.envs.map((e) => (e.name === env ? { ...e, aiRelease: v } : e)) })) }))
  return (
    <div className="page">
      <PageHeader title="发布" {...headNav(nav)} />
      <div className="page-body">
        <div className="pad"><Segmented value={tab} onChange={setTab} options={[{ value: 'records', label: '发布记录' }, { value: 'apps', label: '应用和环境' }]} /></div>
        {tab === 'records' && (
          <Section flush>
            {recs.map((r) => (
              <Row key={r.id} chevron onClick={() => nav.push({ page: 'release', params: { id: r.id } })}
                title={<>{r.app} → {r.env} <span className="mono">{r.version}</span></>}
                sub={`#${r.id} · ${r.by} · ${r.when} · ${r.duration}`} right={<Tag tone={relTone(r.status)}>{r.status}</Tag>} />
            ))}
          </Section>
        )}
        {tab === 'apps' && apps.map((a) => (
          <Section key={a.id} title={a.name}>
            {a.components.map((c) => <Row key={c.code} title={`${c.name}（${c.code}）`} sub={c.kind} right={<span className="mono">{c.version}</span>} />)}
            {a.envs.map((e) => (
              <div key={e.name} className="lrow col">
                <div className="row-main">
                  <span className="row-title">{e.name} <Tag tone={envTone(e.name)}>{e.server}</Tag></span>
                  <span className="row-sub mono">{e.dir}</span>
                </div>
                <div className="env-ai">
                  <span className="sub">AI 发版</span>
                  <Segmented value={e.aiRelease} onChange={(v) => setAi(a.id, e.name, v)}
                    options={[{ value: 'auto', label: '直接发' }, { value: 'ask', label: '每次问我' }, { value: 'off', label: '不许' }]} />
                </div>
              </div>
            ))}
          </Section>
        ))}
      </div>
    </div>
  )
}

export function ReleasePage({ params, nav }: PageProps) {
  const r = useStore((s) => s.releases.find((x) => x.id === Number(params.id)))
  if (!r) return <div className="page"><PageHeader title="发布" {...headNav(nav)} /><Empty>找不到</Empty></div>
  const rollback = () => {
    const go = () => { toast(`已开始回滚 ${r.app} · ${r.env}`); audit({ via: '—', action: 'release.rollback', target: `${r.app} · ${r.env}`, level: '写', result: '成功', how: '本人' }) }
    if (r.env === '生产') requireVerify(`回滚 ${r.app} 生产`, go, '回到上一版')
    else go()
  }
  return (
    <div className="page">
      <PageHeader title={`#${r.id} ${r.app} → ${r.env}`} sub={`${r.version} · ${r.when}`} {...headNav(nav)} />
      <div className="page-body">
        <div className="pad"><Tag tone={relTone(r.status)}>{r.status}</Tag> <span className="sub">{r.by} 发的 · 用时 {r.duration}</span></div>
        <Section title="步骤">
          {r.steps.map((s) => (
            <Row key={s.name} icon={s.ok ? <IconCheck size={18} /> : <span className="x-icon">×</span>} title={s.name} sub={s.note} />
          ))}
        </Section>
        <div className="pad row-actions wrap">
          {r.status === '失败' && <button className="btn primary" onClick={() => toast('已把失败原因交给「发布」，它会修好再发')}>交给员工修</button>}
          <button className="btn default" onClick={() => toast('已重新发布（原型）')}>重发</button>
          {r.status === '成功' && <button className="btn default" onClick={rollback}>回滚</button>}
          <button className="btn ghost" onClick={() => nav.openChat('release')}>问「发布」</button>
        </div>
      </div>
    </div>
  )
}

// ---------- 凭证：你在公司有什么权限就带进来，没有的这里也没有 ----------
const GROUPS: CredGroup[] = ['服务器', '数据库', '代码仓库', '云账号', 'AI', '消息渠道', '其它']
const GROUP_HINT: Record<CredGroup, string> = {
  服务器: '装 Agent 时生成的令牌；员工在这台机器上能做的 = 你在这台机器上能做的',
  数据库: '你的数据库账号；只读账号就只能查，读写账号改数据也会先存快照',
  代码仓库: '你的 Codeup / GitHub 令牌；你能看哪些仓库，员工就能看哪些',
  云账号: '你的云子账号（AccessKey）；按它的策略来',
  签名证书: '安卓签名（keystore）、苹果证书（.p12）、App Store Connect API Key（.p8）、Windows 代码签名（.pfx）：密码员工拿不到',
  AI: '模型的 API Key；按量计费',
  消息渠道: '邮箱、Slack、Telegram 的账号；消息助理用它收消息、起草回复（发之前要你点）',
  其它: '签名证书、第三方密钥……',
}
export function CredentialsPage({ nav }: PageProps) {
  const list = useStore((s) => s.credentials)
  return (
    <div className="page">
      <PageHeader title="凭证" sub={`${list.length} 个账号`} {...headNav(nav)}
        right={<button className="btn primary sm" onClick={() => nav.push({ page: 'credentialEdit' })}><IconPlus /> 新增凭证</button>} />
      <div className="page-body">
        <div className="pad"><div className="banner b-info">你在公司有什么权限就带进来，员工就能用；没有的这里也没有。AI 只拿编号，拿不到明文。</div></div>
        {GROUPS.map((g) => {
          const items = list.filter((c) => c.group === g)
          if (!items.length) return null
          return (
            <Section key={g} title={g} right={<span className="sub">{GROUP_HINT[g]}</span>}>
              {items.map((c) => (
                <Row key={c.id} chevron onClick={() => nav.push({ page: 'credentialEdit', params: { id: c.id } })}
                  title={<>{c.name} <Tag tone={envTone(c.env)}>{c.env}</Tag> {!c.aiAllowed && <Tag>只有你能用</Tag>}</>}
                  sub={`能做：${c.scope} · 用在：${(c.usedBy ?? []).map((u) => empName(u)).join('、') || '还没员工用'}`} />
              ))}
            </Section>
          )
        })}
      </div>
    </div>
  )
}

const KINDS: Credential['kind'][] = ['账号密码', '密钥', 'Token', '证书', '数据库']
export function CredentialEditPage({ params, nav }: PageProps) {
  const existing = useStore((s) => s.credentials.find((x) => x.id === params.id))
  const employees = useStore((s) => s.employees)
  const [c, setC] = useState<Credential>(() => existing ?? { id: '', name: '', group: '服务器', kind: 'Token', env: '生产', scope: '', usedBy: [], updated: '刚刚', aiAllowed: true })
  const [secret, setSecret] = useState('')
  const [shown, setShown] = useState(false)
  const save = () => {
    if (!c.name.trim()) { toast('先起个名字'); return }
    requireVerify(existing ? `修改「${c.name}」` : `带进来「${c.name}」`, () => {
      saveCredential({ ...c, id: c.id || uid('cr'), updated: '刚刚' })
      nav.back()
    })
  }
  const toggleUser = (id: string) => setC({ ...c, usedBy: (c.usedBy ?? []).includes(id) ? (c.usedBy ?? []).filter((x) => x !== id) : [...(c.usedBy ?? []), id] })
  return (
    <div className="page">
      <PageHeader title={existing ? existing.name : '新增凭证'} {...headNav(nav)} right={<button className="btn primary sm" onClick={save}>保存</button>} />
      <div className="page-body form">
        <Field label="是什么"><Segmented value={c.group} onChange={(v) => setC({ ...c, group: v })} options={GROUPS.map((g) => ({ value: g, label: g }))} /></Field>
        <p className="field-hint">{GROUP_HINT[c.group]}</p>
        <Field label="名字"><input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="比如：shop-prod 只读账号" /></Field>
        <Field label="它在公司那边能做什么" hint="照实写（只读 / 读写 / 能部署…）；员工能做的不会超过这个账号本身的权限">
          <input value={c.scope} onChange={(e) => setC({ ...c, scope: e.target.value })} placeholder="比如：只读" />
        </Field>
        <Field label="类型"><Segmented value={c.kind} onChange={(v) => setC({ ...c, kind: v })} options={KINDS.map((k) => ({ value: k, label: k }))} /></Field>
        <Field label="环境"><Segmented value={c.env} onChange={(v) => setC({ ...c, env: v })} options={ENVS} /></Field>
        <Field label={existing ? '新的值（留空 = 不改）' : '值'} hint="直接加密存起来；员工用的时候由后台或 Agent 替换，AI 只看到编号">
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
        </Field>
        <div className="field">
          <span className="field-label">哪些员工用它</span>
          <div className="chips">
            {employees.map((e) => (
              <button key={e.id} className={'chip' + ((c.usedBy ?? []).includes(e.id) ? ' on' : '')} onClick={() => toggleUser(e.id)}>{e.name}</button>
            ))}
          </div>
        </div>
        <div className="lrow boxed">
          <span className="row-main"><span className="row-title">允许 AI 员工使用</span><span className="row-sub">关掉后只有你本人能用（比如生产签名、支付密钥）</span></span>
          <Toggle on={c.aiAllowed} onChange={(v) => setC({ ...c, aiAllowed: v })} />
        </div>
        {existing && (
          <Section title="明文">
            <Row title={shown ? <span className="mono">sk-live-••••-a91f（演示）</span> : '••••••••••••'}
              right={<button className="btn default sm" onClick={() => (shown ? setShown(false) : requireVerify(`看「${c.name}」的明文`, () => {
                setShown(true)
                audit({ via: '—', action: 'credential.reveal', target: c.name, level: '危险', result: '成功', how: '本人 + 指纹' })
              }, '看明文是危险操作，会记进操作记录'))}>{shown ? '隐藏' : '查看'}</button>} />
          </Section>
        )}
      </div>
    </div>
  )
}

// ---------- 数据 ----------
export function DataPage({ nav }: PageProps) {
  const sources = useStore((s) => s.dataSources)
  const queries = useStore((s) => s.savedQueries)
  return (
    <div className="page">
      <PageHeader title="数据" sub="查库默认只读账号；改数据先存快照、可撤销" {...headNav(nav)} />
      <div className="page-body">
        <Section title="数据库">
          {sources.map((d) => (
            <Row key={d.id} chevron onClick={() => nav.push({ page: 'query', params: { source: d.id } })}
              icon={<span className="ws-icon">{d.kind === 'MySQL' ? 'M' : 'P'}</span>}
              title={<>{d.name} <Tag tone={envTone(d.env)}>{d.env}</Tag> {!d.writable && <Tag>只读</Tag>}</>}
              sub={`${d.kind} · ${d.db} · ${d.tables.length} 张表`} />
          ))}
        </Section>
        <Section title="常用查询（存成的菜单）">
          {queries.map((q) => (
            <Row key={q.id} title={q.name} sub={<span className="mono small">{q.sql}</span>} chevron
              onClick={() => nav.push({ page: 'query', params: { source: q.source, sql: q.sql } })} />
          ))}
        </Section>
      </div>
    </div>
  )
}

const FAKE_ROWS = [['98213', '10086', 'failed', 'SIGN_ERR', '09:41'], ['98207', '10086', 'failed', 'SIGN_ERR', '09:40'], ['98190', '20311', 'paid', '', '09:12'], ['98172', '10086', 'paid', '', '08:57']]
export function QueryPage({ params, nav }: PageProps) {
  const d = useStore((s) => s.dataSources.find((x) => x.id === params.source))
  const queries = useStore((s) => s.savedQueries)
  const [sql, setSql] = useState<string>(params.sql ?? 'SELECT id, user_id, status, err_code, created_at FROM pay_order ORDER BY id DESC LIMIT 20')
  const [res, setRes] = useState<{ cols: string[]; rows: string[][]; ms: number; note?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [table, setTable] = useState<string | null>(null)
  if (!d) return <div className="page"><PageHeader title="数据" {...headNav(nav)} /><Empty>找不到这个库</Empty></div>
  const write = /^\s*(update|delete|insert|alter|drop|truncate)\b/i.test(sql)
  const run = () => {
    if (write && !d.writable) { setRes({ cols: [], rows: [], ms: 0, note: '这个库只配了只读账号，不能改数据。' }); return }
    const doRun = () => {
      setBusy(true)
      setTimeout(() => {
        setBusy(false)
        if (write) {
          setRes({ cols: [], rows: [], ms: 31, note: '改了 2 行 · 已存改前快照，7 天内可撤销' })
          audit({ via: '—', action: 'db.exec', target: d.name, level: '写', result: '成功', how: '本人 · 已存快照' })
        } else {
          setRes({ cols: ['id', 'user_id', 'status', 'err_code', 'created_at'], rows: FAKE_ROWS, ms: 23 })
          audit({ via: '—', action: 'db.query', target: d.name, level: '读', result: '成功', how: '本人（只读）' })
        }
      }, 450)
    }
    if (write && /delete/i.test(sql) && !/where/i.test(sql)) requireVerify('没有 WHERE 的 DELETE', doRun, '会删整张表，属于危险操作')
    else doRun()
  }
  return (
    <div className="page">
      <PageHeader title={d.name} sub={`${d.kind} · ${d.db} · ${d.env}`} {...headNav(nav)} />
      <div className="page-body">
        <Section title="库表结构">
          <div className="pad chips">
            {d.tables.length === 0 && <span className="sub">还没有表</span>}
            {d.tables.map((t) => (
              <button key={t.name} className={'chip' + (table === t.name ? ' on' : '')} onClick={() => setTable(table === t.name ? null : t.name)}>
                {t.name} <span className="sub">{t.rows}</span>
              </button>
            ))}
          </div>
          {table && <div className="pad mono small">{d.tables.find((t) => t.name === table)?.cols.join(' · ')}</div>}
        </Section>
        <Section title="SQL" right={write ? <Tag tone="warn">写操作：先存快照</Tag> : <Tag>只读</Tag>}>
          <div className="pad">
            <textarea className="mono code-edit" rows={4} value={sql} onChange={(e) => setSql(e.target.value)} />
            <div className="chips">
              {queries.filter((q) => q.source === d.id).map((q) => <button key={q.id} className="chip" onClick={() => setSql(q.sql)}>{q.name}</button>)}
            </div>
            <div className="row-actions">
              <button className="btn ghost" onClick={() => saveQuery({ id: uid('q'), source: d.id, name: sql.slice(0, 18) + '…', sql })}>存成菜单</button>
              <button className="btn primary" onClick={run} disabled={busy}>{busy ? '运行中…' : '运行'}</button>
            </div>
          </div>
        </Section>
        {res && (
          <Section title={res.note ? '结果' : `结果 · ${res.rows.length} 行 · ${res.ms} ms`} right={!res.note && <button className="btn ghost sm" onClick={() => toast('已导出 CSV（原型）')}>导出</button>}>
            {res.note ? <div className="pad"><div className={'banner ' + (res.ms ? 'b-ok' : 'b-warn')}>{res.note}</div></div>
              : <div className="pad"><Table cols={res.cols} rows={res.rows} bad={(v) => typeof v === 'string' && /failed|ERR/.test(v)} /></div>}
          </Section>
        )}
        <p className="hint">敏感列（手机号、身份证、密钥）自动打码；15 秒超时、最多 200 行。</p>
      </div>
    </div>
  )
}

// ---------- 触发器 ----------
const TKIND: Trigger['kind'][] = ['监控', '定时', 'Webhook', '邮件']
export function TriggersPage({ nav }: PageProps) {
  const list = useStore((s) => s.triggers)
  return (
    <div className="page">
      <PageHeader title="触发器" sub="事情来了员工自己动，不用你叫" {...headNav(nav)}
        right={<button className="btn primary sm" onClick={() => nav.push({ page: 'triggerEdit' })}><IconPlus /> 新增</button>} />
      <div className="page-body">
        <Section flush>
          {list.map((t) => (
            <Row key={t.id} icon={<Avatar id={t.employee} size={36} />} onClick={() => nav.push({ page: 'triggerEdit', params: { id: t.id } })}
              title={<>{t.name} <Tag tone="primary">{t.kind}</Tag></>} sub={`${t.rule} · 交给 ${empName(t.employee)} · ${t.last}`}
              right={<Toggle on={t.enabled} onChange={() => toggleTrigger(t.id)} label="启用" />} />
          ))}
        </Section>
        <p className="hint">触发出来的活，员工做完只在需要你知道时才发到会话里。</p>
      </div>
    </div>
  )
}

export function TriggerEditPage({ params, nav }: PageProps) {
  const existing = useStore((s) => s.triggers.find((x) => x.id === params.id))
  const employees = useStore((s) => s.employees)
  const [t, setT] = useState<Trigger>(() => existing ?? { id: '', name: '', kind: '定时', rule: '', employee: params.employee ?? employees[0]?.id ?? '', enabled: true, last: '还没触发' })
  const ph: Record<Trigger['kind'], string> = { 定时: '每天 09:00 / 每周一 10:00', Webhook: '保存后生成地址和密钥', 监控: '比如：dev-1 内存 > 90% 持续 5 分钟', 邮件: '收件地址 ops@… 里标题含「告警」的' }
  const save = () => {
    if (!t.name.trim()) { toast('先起个名字'); return }
    saveTrigger({ ...t, id: t.id || uid('t') })
    nav.back()
  }
  return (
    <div className="page">
      <PageHeader title={existing ? existing.name : '新触发器'} {...headNav(nav)} right={<button className="btn primary sm" onClick={save}>保存</button>} />
      <div className="page-body form">
        <Field label="名字"><input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="比如：每天 9 点巡检" /></Field>
        <Field label="什么时候"><Segmented value={t.kind} onChange={(v) => setT({ ...t, kind: v })} options={TKIND.map((k) => ({ value: k, label: k }))} /></Field>
        <Field label="规则"><input value={t.rule} onChange={(e) => setT({ ...t, rule: e.target.value })} placeholder={ph[t.kind]} /></Field>
        <Field label="交给哪个员工">
          <select value={t.employee} onChange={(e) => setT({ ...t, employee: e.target.value })}>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <div className="lrow">
          <span className="row-main"><span className="row-title">启用</span></span>
          <Toggle on={t.enabled} onChange={(v) => setT({ ...t, enabled: v })} />
        </div>
      </div>
    </div>
  )
}

// ---------- 插件 ----------
export function PluginsPage({ nav }: PageProps) {
  const list = useStore((s) => s.plugins)
  return (
    <div className="page">
      <PageHeader title="插件" sub="二开都做成插件：坏了停掉就行，内核照常跑" {...headNav(nav)} />
      <div className="page-body">
        <div className="pad"><div className="banner b-info">这套 Opero 是你的：按自己的习惯加插件，官方升级不冲突。<button className="btn ghost sm" onClick={() => nav.push({ page: 'customize' })}>定制和二开 ›</button></div></div>
        <Section flush>
          {list.map((p) => (
            <Row key={p.id} icon={<span className="ws-icon">{p.name.slice(0, 1)}</span>}
              title={<>{p.name} {p.builtin ? <Tag>自带</Tag> : <Tag tone="primary">自己做的</Tag>}</>}
              sub={`${p.desc} · ${p.tools} 个工具 · v${p.version}`}
              right={<Toggle on={p.enabled} onChange={() => { togglePlugin(p.id); toast(p.enabled ? `已停用「${p.name}」` : `已启用「${p.name}」`) }} label="启用" />} />
          ))}
        </Section>
        <div className="pad row-actions">
          <button className="btn default" onClick={() => nav.openChat('dev-opero')}>想要新功能？跟「后台开发」说</button>
        </div>
      </div>
    </div>
  )
}

// ---------- 操作记录（原「审计」：单用户下主要用来看员工做了什么、需要时撤销） ----------
type AF = 'all' | 'write' | 'danger' | 'denied'
export function AuditPage({ nav }: PageProps) {
  const list = useStore((s) => s.audit)
  const [f, setF] = useState<AF>('all')
  const shown = list.filter((a) => (f === 'all' ? true : f === 'write' ? a.level !== '读' : f === 'danger' ? a.level === '危险' : a.result === '拒绝'))
  return (
    <div className="page">
      <PageHeader title="操作记录" sub="员工做的每一件事都记一条；只能追加，不能改、不能删" {...headNav(nav)} />
      <div className="page-body">
        <div className="pad"><Segmented value={f} onChange={setF} options={[{ value: 'all', label: '全部' }, { value: 'write', label: '写' }, { value: 'danger', label: '危险' }, { value: 'denied', label: '被拒' }]} /></div>
        <Section flush>
          {shown.length === 0 && <Empty>没有</Empty>}
          {shown.map((a) => (
            <Row key={a.id} title={<>{auditLabel(a.action) ? <b className="audit-act">{auditLabel(a.action)}</b> : <span className="audit-code mono">{a.action}</span>}<span className="audit-target">{a.target}</span></>}
              sub={`${a.who}${a.via !== '—' ? ' 通过「' + a.via + '」' : ''} · ${a.how}`}
              right={<span className="audit-right"><span className="sub">{a.when}</span><Tag tone={a.result === '成功' ? (a.level === '危险' ? 'danger' : a.level === '写' ? 'warn' : 'mute') : 'danger'}>{a.result === '成功' ? a.level : a.result}</Tag></span>} />
          ))}
        </Section>
      </div>
    </div>
  )
}

// ---------- 消息渠道：所有外部消息交给「消息助理」；Opero 的通知也能发过去 ----------
const CH_KINDS: Channel['kind'][] = ['邮件', 'Slack', 'Telegram', '飞书', '企业微信', '钉钉']
export function ChannelsPage({ nav }: PageProps) {
  const list = useStore((s) => s.channels)
  const [adding, setAdding] = useState(false)
  return (
    <div className="page">
      <PageHeader title="消息渠道" sub="都交给「消息助理」：只查、只整理，你一键过去自己回" {...headNav(nav)}
        right={<button className="btn primary sm" onClick={() => setAdding(true)}><IconPlus /> 接入</button>} />
      <div className="page-body">
        <Section flush>
          {list.map((c) => (
            <div key={c.id} className="lrow col">
              <div className="ch-top">
                <span className="ws-icon">{c.kind.slice(0, 1)}</span>
                <span className="row-main">
                  <span className="row-title">{c.kind} {c.status === '已连接' ? <Tag tone="ok">已连接</Tag> : <Tag tone="warn">{c.status}</Tag>}</span>
                  <span className="row-sub">{c.account}{c.inbound ? ` · 今天 ${c.today} 条` : ''}</span>
                </span>
              </div>
              <div className="ch-switches">
                <label className="ch-switch"><span>收进来给消息助理</span><Toggle on={c.inbound} onChange={() => toggleChannel(c.id, 'inbound')} /></label>
                <label className="ch-switch"><span>Opero 的通知也发这里</span><Toggle on={c.notifyMe} onChange={() => toggleChannel(c.id, 'notifyMe')} /></label>
                <label className="ch-switch"><span>允许代你发（默认关）</span><Toggle on={c.allowSend} onChange={() => (c.allowSend
                  ? toggleChannel(c.id, 'allowSend')
                  : requireVerify(`允许消息助理用你的 ${c.kind} 代发`, () => toggleChannel(c.id, 'allowSend'), 'AI 会弄错、会回到不关你的事；商业场景建议一直关着'))} /></label>
              </div>
            </div>
          ))}
        </Section>
        <div className="pad row-actions">
          <button className="btn default" onClick={() => nav.openChat('inbox')}>去找消息助理</button>
        </div>
        <p className="hint">默认只读：消息助理查、整理、告诉你为什么要看，每条都能一键到原处自己回；要回复建议时点「给我个回复建议」（能选语言），复制过去自己发。账号、令牌在「凭证 → 消息渠道」，用的是你自己的账号。</p>
      </div>
      {adding && (
        <Sheet title="接入一个渠道" onClose={() => setAdding(false)}>
          <div className="attach-grid">
            {CH_KINDS.map((k) => (
              <button key={k} onClick={() => {
                setAdding(false)
                addChannel({ id: uid('ch'), kind: k, account: k === '邮件' ? '新邮箱（IMAP / SMTP）' : `${k} · 你的账号`, inbound: true, notifyMe: false, allowSend: false, status: '已连接', today: 0 })
              }}><span className="ws-icon">{k.slice(0, 1)}</span>{k}</button>
            ))}
          </div>
          <p className="field-hint">原型里点了就算接上；正式版会走各家的登录 / 授权，令牌存进「凭证」。</p>
        </Sheet>
      )}
    </div>
  )
}

const INBOX: { group: string; items: { from: string; ch: string; text: string; when: string }[] }[] = [
  { group: '要你看 · 3', items: [
    { from: '张总', ch: '邮件', text: '明天的评审能改到下午 3 点吗？', when: '09:12' },
    { from: '阿浩', ch: 'Slack #shop-dev', text: 'v1.4.2 上生产了吗？', when: '09:20' },
    { from: '客户 Lily', ch: 'Telegram', text: '导出 10 月订单时页面报 403', when: '09:25' },
  ] },
  { group: '知道就行 · 9', items: [
    { from: 'CI', ch: '邮件', text: 'shop-admin 构建成功 #1835', when: '08:50' },
    { from: '晓雨', ch: 'Slack #ops', text: '周五晚上 RDS 维护 30 分钟', when: '08:41' },
    { from: '日历', ch: '邮件', text: '周会改到周四 10:00', when: '08:10' },
  ] },
  { group: '归档了 · 19', items: [
    { from: 'AWS', ch: '邮件', text: '本月账单已出', when: '07:00' },
    { from: 'Newsletter', ch: '邮件', text: 'This week in AI…', when: '06:30' },
  ] },
]
export function InboxPage({ nav }: PageProps) {
  return (
    <div className="page">
      <PageHeader title="收件箱" sub="消息助理分好类的，所有渠道放一起" {...headNav(nav)} />
      <div className="page-body">
        {INBOX.map((g) => (
          <Section key={g.group} title={g.group}>
            {g.items.map((m) => <Row key={m.from + m.when} title={<>{m.from} <Tag>{m.ch}</Tag></>} sub={`${m.text} · ${m.when}`}
              right={<button className="btn ghost sm" onClick={() => toast(`原型：正式版直接跳到 ${m.ch} 里的这条消息`)}>去回复</button>} />)}
          </Section>
        ))}
        <div className="pad row-actions"><button className="btn default" onClick={() => nav.push({ page: 'channels' })}>消息渠道</button></div>
      </div>
    </div>
  )
}

// ---------- 知识库：所有员工共用的资料（git 仓库 opero-kb） ----------
const KB_KINDS: KbDoc['kind'][] = ['产品说明', '接口文档', '客户信息', '规范', '其它']
export function KnowledgePage({ nav }: PageProps) {
  const docs = useStore((s) => s.kb)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<KbDoc['kind']>('产品说明')
  const shown = docs.filter((d) => !q.trim() || (d.name + d.summary).includes(q.trim()))
  return (
    <div className="page">
      <PageHeader title="知识库" sub="通用规范、接口文档、资料：存在 Opero 里，员工通过 MCP 按需查" {...headNav(nav)}
        right={<button className="btn primary sm" onClick={() => setAdding(true)}><IconPlus /> 加资料</button>} />
      <div className="page-body">
        <div className="pad"><input className="kb-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜资料…" /></div>
        {KB_KINDS.map((k) => {
          const items = shown.filter((d) => d.kind === k)
          if (!items.length) return null
          return (
            <Section key={k} title={k}>
              {items.map((d) => <Row key={d.id} title={d.name} sub={`${d.summary} · ${d.by} · ${d.updated}`} chevron onClick={() => toast('原型：正式版在面板里打开这份资料（Markdown）')} />)}
            </Section>
          )
        })}
        <p className="hint">员工不会每次全读，而是用 MCP 工具 kb.search / kb.get 只查用得到的那段，省上下文；你改一次，所有员工马上用上。每次修改都存一个版本，能退回；也能导出成 git 分享给同事。必读的短规矩在「我的习惯」，每次派活自动带上；员工自己的交接还在它的记忆仓库里。</p>
      </div>
      {adding && (
        <Sheet title="加一份资料" onClose={() => setAdding(false)}>
          <div className="form">
            <Field label="名字"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="比如：退款流程说明" /></Field>
            <Field label="类型"><Segmented value={kind} onChange={setKind} options={KB_KINDS.map((k) => ({ value: k, label: k }))} /></Field>
            <p className="field-hint">可以粘贴文字、传文件，或者跟员工说「把 xx 整理进知识库」。</p>
            <button className="btn primary block" onClick={() => { if (!name.trim()) { toast('先起个名字'); return } addKbDoc({ id: uid('kb'), name: name.trim(), kind, updated: '刚刚', by: '主人', summary: '刚加的' }); setAdding(false); setName('') }}>加进去</button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

// ---------- 流程：做过的事存成步骤，下次直接跑，不经过 AI ----------
export function FlowsPage({ nav }: PageProps) {
  const flows = useStore((s) => s.flows)
  return (
    <div className="page">
      <PageHeader title="流程" sub="做过的事存成固定步骤：快、省钱、结果一样" {...headNav(nav)} />
      <div className="page-body">
        <Section flush>
          {flows.map((f) => (
            <div key={f.id} className="lrow col">
              <div className="ch-top">
                <Avatar id={f.employee} size={36} />
                <span className="row-main">
                  <span className="row-title">{f.name}</span>
                  <span className="row-sub">{empName(f.employee)} · 跑过 {f.runs} 次 · 上次 {f.last}</span>
                </span>
                <button className="btn primary sm" onClick={() => runFlow(f.id)}>跑一次</button>
              </div>
              <ol className="flow-steps">{f.steps.map((x) => <li key={x}>{x}</li>)}</ol>
            </div>
          ))}
        </Section>
        <p className="hint">怎么来的：员工做完一件事，在聊天「···」里点「把刚才做的存成流程」；流程存在员工的记忆仓库 flows/ 里，换 work 也在。可以挂到触发器上定时跑。</p>
      </div>
    </div>
  )
}
