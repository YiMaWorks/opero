// 内核卡片：一份描述（Card）→ 一个组件。按钮统一交给 onAction（= 走网关调工具 / 打开面板）。
import { useEffect, useState } from 'react'
import type { Card, CardAction } from '../types'
import { IconCheck, IconChevron } from './icons'
import { Check, CircleDashed, ExternalLink, X } from 'lucide-react'

type OnAction = (card: Card, action: CardAction, extra?: Record<string, unknown>) => void

const KIND: Record<Card['type'], { label: string; cls: string }> = {
  issue: { label: '问题', cls: 'k-danger' },
  change: { label: '改动', cls: 'k-primary' },
  release: { label: '发布', cls: 'k-info' },
  query: { label: '查询', cls: 'k-mute' },
  confirm: { label: '要你确认', cls: 'k-warn' },
  ask: { label: '提问', cls: 'k-primary' },
  generic: { label: '', cls: 'k-mute' },
  run: { label: '', cls: 'k-mute' },
}

// 按钮的轻重：主按钮（实心）只有一个、放最前；普通按钮描边；ghost 是文字链接，靠右。一眼看出该点哪个
function Actions({ card, onAction, only }: { card: Card; onAction: OnAction; only?: (a: CardAction) => boolean }) {
  const list = card.actions.filter((a) => (only ? only(a) : true))
  if (!list.length) return null
  const rank = (a: CardAction) => (a.style === 'primary' || a.style === 'danger' ? 0 : a.style === 'ghost' ? 2 : 1)
  const sorted = [...list].sort((a, b) => rank(a) - rank(b))
  return (
    <div className="card-actions">
      {sorted.map((a) => (
        <button key={a.id} className={'btn sm ' + (a.style ?? 'default') + (rank(a) === 2 ? ' link' : '')} onClick={() => onAction(card, a)}>
          {a.label}
        </button>
      ))}
    </div>
  )
}

// 卡片头：第一行小字（类型 · 标签 · 时间），第二行标题（最醒目）
function Head({ card, title, tag, tagCls, right }: { card: Card; title: string; tag?: string; tagCls?: string; right?: string }) {
  const k = KIND[card.type]
  const meta = k.label || tag || right
  return (
    <div className="card-head">
      {meta && (
        <div className="card-meta">
          {k.label && <span className={'card-kind ' + k.cls}>{k.label}</span>}
          {tag && <span className={'tag ' + (tagCls ?? '')}>{tag}</span>}
          {right && <span className="card-right">{right}</span>}
        </div>
      )}
      <div className="card-title">{title}</div>
    </div>
  )
}

const CH_CLS: Record<string, string> = { 邮件: 'ch-mail', Slack: 'ch-slack', Telegram: 'ch-tg', 飞书: 'ch-feishu' }

/** 消息助理的一条消息：谁在哪说的（小字）→ 说了什么（标题 + 原文引用，重点）→ 为什么给你看（淡）→ 去回复 */
function MsgCard({ card, onAction }: { card: Card; onAction: OnAction }) {
  const d = card.data
  const open = card.state === 'open'
  const title = String(d.title ?? '')
  const cut = title.indexOf('：')
  const from = cut > 0 ? title.slice(0, cut) : String(d.ch)
  const headline = cut > 0 ? title.slice(cut + 1) : title
  const fromWho = from.replace(new RegExp('^' + String(d.ch) + '\\s*·?\\s*'), '')
  const rows = (d.rows as string[][] | undefined) ?? []
  const why = rows.find(([k]) => k.startsWith('为什么'))?.[1]
  const orig = rows.find(([k]) => k.startsWith('原文'))
  const tone = tagTone(d.tag)
  return (
    <div className={'card msg-card' + (open && tone === 't-warn' ? ' k-warn' : '') + (open ? '' : ' is-done')}>
      <div className="card-meta">
        <span className={'ch-chip ' + (CH_CLS[String(d.ch)] ?? '')}>{String(d.ch)}</span>
        <span className="msg-from">{fromWho}</span>
        {d.tag && <span className={'tag ' + tone}>{d.tag}</span>}
      </div>
      <div className="card-title">{headline}</div>
      {orig && (
        <blockquote className="msg-quote">
          {d.original ?? orig[1]}
          {orig[0].includes('（') && <span className="msg-lang">{orig[0].slice(orig[0].indexOf('（') + 1, -1)}</span>}
        </blockquote>
      )}
      {why && <div className="msg-why"><b>为什么给你看</b>{why}</div>}
      {open ? <Actions card={card} onAction={onAction} /> : <Done card={card} />}
    </div>
  )
}

/** 汇总卡：几个大数字在前，说明在后 */
function DigestCard({ card, onAction }: { card: Card; onAction: OnAction }) {
  const d = card.data
  const rows = (d.rows as string[][]) ?? []
  return (
    <div className="card digest-card">
      <Head card={card} title={String(d.title)} tag={d.tag} tagCls={tagTone(d.tag)} />
      <div className="digest">
        {rows.map(([k, v]) => {
          const n = v.match(/^(\d+)\s*条[：:（(]?/)
          return (
            <div key={k} className={'digest-cell' + (k.includes('要你') ? ' hot' : '')}>
              <b>{n ? n[1] : '—'}</b>
              <span>{k}</span>
              <small>{n ? v.slice(n[0].length).replace(/[）)]$/, '') : v}</small>
            </div>
          )
        })}
      </div>
      {card.state === 'open' ? <Actions card={card} onAction={onAction} /> : <Done card={card} />}
    </div>
  )
}

const usd = (n: number) => (n >= 10 ? `$${n.toFixed(1)}` : n >= 0.01 ? `$${n.toFixed(2)}` : n > 0 ? '<$0.01' : '$0')

/** 一轮做完的小结：一行小字跟在员工最后一句话下面（和 KidLock 一样），不单独占一条消息。
 *  ✓ 本次完成 · 已推送 abc1234 · 3 个文件 +12 −4 · 本次 $0.42 / 会话 $3.10（订阅额度） · 发布这次改动 · 撤销 */
export function RunFoot({ card, onAction }: { card: Card; onAction: OnAction }) {
  const d = card.data
  const [more, setMore] = useState(false)
  const list = (d.list as { f: string; a: number; d: number }[] | undefined) ?? []
  const files = Number(d.files) || 0
  const git = String(d.git ?? '')
  const hash = git.match(/推送到远端（([0-9a-f]{7,})/)?.[1]
  const gitShort = hash ? `已推送 ${hash}` : /推送失败|没推上去/.test(git) ? '没推送上去' : /已提交/.test(git) ? '已提交' : git
  const open = card.state === 'open'
  return (
    <div className={'run-foot' + (d.ok ? '' : ' warn')}>
      <div className="run-foot-line">
        <span className="run-foot-state">{d.ok ? <IconCheck size={12} /> : d.stopped ? '■' : '!'} {d.ok ? '本次完成' : d.stopped ? '你让停下了' : '这一轮没做完'}</span>
        {gitShort && <span title={git} data-no-i18n={hash ? '' : undefined}>{gitShort}</span>}
        {files > 0 && (
          <button type="button" className="run-foot-chip" onClick={() => setMore(!more)} title="看改了哪些文件">
            {`${files} 个文件`} <span className="add" data-no-i18n="">+{d.ins}</span> <span className="del" data-no-i18n="">−{d.del}</span>
          </button>
        )}
        <span title={d.billing === 'sub' ? '计入订阅额度（执行器报的估算）' : '按量计费'}>本次 <b data-no-i18n="">{usd(Number(d.cost) || 0)}</b> · 会话 <b data-no-i18n="">{usd(Number(d.sessionCost) || 0)}</b>（{d.billing === 'sub' ? '订阅' : '按量'}）</span>
        {open && card.actions.map((a) => (
          <button key={a.id} type="button" title={a.label} className={'run-foot-chip' + (a.style === 'primary' ? ' strong' : '')} onClick={() => onAction(card, a)}>{a.id === 'revert' ? '撤销' : a.label.replace('这次改动', '').replace(/^发布到/, '发到 ') || '发布'}</button>
        ))}
        {!open && card.result && <span className="run-foot-result">{card.result}</span>}
      </div>
      {more && list.length > 0 && (
        <div className="run-foot-files" data-no-i18n="">
          {list.map((x) => <div key={x.f}><span className="mono">{x.f}</span><span className="add">+{x.a}</span><span className="del">−{x.d}</span></div>)}
          {files > list.length && <div className="sub">{`还有 ${files - list.length} 个文件`}</div>}
        </div>
      )}
    </div>
  )
}

function Done({ card }: { card: Card }) {
  if (card.state !== 'done' || !card.result) return null
  return <div className="card-done">{card.result}</div>
}

export function CardView({ card, onAction }: { card: Card; onAction: OnAction }) {
  const d = card.data
  const open = card.state === 'open'
  const cls = `card card-${card.type} ${KIND[card.type].cls}` + (open ? '' : ' is-done')

  switch (card.type) {
    case 'issue':
      return (
        <div className={cls}>
          <Head card={card} title={`${d.no ? `#${d.no} ` : ''}${d.title}`} tag={d.severity ?? d.tag} tagCls="t-danger" />
          <dl className="kv">
            {((d.rows ?? []) as string[][]).map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
          {Array.isArray(d.evidence) && <div className="chips">{(d.evidence as string[]).map((e) => <span key={e} className="chip">{e}</span>)}</div>}
          {d.sample && <pre className="console small" data-no-i18n="">{String(d.sample)}</pre>}
          {open ? <Actions card={card} onAction={onAction} /> : <Done card={card} />}
        </div>
      )

    case 'change':
      return (
        <div className={cls}>
          <Head card={card} title={`${d.project} · ${d.branch}`} />
          <div className="files">
            {(d.files as { name: string; add: number; del: number }[]).map((f) => (
              <div key={f.name} className="file-row">
                <span className="mono">{f.name}</span>
                <span className="mono add">+{f.add}</span>
                <span className="mono del">−{f.del}</span>
              </div>
            ))}
          </div>
          <div className="checks">
            <span className="checks-label">检查</span>
            {(d.checks as string[]).map((c) => (
              <span key={c} className="check"><IconCheck size={14} />{c}</span>
            ))}
          </div>
          <div className="sub">{d.ci}</div>
          {d.merged && (
            <div className={'banner ' + (d.reverted ? 'b-warn' : 'b-ok')}>
              {d.reverted ? '已撤销合并，main 回到改动前' : <><IconCheck size={14} /> 检查通过，已自动合并到 main</>}
            </div>
          )}
          <Actions card={card} onAction={onAction} only={(a) => !(d.reverted && a.id === 'revert')} />
        </div>
      )

    case 'release': {
      if (d.rel) return <ReleaseCard card={card} onAction={onAction} />
      const steps = d.steps as string[]
      const step = d.step as number // 正在做第几步；= steps.length 表示都做完
      return (
        <div className={cls}>
          <Head card={card} title={`${d.app} → ${d.env} ${d.version}`} />
          <div className="steps">
            {steps.map((s, i) => (
              <div key={s} className={'step ' + (i < step ? 'done' : i === step ? 'doing' : 'todo')}>
                <span className="step-dot">{i < step ? <IconCheck size={18} /> : <i />}</span>
                <span className="step-label">{s}</span>
              </div>
            ))}
          </div>
          {step >= steps.length - 1 && (
            <div className={'banner ' + (step >= steps.length ? 'b-ok' : 'b-info')}>
              {step >= steps.length
                ? `盯了 ${d.total} 分钟，没有新的 ${d.watchFor}`
                : `盯生产报错 ${d.watched} / ${d.total} 分钟 · 没有新的 ${d.watchFor}`}
            </div>
          )}
          <div className="card-foot">
            <span className="sub">有异常会自动回滚</span>
            <Actions card={card} onAction={onAction} />
          </div>
        </div>
      )
    }

    case 'query':
      return (
        <div className={cls}>
          <Head card={card} title={d.source} right={`${d.ms} ms · ${d.total} 行`} />
          <div className="sql mono">{d.sql}</div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr>{(d.cols as string[]).map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {(d.rows as string[][]).map((r, i) => (
                  <tr key={i}>{r.map((v, j) => <td key={j} className={/failed|ERR/.test(v) ? 'bad' : ''}>{v}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <Actions card={card} onAction={onAction} />
          {card.result && <div className="card-done">{card.result}</div>}
        </div>
      )

    case 'confirm':
      return <ConfirmCard card={card} onAction={onAction} cls={cls} />

    case 'ask':
      return <AskCard card={card} onAction={onAction} />

    case 'run':
      return <RunFoot card={card} onAction={onAction} />

    default:
      if (d.ch) return <MsgCard card={card} onAction={onAction} />
      if (d.rows && (d.rows as string[][]).every(([, v]) => /^\d+\s*条/.test(v))) return <DigestCard card={card} onAction={onAction} />
      return (
        <div className={cls + (open && tagTone(d.tag) === 't-warn' ? ' k-warn' : '')}>
          <Head card={card} title={d.title} tag={d.tag} tagCls={tagTone(d.tag)} />
          {d.rows && (
            <dl className="kv">
              {(d.rows as string[][]).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          )}
          {typeof d.url === 'string' && /^https?:\/\//.test(d.url) && <a className="card-link" href={d.url} target="_blank" rel="noreferrer">打开 ↗</a>}
          {open ? <Actions card={card} onAction={onAction} /> : <Done card={card} />}
        </div>
      )
  }
}

/** 要你确认：先说人话（要做什么、为什么要你点），命令收起来，想看再展开 */
function ConfirmCard({ card, onAction, cls }: { card: Card; onAction: OnAction; cls: string }) {
  const d = card.data
  const open = card.state === 'open'
  const [show, setShow] = useState(false)
  const detail = String(d.detail ?? '')
  return (
    <div className={cls}>
      <Head card={card} title={d.title} tag={d.tag} tagCls="t-danger" />
      {d.note && <p className="confirm-who">{d.note}</p>}
      {open && d.why && <div className="banner b-warn">{d.why}</div>}
      {detail && (
        <div className="confirm-cmd">
          <button type="button" className="confirm-toggle" onClick={() => setShow(!show)}>{show ? '收起' : '看具体命令 / 内容'}</button>
          {show && <pre className="sql mono confirm-detail" data-no-i18n="">{detail}</pre>}
        </div>
      )}
      {open ? <Actions card={card} onAction={onAction} /> : <Done card={card} />}
    </div>
  )
}

function AskCard({ card, onAction }: { card: Card; onAction: OnAction }) {
  const d = card.data
  const [pick, setPick] = useState<number>(d.recommend ?? 0)
  const open = card.state === 'open'
  return (
    <div className={'card card-ask k-primary' + (open ? '' : ' is-done')}>
      <Head card={card} title={d.title} />
      <div className="options">
        {(d.options as string[]).map((o, i) => (
          <button key={o} className={'option' + (pick === i ? ' on' : '')} disabled={!open} onClick={() => setPick(i)}>
            <i className="radio" />{o}
          </button>
        ))}
      </div>
      {open ? (
        <div className="card-foot">
          <span className="sub">AI 推荐的已选好</span>
          <div className="card-actions">
            {card.actions.map((a) => (
              <button key={a.id} className={'btn ' + (a.style ?? 'default')} onClick={() => onAction(card, a, { answer: d.options[pick] })}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ) : <Done card={card} />}
    </div>
  )
}

/** 标签颜色：要你做点什么的 = 橙；做完 / 正常 = 绿；其它 = 灰（不要满屏绿） */
function tagTone(tag?: string) {
  if (!tag) return 't-mute'
  if (/要你|等你|待/.test(tag)) return 't-warn'
  if (/完成|已|通过|正常/.test(tag)) return 't-ok'
  return 't-mute'
}

// ---------- 发布卡片（后台 releases.card：data.rel 有值的新版） ----------
interface RelStep { k: string; label: string; s: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; msg: string; t0: number; t1: number; est: number }
const dur = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} 秒` : s < 3600 ? `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒` : `${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分` }
const STATUS: Record<string, { label: string; cls: string }> = { running: { label: '发布中', cls: 'run' }, success: { label: '发布成功', cls: 'ok' }, failed: { label: '发布失败', cls: 'bad' } }

/** 一次发布：环境、版本、每一步（状态、用时、上次用了多久）、总进度；失败给原因和日志，成功给回滚。进行中时每秒走表 */
function ReleaseCard({ card, onAction }: { card: Card; onAction: OnAction }) {
  const d = card.data
  const steps = (d.steps ?? []) as RelStep[]
  const running = d.status === 'running'
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!running) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [running])
  const end = running ? now : Number(d.ended) || now
  // 总进度：做完的步骤 + 正在做的那步按上次用时估一个比例（最多算 90%）
  const doneN = steps.filter((x) => x.s === 'done').length
  const cur = steps.find((x) => x.s === 'running')
  const part = cur && cur.est ? Math.min(0.9, (now - cur.t0) / cur.est) : cur ? 0.3 : 0
  const pct = d.status === 'success' ? 100 : Math.round(((doneN + part) / Math.max(1, steps.length)) * 100)
  const st = STATUS[String(d.status)] ?? STATUS.running
  const [log, setLog] = useState(false)
  return (
    <div className={'card rel2 k-' + (d.status === 'failed' ? 'danger' : d.prod ? 'warn' : 'info') + (running ? '' : ' is-done')}>
      <div className="rel2-head">
        <span className="card-kind k-info">发布</span>
        {d.env && <span className={'rel2-env' + (d.prod ? ' prod' : '')}>{d.env}</span>}
        {d.rollback && <span className="rel2-env">回滚</span>}
        <span className={'rel2-status ' + st.cls}>{running ? <i className="spinner" /> : d.status === 'success' ? <Check size={13} strokeWidth={2.6} /> : <X size={13} strokeWidth={2.6} />}{st.label}<span className="rel2-took">{dur(end - Number(d.started))}</span></span>
      </div>
      <div className="rel2-title"><b>{d.app}</b><span className="rel2-arrow">→</span><b>{d.target}</b></div>
      <div className="rel2-ver">
        {d.version ? <span className="mono rel2-v" data-no-i18n="">{d.version}</span> : <span className="rel2-wait">取最新提交…</span>}
        {d.sha && !String(d.sha).startsWith(String(d.version)) && <span className="mono rel2-sha" title={`提交 ${d.sha}`} data-no-i18n="">{String(d.sha).slice(0, 7)}</span>}
        {d.comp && <span>{d.comp}</span>}
        <span>{d.by}</span>
      </div>
      {d.note && <p className="rel2-note" data-no-i18n="">{d.note}</p>}
      <div className={'rel2-bar ' + st.cls}><b style={{ width: `${Math.max(3, pct)}%` }} /></div>
      <ol className="rel2-steps">
        {steps.map((x) => (
          <li key={x.k} className={'rel2-step ' + x.s}>
            <span className="rel2-dot">{x.s === 'done' ? <Check size={12} strokeWidth={3} /> : x.s === 'failed' ? <X size={12} strokeWidth={3} /> : x.s === 'running' ? <i className="spinner" /> : <CircleDashed size={14} strokeWidth={2} />}</span>
            <span className="rel2-step-main">
              <b>{x.label}</b>
              {x.msg && <small data-no-i18n="">{x.msg}</small>}
              {x.k === 'build' && d.url && <a href={d.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>看流水线<ExternalLink size={11} /></a>}
            </span>
            <span className="rel2-time">
              {x.s === 'done' || x.s === 'failed' ? (x.t0 && x.t1 ? dur(x.t1 - x.t0) : '')
                : x.s === 'running' ? `${dur(now - x.t0)}${x.est ? ` / 约 ${dur(x.est)}` : ''}`
                : x.est ? `约 ${dur(x.est)}` : ''}
            </span>
          </li>
        ))}
      </ol>
      {d.status === 'failed' && (
        <div className="rel2-fail">
          <b data-no-i18n="">{d.reason || '发布失败'}</b>
          {d.log && <button type="button" className="rel2-logbtn" onClick={() => setLog(!log)}>{log ? '收起日志' : `看日志（${String(d.log).split('\n').length} 行）`}<IconChevron /></button>}
          {d.log && log && <pre className="console small" data-no-i18n="">{d.log}</pre>}
          {d.autoFix && <span className="rel2-hint">已把原因发给员工接着修</span>}
        </div>
      )}
      {d.status === 'success' && <div className="rel2-ok"><Check size={14} strokeWidth={2.6} />{d.pkg ? `已存进安装包 · ${d.pkg}${d.version ? ` · ${d.version}` : ''}` : `线上已经是 ${d.version}${(d.servers ?? []).length ? ` · ${(d.servers as string[]).join('、')}` : ''}`}</div>}
      <Actions card={card} onAction={onAction} />
    </div>
  )
}
