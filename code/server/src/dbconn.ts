// 查库：MySQL / MariaDB / PostgreSQL / SQL Server / Oracle。账号从保险箱取，Opero 自己连；只读语句放在只读事务里跑，15 秒超时、最多 200 行，敏感列打码。
import mysql from 'mysql2/promise'
import pg from 'pg'
import mssql from 'mssql'
import oracledb from 'oracledb'
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
const table = (cols: string[], all: unknown[][], t0: number): QueryResult => ({ cols, rows: all.slice(0, MAX_ROWS).map((r) => r.map((v, i) => mask(cols[i], cell(v)))), total: all.length, ms: Date.now() - t0 })

/** password：还没存进保险箱时（新增凭证点「测试连接」）直接给；db：整个实例接进来的，这次查哪个库（不给就用 ds.db） */
export async function runQuery(ds: DataSource, sql: string, opts: { write?: boolean; password?: string; db?: string } = {}): Promise<QueryResult> {
  if (opts.db) ds = { ...ds, db: opts.db }
  const read = isReadSql(sql)
  if (!read && !opts.write) throw new Error('这不是只读语句')
  const t0 = Date.now()
  const acc = account(ds)
  const user = acc.user
  const password = opts.password ?? acc.password
  if (ds.kind === 'SQL Server') {
    const pool = await new mssql.ConnectionPool({ server: ds.host, port: ds.port || 1433, user, password, database: ds.db || undefined, connectionTimeout: 10_000, requestTimeout: TIMEOUT, options: { encrypt: false, trustServerCertificate: true } }).connect()
    try {
      const tx = new mssql.Transaction(pool)
      if (read) await tx.begin(mssql.ISOLATION_LEVEL.READ_COMMITTED)
      const req = read ? new mssql.Request(tx) : pool.request()
      ;(req as any).arrayRowMode = true
      const r: any = await req.query(sql)
      if (read) await tx.rollback().catch(() => {})
      const cols = (r.columns?.[0] ?? []).map((c: any) => String(c.name))
      if (!cols.length) return { cols: [], rows: [], total: 0, affected: (r.rowsAffected ?? []).reduce((a: number, b: number) => a + b, 0), ms: Date.now() - t0 }
      return table(cols, r.recordsets?.[0] ?? r.recordset ?? [], t0)
    } finally { await pool.close().catch(() => {}) }
  }
  if (ds.kind === 'Oracle') {
    // thin 模式：不用装 Oracle 客户端。db 填服务名（比如 ORCLPDB1）
    const c = await oracledb.getConnection({ user, password, connectString: `${ds.host}:${ds.port || 1521}/${ds.db}`, connectTimeout: 10 } as any)
    try {
      c.callTimeout = TIMEOUT
      if (read) await c.execute('SET TRANSACTION READ ONLY')
      const r = await c.execute(sql.trim().replace(/;\s*$/, ''), [], { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: MAX_ROWS + 1 })
      if (read) await c.rollback()
      const cols = (r.metaData ?? []).map((m) => m.name)
      if (!cols.length) { if (!read) await c.commit(); return { cols: [], rows: [], total: 0, affected: r.rowsAffected ?? 0, ms: Date.now() - t0 } }
      return table(cols, (r.rows ?? []) as unknown[][], t0)
    } finally { await c.close().catch(() => {}) }
  }
  if (ds.kind === 'MySQL' || ds.kind === 'MariaDB') {
    const c = await mysql.createConnection({ host: ds.host, port: ds.port || 3306, user, password, database: ds.db || undefined, connectTimeout: 10_000, dateStrings: true })
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
  const c = new pg.Client({ host: ds.host, port: ds.port || 5432, user, password, database: ds.db || 'postgres', connectionTimeoutMillis: 10_000, statement_timeout: TIMEOUT })
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
export async function loadSchema(ds: DataSource, password?: string): Promise<DataSource['tables']> {
  const sql = ds.kind === 'SQL Server'
    ? `SELECT TOP 300 t.name, ISNULL(SUM(p.rows), 0), STUFF((SELECT ',' + c.name FROM sys.columns c WHERE c.object_id = t.object_id ORDER BY c.column_id FOR XML PATH('')), 1, 1, '')
       FROM sys.tables t LEFT JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1) GROUP BY t.name, t.object_id ORDER BY t.name`
    : ds.kind === 'Oracle'
    ? `SELECT * FROM (SELECT t.table_name, NVL(t.num_rows, 0), (SELECT LISTAGG(c.column_name, ',') WITHIN GROUP (ORDER BY c.column_id) FROM user_tab_columns c WHERE c.table_name = t.table_name)
       FROM user_tables t ORDER BY t.table_name) WHERE ROWNUM <= 300`
    : ds.kind === 'MySQL' || ds.kind === 'MariaDB'
    ? `SELECT ${ds.db ? 't.TABLE_NAME' : "CONCAT(t.TABLE_SCHEMA, '.', t.TABLE_NAME)"}, IFNULL(t.TABLE_ROWS, 0), GROUP_CONCAT(c.COLUMN_NAME ORDER BY c.ORDINAL_POSITION SEPARATOR ',')
       FROM information_schema.TABLES t JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
       WHERE ${ds.db ? 't.TABLE_SCHEMA = DATABASE()' : `t.TABLE_SCHEMA NOT IN (${MYSQL_SYS})`} GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME, t.TABLE_ROWS ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME LIMIT 300`
    : `SELECT c.relname, GREATEST(c.reltuples, 0)::bigint, string_agg(a.attname, ',' ORDER BY a.attnum)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE c.relkind IN ('r', 'p', 'v') AND n.nspname NOT IN ('pg_catalog', 'information_schema') GROUP BY c.relname, c.reltuples ORDER BY c.relname LIMIT 300`
  const r = await runQuery(ds, sql, { password })
  return r.rows.map(([name, rows, cols]) => ({ name, rows: fmtRows(Number(rows)), cols: (cols ?? '').split(',') }))
}
const MYSQL_SYS = "'mysql', 'information_schema', 'performance_schema', 'sys'"

/** 整个实例接进来的（没填库名）：这个账号能看到哪些库（Oracle 是一个服务名一个库，不列） */
export async function listDbs(ds: DataSource, password?: string): Promise<string[]> {
  const sql = ds.kind === 'MySQL' || ds.kind === 'MariaDB' ? `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN (${MYSQL_SYS}) ORDER BY 1`
    : ds.kind === 'PostgreSQL' ? 'SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY 1'
    : ds.kind === 'SQL Server' ? 'SELECT name FROM sys.databases WHERE database_id > 4 AND HAS_DBACCESS(name) = 1 ORDER BY name' : ''
  if (!sql) return []
  const r = await runQuery({ ...ds, db: '' }, sql, { password })
  return r.rows.map((x) => x[0]).slice(0, 200)
}

/** 表 + （整个实例时）库：存到 DataSource 上 */
export async function schemaOf(ds: DataSource): Promise<Pick<DataSource, 'tables' | 'dbs'>> {
  const tables = await loadSchema(ds)
  return { tables, dbs: ds.db ? undefined : await listDbs(ds).catch(() => undefined) }
}

const fmtRows = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n))

/** 结果写成给 AI 看的文字表格 */
export function resultText(r: QueryResult) {
  if (!r.cols.length) return `执行完成，影响 ${r.affected ?? 0} 行（${r.ms} ms）`
  const lines = [r.cols.join('\t'), ...r.rows.map((x) => x.join('\t'))]
  return `${r.total} 行${r.total > r.rows.length ? `（只给前 ${r.rows.length} 行）` : ''} · ${r.ms} ms\n` + lines.join('\n')
}

/** 这个账号能不能改数据（测试连接时告诉主人）：读权限说明，读不到就返回空 */
export async function grantsOf(ds: DataSource, password?: string): Promise<{ write: boolean | null; lines: string[] }> {
  try {
    if (ds.kind === 'MySQL' || ds.kind === 'MariaDB') {
      const r = await runQuery(ds, 'SHOW GRANTS', { password })
      const lines = r.rows.map((x) => x[0])
      return { write: lines.some((l) => /\b(ALL PRIVILEGES|INSERT|UPDATE|DELETE)\b/i.test(l)), lines }
    }
    if (ds.kind === 'PostgreSQL') {
      const r = await runQuery(ds, `SELECT rolsuper::text, (SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = current_user AND privilege_type IN ('INSERT','UPDATE','DELETE'))::text FROM pg_roles WHERE rolname = current_user`, { password })
      const [sup, n] = r.rows[0] ?? []
      return { write: sup === 'true' || Number(n) > 0, lines: [sup === 'true' ? '超级用户' : `能写的表：${n} 张`] }
    }
    if (ds.kind === 'SQL Server') {
      const r = await runQuery(ds, `SELECT IS_SRVROLEMEMBER('sysadmin'), IS_ROLEMEMBER('db_owner'), IS_ROLEMEMBER('db_datawriter')`, { password })
      const [a, o, w] = r.rows[0] ?? []
      return { write: [a, o, w].some((x) => x === '1'), lines: [`sysadmin=${a} db_owner=${o} db_datawriter=${w}`] }
    }
    if (ds.kind === 'Oracle') {
      const r = await runQuery(ds, `SELECT privilege FROM session_privs WHERE privilege LIKE '%ANY TABLE' OR privilege IN ('DBA')`, { password })
      const lines = r.rows.map((x) => x[0])
      return { write: lines.some((l) => /INSERT|UPDATE|DELETE/.test(l)), lines }
    }
  } catch { /* 查不到权限不影响 */ }
  return { write: null, lines: [] }
}
