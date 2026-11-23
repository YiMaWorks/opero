// 抽出界面上所有中文（网页 code/web/src + 后台 code/server/src 里会显示给人的），写成 src/i18n/source.json。
// 翻译放在 src/i18n/locales/<语言>.json：{ "中文原文": "译文" }；带变量的原文里变量写成 {0} {1}…，译文里照样保留。
// 用法：cd code/web && node scripts/i18n-extract.mjs        （改了界面文字后跑一次，再补各语言缺的条目）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const web = path.resolve(here, '..')
const roots = [path.join(web, 'src'), path.resolve(web, '../server/src')]
// 不显示给人的：Agent / 命令行程序 / MCP 桥 / 翻译本身
const skip = /(\/server\/src\/(agent|cli|mcp|vault|config)\.ts$)|(\/src\/i18n\/)/
const CJK = /[㐀-鿿]/

const files = []
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f)
    if (fs.statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p) } else if (/\.(tsx?)$/.test(f) && !skip.test(p)) files.push(p)
  }
}
roots.forEach(walk)

const out = new Set()
for (const f of files) {
  const src = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const add = (s) => {
    if (!s) return
    // 多行的（提示词、长说明）按行拆开：界面上按文本节点整段对，提示词本来也不显示
    for (const part of s.split(/\n+/)) { const t = part.trim(); if (t && CJK.test(t)) out.add(t) }
  }
  const visit = (n) => {
    if (ts.isJsxText(n)) add(n.text.replace(/\s+/g, ' '))
    else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !ts.isLiteralTypeNode(n.parent) && !ts.isImportDeclaration(n.parent)) add(n.text)
    else if (ts.isTemplateExpression(n)) add(n.head.text + n.templateSpans.map((sp, i) => `{${i}}` + sp.literal.text).join(''))
    ts.forEachChild(n, visit)
  }
  visit(src)
}

const list = [...out].sort()
const dir = path.join(web, 'src/i18n')
fs.mkdirSync(path.join(dir, 'locales'), { recursive: true })
fs.writeFileSync(path.join(dir, 'source.json'), JSON.stringify(list, null, 0).replace(/","/g, '",\n"') + '\n')
console.log(`界面文字 ${list.length} 条 → src/i18n/source.json`)
for (const f of fs.readdirSync(path.join(dir, 'locales')).filter((x) => x.endsWith('.json'))) {
  const dict = JSON.parse(fs.readFileSync(path.join(dir, 'locales', f), 'utf8'))
  const missing = list.filter((k) => !(k in dict))
  console.log(`${f}: 缺 ${missing.length} 条`)
}
