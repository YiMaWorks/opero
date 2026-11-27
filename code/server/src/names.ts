// 给员工起名字（迁移、建员工时）：按界面语言（中文用中文名、其它用英文名）、性别挑，避开已经有人用的
import fs from 'node:fs'
import path from 'node:path'
import { kvGet } from './db.ts'

const NAMES = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'names.json'), 'utf8')) as { zh: { f: string[]; m: string[] }; en: { f: string[]; m: string[] } }
const zh = () => { const st = kvGet<{ lang?: string; langResolved?: string }>('settings', {}); const l = st.lang && st.lang !== 'auto' ? st.lang : st.langResolved ?? 'zh-CN'; return l.startsWith('zh') }

/** gender：女 / 男（员工资料的性别），不给就随便；taken：已经有人用的名字 */
export function randomName(gender: string | undefined, taken: string[]): string {
  const set = zh() ? NAMES.zh : NAMES.en
  const g = gender === '女' ? 'f' : gender === '男' ? 'm' : Math.random() < 0.5 ? 'f' : 'm'
  for (const pool of [set[g], set[g === 'f' ? 'm' : 'f']]) {
    const free = pool.filter((n) => !taken.includes(n))
    if (free.length) return free[Math.floor(Math.random() * free.length)]
  }
  // 都用完了：加个编号
  let i = 2
  while (taken.includes(`${set[g][0]} ${i}`)) i++
  return `${set[g][0]} ${i}`
}
