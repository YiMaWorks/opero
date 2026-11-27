// 品牌：标志（对话 O）和启动页。动画和 docs/品牌/opero-splash.html 一致（标志永远是品牌紫 + 薄荷绿点，字和标志不同色）。
import { useEffect, useId, useState } from 'react'
import { useStore } from '../store'

export const MARK_PATH = 'M24.02,65.00 A30,30 0 1 1 35.92,76.49 L19,83 Z'

/** 标志。size = 外框边长（像素）；圆的外径约为 0.73 × size。
 *  state（活的标志，左上角用）：idle 静止；working 中间的点呼吸 + 一道光沿着气泡边流动；waiting 点变橙、跳得快、往外一圈圈波纹；down 点变灰。
 *  intro：出现时先把气泡边画出来、点再弹出来（打开页面那一下）。鼠标放上去气泡歪一下、点眨眼。减少动效的系统设置下全关 */
export type MarkState = 'idle' | 'working' | 'waiting' | 'down'
export function Mark({ size = 32, dot = true, state, intro }: { size?: number; dot?: boolean; state?: MarkState; intro?: boolean }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className={'mark' + (state ? ` mk-live mk-${state}` : '') + (intro ? ' mk-intro' : '')}>
      <defs>
        <linearGradient id={`mark-g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--mark-1)" />
          <stop offset="1" stopColor="var(--mark-2)" />
        </linearGradient>
        {state === 'working' && (
          <linearGradient id={`mark-f${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset=".5" stopColor="var(--mint)" />
            <stop offset="1" stopColor="#fff" stopOpacity=".95" />
          </linearGradient>
        )}
      </defs>
      <path className="mk-ring" d={MARK_PATH} pathLength={100} fill="none" stroke={`url(#mark-g${id})`} strokeWidth="13" strokeLinejoin="round" strokeLinecap="round" />
      {state === 'working' && <path className="mk-flow" d={MARK_PATH} pathLength={100} fill="none" stroke={`url(#mark-f${id})`} strokeWidth="13" strokeLinejoin="round" strokeLinecap="round" />}
      {state === 'waiting' && <circle className="mk-wave" cx="50" cy="50" r="8.5" />}
      {dot && <circle className="mk-dot" cx="50" cy="50" r="8.5" fill="var(--mint)" />}
    </svg>
  )
}

/** 左上角的活标志：看大家在干嘛——有事等你决定 > 有员工在干活 > AI 连不上 > 空闲；鼠标放上去写着是什么状态，有事等你时点它直接去 */
export function LiveMark({ size = 32, onWaiting }: { size?: number; onWaiting?: () => void }) {
  const working = useStore((s) => s.sessions.filter((x) => x.working).length)
  const waiting = useStore((s) => s.sessions.filter((x) => x.waiting).length)
  const down = useStore((s) => !!s.settings.aiDown)
  const state: MarkState = waiting ? 'waiting' : working ? 'working' : down ? 'down' : 'idle'
  const title = waiting ? `有 ${waiting} 个会话等你决定：点这里去看` : working ? `${working} 个员工在干活` : down ? 'AI 暂时连不上' : '大家都空着'
  return (
    <span className={'mk-wrap' + (waiting && onWaiting ? ' click' : '')} title={title} role={waiting && onWaiting ? 'button' : undefined} onClick={waiting ? onWaiting : undefined}>
      <Mark size={size} state={state} intro />
    </span>
  )
}

/** 横版字标：标志当「O」+ pero；live = 用活标志（手机会话列表顶上） */
export function Wordmark({ size = 22, live, onWaiting }: { size?: number; live?: boolean; onWaiting?: () => void }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      {live ? <LiveMark size={size * 1.04} onWaiting={onWaiting} /> : <Mark size={size * 1.04} />}
      <span>pero</span>
    </span>
  )
}

/** 启动页：动画至少放完 2.6 秒，点一下可跳过 */
export function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = setTimeout(() => setLeaving(true), reduce ? 600 : 2900)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(onDone, 320)
    return () => clearTimeout(t)
  }, [leaving, onDone])
  return (
    <div className={'splash' + (leaving ? ' done' : '')} onClick={() => setLeaving(true)}>
      <svg viewBox="0 0 360 640" preserveAspectRatio="xMidYMid meet" aria-label="Opero">
        <defs>
          <linearGradient id="splash-mg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#A496FF" />
            <stop offset="1" stopColor="#6B5BF6" />
          </linearGradient>
        </defs>
        <g className="sp-mark">
          <g transform="translate(-50 -50)">
            <path className="sp-ring" pathLength={100} d={MARK_PATH} />
            <circle className="sp-wave" cx="50" cy="50" r="8.5" />
            <circle className="sp-dot" cx="50" cy="50" r="8.5" />
          </g>
        </g>
        <text className="sp-word" x="128.73" y="300">
          {'pero'.split('').map((c, i) => (
            <tspan key={i} className="sp-ch" style={{ animationDelay: `${1.7 + 0.07 * i}s` }}>{c}</tspan>
          ))}
        </text>
        <text className="sp-slogan" x="180" y="352" textAnchor="middle">和 AI 团队聊天，搞定开发</text>
      </svg>
    </div>
  )
}
