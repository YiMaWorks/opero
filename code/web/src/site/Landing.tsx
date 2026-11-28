// 官网（opero.yimakeji.cn 中文 / opero.yimaworks.com 英文）：介绍 + 视频 + 「在线试用」（/demo，假数据，不连任何服务器）。
// 真正用 Opero 要装在自己的服务器上（像论坛系统那样：一台 Linux 服务器 → 一条命令安装 → 网页向导）。
import { useEffect, useState } from 'react'
import { AI_PROMPT, GITHUB_URL, INSTALL_CMD, INSTALL_DOC, type Lang } from './config'
import { useLang } from '../i18n'
import { LangPicker } from '../components/LangPicker'
import './site.css'
import { Hero } from './Hero'

const T = {
  zh: {
    nav: ['为什么', '看看界面', '对比', '安装'],
    demo: '在线试用',
    tagline: '你自己部署的 AI 开发团队，装在一个聊天 App 里',
    sub: 'Claude Code / Codex 员工替你查 bug、改代码、发版本、管运维。账号在你手上，AI 拿不到；你在手机上只做决定。',
    tryNote: '试用版是假数据，不连任何服务器；随便点。',
    why: '为什么做 Opero',
    whyItems: [
      ['会话一多就乱', 'AI Agent 桌面能写代码、连库、连服务器，但开了十几个会话后，谁也记不清哪个在干什么。Opero 里每个员工一个会话，有角色、有记忆。'],
      ['key 不再交给 AI', '员工通过 Opero 的 Agent 代理去连服务器、数据库、云；密码加密存在你自己的服务器上，AI 只看到结果，危险操作要你指纹。'],
      ['一个 App 打通', '开发、测试、部署、上线、日志巡检、发现 bug、在线修复、发版，每一步都有员工负责。'],
      ['你只管业务', '员工去查、去做；你看结论、点卡片。开发和运维变简单。'],
    ],
    screens: '看看界面',
    screenItems: [['日志巡检', 'screen-log-patrol'], ['修 bug', 'screen-bug-fix'], ['运维', 'screen-ops']],
    compare: '和同类项目比',
    install: '安装',
    installSub: 'Opero 一定要装在服务器上（员工要在服务器上干活），装法像以前的论坛系统：',
    steps: ['准备一台 Linux 服务器（2 核 4G 起，有 systemd）', '用 root 运行下面这一条命令，装好 Opero', '打开它给的地址：设账号 → 点「一键安装 Claude Code」→ 点「开始登录」在浏览器里授权 → 建员工。全程点按钮，不用再敲命令'],
    aiLabel: '服务器上已经有 Claude Code / Codex？也可以把这句话发给它：', manual: '用 root 运行：', doc: '完整安装说明',
    soon: '代码和安装都从 GitHub 来，不经过我们的服务器。国内服务器手动装时在命令最后加 -s -- --cn。v0.1：聊天、员工、服务器、数据库、凭证、触发器、知识库都是真的；发布、消息渠道、流程还在做。',
    github: 'GitHub',
    footer: '开源 · Apache-2.0',
  },
  en: {
    nav: ['Why', 'Screens', 'Compare', 'Install'],
    demo: 'Live demo',
    tagline: 'Your self-hosted AI dev team, in a chat app',
    sub: 'Claude Code & Codex employees that catch bugs, fix code, ship releases and run ops. Your credentials stay yours; you just make the calls from your phone.',
    tryNote: 'The demo runs on mock data and connects to nothing. Click around.',
    why: 'Why Opero',
    whyItems: [
      ['Sessions pile up', 'Agent desktops can code, query databases and SSH into servers — until you have a dozen sessions. In Opero each employee is one chat, with a role and memory.'],
      ['Keys never reach the AI', 'Employees reach servers, databases and clouds through Opero\'s agent proxy. Secrets stay encrypted on your server; the AI only sees results; risky actions need your fingerprint.'],
      ['One app, the whole loop', 'Develop, test, deploy, release, watch logs, find bugs, fix online, ship — an employee owns every step.'],
      ['Focus on the product', 'Employees investigate and do the work; you read conclusions and tap cards.'],
    ],
    screens: 'See it',
    screenItems: [['Log monitoring', 'screen-log-patrol'], ['Bug fixing', 'screen-bug-fix'], ['Ops', 'screen-ops']],
    compare: 'How Opero compares',
    install: 'Install',
    installSub: 'Opero runs on your own server (employees work there). Installing feels like the forum software of old:',
    steps: ['Get a Linux server with systemd (2 vCPU / 4 GB+)', 'Run the one command below as root to install Opero', 'Open the address it prints: create your account → click "Install Claude Code" → click "Log in" and authorize in the browser → add employees. Buttons only, no more terminal'],
    aiLabel: 'Already have Claude Code / Codex on the server? You can also just tell it:', manual: 'As root:', doc: 'Full install guide',
    soon: 'Code and installer come straight from GitHub; nothing goes through our servers. v0.1 has real chat, employees, servers, databases, vault, triggers and knowledge base; releases, message channels and flows are next.',
    github: 'GitHub',
    footer: 'Open source · Apache-2.0',
  },
}

const ROWS: { zh: string; en: string; v: string[] }[] = [
  { zh: '手机上指挥 Claude Code / Codex', en: 'Drive Claude Code / Codex from your phone', v: ['✓', '✓', '—', '—', '—'] },
  { zh: '一组常驻员工，有角色、有记忆', en: 'Long-running employees with roles and memory', v: ['✓', '—', '1', '—', '✓'] },
  { zh: '自己从日志里发现 bug', en: 'Finds bugs from logs on its own', v: ['✓', '—', '—', '✓', '—'] },
  { zh: '修复 → 检查 → 上线 → 回滚在一个聊天里', en: 'Fix → checks → release → rollback in one chat', v: ['✓', '~', '—', '~', '—'] },
  { zh: '用你已有的权限，AI 拿不到密码', en: 'Your existing access; the AI never sees secrets', v: ['✓', '—', '—', '~', '~'] },
  { zh: '自己部署、随便 fork 二开', en: 'Self-hosted, fork-and-hack', v: ['✓', '✓', '✓', '✓', '~'] },
]
const COLS = { zh: ['Opero', '手机遥控 Agent', '个人 AI 助理', 'AI SRE', 'AI 员工平台'], en: ['Opero', 'Agent remotes', 'Personal AI agents', 'AI SRE', 'AI workforce'] }

/** 命令框：整条显示（手机上换行，不截断），右上角「复制」 */
function CodeBox({ text, lang }: { text: string; lang: Lang }) {
  const [ok, setOk] = useState(false)
  return (
    <div className="site-codebox">
      <pre className="site-code"><code>{text}</code></pre>
      <button type="button" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500) }).catch(() => {}) }}>{ok ? (lang === 'zh' ? '已复制' : 'Copied') : (lang === 'zh' ? '复制' : 'Copy')}</button>
    </div>
  )
}

export default function Landing() {
  const code = useLang()
  // 英文用英文底稿；其它语言用中文底稿，页面上再按字典换成那个语言
  const lang: Lang = code === 'en' ? 'en' : 'zh'
  const zhish = code.startsWith('zh')
  const [scrolled, setScrolled] = useState(false)
  const t = T[lang]
  const m = (f: string) => `/media/${zhish ? 'zh' : 'en'}/${f}`
  useEffect(() => { document.title = `Opero — ${t.tagline}` }, [t.tagline])
  // 搜索引擎（会跑 JS 的，比如 Google）看到的语言、描述、规范地址跟着当前语言走；不跑 JS 的看 index.html 里写死的那份
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    const meta = (sel: string, make: () => HTMLElement, attr: string, val: string) => { let el = document.head.querySelector(sel); if (!el) { el = make(); document.head.appendChild(el) } el.setAttribute(attr, val) }
    meta('meta[name="description"]', () => Object.assign(document.createElement('meta'), { name: 'description' }), 'content', t.sub)
    meta('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', `${location.origin}/`)
  }, [lang, t.sub])
  return (
    <div className="site" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 40)}>
      <header className={'site-nav' + (scrolled ? '' : ' on-dark')}>
        <a className="site-brand" href="/"><img src="/media/logo.png" alt="Opero" /></a>
        <nav>{t.nav.map((n, i) => <a key={n} href={['#why', '#screens', '#compare', '#install'][i]}>{n}</a>)}</nav>
        <span className="grow" />
        {/* 手机上只留一个地球（文字会被截成「跟随系…」） */}
        <span className="site-lang-wrap" title="Language"><svg className="site-lang-ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg><LangPicker className="site-lang" /></span>
        {GITHUB_URL && <a className="site-btn ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">{t.github}</a>}
        <a className="site-btn" href="/demo">{t.demo}</a>
      </header>

      <Hero lang={lang} />

      <section className="site-sec">
        <h2>{lang === 'zh' ? '看它怎么干活' : 'Watch it work'}</h2>
        <img className="site-media" src={m('demo.gif')} alt="Opero demo" loading="lazy" />
      </section>

      <section id="why" className="site-sec">
        <h2>{t.why}</h2>
        <div className="site-grid4">
          {t.whyItems.map(([h, d], i) => (
            <div key={h} className="site-card"><b><em>{i + 1}</em>{h}</b><p>{d}</p></div>
          ))}
        </div>
        <img className="site-media" src={m('explainer.gif')} alt={t.why} loading="lazy" />
      </section>

      <section id="screens" className="site-sec">
        <h2>{t.screens}</h2>
        {/* 手机上截图太小：点了打开原图看 */}
        <a className="site-zoom" href={m('ide-to-chat.png')} target="_blank" rel="noreferrer"><img className="site-media" src={m('ide-to-chat.png')} alt={t.screens} loading="lazy" /><span>{lang === 'zh' ? '点开看大图' : 'Tap to enlarge'}</span></a>
        {t.screenItems.map(([h, f]) => (
          <figure key={f}><figcaption>{h}</figcaption><a className="site-zoom" href={m(`${f}.png`)} target="_blank" rel="noreferrer"><img className="site-media" src={m(`${f}.png`)} alt={h} loading="lazy" /><span>{lang === 'zh' ? '点开看大图' : 'Tap to enlarge'}</span></a></figure>
        ))}
      </section>

      <section id="compare" className="site-sec">
        <h2>{t.compare}</h2>
        <div className="site-table-wrap">
          <table className="site-table">
            <thead><tr><th />{COLS[lang].map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{ROWS.map((r) => <tr key={r.en}><td>{r[lang]}</td>{r.v.map((v, i) => <td key={i} className={i === 0 ? 'me' : ''}>{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
        {/* 手机：表格太挤（第一列一行两三个字、右边被截），改成一项一张卡 */}
        <div className="site-cmp-cards">
          {ROWS.map((r) => (
            <div key={r.en} className="site-cmp-card">
              <b>{r[lang]}</b>
              <div className="site-cmp-vals">{r.v.map((v, i) => <span key={i} className={(i === 0 ? 'me ' : '') + (v === '✓' ? 'yes' : v === '—' ? 'no' : 'part')}><i>{v === '—' ? '–' : v}</i>{COLS[lang][i]}</span>)}</div>
            </div>
          ))}
          <p className="site-cmp-note">{lang === 'zh' ? '✓ 有　~ 部分有　– 没有' : '✓ yes　~ partly　– no'}</p>
        </div>
      </section>

      <section id="install" className="site-sec">
        <h2>{t.install}</h2>
        <p className="site-lead">{t.installSub}</p>
        <ol className="site-steps">{t.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="site-lead">{t.manual}</p>
        <CodeBox text={INSTALL_CMD} lang={lang} />
        <p className="site-lead">{t.aiLabel}</p>
        <CodeBox text={AI_PROMPT[zhish ? 'zh' : 'en']} lang={lang} />
        <p className="site-note"><a href={INSTALL_DOC} target="_blank" rel="noreferrer">{t.doc} →</a></p>
        <p className="site-note">{t.soon}</p>
      </section>

      <footer className="site-foot">
        <img src="/media/logo.png" alt="Opero" />
        <span>{t.footer}</span>
        {GITHUB_URL && <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>}
        <a href="/demo">{t.demo}</a>
      </footer>
    </div>
  )
}
