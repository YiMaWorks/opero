// 主题（风格）：精选 14 套，每套有名字、有出处（参考业界做得好看的配色），不硬凑。
// 大多数颜色由「底色 / 字色 / 跳色」算出来；哪套需要更讲究（左栏颜色、面板、毛玻璃背景、气泡渐变）就在那一套里单独写，覆盖算出来的值。
// 加一套 = 在 THEMES 里加一项。设置里还能「自己配色」（只挑三个颜色，其余算出来）。

export interface ThemeDef {
  key: string
  name: string
  mode: 'light' | 'dark'
  /** 页面底色 */
  bg: string
  /** 正文字色 */
  ink: string
  /** 跳色：按钮、我的气泡、选中 */
  accent: string
  /** 圆角（默认 10） */
  radius?: number
  /** 一句话：什么感觉、参考了谁 */
  desc?: string
  // ---- 下面都是可选的讲究（不写就按上面三个颜色算） ----
  /** 面板（列表、卡片、顶栏）/ 次级面板 */
  panel?: string
  panel2?: string
  /** 分割线 */
  line?: string
  /** 左边窄栏：渐变两端（一样就是纯色）、图标文字颜色、选中底色 */
  rail?: [string, string]
  railText?: string
  railOn?: string
  /** 左栏选中项的图标文字颜色 */
  railOnText?: string
  /** 我的气泡渐变的另一端 */
  accent2?: string
  /** 毛玻璃：整页背景（渐变），面板半透明 + 模糊 */
  wallpaper?: string
}

export const THEMES: ThemeDef[] = [
  // ---------- 浅色 ----------
  { key: 'amethyst', name: '紫晶', mode: 'light', bg: '#F4F5F8', ink: '#14161F', accent: '#5B4FE9', accent2: '#8B5CF6',
    rail: ['#2C2848', '#3A3062'], desc: 'Opero 默认：冷灰 + 品牌紫，左栏深紫' },
  { key: 'glacier', name: '冰川', mode: 'light', bg: '#F3F5F8', ink: '#101826', accent: '#2B59FF', accent2: '#4F7BFF',
    rail: ['#0F1A2B', '#16233A'], railText: '#B4C0D1', desc: '冷灰 + 电光蓝，深海军蓝左栏（KidLock 冰川）' },
  { key: 'wechat', name: '微绿', mode: 'light', bg: '#F5F5F5', ink: '#191919', accent: '#07C160', accent2: '#07C160', radius: 8,
    panel: '#FFFFFF', panel2: '#EDEDED', line: '#E3E3E3', rail: ['#E9E9E9', '#E9E9E9'], railText: '#6B6B6B', railOn: 'rgba(0,0,0,.07)', railOnText: '#07C160',
    desc: '照微信电脑版：浅灰、白、微信绿' },
  { key: 'paper', name: '纸本', mode: 'light', bg: '#F3F1EA', ink: '#1C1B17', accent: '#B8361E', accent2: '#B8361E', radius: 4,
    panel: '#FBFAF6', panel2: '#ECE9E0', line: '#D9D5C9', rail: ['#1C1B17', '#1C1B17'], railText: '#B9B4A7',
    desc: '纸 + 墨 + 印章红，方角，像一本书（KidLock 纸本）' },
  { key: 'cream', name: '奶油', mode: 'light', bg: '#F3EEE3', ink: '#111111', accent: '#D9541E', accent2: '#E8743F', radius: 12,
    panel: '#FBF8F2', rail: ['#111111', '#1E1C19'], railText: '#BDB5A6', desc: '奶油 + 墨黑 + 焦橙（硅谷创业公司官网那种）' },
  { key: 'ink', name: '墨白', mode: 'light', bg: '#FAFAFA', ink: '#0A0A0A', accent: '#0A0A0A', accent2: '#3F3F46', radius: 8,
    panel: '#FFFFFF', panel2: '#F4F4F5', line: '#E4E4E7', rail: ['#0A0A0A', '#0A0A0A'], railText: '#A1A1AA',
    desc: '黑白极简，只有状态色有颜色（Vercel 那种）' },
  { key: 'mist', name: '晨雾', mode: 'light', bg: '#F4F3FB', ink: '#1B1830', accent: '#6D5BF7', accent2: '#4FB3F6', radius: 14,
    wallpaper: 'radial-gradient(45% 50% at 10% 0%, rgba(167,139,250,.35), transparent 70%), radial-gradient(40% 45% at 95% 10%, rgba(125,211,252,.35), transparent 70%), radial-gradient(50% 50% at 70% 100%, rgba(244,114,182,.22), transparent 70%), #F4F3FB',
    rail: ['rgba(255,255,255,.55)', 'rgba(255,255,255,.4)'], railText: '#5B5675', railOn: 'rgba(109,91,247,.14)',
    desc: '淡紫淡蓝的雾，毛玻璃（KidLock 晨雾）' },
  // ---------- 深色 ----------
  { key: 'slate', name: '石板', mode: 'dark', bg: '#0F1117', ink: '#E9EBF1', accent: '#7C6CFF', accent2: '#9B8CFF',
    rail: ['#1E1B33', '#2A2448'], desc: 'Opero 默认深色：蓝紫灰 + 品牌紫（Linear 那种）' },
  { key: 'night', name: '夜航', mode: 'dark', bg: '#0D0E10', ink: '#F2F3F4', accent: '#C6F432', accent2: '#A8E01A', radius: 8,
    panel: '#141518', panel2: '#1B1D21', line: '#26292E', rail: ['#0D0E10', '#0D0E10'], railText: '#8A9098', railOn: '#1B1D21',
    desc: '近黑 + 荧光绿（KidLock 夜航）' },
  { key: 'charcoal', name: '炭灰', mode: 'dark', bg: '#1E1E1C', ink: '#EFE7D8', accent: '#2F6BFF', accent2: '#5B8BFF',
    rail: ['#151513', '#151513'], railText: '#A39C8F', desc: '炭灰 + 沙色字 + 电光蓝（能源公司官网那种）' },
  { key: 'navy', name: '海军', mode: 'dark', bg: '#0F1B3D', ink: '#FFFFFF', accent: '#FF3D8B', accent2: '#FF6FA8', radius: 14,
    panel: '#16244D', panel2: '#1C2B57', rail: ['#0A1430', '#0A1430'], railText: '#9AA6C8', desc: '海军蓝 + 白 + 亮粉（金融 App 那种）' },
  { key: 'dusk', name: '暮光', mode: 'dark', bg: '#17130E', ink: '#F3E9DA', accent: '#F2A93B', accent2: '#F7C46C',
    rail: ['#100D09', '#100D09'], railText: '#A8998A', desc: '暖黑 + 琥珀，晚上看不刺眼（KidLock 暮光）' },
  { key: 'aero', name: '琉璃', mode: 'dark', bg: '#0A1120', ink: '#F3F7FC', accent: '#5CCBFF', accent2: '#7AA8FF', radius: 12,
    wallpaper: 'radial-gradient(40% 48% at 26% 4%, rgba(58,124,232,.50), transparent 70%), radial-gradient(36% 44% at 88% 16%, rgba(122,92,224,.34), transparent 70%), radial-gradient(46% 52% at 68% 100%, rgba(28,160,172,.34), transparent 70%), linear-gradient(180deg, #0C1528, #0A1120 60%, #0B1322)',
    rail: ['rgba(12,20,38,.6)', 'rgba(12,20,38,.45)'], railText: '#B9C7DA', desc: '深蓝毛玻璃 + 天蓝（KidLock 琉璃）' },
  { key: 'contrast', name: '高对比', mode: 'dark', bg: '#000000', ink: '#FFFFFF', accent: '#FFD60A', accent2: '#FFD60A', radius: 6,
    panel: '#0B0B0B', panel2: '#161616', line: '#3A3A3A', rail: ['#000000', '#000000'], railText: '#D4D4D4', railOn: '#262626',
    desc: '纯黑 + 白 + 明黄，看得最清楚' },
]

export const DEFAULT_LIGHT = 'amethyst'
export const DEFAULT_DARK = 'slate'
export const themeByKey = (k: string) => THEMES.find((t) => t.key === k)

// ---------- 颜色计算 ----------
type RGB = [number, number, number]
const hex = (h: string): RGB => {
  let s = h.replace('#', '')
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  const n = parseInt(s.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()
/** a 和 b 混合，t = b 占的比例 */
export const mix = (a: string, b: string, t: number) => { const x = hex(a), y = hex(b); return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]) }
const rgba = (c: string, a: number) => { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a})` }
/** 相对亮度 0~1 */
export const lum = (c: string) => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  const [r, g, b] = hex(c)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

const STATUS = {
  light: { ok: '#12A150', warn: '#C26A00', danger: '#D92D20', info: '#2B59FF' },
  dark: { ok: '#4ADE80', warn: '#FBBF24', danger: '#FF6B6B', info: '#8FB4FF' },
}

/** 三个颜色 → 全部 CSS 变量（styles.css 里用的那些） */
export function themeVars(t: ThemeDef): Record<string, string> {
  const dark = t.mode === 'dark'
  const { bg, ink, accent } = t
  const glass = !!t.wallpaper
  const panelSolid = t.panel ?? (dark ? mix(bg, ink, 0.045) : (lum(bg) > 0.93 ? '#FFFFFF' : mix(bg, '#FFFFFF', 0.62)))
  const panel = glass ? rgba(panelSolid, dark ? 0.55 : 0.62) : panelSolid
  const panel2 = t.panel2 ?? (dark ? mix(bg, ink, 0.08) : mix(bg, ink, 0.035))
  const st = STATUS[t.mode]
  // 跳色上面的字：跳色太亮（荧光绿、明黄）就用深字
  const onAccent = contrast(accent, '#FFFFFF') >= 2.6 ? '#FFFFFF' : (dark ? bg : '#111111')
  // 跳色当文字用时要看得清：和面板对比不够就往字色那边拉
  let accentText = accent
  for (let i = 1; i <= 6 && contrast(accentText, panelSolid) < 4; i++) accentText = mix(accent, ink, i * 0.12)
  const accentSoft = mix(panelSolid, accent, dark ? 0.16 : 0.1)
  // 左边一栏：浅色主题用字色（深）做底，深色主题比底色再深一点；都带一点跳色
  const railA = t.rail?.[0] ?? (dark ? mix(bg, '#000000', 0.35) : mix(ink, accent, 0.1))
  const railB = t.rail?.[1] ?? (dark ? mix(railA, accent, 0.1) : mix(ink, accent, 0.22))
  const railLight = !railA.startsWith('rgba') && lum(railA) > 0.5
  const railText = t.railText ?? mix('#FFFFFF', railA.startsWith('rgba') ? bg : railA, 0.32)
  const soft = (c: string) => (dark ? rgba(c, 0.13) : mix('#FFFFFF', c, 0.1))
  return {
    '--primary': accent,
    '--primary-2': t.accent2 ?? mix(accent, dark ? '#FFFFFF' : ink, 0.16),
    '--violet': t.accent2 ?? mix(accent, dark ? '#FFFFFF' : ink, 0.16),
    '--on-primary': onAccent,
    '--primary-soft': accentSoft,
    '--primary-text': accentText,
    '--ok': st.ok, '--ok-soft': soft(st.ok),
    '--warn': st.warn, '--warn-soft': soft(st.warn),
    '--danger': st.danger, '--danger-soft': soft(st.danger),
    '--info': st.info, '--info-soft': soft(st.info), '--info-text': st.info,
    '--badge': '#F43F5E',
    '--bg': glass ? 'transparent' : bg,
    '--bg-solid': bg,
    '--panel': panel,
    '--panel-2': glass ? rgba(panel2, dark ? 0.4 : 0.45) : panel2,
    '--nav': `linear-gradient(180deg, ${railA}, ${railB})`,
    '--nav-solid': railA.startsWith('rgba') ? bg : railA,
    '--nav-2': t.railOn ?? (railLight ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.14)'),
    '--nav-text': railText,
    '--nav-on-text': t.railOnText ?? (railLight || (glass && !dark) ? ink : '#FFFFFF'),
    '--wallpaper': t.wallpaper ?? bg,
    '--panel-solid': panelSolid,
    '--text': ink,
    '--sub': mix(ink, bg, 0.32),
    '--faint': mix(ink, bg, 0.5),
    '--line': t.line ?? (glass ? rgba(ink, dark ? 0.12 : 0.1) : mix(bg, ink, dark ? 0.14 : 0.11)),
    '--line-soft': glass ? rgba(ink, dark ? 0.08 : 0.06) : mix(bg, ink, dark ? 0.09 : 0.065),
    '--hover': glass ? rgba(ink, 0.05) : mix(panelSolid, ink, 0.04),
    '--soft': glass ? rgba(ink, dark ? 0.09 : 0.06) : mix(bg, ink, dark ? 0.09 : 0.05),
    '--pinned': glass ? rgba(ink, 0.04) : mix(panel2, ink, 0.03),
    '--sys': mix(bg, ink, 0.08),
    '--code-bg': panel2,
    '--add': rgba(st.ok, 0.16), '--del': rgba(st.danger, 0.15), '--hunk': accentSoft,
    '--shadow': dark ? '0 1px 3px rgba(0,0,0,.3)' : `0 1px 3px ${rgba(ink, 0.07)}`,
    '--shadow-lg': dark ? '0 24px 60px rgba(0,0,0,.45)' : `0 24px 60px ${rgba(ink, 0.14)}`,
    '--mask': dark ? 'rgba(0,0,0,.6)' : rgba(ink, 0.42),
    '--radius': `${t.radius ?? 10}px`,
    '--mark-1': dark ? '#A496FF' : '#7C6CFF',
    '--mark-2': dark ? '#6B5BF6' : '#4F3FE0',
  }
}

/** 套用到页面；返回实际用的那套 */
export function applyTheme(t: ThemeDef) {
  const root = document.documentElement
  for (const [k, v] of Object.entries(themeVars(t))) root.style.setProperty(k, v)
  root.dataset.theme = t.mode
  root.dataset.glass = t.wallpaper ? '1' : ''
  root.style.colorScheme = t.mode
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeVars(t)['--panel-solid'])
  return t
}

/** 设置 → 现在该用哪一套（老设置里的 light / dark 也认） */
export function resolveTheme(
  s: { theme: string; themeLight?: string; themeDark?: string; customTheme?: { mode: 'light' | 'dark'; bg: string; ink: string; accent: string } },
  systemDark: boolean,
): ThemeDef {
  const light = themeByKey(s.themeLight ?? '') ?? themeByKey(DEFAULT_LIGHT)!
  const dark = themeByKey(s.themeDark ?? '') ?? themeByKey(DEFAULT_DARK)!
  if (s.theme === 'custom' && s.customTheme) return { key: 'custom', name: '我的配色', ...s.customTheme }
  if (s.theme === 'light') return light
  if (s.theme === 'dark') return dark
  return themeByKey(s.theme) ?? (systemDark ? dark : light)
}
