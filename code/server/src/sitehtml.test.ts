// 跑：cd code/server && npm test。自己服务器上的 Opero：官网给搜索引擎的 meta 和静态正文去掉、标 noindex、注入 instance
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { instanceHtml } from './sitehtml.ts'

test('拿真的 index.html：去掉官网收录信息，留下网页要的', () => {
  const raw = fs.readFileSync(path.join(import.meta.dirname, '../../web/index.html'), 'utf8')
  assert.match(raw, /<!--site-meta/)
  assert.match(raw, /<!--site-static/)
  const h = instanceHtml(raw, '/opero/')
  assert.doesNotMatch(h, /og:title|ld\+json|hreflang|canonical|你自己部署的 AI 开发团队|llms\.txt/)
  assert.match(h, /<meta name="robots" content="noindex,nofollow" \/>/)
  assert.match(h, /<title>Opero<\/title>/)
  assert.match(h, /<base href="\/opero\/" \/>/)
  assert.match(h, /window\.OPERO_MODE='instance'/)
  assert.match(h, /<div id="root"><\/div>/, '根节点空着（部署检查认 <div id="root">）')
  assert.match(h, /src\/main\.tsx|assets\//)
})
