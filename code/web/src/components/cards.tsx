// 内核卡片：一份描述（Card）→ 一个组件。按钮统一交给 onAction（= 走网关调工具 / 打开面板）。
import { useState } from 'react'
import type { Card, CardAction } from '../types'
import { IconCheck, IconChevron } from './icons'

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

/** 一轮做完的小结：做完没有 + 提交推送（一行）→ 改了几个文件（点开看清单）→ 用量 → 撤销 / 发布 */
function RunCard({ card, onAction }: { card: Card; onAction: OnAction }) {
  const d = card.data
  const [more, setMore] = useState(false)
  const list = (d.list as { f: string; a: number; d: number }[] | undefined) ?? []
  const state = d.ok ? 'ok' : d.stopped ? 'stop' : 'fail'
  const head = d.ok ? '本次完成' : d.stopped ? '你让停下了' : '这一轮没做完'
  const files = Number(d.files) || 0
  return (
    <div className={'card run-card run-' + state}>
      <div className="run-head">
        <span className="run-ico">{d.ok ? <IconCheck size={14} /> : d.stopped ? '■' : '!'}</span>
        <span className="run-title">{head}</span>
        {d.git && <span className="run-git">{String(d.git)}</span>}
      </div>
      {files > 0 && (
        <>
          <button className={'run-diff' + (more ? ' open' : '')} onClick={() => setMore(!more)}>
            <span className="run-files">{`${files} 个文件`}</span>
            <span className="mono add" data-no-i18n="">+{d.ins}</span>
            <span className="mono del" data-no-i18n="">−{d.del}</span>
            <span className="run-bar" aria-hidden><i style={{ flexGrow: Number(d.ins) || 0 }} /><b style={{ flexGrow: Number(d.del) || 0 }} /></span>
            <IconChevron />
          </button>
          {more && (
            <div className="run-list" data-no-i18n="">
              {list.map((x) => (
                <div key={x.f} className="run-file"><span className="mono">{x.f}</span><span className="mono add">+{x.a}</span><span className="mono del">−{x.d}</span></div>
              ))}
              {files > list.length && <div className="sub">{`还有 ${files - list.length} 个文件`}</div>}
            </div>
          )}
        </>
      )}
      <div className="run-usage">
        <span>本次</span><b data-no-i18n="">{usd(Number(d.cost) || 0)}</b>
        <span className="run-dot" />
        <span>会话累计</span><b data-no-i18n="">{usd(Number(d.sessionCost) || 0)}</b>
        <span className={'run-bill ' + d.billing}>{d.billing === 'sub' ? '计入订阅额度' : '按量计费'}</span>
      </div>
      {card.state === 'open' ? <Actions card={card} onAction={onAction} /> : <Done card={card} />}
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
      return (
        <div className={cls}>
          <Head card={card} title={d.title} tag={d.tag} tagCls="t-danger" />
          <div className="sql mono">{d.detail}</div>
          <p className="note">{d.note}</p>
          {open && <div className="banner b-warn">{d.why}</div>}
          {open ? <Actions card={card} onAction={onAction} /> : <Done card={card} />}
        </div>
      )

    case 'ask':
      return <AskCard card={card} onAction={onAction} />

    case 'run':
      return <RunCard card={card} onAction={onAction} />

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
