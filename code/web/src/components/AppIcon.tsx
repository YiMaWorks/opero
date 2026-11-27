// 应用的图标：Lucide（https://lucide.dev，ISC 许可，线框风格和我们自己画的图标一致）+ 每个应用一个颜色，浅色底、同色图标。
// 应用页磁贴、「这套 Opero 的配置」、电脑侧栏都用这一套；新加应用在 APP_ICONS 里加一行。
import type { LucideIcon } from 'lucide-react'
import {
  BookOpen, Bot, ChartColumn, Database, FileClock, Globe, Inbox, Info, KeyRound, LayoutGrid, MessagesSquare, Puzzle, Rocket,
  Server, Settings, ShieldAlert, Workflow, Zap,
} from 'lucide-react'

export const APP_ICONS: Record<string, { icon: LucideIcon; color: string }> = {
  servers: { icon: Server, color: '#3B82F6' },
  credentials: { icon: KeyRound, color: '#F59E0B' },
  data: { icon: Database, color: '#0EA5A4' },
  releases: { icon: Rocket, color: '#7C3AED' },
  issues: { icon: ShieldAlert, color: '#EF4444' },
  domains: { icon: Globe, color: '#0EA5E9' },
  inbox: { icon: Inbox, color: '#6366F1' },
  channels: { icon: MessagesSquare, color: '#10B981' },
  triggers: { icon: Zap, color: '#F97316' },
  knowledge: { icon: BookOpen, color: '#22A06B' },
  audit: { icon: FileClock, color: '#64748B' },
  flows: { icon: Workflow, color: '#EC4899' },
  plugins: { icon: Puzzle, color: '#8B5CF6' },
  executors: { icon: Bot, color: '#5B4FE9' },
  usage: { icon: ChartColumn, color: '#0891B2' },
  system: { icon: Settings, color: '#64748B' },
  about: { icon: Info, color: '#94A3B8' },
  apps: { icon: LayoutGrid, color: '#5B4FE9' },
}

/** 圆角方块里一个图标（size = 方块边长）；没登记的应用用名字第一个字。
 *  plain：不要底色、只要彩色线框图标（size = 图标本身大小）——侧栏这种小地方用，浅色底 + 同色线条在小尺寸下看着像重影 */
export function AppIcon({ page, size = 36, fallback, plain }: { page: string; size?: number; fallback?: string; plain?: boolean }) {
  const a = APP_ICONS[page]
  const color = a?.color ?? '#5B4FE9'
  if (plain) return a ? <a.icon className="app-ico-plain" size={size} strokeWidth={1.8} color={color} /> : <span className="side-letter">{fallback ?? '·'}</span>
  return (
    <span className="app-ico" style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), color, background: `color-mix(in srgb, ${color} 13%, transparent)` }}>
      {a ? <a.icon size={Math.round(size * 0.52)} strokeWidth={1.9} /> : <b style={{ fontSize: Math.round(size * 0.44) }}>{fallback ?? '·'}</b>}
    </span>
  )
}
