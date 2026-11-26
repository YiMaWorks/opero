// 我：只放跟你这个人有关的——资料、我的习惯、外观和通知、账号安全、退出登录。
// 这套 Opero 的配置（AI 执行器、用量和预算、系统设置、开机向导、关于和升级、定制和二开）都在「应用」里（apps.tsx DEMO_CONFIG / live.tsx LIVE_CONFIG）。
import { useState } from 'react'
import type { Settings } from '../types'
import { empName, logout, mergeOfficialUpdate, replaySetup, requireVerify, setSettings, toast, useStore } from '../store'
import { Avatar } from '../components/Avatar'
import { Wordmark } from '../components/brand'
import { Meter, PageHeader, Row, Section, Segmented, Stat, Tag, Toggle } from '../components/ui'
import { headNav, type PageProps } from './nav'
import { THEMES, resolveTheme, type ThemeDef } from '../themes'
import { ThemeCard } from '../components/ThemeCard'
import { MeHeader } from '../components/MeHeader'
import { appVersion, getShell, nativeUnpair, setShell, type ShellPrefs } from '../native'
import { CUR, LIVE } from '../mode'
import { LangPicker } from '../components/LangPicker'
import { UsageDetail } from './live2'

export function MePage({ params, nav }: PageProps) {
  const go = (page: any) => () => nav.push({ page })
  return (
    <div className="page">
      {nav.canBack && <PageHeader title="我" {...headNav(nav)} />}
      <div className="page-body">
        <MeHeader onEdit={go('meEdit')} />
        <Section title="按你的习惯">
          <Row title="我的习惯" sub="所有员工都遵守的个人规矩，每次派活都带上" chevron onClick={go('habits')} />
          <Row title="外观和通知" sub="风格、语言、推送什么、这台手机" chevron onClick={go('settings')} />
          <Row title="账号安全" sub={LIVE ? '改密码、通行密钥、两步验证、登录的设备' : '通行密钥、登录设备'} chevron onClick={go('security')} />
        </Section>
        <p className="hint">AI 执行器、用量和预算、系统设置这些配置都在「应用」里。</p>
        <Section>
          {params.onReplaySplash && <Row title="再看一次启动动画" chevron onClick={params.onReplaySplash} />}
          <Row title="退出登录" danger onClick={() => logout()} />
        </Section>
      </div>
    </div>
  )
}

export function UsagePage({ nav }: PageProps) {
  const usage = useStore((s) => s.usage)
  const st = useStore((s) => s.settings)
  const total = usage.reduce((a, u) => a + u.cost, 0)
  const tasks = usage.reduce((a, u) => a + u.tasks, 0)
  const ok = usage.reduce((a, u) => a + u.success, 0)
  const max = Math.max(...usage.map((u) => u.cost))
  return (
    <div className="page">
      <PageHeader title="用量和成本" sub={LIVE ? '本月 · 执行器报的花费（订阅登录的不算钱）' : '本月 · 按 API Key 计费'} {...headNav(nav)} />
      <div className="page-body">
        <div className="stats">
          <Stat label="本月花费" value={`${CUR}${total.toFixed(LIVE ? 2 : 0)}`} sub={st.budget ? `预算 ${CUR}${st.budget}` : '不限预算'} />
          <Stat label={LIVE ? '轮数' : '任务'} value={tasks} />
          <Stat label="成功率" value={tasks ? `${Math.round((ok / tasks) * 100)}%` : '—'} />
        </div>
        <Section title="每月预算">
          <div className="pad form">
            {st.budget > 0 && <Meter label={`用了 ${CUR}${total.toFixed(0)} / ${CUR}${st.budget}`} value={Math.min(100, Math.round((total / st.budget) * 100))} />}
            <div className="inline-form">
              <input type="number" min={0} value={st.budget} onChange={(e) => setSettings({ budget: Math.max(0, Number(e.target.value) || 0) })} />
              <span className="sub nowrap">{LIVE ? '美元' : '元'} / 月（0 = 不限）</span>
            </div>
            <div className="lrow boxed">
              <span className="row-main"><span className="row-title">用满了先停下来问我</span><span className="row-sub">到 80% 先提醒你；用满后员工新开的活先问你再做（正在做的做完）</span></span>
              <Toggle on={st.budgetStop} onChange={(v) => setSettings({ budgetStop: v })} />
            </div>
          </div>
        </Section>
        <Section title="每个员工">
          {[...usage].sort((a, b) => b.cost - a.cost).map((u) => (
            <div key={u.employee} className="lrow">
              <Avatar id={u.employee} size={36} />
              <span className="row-main">
                <span className="row-title">{empName(u.employee)}</span>
                <span className="cost-bar"><i style={{ width: `${max > 0 ? (u.cost / max) * 100 : 0}%` }} /></span>
                <span className="row-sub">{u.tasks} 个任务 · 成功 {u.success} · {u.tokens} token</span>
              </span>
              <span className="row-right"><b>{CUR}{u.cost.toFixed(LIVE ? 2 : 1)}</b></span>
            </div>
          ))}
        </Section>
        {LIVE && <UsageDetail />}
        <p className="hint">超预算时员工会先停下来问你；常做的事存成固定流程后，第二次不经过 AI，更快更省。</p>
      </div>
    </div>
  )
}

export function SettingsPage({ nav }: PageProps) {
  const s = useStore((x) => x.settings)
  const up = (p: Partial<Settings>) => setSettings(p)
  return (
    <div className="page">
      <PageHeader title="外观和通知" sub="只管你自己看到的样子和收到的提醒" {...headNav(nav)} />
      <div className="page-body">
        <PhoneSection />
        <Section title="通知">
          <div className="lrow col">
            <span className="row-main"><span className="row-title">推送什么</span><span className="row-sub">免打扰的会话一律不推</span></span>
            <Segmented value={s.notify} onChange={(v) => up({ notify: v })}
              options={[{ value: 'decide', label: '只推要我决定的' }, { value: 'errors', label: '出错也推' }, { value: 'all', label: '全部' }]} />
          </div>
        </Section>
        <Section title="外观">
          <ThemePicker />
          <div className="lrow col">
            <span className="row-main"><span className="row-title">语言</span></span>
            <LangPicker onPick={(p) => up({ lang: p })} />
          </div>
        </Section>
      </div>
    </div>
  )
}

/** 系统设置（在「应用」里）：生产保护、每轮小结、提醒发到哪、AI 用不了时、开机向导 */
export function SystemSettingsPage({ nav }: PageProps) {
  const s = useStore((x) => x.settings)
  const up = (p: Partial<Settings>) => setSettings(p)
  return (
    <div className="page">
      <PageHeader title="系统设置" sub="这套 Opero 怎么干活" {...headNav(nav)} />
      <div className="page-body">
        <Section title="安全（信任 AI、少打扰）" right={<span className="sub">危险操作永远要你本人验证</span>}>
          <div className="lrow">
            <span className="row-main"><span className="row-title">生产保护</span><span className="row-sub">打开后，员工改生产（发版、重启、改数据）先出确认卡片；关着就按每个员工的审核方式来</span></span>
            <Toggle on={s.prodProtect} onChange={(v) => up({ prodProtect: v })} />
          </div>
        </Section>
        <Section title="聊天">
          <div className="lrow">
            <span className="row-main"><span className="row-title">每轮做完显示小结</span><span className="row-sub">改了哪些文件、提交推送了没有、这一轮和这个会话用了多少；能一键撤销或发布这次改动</span></span>
            <Toggle on={s.runSummary !== false} onChange={(v) => up({ runSummary: v })} />
          </div>
        </Section>
        {!LIVE && <Section title="AI 用不了时" right={<span className="sub">欠费、限流、执行器挂了</span>}>
          <div className="lrow col">
            <span className="row-main"><span className="row-title">备用执行器</span><span className="row-sub">主执行器连不上时自动切过去；面板和底部菜单不经过 AI，照常能用</span></span>
            <Segmented value={s.fallback || 'none'} onChange={(v) => up({ fallback: v === 'none' ? '' : v })}
              options={[{ value: 'none', label: '不用备用' }, { value: 'Codex', label: 'Codex' }, { value: 'OpenCode', label: 'OpenCode' }, { value: 'Qwen Code', label: 'Qwen Code' }]} />
          </div>
          <div className="lrow">
            <span className="row-main"><span className="row-title">模拟 AI 不可用（演示）</span><span className="row-sub">打开后看看聊天里是什么样</span></span>
            <Toggle on={s.aiDown} onChange={(v) => up({ aiDown: v })} />
          </div>
        </Section>}
        {LIVE && <Section title="通知发到哪" right={<span className="sub">不装 App 也能收到</span>}><Row title="Telegram、Slack、企业微信、钉钉、飞书、邮件、Webhook" sub="要你决定的、出错的同时发到这些地方" chevron onClick={() => nav.push({ page: 'channels' })} /></Section>}
        {!LIVE && <Section title="通知发到哪" right={<span className="sub">不装 App 也能收到</span>}>
          <div className="pad chips">
            {['App 推送', 'Telegram', 'Slack', '邮件'].map((t) => (
              <button key={t} className={'chip' + (s.notifyTo.includes(t) ? ' on' : '')}
                onClick={() => up({ notifyTo: s.notifyTo.includes(t) ? s.notifyTo.filter((x) => x !== t) : [...s.notifyTo, t] })}>{t}</button>
            ))}
          </div>
          <p className="hint">Telegram / Slack 要先在「消息渠道」里接上；每个员工提醒不提醒，在它的「聊天设置」里单独设。</p>
        </Section>}
        <Section title="开机向导">
          <Row title="重新走一遍开机向导" sub="接 AI、建第一个员工、接服务器这些步骤再来一遍" chevron onClick={() => replaySetup()} />
        </Section>
      </div>
    </div>
  )
}

export function SecurityPage({ nav }: PageProps) {
  const [keys, setKeys] = useState(['这台手机（指纹）', 'MacBook（Touch ID）'])
  const [pair, setPair] = useState<{ code: string } | null>(null)
  const [phones, setPhones] = useState(['HUAWEI Mate 60'])
  return (
    <div className="page">
      <PageHeader title="账号安全" {...headNav(nav)} />
      <div className="page-body">
        <Section title="通行密钥" right={<button className="btn ghost sm" onClick={() => requireVerify('添加通行密钥', () => { setKeys((k) => [...k, '新设备']); toast('已添加') })}>添加</button>}>
          {keys.map((k) => <Row key={k} title={k} sub="验证本人用；30 分钟内验过不再问" />)}
        </Section>
        <Section title="接手机" right={<span className="sub">Opero App（安卓）</span>}>
          {pair
            ? (
              <div className="pad">
                <div className="pair-code">{pair.code}</div>
                <p className="sub center">在手机上打开 Opero App，填这套的地址和这个配对码。10 分钟内有效，用一次就作废。</p>
              </div>
            )
            : <Row title="生成配对码" sub="配对后手机能收提醒、用指纹验证本人；手机丢了在这里断开" chevron
                onClick={() => requireVerify('生成手机配对码', () => setPair({ code: String(Math.floor(100000 + Math.random() * 900000)) }))} />}
          {phones.map((p) => (
            <Row key={p} title={p} sub="已配对 · 收提醒、指纹验证本人"
              right={<button className="btn ghost sm" onClick={() => requireVerify(`断开 ${p}`, () => { setPhones((x) => x.filter((y) => y !== p)); toast('已断开，这台手机要重新配对才能用') })}>断开</button>} />
          ))}
        </Section>
        <Section title="登录中的设备">
          <Row title="Android · Chrome" sub="现在" right={<Tag tone="ok">当前</Tag>} />
          <Row title="Mac · Opero 桌面版" sub="10 分钟前" right={<button className="btn ghost sm" onClick={() => toast('已让它退出登录')}>退出</button>} />
        </Section>
        <Section title="两步验证">
          <Row title="验证码（没有 HTTPS 时用）" right={<Tag tone="ok">已开</Tag>} />
        </Section>
      </div>
    </div>
  )
}

export function AboutPage({ nav }: PageProps) {
  const instance = useStore((s) => s.instance)
  return (
    <div className="page">
      <PageHeader title="关于" {...headNav(nav)} />
      <div className="page-body">
        <div className="about">
          <Wordmark size={34} />
          <p className="sub">你的个人开发助理：和 AI 团队聊天，搞定开发</p>
          <p className="sub">一人一套 · 你在公司有什么权限就带进来 · 按自己的习惯二开</p>
          <p className="sub">网页 {__APP_VERSION__}{appVersion ? ` · App ${appVersion}` : ''}{LIVE ? ` · 后台 ${instance?.version ?? ''}` : ' · 在线试用（数据是假的，不连任何服务器）'}</p>
        </div>
        <Section>
          <Row title="开源许可" right="Apache-2.0" />
          <Row title="规范" sub="MCP 2026-07-28 · 卡片 / 工具 / 插件规范见 docs" />
          <Row title="定制和二开" chevron onClick={() => nav.push({ page: 'customize' })} />
        </Section>
      </div>
    </div>
  )
}

const HABIT_EXAMPLES = ['回复用中文，先给结论再说原因', '改代码在分支上，检查通过就合并，不用问我', '不要在共享服务器上跑测试和服务', '周五 18 点后不自动发生产', '提交信息用中文']
export function HabitsPage({ nav }: PageProps) {
  const habits = useStore((s) => s.settings.habits)
  const [text, setText] = useState(habits)
  const add = (h: string) => setText((t) => (t.includes(h) ? t : (t.trim() ? t.trim() + '\n' : '') + '- ' + h))
  return (
    <div className="page">
      <PageHeader title="我的习惯" sub="必读的短规矩：每次派活自动带上，不靠员工去查" {...headNav(nav)}
        right={<button className="btn primary sm" onClick={() => { setSettings({ habits: text }); toast('已保存，下次派活起生效') }}>保存</button>} />
      <div className="page-body form">
        <textarea className="code-edit" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="- 回复用中文&#10;- 先给结论" />
        <div className="field">
          <span className="field-label">常用的，点一下加进去</span>
          <div className="chips">{HABIT_EXAMPLES.map((h) => <button key={h} className="chip" onClick={() => add(h)}>+ {h}</button>)}</div>
        </div>
        <p className="field-hint">要短（一两千字以内）：这里每次都会塞进员工的上下文。长的规范、接口文档放「知识库」，员工按需查。单个员工的职责写在它自己的档案里。</p>
      </div>
    </div>
  )
}

const EXT_POINTS: { name: string; desc: string; doc: string }[] = [
  { name: '底部菜单', desc: '给员工加一排秒开的按钮', doc: 'docs/规范/底部菜单.md' },
  { name: '插件', desc: '加工具、表、页面、定时任务、新的资源类型', doc: 'docs/规范/插件.md（待写）' },
  { name: '卡片和表单', desc: '插件自己的界面（MCP Apps）', doc: 'docs/规范/表单与卡片.md' },
  { name: '判定规则', desc: '比如「周五 18 点后不自动发生产」', doc: 'docs/MCP设计.md 第 2 节' },
  { name: '员工模板', desc: '把配好的员工存成模板，换机器 / 分享给同事', doc: 'docs/规范/员工.md（待写）' },
]
export function CustomizePage({ nav }: PageProps) {
  const c = useStore((s) => s.custom)
  return (
    <div className="page">
      <PageHeader title="定制和二开" sub="这套 Opero 是你的，按你的习惯改" {...headNav(nav)} />
      <div className="page-body">
        <Section title="你的版本">
          <Row title="代码" sub={c.fork} />
          <Row title="底座" right={c.base} />
          <Row title="你的改动" right={`${c.mine.length} 处`} />
        </Section>
        {c.update && (
          <Section title="官方有新版">
            <div className="pad">
              <div className="banner b-info">{c.update.version} 发布了</div>
              <ul className="notes">{c.update.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              <p className="field-hint">交给「后台开发」合并到你的版本：先检查你的改动有没有冲突、起预览，你点「上线」才换；坏了自动回滚。</p>
              <div className="row-actions"><button className="btn primary" onClick={mergeOfficialUpdate}>让后台开发合并上来</button></div>
            </div>
          </Section>
        )}
        <Section title="你做过的改动" right={<button className="btn ghost sm" onClick={() => nav.openChat('dev-opero')}>再改点什么</button>}>
          {c.mine.map((m) => (
            <Row key={m.what} title={m.what} sub={m.kind} right={<Tag tone={m.status === '已上线' ? 'ok' : 'primary'}>{m.status}</Tag>} />
          ))}
        </Section>
        <Section title="能改哪里（扩展点）">
          {EXT_POINTS.map((p) => <Row key={p.name} title={p.name} sub={`${p.desc} · ${p.doc}`} />)}
        </Section>
        <p className="hint">最省事的二开：跟「后台开发」说你想要什么，它按规矩做成插件、先起预览给你看。新功能优先做插件，不改内核，官方升级不冲突。</p>
      </div>
    </div>
  )
}

/** 在 Opero App 里才有：这台手机自己的设置（存在手机上，外壳管） */
function PhoneSection() {
  const [p, setP] = useState(() => getShell())
  if (!p) return null
  const up = (x: Partial<ShellPrefs>) => { setShell(x); setP(getShell()) }
  return (
    <Section title="这台手机" right={<span className="sub">App {p.version}</span>}>
      <div className="lrow">
        <span className="row-main"><span className="row-title">指纹解锁 App</span><span className="row-sub">打开、离开一会儿再回来先验指纹；最近任务里不显示内容</span></span>
        <Toggle on={p.lockOn} onChange={(v) => up({ lockOn: v })} />
      </div>
      {p.lockOn && (
        <div className="lrow col">
          <span className="row-main"><span className="row-title">离开多久要解锁</span></span>
          <Segmented value={String(p.lockAfter)} onChange={(v) => up({ lockAfter: Number(v) })}
            options={[{ value: '0', label: '每次' }, { value: '60', label: '1 分钟' }, { value: '300', label: '5 分钟' }, { value: '1800', label: '30 分钟' }]} />
        </div>
      )}
      <div className="lrow">
        <span className="row-main"><span className="row-title">接收提醒</span><span className="row-sub">{p.paired ? '常驻连接你的 Opero，要你决定的事马上弹' : '还没配对：去「账号安全 → 接手机」拿配对码'}</span></span>
        <Toggle on={p.pushEnabled} onChange={(v) => up({ pushEnabled: v })} />
      </div>
      <div className="lrow">
        <span className="row-main"><span className="row-title">严重告警一直响</span><span className="row-sub">生产挂了这种，响到你点「我知道了」</span></span>
        <Toggle on={p.insistent} onChange={(v) => up({ insistent: v })} />
      </div>
      <Row title="断开这台手机" sub={`现在连的是 ${p.server}`} onClick={() => requireVerify('断开这台手机', nativeUnpair)} />
    </Section>
  )
}

/** 风格：20 套（每套 = 底色 + 字色 + 一个跳色），跟随系统时浅色 / 深色各选一套；也能自己挑三个颜色 */
function ThemePicker() {
  const s = useStore((x) => x.settings)
  const mode = s.theme === 'system' ? 'system' : s.theme === 'custom' ? 'custom' : 'fixed'
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const cur = resolveTheme(s, sysDark)
  const c = s.customTheme
  const grid = (list: ThemeDef[], on: string, pick: (k: string) => void) => (
    <div className="theme-grid">
      {list.map((t) => <ThemeCard key={t.key} t={t} on={t.key === on} onClick={() => pick(t.key)} />)}
    </div>
  )
  return (
    <>
      <div className="lrow col">
        <span className="row-main"><span className="row-title">风格</span><span className="row-sub">现在：{cur.name}{cur.desc ? ` · ${cur.desc}` : ''}</span></span>
        <Segmented value={mode} onChange={(v) => setSettings({ theme: v === 'system' ? 'system' : v === 'custom' ? 'custom' : cur.key === 'custom' ? 'amethyst' : cur.key })}
          options={[{ value: 'system', label: '跟随系统' }, { value: 'fixed', label: '固定一套' }, { value: 'custom', label: '自己配色' }]} />
      </div>
      {mode === 'system' && (
        <>
          <div className="lrow col">
            <span className="row-main"><span className="row-title">浅色时用</span></span>
            {grid(THEMES.filter((t) => t.mode === 'light'), s.themeLight, (k) => setSettings({ themeLight: k }))}
          </div>
          <div className="lrow col">
            <span className="row-main"><span className="row-title">深色时用</span></span>
            {grid(THEMES.filter((t) => t.mode === 'dark'), s.themeDark, (k) => setSettings({ themeDark: k }))}
          </div>
        </>
      )}
      {mode === 'fixed' && (
        <div className="lrow col">
          {grid(THEMES, cur.key, (k) => setSettings({ theme: k }))}
        </div>
      )}
      {mode === 'custom' && (
        <div className="lrow col">
          <span className="row-main"><span className="row-sub">两个颜色定调（底色、字色），一个颜色跳出来（按钮、我的气泡、选中）。其它颜色自动算。</span></span>
          <Segmented value={c.mode} onChange={(v) => setSettings({ customTheme: { ...c, mode: v } })}
            options={[{ value: 'light', label: '浅底' }, { value: 'dark', label: '深底' }]} />
          <div className="color-picks">
            {([['bg', '底色'], ['ink', '字色'], ['accent', '跳色']] as const).map(([k, label]) => (
              <label key={k} className="color-pick">
                <input type="color" value={c[k]} onChange={(e) => setSettings({ customTheme: { ...c, [k]: e.target.value.toUpperCase() } })} />
                <span><b>{label}</b><small>{c[k]}</small></span>
              </label>
            ))}
          </div>
          <span className="row-sub">从现成的一套开始改：</span>
          {grid(THEMES, '', (k) => { const t = THEMES.find((x) => x.key === k)!; setSettings({ customTheme: { mode: t.mode, bg: t.bg, ink: t.ink, accent: t.accent } }) })}
        </div>
      )}
    </>
  )
}
