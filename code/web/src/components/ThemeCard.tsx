// 风格小样：一个缩小的 Opero 界面（左栏 · 顶上两行字 · 一张卡片带跳色）。设置页、顶部快捷切换都用
import { themeVars, type ThemeDef } from '../themes'

export function ThemeCard({ t, on, onClick }: { t: ThemeDef; on: boolean; onClick: () => void }) {
  const v = themeVars(t)
  const r = Math.min(t.radius ?? 10, 12)
  return (
    <button className={'theme-card' + (on ? ' on' : '')} onClick={onClick} title={t.desc}>
      <span className="theme-sample" style={{ background: v['--wallpaper'], borderRadius: r }}>
        <span className="tsm-rail" style={{ background: v['--nav'] }}>
          <i style={{ background: t.accent }} />
          <i style={{ background: v['--nav-text'] }} />
          <i style={{ background: v['--nav-text'] }} />
        </span>
        <span className="tsm-main">
          <i className="tsm-line" style={{ background: t.ink }} />
          <i className="tsm-line short" style={{ background: v['--faint'] }} />
          <span className="tsm-card" style={{ background: v['--panel'], borderColor: v['--line'], borderRadius: Math.max(3, r / 2) }}>
            <i className="tsm-pill" style={{ background: `linear-gradient(135deg, ${t.accent}, ${v['--primary-2']})` }} />
            <i className="tsm-line" style={{ background: v['--faint'] }} />
          </span>
        </span>
      </span>
      <span className="theme-name">{on && <b className="theme-check">✓</b>}{t.name}</span>
    </button>
  )
}
