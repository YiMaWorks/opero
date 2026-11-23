// 多语言：界面源文字是简体中文，换语言时把页面上显示的中文按字典换成那个语言（locales/<语言>.json，由 scripts/i18n-extract.mjs 抽原文）。
//   - 不用把几千处文字改成 t('key')：页面上每一段文字、placeholder / title / aria-label / alt 都在显示时换；React 更新了文字也会跟着换。
//   - 带变量的原文（「{0} 分钟前」）按模板对。
//   - 不换的：data-no-i18n / translate="no" 里面的（你和员工说的话、AI 写的内容）、输入框、代码块。
//   - 语言选择：默认跟随系统；用户选了就记住（本机 localStorage，装好的一套还存进后台设置，手机 App 和别的电脑打开也一样）。
//   - 阿拉伯语从右往左排（<html dir="rtl">）。

import { useSyncExternalStore } from 'react'

export type LangCode = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'de' | 'fr' | 'ar'
export type LangPref = 'auto' | LangCode

export const LANGS: { code: LangCode; name: string }[] = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'ar', name: 'العربية' },
]
const RTL = new Set<LangCode>(['ar'])
const KEY = 'opero.lang'

/** 「跟随系统」在各语言里怎么说（这一条是新加的，不在字典里） */
const AUTO_LABEL: Record<LangCode, string> = { 'zh-CN': '跟随系统', 'zh-TW': '跟隨系統', en: 'System default', ja: 'システムに合わせる', de: 'Systemsprache', fr: 'Langue du système', ar: 'لغة النظام' }

export function systemLang(): LangCode {
  for (const l of navigator.languages?.length ? navigator.languages : [navigator.language || 'en']) {
    const x = l.toLowerCase()
    if (/^zh-(tw|hk|mo)|^zh-hant/.test(x)) return 'zh-TW'
    if (x.startsWith('zh')) return 'zh-CN'
    for (const c of ['en', 'ja', 'de', 'fr', 'ar'] as LangCode[]) if (x === c || x.startsWith(c + '-')) return c
  }
  return 'en'
}

/** 旧设置里存的是 zh / en */
export function normPref(v: unknown): LangPref {
  if (v === 'zh') return 'zh-CN'
  if (v === 'auto' || LANGS.some((l) => l.code === v)) return v as LangPref
  return 'auto'
}
export const loadPref = (): LangPref => { try { return normPref(localStorage.getItem(KEY)) } catch { return 'auto' } }
export const resolve = (p: LangPref): LangCode => (p === 'auto' ? systemLang() : p)
export const autoLabel = () => AUTO_LABEL[current]

// ---------- 字典 ----------
const loaders = import.meta.glob<{ default: Record<string, string> }>('./locales/*.json')
let current: LangCode = 'zh-CN'
let dict: Record<string, string> | null = null
let patterns: { re: RegExp; order: number[]; out: string }[] = []
const cache = new Map<string, string>()
const CJK = /[㐀-鿿]/

export const lang = () => current
export const isRtl = () => RTL.has(current)

function compile(d: Record<string, string>) {
  patterns = []
  for (const [k, v] of Object.entries(d)) {
    if (!/\{\d+\}/.test(k)) continue
    // 「{0} 分钟前」→ /^([\s\S]+?) 分钟前$/，order 记下第几个括号是哪个变量
    const order: number[] = []
    let src = '^'
    k.split(/\{(\d+)\}/).forEach((p, i) => {
      if (i % 2 === 0) src += p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      else { order.push(Number(p)); src += '([\\s\\S]+?)' }
    })
    try { patterns.push({ re: new RegExp(src + '$'), order, out: v }) } catch { /* 坏的跳过 */ }
  }
  // 原文越长越具体，先对
  patterns.sort((a, b) => b.re.source.length - a.re.source.length)
}

/** 一段中文换成当前语言；不认识的原样返回 */
export function t(src: string): string {
  if (!dict || !src || !CJK.test(src)) return src
  const hit = cache.get(src)
  if (hit !== undefined) return hit
  const m = src.match(/^(\s*)([\s\S]*?)(\s*)$/)!
  const core = m[2]
  let out = dict[core]
  if (out === undefined) {
    for (const p of patterns) {
      const r = p.re.exec(core)
      if (!r) continue
      const vals: Record<number, string> = {}
      p.order.forEach((n, i) => { vals[n] = t(r[i + 1]) })
      out = p.out.replace(/\{(\d+)\}/g, (_, n) => vals[Number(n)] ?? '')
      break
    }
  }
  const res = out === undefined ? src : m[1] + out + m[3]
  if (cache.size > 5000) cache.clear()
  cache.set(src, res)
  return res
}

// ---------- 页面上的文字 ----------
const origText = new WeakMap<Text, string>()
const shownText = new WeakMap<Text, string>()
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt']
const origAttr = new WeakMap<Element, Record<string, string>>()
const SKIP = '[data-no-i18n],[translate="no"],textarea,input,script,style,code,pre'

function skipEl(el: Element | null) { return !!el?.closest(SKIP) }

function doText(n: Text) {
  const cur = n.nodeValue ?? ''
  if (shownText.get(n) !== cur) origText.set(n, cur) // React 写了新文字：这是新的原文
  const src = origText.get(n)
  if (src === undefined) return
  if (!CJK.test(src) && src === cur) return
  if (skipEl(n.parentElement)) return
  const out = t(src)
  shownText.set(n, out)
  if (out !== cur) n.nodeValue = out
}

function doAttrs(el: Element) {
  if (skipEl(el) && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return
  let o = origAttr.get(el)
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (v === null) continue
    if (!o) { o = {}; origAttr.set(el, o) }
    const last = o['__shown_' + a]
    if (last !== v) o[a] = v
    const out = t(o[a])
    o['__shown_' + a] = out
    if (out !== v) el.setAttribute(a, out)
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return
  const el = root as Element
  if (el.nodeType === Node.ELEMENT_NODE) doAttrs(el)
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let n = tw.nextNode()
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text)
    else doAttrs(n as Element)
    n = tw.nextNode()
  }
}

let observer: MutationObserver | null = null
function observe() {
  if (observer) return
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target as Text)
      else if (m.type === 'attributes') doAttrs(m.target as Element)
      else m.addedNodes.forEach((n) => walk(n))
    }
  })
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
}

/** 换语言：载字典、改 <html lang dir>、整页重换一遍 */
export async function applyLang(code: LangCode) {
  if (code !== 'zh-CN') {
    const load = loaders[`./locales/${code}.json`]
    try { dict = load ? (await load()).default : null } catch { dict = null }
  } else dict = null
  current = dict || code === 'zh-CN' ? code : 'zh-CN'
  cache.clear()
  compile(dict ?? {})
  document.documentElement.lang = current
  document.documentElement.dir = RTL.has(current) ? 'rtl' : 'ltr'
  walk(document.documentElement)
  observe()
  listeners.forEach((f) => f(current))
}

const listeners = new Set<(c: LangCode) => void>()
export function onLangChange(f: (c: LangCode) => void) { listeners.add(f); return () => { listeners.delete(f) } }

/** 用户选了语言：记住（本机），马上换 */
export async function setPref(p: LangPref) {
  try { localStorage.setItem(KEY, p) } catch { /* 隐私模式 */ }
  await applyLang(resolve(p))
}

/** 打开页面时：按记住的或系统语言 */
export function initI18n() { return applyLang(resolve(loadPref())) }

// ---------- React 里用 ----------
/** 当前语言（换了会重画） */
export function useLang(): LangCode {
  return useSyncExternalStore((cb) => onLangChange(cb), () => current, () => current)
}
