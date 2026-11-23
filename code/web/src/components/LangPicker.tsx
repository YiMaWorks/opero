// 选语言：跟随系统 + 7 种。选了就记住；在 App 里（store 在）同时存进设置（装好的一套会同步到后台、别的设备）。
import { LANGS, autoLabel, loadPref, normPref, setPref, useLang, type LangPref } from '../i18n'

export function LangPicker({ onPick, className }: { onPick?: (p: LangPref) => void; className?: string }) {
  useLang()
  const pref = loadPref()
  return (
    <select className={className ?? 'lang-picker'} value={pref} translate="no" aria-label="Language"
      onChange={(e) => { const p = normPref(e.target.value); if (onPick) onPick(p); else setPref(p) }}>
      <option value="auto">🌐 {autoLabel()}</option>
      {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
    </select>
  )
}
