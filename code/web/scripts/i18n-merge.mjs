// 把一个语言分批翻好的 src/i18n/parts/<语言>-*.json 合成 src/i18n/locales/<语言>.json，并检查：
//   每条原文都有译文；原文里的 {0} {1}… 译文里一个不少。
// 用法：node scripts/i18n-merge.mjs ja
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/i18n')
const lang = process.argv[2]
if (!lang) { console.error('用法：node scripts/i18n-merge.mjs <语言>'); process.exit(2) }
const source = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8'))
const partsDir = path.join(dir, 'parts')
const out = {}
const old = path.join(dir, 'locales', `${lang}.json`)
if (fs.existsSync(old)) Object.assign(out, JSON.parse(fs.readFileSync(old, 'utf8')))
for (const f of fs.existsSync(partsDir) ? fs.readdirSync(partsDir).filter((x) => x.startsWith(lang + '-') && x.endsWith('.json')).sort() : []) {
  Object.assign(out, JSON.parse(fs.readFileSync(path.join(partsDir, f), 'utf8')))
}
const missing = source.filter((k) => typeof out[k] !== 'string' || !out[k].trim())
const badVars = source.filter((k) => typeof out[k] === 'string' && (k.match(/\{\d+\}/g) ?? []).some((v) => !out[k].includes(v)))
const final = Object.fromEntries(source.filter((k) => typeof out[k] === 'string').map((k) => [k, out[k]]))
fs.mkdirSync(path.join(dir, 'locales'), { recursive: true })
fs.writeFileSync(old, JSON.stringify(final, null, 0).replace(/","/g, '",\n"') + '\n')
console.log(`${lang}: ${Object.keys(final).length}/${source.length} 条`)
if (missing.length) console.log(`缺 ${missing.length} 条，比如：`, missing.slice(0, 5))
if (badVars.length) console.log(`变量对不上 ${badVars.length} 条，比如：`, badVars.slice(0, 5))
process.exit(missing.length || badVars.length ? 1 : 0)
