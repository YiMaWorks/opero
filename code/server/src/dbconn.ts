// 查库：MySQL / PostgreSQL。账号从保险箱取，Opero 自己连；只读语句放在只读事务里跑，15 秒超时、最多 200 行，敏感列打码。
import mysql from 'mysql2/promise'
import pg from 'pg'
import { getSecret } from './vault.ts'
import { get } from './db.ts'
import type { Credential, DataSource } from './types.ts'

export interface QueryResult { cols: string[]; rows: string[][]; ms: number; total: number; affected?: number; note?: string }

const MAX_ROWS = 200
const TIMEOUT = 15_000

export function isReadSql(sql: string) {
  const s = stripComments(sql).trim().replace(/;\s*$/, '')
  if (s.includes(';')) return false
  return /^(select|show|describe|desc|explain|with|values|table)\b/i.test(s) && !/\b(insert|update|delete|merge|alter|drop|truncate|create|grant|revoke)\b/i.test(s.replace(/'[^']*'/g, ''))
}
const stripComments = (s: string) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const SENSITIVE = /pass|pwd|secret|token|salt|phone|mobile|tel|id_?card|idno|身份证|手机|email|bank|card_?no/i
function mask(col: string, v: string) {
  if (!SENSITIVE.test(col) || !v) return v
  if (v.length <= 4) return '••••'
  return v.slice(0, 2) + '••••' + v.slice(-2)
}
const cell = (v: unknown): string => (v === null || v === undefined ? 'NULL' : v instanceof Date ? v.toISOString().replace('T', ' ').slice(0, 19) : Buffer.isBuffer(v) ? `<${v.length} 字节>` : typeof v === 'object' ? JSON.stringify(v) : String(v))

function account(ds: DataSource) {
  const cred = ds.credential ? get<Credential>('credentials', ds.credential) : undefined
  return { user: ds.user || cred?.user || '', password: ds.credential ? getSecret(ds.credential) ?? '' : '' }
}

export async function runQuery(ds: DataSource, sql: string, opts: { write?: boolean } = {}): Promise<QueryResult> {
  const read = isReadSql(sql)
  if (!read && !opts.write) throw new Error('这不是只读语句')
  const t0 = Date.now()
  const { user, password } = account(ds)
  if (ds.kind === 'MySQL') {
    const c = await mysql.createConnection({ host: ds.host, port: ds.port || 3306, user, password, database: ds.db, connectTimeout: 10_000, dateStrings: true })
    try {
      if (read) { await c.query('SET SESSION TRANSACTION READ ONLY'); await c.query('START TRANSACTION READ ONLY') }
      const [res, fields] = await c.query({ sql, timeout: TIMEOUT, rowsAsArray: true })
      if (read) await c.query('ROLLBACK')
      if (Array.isArray(res)) {
        const cols = (fields ?? []).map((f: any) => String(f.name))
        const all = res as unknown[][]
        return { cols, rows: all.slice(0, MAX_ROWS).map((r) => r.map((v, i) => mask(cols[i], cell(v)))), total: all.length, ms: Date.now() - t0 }
      }
      return { cols: [], rows: [], total: 0, affected: (res as any).affectedRows ?? 0, ms: Date.now() - t0 }
    } finally { await c.end().catch(() => {}) }
  }
  const c = new pg.Client({ host: ds.host, port: ds.port || 5432, user, password, database: ds.db, connectionTimeoutMillis: 10_000, statement_timeout: TIMEOUT })
  await c.connect()
  try {
    if (read) await c.query('BEGIN READ ONLY')
    const r = await c.query({ text: sql, rowMode: 'array' })
    if (read) await c.query('ROLLBACK')
    const cols = (r.fields ?? []).map((f) => f.name)
    if (!cols.length) return { cols: [], rows: [], total: 0, affected: r.rowCount ?? 0, ms: Date.now() - t0 }
    const rows = r.rows as unknown[][]
    return { cols, rows: rows.slice(0, MAX_ROWS).map((x) => x.map((v, i) => mask(cols[i], cell(v)))), total: rows.length, ms: Date.now() - t0 }
  } finally { await c.end().catch(() => {}) }
}

/** 库表结构：表名、大概行数、列 */
export async function loadSchema(ds: DataSource): Promise<DataSource['tables']> {
  const sql = ds.kind === 'MySQL'
    ? `SELECT t.TABLE_NAME, IFNULL(t.TABLE_ROWS, 0), GROUP_CONCAT(c.COLUMN_NAME ORDER BY c.ORDINAL_POSITION SEPARATOR ',')
       FROM information_schema.TABLES t JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
       WHERE t.TABLE_SCHEMA = DATABASE() GROUP BY t.TABLE_NAME, t.TABLE_ROWS ORDER BY t.TABLE_NAME LIMIT 300`
    : `SELECT c.relname, GREATEST(c.reltuples, 0)::bigint, string_agg(a.attname, ',' ORDER BY a.attnum)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE c.relkind IN ('r', 'p', 'v') AND n.nspname NOT IN ('pg_catalog', 'information_schema') GROUP BY c.relname, c.reltuples ORDER BY c.relname LIMIT 300`
  const r = await runQuery(ds, sql)
  return r.rows.map(([name, rows, cols]) => ({ name, rows: fmtRows(Number(rows)), cols: (cols ?? '').split(',') }))
}
const fmtRows = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n))

/** 结果写成给 AI 看的文字表格 */
export function resultText(r: QueryResult) {
  if (!r.cols.length) return `执行完成，影响 ${r.affected ?? 0} 行（${r.ms} ms）`
  const lines = [r.cols.join('\t'), ...r.rows.map((x) => x.join('\t'))]
  return `${r.total} 行${r.total > r.rows.length ? `（只给前 ${r.rows.length} 行）` : ''} · ${r.ms} ms\n` + lines.join('\n')
}
