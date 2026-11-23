// 存储：一个 SQLite 文件（Node 自带的 node:sqlite，不用装别的）。
// 大部分实体是 JSON 文档（docs 表，按 coll 分）；消息、操作记录、执行记录、推送单独建表方便按时间查。
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { cfg } from './config.ts'

export const db = new DatabaseSync(path.join(cfg.data, 'opero.db'))
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (coll, id));
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, sid TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_sid ON messages (sid, ts);
CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, enc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, emp TEXT NOT NULL, ts INTEGER NOT NULL, ok INTEGER NOT NULL, cost REAL NOT NULL, tokens INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_sessions (token TEXT PRIMARY KEY, created INTEGER NOT NULL, seen INTEGER NOT NULL, verified INTEGER NOT NULL, device TEXT);
CREATE TABLE IF NOT EXISTS push (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, data TEXT NOT NULL);
`)

export type Coll =
  | 'employees' | 'sessions' | 'servers' | 'credentials' | 'dataSources' | 'savedQueries'
  | 'triggers' | 'kb' | 'workspaces' | 'devices' | 'queue'

export interface Doc { id: string }

export function all<T extends Doc>(coll: Coll): T[] {
  return (db.prepare('SELECT data FROM docs WHERE coll = ? ORDER BY ts').all(coll) as { data: string }[]).map((r) => JSON.parse(r.data))
}
export function get<T extends Doc>(coll: Coll, id: string): T | undefined {
  const r = db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').get(coll, id) as { data: string } | undefined
  return r ? JSON.parse(r.data) : undefined
}
/** 写一个文档；第一次写的时间用来排序，之后保留 */
export function put<T extends Doc>(coll: Coll, item: T): T {
  db.prepare(`INSERT INTO docs (coll, id, ts, data) VALUES (?, ?, ?, ?)
    ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data`).run(coll, item.id, Date.now(), JSON.stringify(item))
  return item
}
export function del(coll: Coll, id: string) { db.prepare('DELETE FROM docs WHERE coll = ? AND id = ?').run(coll, id) }

export function kvGet<T>(k: string, def: T): T {
  const r = db.prepare('SELECT v FROM kv WHERE k = ?').get(k) as { v: string } | undefined
  return r ? JSON.parse(r.v) : def
}
export function kvSet(k: string, v: unknown) {
  db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v))
}

let seq = 0
export const uid = (p = '') => `${p}${Date.now().toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 6)}`
