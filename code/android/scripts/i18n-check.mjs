#!/usr/bin/env node
// 查安卓界面文字有没有翻译：找出代码里所有 t("中文原文")，看网页字典（code/web/src/i18n/locales）或
// 安卓自己的字典（code/android/i18n/<语言>.json）里有没有。缺的列出来，补进 code/android/i18n/<语言>.json。
// 用法：node code/android/scripts/i18n-check.mjs（在仓库任何地方跑都行；缺了退出码 1）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const android = path.resolve(here, '..')
const web = path.resolve(android, '../web/src/i18n/locales')
const own = path.join(android, 'i18n')
const LANGS = ['zh-TW', 'en', 'ja', 'de', 'fr', 'ar']

function kotlinFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) kotlinFiles(p, out)
    else if (e.name.endsWith('.kt')) out.push(p)
  }
  return out
}

// t("…") 里的字面量（不带 ${} 模板；变量用 {0} {1}）
const used = new Map()
for (const f of kotlinFiles(path.join(android, 'app/src/main/java'))) {
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(/\bt\("((?:[^"\\$]|\\.)*)"/g)) {
    const s = m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
    if (!/[㐀-鿿]/.test(s)) continue
    if (!used.has(s)) used.set(s, path.relative(android, f))
  }
}

const read = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {})
let missing = 0
for (const l of LANGS) {
  const d = { ...read(path.join(web, `${l}.json`)), ...read(path.join(own, `${l}.json`)) }
  const miss = [...used.keys()].filter((k) => d[k.trim()] === undefined)
  for (const k of [...used.keys()]) {
    const v = d[k.trim()]
    if (v === undefined) continue
    const a = (k.match(/\{\d+\}/g) ?? []).sort().join()
    const b = (v.match(/\{\d+\}/g) ?? []).sort().join()
    if (a !== b) { console.log(`${l}: 占位符对不上：${JSON.stringify(k)} → ${JSON.stringify(v)}`); missing++ }
  }
  if (miss.length) {
    console.log(`${l}: 缺 ${miss.length} 句（补进 code/android/i18n/${l}.json）`)
    for (const k of miss) console.log(`  ${JSON.stringify(k)}  ← ${used.get(k)}`)
    missing += miss.length
  }
}
console.log(`共 ${used.size} 句，${missing ? `还缺 ${missing} 处` : '六种语言都齐了'}`)
process.exit(missing ? 1 : 0)
