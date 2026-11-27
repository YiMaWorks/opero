// 跑：cd code/server && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

test('后台和网页的名字候选是同一份', () => {
  const a = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'names.json'), 'utf8'))
  const web = path.join(import.meta.dirname, '../../web/src/data/names.json')
  if (!fs.existsSync(web)) return // 只部署了后台
  assert.deepEqual(a, JSON.parse(fs.readFileSync(web, 'utf8')))
})
