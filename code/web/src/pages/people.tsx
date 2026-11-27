// 员工：列表 · 员工资料 · 新建 / 编辑 · 记忆
import { useEffect, useState } from 'react'
import type { Employee } from '../types'
import { memoryFiles } from '../data/mock'
import { MENU_REGISTRY } from '../menus'
import { employeeFromTemplate, runFlow, saveEmployee, set, setLook, switchWork, sessionFor, togglePin, toast, useStore } from '../store'
import { LIVE } from '../mode'
import { call } from '../live'
import type { ChatBg, Notify } from '../types'
import { Avatar } from '../components/Avatar'
import { editImage, fileToDataUrl, pickImages } from '../components/ImageEditor'
import { Empty, Field, PageHeader, Row, Section, Segmented, Sheet, Stat, Tag, Toggle } from '../components/ui'
import { WorkSheet } from '../components/WorkSheet'
import { EditableAvatar, presetData, randomName, randomPreset } from '../components/AvatarPicker'
import { Shuffle } from 'lucide-react'
import { ExecPicker } from '../components/ExecutorSetup'
import { APPROVALS, EFFORTS, approvalLabel, effortLabel, modelsFor } from '../work'
import { IconPlus } from '../components/icons'
import { headNav, type PageProps } from './nav'
import { EmpName } from '../components/EmpName'
import { empGroups } from '../empGroups'

export function EmployeesPage({ nav }: PageProps) {
  const employees = useStore((s) => s.employees)
  const sessions = useStore((s) => s.sessions)
  const workspaces = useStore((s) => s.workspaces)
  const [tpl, setTpl] = useState(false)
  // 给某个项目加员工：点了就建好（同项目页的「+ 加一个员工」）
  const addTo = async (wsId: string) => { const r = await call<Employee>('POST', `/api/workspaces/${wsId}/employees`, undefined); if (r) toast(`已加上「${r.name}」：点它改名、发消息`) }
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
            {['shop 日志值班', '发布', '运维', '消息助理', 'shop 开发'].map((n) => (
              <Row key={n} title={n} sub="内置模板" onClick={() => { setTpl(false); employeeFromTemplate(n, '内置') }} />
            ))}
          </div>
          <Field label="或者用同事分享的模板（git 地址）">
            <div className="inline-form">
              <input value={url} onChange={(v) => setUrl(v.target.value)} placeholder="https://github.com/you/emp-template-review.git" />
              <button className="btn primary" onClick={() => { if (!url.trim()) { toast('先填地址'); return } setTpl(false); employeeFromTemplate('shop 开发', url.trim()) }}>导入</button>
            </div>
          </Field>
        </Sheet>
      )}
      <div className="page-body">
        {/* 按项目分组：组名点了进项目，旁边「+ 加员工」直接给这个项目加一个 */}
        {empGroups(employees, workspaces, sessions).map((g) => (
          <Section key={g.key || 'none'}
            title={`${g.name} · ${g.list.length}`}
            right={g.ws ? <span className="row-actions">
              <button className="btn ghost sm" onClick={() => nav.push({ page: 'workspace', params: { id: g.ws!.id } })}>项目</button>
              {LIVE && <button className="btn ghost sm" onClick={() => addTo(g.ws!.id)}>+ 加员工</button>}
            </span> : undefined}>
            {g.list.map((e) => {
              const working = sessions.find((s) => s.employee === e.id)?.working
              return (
                <Row key={e.id} icon={<Avatar id={e.id} size={44} />} chevron onClick={() => nav.push({ page: 'employee', params: { id: e.id } })}
                  title={<EmpName e={e} />}
                  sub={working ? <span className="ok">● {working}</span> : `${e.title} · ${e.executor} · ${e.host}`} />
              )
            })}
          </Section>
        ))}
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
  const myCreds = creds.filter((c) => (c.usedBy ?? []).includes(e.id) || (c.usedBy ?? []).includes('全部员工'))
  return (
    <div className="page">
      <PageHeader title={e.name} sub="员工资料" {...headNav(nav)}
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
          <Row title="执行器" right={e.executor} chevron onClick={() => setWork(true)} />
          <Row title="跑在" right={e.host} />
          <Row title="项目" right={e.workspace} />
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
          {myCreds.length === 0 && <Empty>还没有：要它碰服务器 / 库 / 仓库，先在「凭证」里带进来</Empty>}
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
            const link = `https://github.com/acme/emp-template-${e.id}.git`
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

const PERSONAS = ['冷静、话少、先给结论', '热情、细致、多解释几句', '严谨、凡事先确认', '幽默、轻松']
const COLORS = ['#10B981', '#EC4899', '#0EA5E9', '#F97316', '#6366F1', '#475569', '#8B5CF6', '#5B4FE9', '#EF4444', '#14B8A6']

export function EmployeeEditPage({ params, nav }: PageProps) {
  const existing = useStore((s) => s.employees.find((x) => x.id === params.id))
  const servers = useStore((s) => s.servers)
  const workspaces = useStore((s) => s.workspaces)
  const allCreds = useStore((s) => s.credentials)
  const repoCreds = allCreds.filter((c) => c.group === '代码仓库')
  const domains = useStore((s) => s.domains)
  const [e, setE] = useState<Employee>(() => existing ?? {
    id: '', name: '', avatar: '', color: COLORS[(Math.random() * COLORS.length) | 0], title: '', prompt: '',
    executor: 'Claude Code', host: LIVE ? 'local' : servers[0]?.name ?? '', workspace: '', menus: [],
    model: 'Opus 5.5', effort: 'high', approval: 'auto', notify: 'decide', bg: 'plain', repo: '',
  })
  const up = (p: Partial<Employee>) => setE((x) => ({ ...x, ...p }))
  const [adv, setAdv] = useState(false)
  const allEmps = useStore((s) => s.employees)
  // 新建：先随机起个名字、挑一张同性别的默认头像（都能换）；选了性别就按性别重新挑
  const reroll = async (gender = e.gender, what: 'both' | 'name' | 'avatar' = 'both') => {
    const g = gender || (Math.random() < 0.5 ? '女' : '男')
    if (what !== 'avatar') up({ name: randomName(g, allEmps.map((x) => x.name)) })
    if (what !== 'name') { try { up({ avatarImg: await presetData(randomPreset(g)) }) } catch { /* 读不到默认头像就用字 */ } }
  }
  useEffect(() => { if (!existing) void reroll() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // 预设角色（后台 presets.ts）：新建时点一个就填好
  const [presets, setPresets] = useState<(Pick<Employee, 'name' | 'avatar' | 'color' | 'title' | 'prompt' | 'menus' | 'persona' | 'effort' | 'approval' | 'credGroups'> & { key: string })[]>([])
  useEffect(() => { if (LIVE && !existing) call<{ presets: typeof presets }>('GET', '/api/presets').then((r) => r && setPresets(r.presets)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    if (!e.name.trim()) { toast('先起个名字（或者点上面一个角色）'); return }
    const title = e.title.trim() || (e.prompt.trim() ? e.prompt.trim().split(/[。；;\n]/)[0].replace(/^你(负责|是)/, '').slice(0, 30) : '')
    const id = e.id || 'emp-' + Date.now().toString(36)
    saveEmployee({ ...e, title, id, avatar: e.avatar || e.name.trim().slice(0, 1), workspace: LIVE ? e.workspace : e.workspace || `emp-${id}` })
    nav.back()
  }
  return (
    <div className="page">
      <PageHeader title={existing ? `编辑「${existing.name}」` : '新员工'} {...headNav(nav)}
        right={<button className="btn primary sm" onClick={save}>保存</button>} />
      <div className="page-body form">
        <div className="hero">
          {existing ? <EditableAvatar id={existing.id} size={64} /> : (
            <span className="avatar" style={{ width: 64, height: 64, ['--c' as string]: e.color, fontSize: 28 }}>{e.avatarImg ? <img src={e.avatarImg} alt="" /> : e.avatar || e.name.slice(0, 1) || '?'}</span>
          )}
          {!existing && (
            <div className="row-actions">
              <button type="button" className="btn default sm" onClick={() => reroll(e.gender, 'avatar')}><Shuffle size={14} /> 换一个头像</button>
              <button type="button" className="btn ghost sm" onClick={async () => { const [f] = await pickImages({ aspect: 1, round: true, maxSize: 256, title: '新员工的头像', allowOriginal: false }); if (f) up({ avatarImg: await fileToDataUrl(f) }) }}>上传图片</button>
              {e.avatarImg && <button type="button" className="btn ghost sm" onClick={() => up({ avatarImg: undefined })}>用字</button>}
            </div>
          )}
          {existing && <span className="sub">点头像换：默认头像、上传图片（会先裁剪）、字或表情</span>}
        </div>
        {LIVE && !existing && presets.length > 0 && (
          <Field label="照着哪个角色建（点一个，名字、职责、提示词、菜单都填好）">
            <div className="chips">{presets.map((p) => <button key={p.key} type="button" className={'chip' + (e.prompt === p.prompt ? ' on' : '')} onClick={() => up({ role: p.name, avatar: p.avatar, color: p.color, title: p.title, prompt: p.prompt, menus: p.menus, persona: p.persona, effort: p.effort, approval: p.approval, credGroups: p.credGroups })}>{p.name}</button>)}</div>
          </Field>
        )}
        <Field label="名字">
          <div className="name-row">
            <input value={e.name} onChange={(v) => up({ name: v.target.value })} placeholder="比如：crm 运营" />
            <button type="button" className="btn default sm" title="随机换一个名字" onClick={() => reroll(e.gender, 'name')}><Shuffle size={14} /> 换一个</button>
          </div>
        </Field>
        <Field label="职位" hint="显示在名字后面的小标签，比如「安卓开发」「运维」「日志值班」；别的员工按职位也能找到它"><input value={e.role ?? ''} maxLength={20} onChange={(v) => up({ role: v.target.value })} placeholder="比如：安卓开发" /></Field>
        <Field label="性别（可选）" hint={existing ? undefined : '选了会按性别重新起名字、挑头像'}><Segmented value={e.gender ?? ''} onChange={(v) => { up({ gender: v }); if (!existing && v) void reroll(v) }} options={[{ value: '', label: '不设' }, { value: '女', label: '女' }, { value: '男', label: '男' }]} /></Field>
        <Field label="职责一句话（可选）" hint="不填用提示词的第一句"><input value={e.title} onChange={(v) => up({ title: v.target.value })} placeholder="会显示在聊天顶栏" /></Field>
        <Field label="职责（提示词）" hint={LIVE ? '每次派活都带上（系统提示词），写清它负责什么、做事的规矩' : '写进它 git 的 CLAUDE.md「我的角色」，以后派活不用长篇大论'}>
          <textarea rows={5} value={e.prompt} onChange={(v) => up({ prompt: v.target.value })} placeholder="你负责 …；做事的规矩是 …" />
        </Field>
        <Field label={LIVE ? '项目' : '项目'} hint={LIVE ? '选了项目：在项目目录里干活，记忆就是项目的 docs/；不选 = 在它自己的目录里干活（适合运维、消息助理）' : '留空 = 只在自己的记忆仓库里干活（适合消息助理、总调度这类）'}>
          <select value={e.workspace} onChange={(v) => up({ workspace: v.target.value })}>
            <option value="">{LIVE ? '不选（它自己的目录）' : '新建员工仓库'}</option>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        {LIVE && <button type="button" className="btn ghost sm" onClick={() => setAdv(!adv)}>{adv ? '收起高级设置' : '高级设置（执行器、模型、服务器、菜单、预算…，一般不用动）'}</button>}
        {(!LIVE || adv) && (<>
        <Field label="执行器">
          <ExecPicker value={e.executor} onChange={(v) => up({ executor: v, model: modelsFor(v).includes(e.model) ? e.model : modelsFor(v)[0] })} />
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
                <option key={s.id} value={s.id}>{s.id === 'local' ? (s.name === '本机' ? 'Opero 这台' : s.name) : `${s.name}（${s.env}${s.online ? '' : ' · 离线'}）`}</option>
              ))}
            </select>
          </Field>
        )}
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
        <Field label="性格 / 说话风格" hint={LIVE ? '写进它记忆仓库的「我的人设」，每次干活都按这个说话' : undefined}>
          <div className="chips">
            <button type="button" className={'chip' + (!e.persona ? ' on' : '')} onClick={() => up({ persona: '' })}>不设</button>
            {PERSONAS.map((x) => <button key={x} type="button" className={'chip' + (e.persona === x ? ' on' : '')} onClick={() => up({ persona: x })}>{x}</button>)}
          </div>
        </Field>
        {LIVE && (
          <>
            <div className="field">
              <span className="field-label">只读参考的项目（最多 8 个）</span>
              <div className="chips">
                {workspaces.filter((w) => w.id !== e.workspace).map((w) => {
                  const on = (e.reads ?? []).includes(w.id)
                  return <button key={w.id} className={'chip' + (on ? ' on' : '')} onClick={() => up({ reads: on ? (e.reads ?? []).filter((x) => x !== w.id) : [...(e.reads ?? []), w.id].slice(0, 8) })}>{w.name}</button>
                })}
                {workspaces.length <= 1 && <span className="sub">还没有别的项目</span>}
              </div>
              <span className="field-hint">它能看这些项目的代码（不能改），要和它在同一台服务器上</span>
            </div>
            <Field label="每月预算" hint="用满了它先停下，到 80% 提醒一次">
              <div className="chips">{[0, 10, 30, 100, 300].map((n) => <button key={n} type="button" className={'chip' + ((e.budget ?? 0) === n ? ' on' : '')} onClick={() => up({ budget: n })}>{n ? `$${n}` : '不单独限'}</button>)}</div>
            </Field>
            <label className="lrow boxed"><span className="row-main"><span className="row-title">在自己的分支上改</span><span className="row-sub">{`开了它在 opero/${e.name ? e.name.replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase() || 'emp' : '名字'} 分支上干活，干完用 pr_create 提合并请求，你在 GitHub / GitLab / Gitee / Codeup 上合；关了直接改主分支。一个项目多个员工同时用时别开`}</span></span>
              <Toggle on={!!e.workBranch} onChange={(v) => up({ workBranch: v ? `opero/${(e.name.replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase() || e.id || 'emp').replace(/^-+|-+$/g, '') || 'emp'}` : '' })} /></label>
            {domains.length > 0 && (
              <div className="field">
                <span className="field-label">能改哪些域名的解析</span>
                <div className="chips">
                  {domains.map((d) => {
                    const on = (e.dns ?? []).includes(d.id)
                    return <button key={d.id} className={'chip' + (on ? ' on' : '')} onClick={() => up({ dns: on ? (e.dns ?? []).filter((x) => x !== d.id) : [...(e.dns ?? []), d.id] })}>{d.domain}</button>
                  })}
                </div>
                <span className="field-hint">它能用 dns_set / dns_delete 改这些域名；审核方式不是「自动」时每次先问你</span>
              </div>
            )}
            <label className="lrow boxed"><span className="row-main"><span className="row-title">能建、改别的员工</span><span className="row-sub">在聊天里让它建员工、改职责（每次都要你点确认；服务器、库、凭证的权限由你自己给）</span></span><Toggle on={!!e.canManage} onChange={(v) => up({ canManage: v })} /></label>
            {!e.workspace && <Field label="记忆仓库的远端（可选）" hint="不配 = 记忆只在它干活那台机器上（也有版本记录）；配了每轮干完推上去，换服务器时在新机器上拉下来接着做。建一个空仓库填在这里">
              <input value={e.memRepo ?? ''} onChange={(v) => up({ memRepo: v.target.value })} placeholder="https://github.com/you/emp-dev.git" />
            </Field>}
            {e.memRepo && !e.workspace && (
              <Field label="推送用的令牌">
                <select value={e.memCred ?? ''} onChange={(v) => up({ memCred: v.target.value })}>
                  <option value="">不用（公开仓库或这台机器上已经配好）</option>
                  {repoCreds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            )}
          </>
        )}
        </>)}
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
          <EditableAvatar id={e.id} size={72} />
          <div className="hero-main">
            <input className="name-input" value={name} onChange={(v) => setName(v.target.value)} onBlur={() => name.trim() && name !== e.name && (setLook(e.id, { name: name.trim() }), toast('名字已改'))} />
            <span className="sub">点头像换（默认头像、上传图片、字或表情），点名字改名字</span>
          </div>
        </div>

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
          <Row title="员工资料" sub="职责、work 设置、记忆、权限" chevron onClick={() => nav.push({ page: 'employee', params: { id: e.id } })} />
        </Section>
      </div>
    </div>
  )
}
