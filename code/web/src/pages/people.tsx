// 员工：列表 · 档案 · 新建 / 编辑 · 记忆
import { useState } from 'react'
import type { Employee } from '../types'
import { memoryFiles } from '../data/mock'
import { MENU_REGISTRY } from '../menus'
import { employeeFromTemplate, runFlow, saveEmployee, set, setLook, switchWork, sessionFor, togglePin, toast, useStore } from '../store'
import { LIVE } from '../mode'
import type { ChatBg, Notify } from '../types'
import { Avatar } from '../components/Avatar'
import { editImage, fileToDataUrl } from '../components/ImageEditor'
import { Empty, Field, PageHeader, Row, Section, Segmented, Sheet, Stat, Tag, Toggle } from '../components/ui'
import { WorkSheet } from '../components/WorkSheet'
import { APPROVALS, EFFORTS, approvalLabel, effortLabel, modelsFor } from '../work'
import { IconPlus } from '../components/icons'
import { headNav, type PageProps } from './nav'

export function EmployeesPage({ nav }: PageProps) {
  const employees = useStore((s) => s.employees)
  const sessions = useStore((s) => s.sessions)
  const [tpl, setTpl] = useState(false)
  const [url, setUrl] = useState('')
  return (
    <div className="page">
      <PageHeader title="员工" sub={`${employees.length} 个 AI 员工`} {...headNav(nav)}
        right={<>
          {!LIVE && <button className="btn default sm" onClick={() => setTpl(true)}>从模板建</button>}
          <button className="btn primary sm" onClick={() => nav.push({ page: 'employeeEdit' })}><IconPlus /> 新员工</button>
        </>} />
      {tpl && (
        <Sheet title="从模板建员工" onClose={() => setTpl(false)}>
          <p className="sub">模板 = 员工记忆仓库里的角色、规矩、设置；不带它的聊天记录和你的账号。</p>
          <div className="sheet-list">
            {['mov 日志值班', '发布', '运维', '消息助理', 'mov 开发'].map((n) => (
              <Row key={n} title={n} sub="内置模板" onClick={() => { setTpl(false); employeeFromTemplate(n, '内置') }} />
            ))}
          </div>
          <Field label="或者用同事分享的模板（git 地址）">
            <div className="inline-form">
              <input value={url} onChange={(v) => setUrl(v.target.value)} placeholder="https://codeup.aliyun.com/xxx/emp-template-review.git" />
              <button className="btn primary" onClick={() => { if (!url.trim()) { toast('先填地址'); return } setTpl(false); employeeFromTemplate('mov 开发', url.trim()) }}>导入</button>
            </div>
          </Field>
        </Sheet>
      )}
      <div className="page-body">
        <Section flush>
          {employees.map((e) => {
            const working = sessions.find((s) => s.employee === e.id)?.working
            return (
              <Row key={e.id} icon={<Avatar id={e.id} size={44} />} chevron onClick={() => nav.push({ page: 'employee', params: { id: e.id } })}
                title={e.name}
                sub={working ? <span className="ok">● {working}</span> : `${e.title} · ${e.executor} · ${e.host}`} />
            )
          })}
        </Section>
        <p className="hint">也可以跟「系统管家」说一句：「建一个 XX 员工，负责 …」。</p>
      </div>
    </div>
  )
}

export function EmployeePage({ params, nav }: PageProps) {
  const e = useStore((s) => s.employees.find((x) => x.id === params.id))
  const [work, setWork] = useState(false)
  const [move, setMove] = useState(false)
  const servers = useStore((s) => s.servers)
  const triggers = useStore((s) => s.triggers)
  const usage = useStore((s) => s.usage)
  const creds = useStore((s) => s.credentials)
  const flows = useStore((s) => s.flows)
  if (!e) return <div className="page"><PageHeader title="员工" {...headNav(nav)} /><Empty>找不到这个员工</Empty></div>
  const u = usage.find((x) => x.employee === e.id)
  const myTriggers = triggers.filter((t) => t.employee === e.id)
  const myFlows = flows.filter((f) => f.employee === e.id)
  const myCreds = creds.filter((c) => c.usedBy.includes(e.id) || c.usedBy.includes('全部员工'))
  return (
    <div className="page">
      <PageHeader title={e.name} sub="员工档案" {...headNav(nav)}
        right={<button className="btn default sm" onClick={() => nav.push({ page: 'employeeEdit', params: { id: e.id } })}>编辑</button>} />
      <div className="page-body">
        <div className="hero">
          <Avatar id={e.id} size={64} />
          <div className="hero-main">
            <b>{e.name}</b>
            <span className="sub">{e.title}</span>
          </div>
          <button className="btn primary" onClick={() => nav.openChat(e.id)}>发消息</button>
        </div>

        {u && (
          <div className="stats">
            <Stat label="本月任务" value={u.tasks} />
            <Stat label="成功率" value={`${Math.round((u.success / u.tasks) * 100)}%`} />
            <Stat label="本月花费" value={`¥${u.cost.toFixed(0)}`} sub={u.tokens + ' token'} />
          </div>
        )}

        <Section title="work" right={<span className="sub">选了就记住，下次派活也用它</span>}>
          <Row title="模型" right={e.model} chevron onClick={() => setWork(true)} />
          <Row title="思考方式" right={effortLabel(e.effort)} chevron onClick={() => setWork(true)} />
          <Row title="审核方式" right={approvalLabel(e.approval)} chevron onClick={() => setWork(true)} />
          <Row title="上下文" right={`${e.contextUsed ?? 0}%`} />
        </Section>

        <Section title="基本">
          <Row title="执行器" right={e.executor} />
          <Row title="跑在" right={e.host} />
          <Row title="工作空间" right={e.workspace} />
          {e.persona && <Row title="人设" right={e.persona} />}
        </Section>

        <Section title="职责（提示词）">
          <p className="prose">{e.prompt}</p>
        </Section>

        <Section title="底部菜单">
          <div className="chips pad">{e.menus.map((m) => <span key={m} className="chip">{m}</span>)}</div>
        </Section>

        <Section title={`常用流程 · ${myFlows.length}`} right={<span className="sub">点一下就跑，不经过 AI</span>}>
          {myFlows.length === 0 && <Empty>还没有：它做完一件事，在聊天「···」里点「把刚才做的存成流程」</Empty>}
          {myFlows.map((f) => (
            <Row key={f.id} title={f.name} sub={`${f.steps.length} 步 · 跑过 ${f.runs} 次 · 上次 ${f.last}`}
              right={<button className="btn default sm" onClick={() => runFlow(f.id)}>跑一次</button>} />
          ))}
        </Section>

        <Section title={`用到的权限 · ${myCreds.length}`} right={<span className="sub">都是你带进来的账号，员工不会比你权限大</span>}>
          {myCreds.length === 0 && <Empty>还没有：要它碰服务器 / 库 / 仓库，先在「权限和凭证」里带进来</Empty>}
          {myCreds.map((c) => (
            <Row key={c.id} title={c.name} sub={`${c.group} · 能做：${c.scope}`} chevron onClick={() => nav.push({ page: 'credentialEdit', params: { id: c.id } })} />
          ))}
        </Section>

        <Section title={`触发器 · ${myTriggers.length}`} right={<button className="btn ghost sm" onClick={() => nav.push({ page: 'triggerEdit', params: { employee: e.id } })}>添加</button>}>
          {myTriggers.length === 0 && <Empty>没有触发器：只有你叫它才干活</Empty>}
          {myTriggers.map((t) => (
            <Row key={t.id} title={t.name} sub={`${t.kind} · ${t.rule}`} chevron onClick={() => nav.push({ page: 'triggerEdit', params: { id: t.id } })}
              right={<Tag tone={t.enabled ? 'ok' : 'mute'}>{t.enabled ? '开' : '关'}</Tag>} />
          ))}
        </Section>

        <Section title="记忆（它自己的 git 仓库）" right={<span className="sub">换 work、换服务器都从这里接手，不会丢</span>}>
          <Row title={<span className="mono small">{e.repo}</span>} sub={`最近同步：${e.repoSynced ?? '—'} · 规矩、交接、机器笔记`} chevron onClick={() => nav.push({ page: 'memory', params: { id: e.id } })} />
        </Section>

        <Section title={`work 历史 · 现在是第 ${e.works?.[0]?.no ?? 1} 个`} right={<button className="btn ghost sm" onClick={() => setMove(true)}>搬到另一台服务器</button>}>
          {(e.works ?? []).map((w) => (
            <Row key={w.no} title={`第 ${w.no} 个 work${w.to ? '' : '（现在）'}`} sub={`${w.from}${w.to ? ' → ' + w.to : ' 起'} · ${w.host} · ${w.reason}`}
              right={!w.to ? <Tag tone="ok">在用</Tag> : undefined} />
          ))}
          <div className="pad row-actions">
            <button className="btn default sm" onClick={() => { switchWork(sessionFor(e.id), e.id, '你让换的'); nav.openChat(e.id) }}>换一个 work</button>
          </div>
        </Section>

        <Section>
          <Row title="聊天设置" sub="头像、名字、背景、提醒" chevron onClick={() => nav.push({ page: 'chatSettings', params: { id: e.id } })} />
          <Row title="导出成模板" sub="分享给同事：角色、规矩、设置（不带聊天记录和你的账号）" chevron onClick={() => {
            const link = `https://codeup.aliyun.com/owner/emp-template-${e.id}.git`
            navigator.clipboard?.writeText(link).catch(() => {})
            toast(`模板地址已复制：${link}`)
          }} />
        </Section>
      </div>
      {work && <WorkSheet emp={e} onClose={() => setWork(false)} />}
      {move && (
        <Sheet title="搬到另一台服务器" onClose={() => setMove(false)}>
          <p className="sub">在新服务器上拉它的记忆仓库、起一个新 work 读交接接着干；旧服务器上的 work 停掉。会话和记忆都不丢。</p>
          <div className="sheet-list">
            {servers.filter((sv) => sv.name !== e.host).map((sv) => (
              <Row key={sv.id} title={sv.name} sub={`${sv.env} · ${sv.os}`} onClick={() => {
                setMove(false)
                setHostOf(e.id, sv.name)
                switchWork(sessionFor(e.id), e.id, `换服务器（${e.host} → ${sv.name}）`)
                nav.openChat(e.id)
              }} />
            ))}
          </div>
        </Sheet>
      )}
    </div>
  )
}

const COLORS = ['#10B981', '#EC4899', '#0EA5E9', '#F97316', '#6366F1', '#475569', '#8B5CF6', '#5B4FE9', '#EF4444', '#14B8A6']
const EXECUTORS = (LIVE ? ['Claude Code', 'Codex'] : ['Claude Code', 'Codex', 'OpenCode', 'Qwen Code']) as readonly ('Claude Code' | 'Codex' | 'OpenCode' | 'Qwen Code')[]

export function EmployeeEditPage({ params, nav }: PageProps) {
  const existing = useStore((s) => s.employees.find((x) => x.id === params.id))
  const servers = useStore((s) => s.servers)
  const workspaces = useStore((s) => s.workspaces)
  const [e, setE] = useState<Employee>(() => existing ?? {
    id: '', name: '', avatar: '', color: COLORS[(Math.random() * COLORS.length) | 0], title: '', prompt: '',
    executor: 'Claude Code', host: LIVE ? 'local' : servers[0]?.name ?? '', workspace: '', menus: [],
    model: 'Opus 5.5', effort: 'high', approval: 'auto', notify: 'decide', bg: 'plain', repo: '',
  })
  const up = (p: Partial<Employee>) => setE((x) => ({ ...x, ...p }))
  const save = () => {
    if (!e.name.trim()) { toast('先起个名字'); return }
    const id = e.id || 'emp-' + Date.now().toString(36)
    saveEmployee({ ...e, id, avatar: e.avatar || e.name.trim().slice(0, 1), workspace: LIVE ? e.workspace : e.workspace || `emp-${id}` })
    nav.back()
  }
  return (
    <div className="page">
      <PageHeader title={existing ? `编辑「${existing.name}」` : '新员工'} {...headNav(nav)}
        right={<button className="btn primary sm" onClick={save}>保存</button>} />
      <div className="page-body form">
        <div className="hero">
          <span className="avatar" style={{ width: 56, height: 56, background: e.color, fontSize: 26 }}>{e.avatar || e.name.slice(0, 1) || '?'}</span>
          <div className="swatches">
            {COLORS.map((c) => <button key={c} className={'swatch' + (c === e.color ? ' on' : '')} style={{ background: c }} onClick={() => up({ color: c })} aria-label={c} />)}
          </div>
        </div>
        <Field label="名字"><input value={e.name} onChange={(v) => up({ name: v.target.value })} placeholder="比如：uugo 运营" /></Field>
        <Field label="头像上的字" hint="留空用名字第一个字"><input value={e.avatar} maxLength={2} onChange={(v) => up({ avatar: v.target.value })} /></Field>
        <Field label="职责一句话"><input value={e.title} onChange={(v) => up({ title: v.target.value })} placeholder="会显示在聊天顶栏" /></Field>
        <Field label="职责（提示词）" hint={LIVE ? '每次派活都带上（系统提示词），写清它负责什么、做事的规矩' : '写进它 git 的 CLAUDE.md「我的角色」，以后派活不用长篇大论'}>
          <textarea rows={5} value={e.prompt} onChange={(v) => up({ prompt: v.target.value })} placeholder="你负责 …；做事的规矩是 …" />
        </Field>
        <Field label="执行器">
          <Segmented value={e.executor as (typeof EXECUTORS)[number]} options={EXECUTORS.map((x) => ({ value: x, label: x }))}
            onChange={(v) => up({ executor: v, model: modelsFor(v).includes(e.model) ? e.model : modelsFor(v)[0] })} />
        </Field>
        <Field label="模型">
          <select value={e.model} onChange={(v) => up({ model: v.target.value })}>
            {modelsFor(e.executor).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="思考方式" hint={EFFORTS.find((x) => x.value === e.effort)?.desc}>
          <Segmented value={e.effort} onChange={(v) => up({ effort: v })} options={EFFORTS.map((x) => ({ value: x.value, label: x.label }))} />
        </Field>
        <Field label="审核方式" hint={APPROVALS.find((x) => x.value === e.approval)?.desc}>
          <select value={e.approval} onChange={(v) => up({ approval: v.target.value as Employee['approval'] })}>
            {APPROVALS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </Field>
        {!LIVE && <Field label="跑在哪台服务器">
          <select value={e.host} onChange={(v) => up({ host: v.target.value })}>
            {servers.map((s) => <option key={s.id} value={s.name}>{s.name}（{s.env}）</option>)}
          </select>
        </Field>}
        {LIVE && (
          <Field label="跑在哪台服务器" hint="只能选 Opero 这台或装了 Agent 的；那台要先装好 AI 执行器（应用 → 服务器 → 点它 → AI 执行器）">
            <select value={servers.some((s) => s.id === e.host) ? e.host : 'local'} onChange={(v) => up({ host: v.target.value })}>
              {servers.filter((s) => s.id === 'local' || s.via === 'agent').map((s) => (
                <option key={s.id} value={s.id}>{s.id === 'local' ? 'Opero 这台' : `${s.name}（${s.env}${s.online ? '' : ' · 离线'}）`}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="工作空间（它干活的项目）" hint={LIVE ? '留空 = 在它自己的目录里干活；要改代码先在「工作空间」接入仓库' : '留空 = 只在自己的记忆仓库里干活（适合消息助理、总调度这类）'}>
          <select value={e.workspace} onChange={(v) => up({ workspace: v.target.value })}>
            <option value="">{LIVE ? '它自己的目录' : '新建员工仓库'}</option>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <div className="field">
          <span className="field-label">底部菜单（点选，建议不超过 3 个）</span>
          <div className="chips">
            {Object.entries(MENU_REGISTRY).map(([name, def]) => (
              <button key={name} title={def.desc} className={'chip' + (e.menus.includes(name) ? ' on' : '')}
                onClick={() => up({ menus: e.menus.includes(name) ? e.menus.filter((m) => m !== name) : [...e.menus, name] })}>{name}</button>
            ))}
          </div>
          <span className="field-hint">点了直接开面板，不经过 AI。想要新的菜单？在「我 → 定制和二开」里找「后台开发」做，或看 docs/规范/底部菜单.md。</span>
        </div>
        {!existing && !LIVE && <p className="field-hint">建好后会自动给它建一个记忆仓库 <span className="mono">emp-名字</span>（放在你带进来的代码仓库账号下），规矩、交接都存在里面，换 work、换服务器都不丢。</p>}
        <Field label="人设（可选）"><input value={e.persona ?? ''} onChange={(v) => up({ persona: v.target.value })} placeholder="比如：冷静、话少、先给结论" /></Field>
      </div>
    </div>
  )
}

export function MemoryPage({ params, nav }: PageProps) {
  const e = useStore((s) => s.employees.find((x) => x.id === params.id))
  const [files, setFiles] = useState(() => (memoryFiles[params.id] ?? memoryFiles.default).map((f) =>
    f.name === 'CLAUDE.md' && e ? { ...f, text: f.text.replace('（职责提示词）', e.prompt) } : f))
  const [open, setOpen] = useState<string | null>(files[0]?.name ?? null)
  return (
    <div className="page">
      <PageHeader title="记忆" sub={`${e?.name ?? ''} · git 仓库 ${e?.workspace ?? ''}`} {...headNav(nav)} />
      <div className="page-body">
        {files.map((f, i) => (
          <Section key={f.name} title={f.name} right={<button className="btn ghost sm" onClick={() => setOpen(open === f.name ? null : f.name)}>{open === f.name ? '收起' : '打开'}</button>}>
            {open === f.name && (
              <div className="pad">
                <textarea className="mono code-edit" rows={8} value={f.text}
                  onChange={(v) => setFiles((all) => all.map((x, j) => (j === i ? { ...x, text: v.target.value } : x)))} />
                <div className="row-actions"><button className="btn primary sm" onClick={() => toast('已保存并提交到员工的 git')}>保存</button></div>
              </div>
            )}
          </Section>
        ))}
      </div>
    </div>
  )
}

const setHostOf = (id: string, host: string) => set((s) => ({ employees: s.employees.map((x) => (x.id === id ? { ...x, host } : x)) }))

// ---------- 聊天设置：像微信给每个联系人设（头像、名字、背景、提醒、置顶），按员工记住 ----------
const EMOJIS = ['🤖', '🛠️', '📮', '🚀', '🐞', '📊', '🧑‍💻', '🦉', '⚙️', '🌙']
const AV_COLORS = ['#10B981', '#EC4899', '#0EA5E9', '#F97316', '#6366F1', '#475569', '#8B5CF6', '#5B4FE9', '#EF4444', '#14B8A6']
export const BGS: { value: ChatBg; label: string }[] = [
  { value: 'plain', label: '默认' }, { value: 'soft', label: '浅紫' }, { value: 'grid', label: '网格' }, { value: 'dusk', label: '暮色' }, { value: 'mint', label: '薄荷' },
]
export const NOTIFIES: { value: Notify; label: string; desc: string }[] = [
  { value: 'decide', label: '只提醒要我决定的', desc: '默认。要你确认、回答、回复的才冒红点和推送；其它消息只给一个灰点' },
  { value: 'all', label: '每条都提醒', desc: '有新消息就红点 + 推送（适合你正盯着的员工）' },
  { value: 'none', label: '不提醒', desc: '免打扰：不推送、不冒红点；要你决定的事照样会在「要你确认」里等着' },
]

/** 选图后缩成 128×128 再存，避免本机存储撑爆 */
export function ChatSettingsPage({ params, nav }: PageProps) {
  const e = useStore((s) => s.employees.find((x) => x.id === params.id))
  const sessions = useStore((s) => s.sessions)
  const [name, setName] = useState(e?.name ?? '')
  if (!e) return <div className="page"><PageHeader title="聊天设置" {...headNav(nav)} /><Empty>找不到这个员工</Empty></div>
  const sess = sessions.find((s) => s.employee === e.id)
  return (
    <div className="page">
      <PageHeader title="聊天设置" sub={e.name} {...headNav(nav)} />
      <div className="page-body">
        <div className="hero">
          <Avatar id={e.id} size={72} />
          <div className="hero-main">
            <input className="name-input" value={name} onChange={(v) => setName(v.target.value)} onBlur={() => name.trim() && name !== e.name && (setLook(e.id, { name: name.trim() }), toast('名字已改'))} />
            <span className="sub">点名字就能改；头像、背景、提醒都只影响你看到的样子</span>
          </div>
        </div>

        <Section title="头像">
          <div className="pad form">
            <div className="field">
              <span className="field-label">用字或表情</span>
              <div className="chips">
                <input className="avatar-text" maxLength={2} value={e.avatarImg ? '' : e.avatar} placeholder="字" onChange={(v) => setLook(e.id, { avatar: v.target.value || e.name.slice(0, 1), avatarImg: undefined })} />
                {EMOJIS.map((x) => <button key={x} className={'chip emoji' + (!e.avatarImg && e.avatar === x ? ' on' : '')} onClick={() => setLook(e.id, { avatar: x, avatarImg: undefined })}>{x}</button>)}
              </div>
            </div>
            <div className="field">
              <span className="field-label">底色</span>
              <div className="swatches">
                {AV_COLORS.map((c) => <button key={c} className={'swatch' + (c === e.color ? ' on' : '')} style={{ background: c }} onClick={() => setLook(e.id, { color: c })} aria-label={c} />)}
              </div>
            </div>
            <div className="field">
              <span className="field-label">或者用一张图</span>
              <div className="chips">
                <label className="btn default sm">选图片<input type="file" accept="image/*" hidden onChange={async (v) => {
                  const f = v.target.files?.[0]
                  v.target.value = ''
                  if (!f) return
                  const r = await editImage(f, { aspect: 1, round: true, maxSize: 256, title: `${e.name} 的头像`, allowOriginal: false })
                  if (r) { setLook(e.id, { avatarImg: await fileToDataUrl(r) }); toast('头像已换') }
                }} /></label>
                {e.avatarImg && <button className="btn ghost sm" onClick={() => setLook(e.id, { avatarImg: undefined })}>不用图片</button>}
              </div>
            </div>
          </div>
        </Section>

        <Section title="聊天背景">
          <div className="pad bg-pick">
            {BGS.map((b) => (
              <button key={b.value} className={'bg-tile msgs-bg-' + b.value + ((e.bg ?? 'plain') === b.value ? ' on' : '')} onClick={() => setLook(e.id, { bg: b.value })}>
                <span>{b.label}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="提醒" right={<span className="sub">少红点：默认只提醒要你决定的</span>}>
          <div className="pad">
            <div className="radio-list">
              {NOTIFIES.map((n) => (
                <button key={n.value} className={'radio-row' + (e.notify === n.value ? ' on' : '')} onClick={() => setLook(e.id, { notify: n.value })}>
                  <i className="radio" /><span className="radio-main"><span>{n.label}</span><span className="sub">{n.desc}</span></span>
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section>
          <div className="lrow">
            <span className="row-main"><span className="row-title">置顶聊天</span></span>
            <Toggle on={!!sess?.pinned} onChange={() => togglePin(sess ? sess.id : sessionFor(e.id))} />
          </div>
          <Row title="员工档案" sub="职责、work 设置、记忆、权限" chevron onClick={() => nav.push({ page: 'employee', params: { id: e.id } })} />
        </Section>
      </div>
    </div>
  )
}
