// 顶部「风格」按钮弹出的快捷切换：点一下马上换；跟随系统时分别点浅色 / 深色用哪套。自己配色在设置页。
import { setSettings, useStore } from '../store'
import { THEMES, resolveTheme } from '../themes'
import { ThemeCard } from './ThemeCard'
import { Sheet, Toggle } from './ui'

export function ThemeQuick({ onClose, onMore }: { onClose: () => void; onMore: () => void }) {
  const s = useStore((x) => x.settings)
  const follow = s.theme === 'system'
  const cur = resolveTheme(s, window.matchMedia('(prefers-color-scheme: dark)').matches)
  const pick = (k: string, mode: 'light' | 'dark') => {
    if (follow) setSettings(mode === 'light' ? { themeLight: k } : { themeDark: k })
    else setSettings({ theme: k })
  }
  const on = (k: string, mode: 'light' | 'dark') => (follow ? (mode === 'light' ? s.themeLight : s.themeDark) === k : cur.key === k)
  return (
    <Sheet title="风格" onClose={onClose} size="lg">
      <div className="tq">
        <div className="tq-follow">
          <span><b>跟随系统</b><small>{follow ? '手机 / 电脑是浅色就用上面一排选中的，深色用下面一排' : `现在固定用「${cur.name}」`}</small></span>
          <Toggle on={follow} onChange={(v) => setSettings({ theme: v ? 'system' : cur.key === 'custom' ? s.themeLight : cur.key })} />
        </div>
        {(['light', 'dark'] as const).map((mode) => (
          <div key={mode} className="tq-row">
            <span className="tq-label">{mode === 'light' ? '浅色' : '深色'}</span>
            <div className="tq-strip">
              {THEMES.filter((t) => t.mode === mode).map((t) => (
                <ThemeCard key={t.key} t={t} on={on(t.key, mode)} onClick={() => pick(t.key, mode)} />
              ))}
            </div>
          </div>
        ))}
        <button className="btn default block" onClick={onMore}>自己配色、更多设置</button>
      </div>
    </Sheet>
  )
}
