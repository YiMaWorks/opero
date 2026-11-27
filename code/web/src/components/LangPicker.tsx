// 选语言：跟随系统 + 7 种。选了就记住；在 App 里（store 在）同时存进设置（装好的一套会同步到后台、别的设备）。
import { LANGS, autoLabel, loadPref, normPref, setPref, useLang, type LangPref } from '../i18n'
import { setSettings } from '../store'
import { Sheet } from './ui'

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

/** 电脑左边栏「语言」：点一下弹出来选（和「风格」一样）；选了马上换，记在本机，装好的一套也存进设置（别的设备、手机 App 跟着变） */
export function LangSheet({ onClose }: { onClose: () => void }) {
  useLang()
  const pref = loadPref()
  const pick = (p: LangPref) => { setSettings({ lang: p }); onClose() } // 本机马上换；装好的一套同步到后台
  return (
    <Sheet title="界面语言" onClose={onClose}>
      <div className="sheet-list" translate="no">
        {[{ code: 'auto' as LangPref, name: `🌐 ${autoLabel()}` }, ...LANGS.map((l) => ({ code: l.code as LangPref, name: l.name }))].map((l) => (
          <button key={l.code} type="button" className={'radio-row' + (pref === l.code ? ' on' : '')} onClick={() => pick(l.code)}><i className="radio" /><span>{l.name}</span></button>
        ))}
      </div>
    </Sheet>
  )
}
