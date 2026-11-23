// 品牌：标志（对话 O）和启动页。动画和 docs/品牌/opero-splash.html 一致（标志永远是品牌紫 + 薄荷绿点，字和标志不同色）。
import { useEffect, useState } from 'react'

export const MARK_PATH = 'M24.02,65.00 A30,30 0 1 1 35.92,76.49 L19,83 Z'

/** 标志。size = 外框边长（像素）；圆的外径约为 0.73 × size。 */
export function Mark({ size = 32, dot = true }: { size?: number; dot?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="mark">
      <defs>
        <linearGradient id="mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--mark-1)" />
          <stop offset="1" stopColor="var(--mark-2)" />
        </linearGradient>
      </defs>
      <path d={MARK_PATH} fill="none" stroke="url(#mark-g)" strokeWidth="13" strokeLinejoin="round" strokeLinecap="round" />
      {dot && <circle cx="50" cy="50" r="8.5" fill="var(--mint)" />}
    </svg>
  )
}

/** 横版字标：标志当「O」+ pero */
export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <Mark size={size * 1.04} />
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
