// 线框图标（24×24，currentColor）
import type { Tab } from '../types'

const base = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export function TabIcon({ tab }: { tab: Tab }) {
  switch (tab) {
    case 'chat':
      return <svg {...base}><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /></svg>
    case 'people':
      return <svg {...base}><circle cx="9.5" cy="8.5" r="3.5" /><path d="M3 20c0-4 3-6 6.5-6s6.5 2 6.5 6" /><path d="M16 5a3.5 3.5 0 0 1 0 7M18 14.5c2 .8 3 2.6 3 5.5" /></svg>
    case 'workspace':
      return <svg {...base}><path d="M3 6.5h6.5l2 2H21V19H3z" /></svg>
    case 'apps':
      return <svg {...base}><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></svg>
    case 'me':
      return <svg {...base}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.5 3.5-7 8-7s8 2.5 8 7" /></svg>
  }
}

export const IconBack = () => <svg {...base}><path d="M15 5l-7 7 7 7" /></svg>
export const IconClose = () => <svg {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>
export const IconSearch = () => <svg {...base}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
export const IconPlus = () => <svg {...base}><path d="M12 5v14M5 12h14" /></svg>
export const IconMore = () => <svg {...base}><circle cx="5.5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="18.5" cy="12" r="1" fill="currentColor" /></svg>
export const IconMic = () => <svg {...base}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
export const IconMenu = () => <svg {...base}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
export const IconBellOff = () => <svg {...base}><path d="M9.5 19a2.5 2.5 0 0 0 5 0M6 8a6 6 0 0 1 10.3-4.2M18 10v3.5l1.5 2.5H7M4 4l16 16" /></svg>
export const IconChevron = () => <svg {...base}><path d="M6 9l6 6 6-6" /></svg>
export const IconClip = () => <svg {...base}><path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6" /></svg>
export const IconImage = () => <svg {...base}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4" /></svg>
export const IconCrop = () => <svg {...base}><path d="M7 3v14h14M3 7h14v14" /></svg>
export const IconPin = () => <svg {...base}><path d="M9 4h6l-1 5 4 4H6l4-4zM12 13v7" /></svg>
export const IconBell = () => <svg {...base}><path d="M9.5 19a2.5 2.5 0 0 0 5 0M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /></svg>
export const IconSliders = () => <svg {...base}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
export const IconFlow = () => <svg {...base}><rect x="3.5" y="4" width="7" height="5" rx="1.5" /><rect x="13.5" y="15" width="7" height="5" rx="1.5" /><path d="M7 9v4a2 2 0 0 0 2 2h4.5" /></svg>
export const IconRefresh = () => <svg {...base}><path d="M19 8a7.5 7.5 0 1 0 .5 6M19 3.5V8h-4.5" /></svg>
export const IconPalette = () => <svg {...base}><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-.9.7-1.6 1.7-1.6h2.1a3.9 3.9 0 0 0 3.9-3.9C20.5 6.6 16.7 3.5 12 3.5z" /><circle cx="7.6" cy="11" r="1.1" fill="currentColor" /><circle cx="10.2" cy="7.4" r="1.1" fill="currentColor" /><circle cx="14.6" cy="7.6" r="1.1" fill="currentColor" /></svg>
export const IconGlobe = () => <svg {...base}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5z" /></svg>
export const IconSend = () => <svg {...base}><path d="M4 12l16-8-6 16-2.5-6.5z" /></svg>

export function IconCheck({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="8" fill="var(--ok)" />
      <path d="M4.6 8.3l2.2 2.2 4.6-4.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconFingerprint({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M6.5 6.8A7.5 7.5 0 0 1 19.4 11" />
      <path d="M4.6 10.5a7.5 7.5 0 0 0-.1 1.5c0 1.4.2 2.7.7 3.9" />
      <path d="M8 12a4 4 0 0 1 8 0c0 2.6-.5 5-1.5 7" />
      <path d="M12 12c0 3-.6 5.8-2 8" />
      <path d="M19.6 13.8c-.1 1.9-.5 3.6-1.1 5.2" />
      <path d="M8.3 15.5c-.2 1.3-.6 2.5-1.2 3.6" />
    </svg>
  )
}
