// 官网首屏：深色背景 + 流动的极光 + 网格；左边大标题（「替你 查 bug / 改代码 / 发版本…」轮换）+ 按钮 + 安装命令；
// 右边一部真的在「动」的手机（纯 HTML/CSS，不是视频）：问题卡片 → 你点修复 → 开发员工在改 → 已上线，循环播放；
// 手机周围飘着几张小卡片（服务器负载、密码不给 AI、Claude Code / Codex）。
import { useEffect, useState } from 'react'
import { GITHUB_URL, INSTALL_CMD, type Lang } from './config'

const TXT = {
  zh: {
    eyebrow: '开源 · Apache-2.0 · 自己部署',
    l1: '你自己部署的', l2: 'AI 开发团队', l3: '装在一个聊天 App 里',
    verbPre: '替你',
    verbs: ['查 bug', '改代码', '发版本', '盯日志', '管运维'],
    sub: 'Claude Code / Codex 员工跑在你的服务器上，账号在你手上、AI 拿不到；你在手机上只做决定。',
    demo: '在线试用', star: 'GitHub', copy: '复制', copied: '已复制',
    works: '支持',
    chat: { name: 'mov 日志值班', sub: '在盯 3 个服务', issue: '支付签名失败 37 次', cause: '微信证书换了，代码还用旧的', fix: '修复', watch: '先盯着', me: '修复，修好直接发', dev: '开发：在分支上改好了，检查全过', live: 'v1.4.2 已上线 ✓', liveSub: '盯了 10 分钟，没再报错' },
    chips: ['CPU 34% · 内存 82%', '密码在你手上，AI 拿不到', '手机上点两下'],
  },
  en: {
    eyebrow: 'Open source · Apache-2.0 · Self-hosted',
    l1: 'Your self-hosted', l2: 'AI dev team', l3: 'in a chat app',
    verbPre: 'It',
    verbs: ['catches bugs', 'fixes code', 'ships releases', 'watches logs', 'runs ops'],
    sub: 'Claude Code & Codex employees run on your servers. Your credentials stay yours — the AI never sees them. You just make the calls from your phone.',
    demo: 'Live demo', star: 'GitHub', copy: 'Copy', copied: 'Copied',
    works: 'Works with',
    chat: { name: 'Log Watch', sub: 'Watching 3 services', issue: 'Payment signature failed 37x', cause: 'Cert rotated, code uses the old one', fix: 'Fix', watch: 'Watch', me: 'Fix it and ship it.', dev: 'Dev: fixed on a branch, all checks passed', live: 'v1.4.2 is live ✓', liveSub: 'Watched 10 min, no new errors' },
    chips: ['CPU 34% · RAM 82%', 'Secrets stay with you', 'Two taps on your phone'],
  },
}

export function Hero({ lang }: { lang: Lang }) {
  const t = TXT[lang]
  const [i, setI] = useState(0)
  const [copied, setCopied] = useState(false)
  useEffect(() => { const id = setInterval(() => setI((x) => (x + 1) % t.verbs.length), 2200); return () => clearInterval(id) }, [t.verbs.length])
  const copy = () => { navigator.clipboard?.writeText(INSTALL_CMD); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const c = t.chat
  return (
    <section className="hero2">
      <div className="hero2-bg" aria-hidden><i className="a1" /><i className="a2" /><i className="a3" /><i className="grid" /></div>
      <div className="hero2-in">
        <div className="hero2-copy">
          <a className="hero2-eyebrow" href={GITHUB_URL || '#install'}><span className="dot" />{t.eyebrow}<b>→</b></a>
          <h1>
            <span>{t.l1}</span>
            <span className="grad">{t.l2}</span>
            <span>{t.l3}</span>
          </h1>
          <div className="hero2-verb">
            {t.verbPre}{' '}
            <span className="rot" key={i}>{t.verbs[i]}</span>
          </div>
          <p>{t.sub}</p>
          <div className="hero2-cta">
            <a className="hb primary" href="/demo">{t.demo} →</a>
            {GITHUB_URL && <a className="hb ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">★ {t.star}</a>}
          </div>
          <button className="hero2-cmd" onClick={copy} title={t.copy}>
            <span className="p">$</span><code>{INSTALL_CMD}</code><em>{copied ? t.copied : t.copy}</em>
          </button>
          <div className="hero2-works">
            <span>{t.works}</span>
            {['Claude Code', 'Codex', 'OpenCode', 'MCP', 'ACP', 'Android'].map((x) => <b key={x}>{x}</b>)}
          </div>
        </div>

        <div className="hero2-stage">
          <div className="hero2-glow" />
          <div className="phone">
            <div className="phone-head"><span className="av">L</span><span><b>{c.name}</b><small>{c.sub}</small></span></div>
            <div className="phone-body">
              <div className="m m1"><span className="av">L</span>
                <div className="card"><em className="k red">#42</em><b>{c.issue}</b><small>{c.cause}</small>
                  <div className="btns"><span className="btn pri tap">{c.fix}</span><span className="btn">{c.watch}</span></div></div>
              </div>
              <div className="m m2 me"><span className="bub">{c.me}</span></div>
              <div className="m m3"><span className="av d">D</span><span className="pill"><i className="spin" />{c.dev}</span></div>
              <div className="m m4"><span className="av r">R</span>
                <div className="card"><em className="k blue">Release</em><b>{c.live}</b><small>{c.liveSub}</small></div>
              </div>
            </div>
            <div className="phone-foot"><span /><i /></div>
          </div>
          <div className="chip c1"><i className="bars"><b style={{ width: '34%' }} /></i>{t.chips[0]}</div>
          <div className="chip c2">🔐 {t.chips[1]}</div>
          <div className="chip c3">⚡ {t.chips[2]}</div>
        </div>
      </div>
    </section>
  )
}
