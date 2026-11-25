// 数据库连接串 → 类型、地址、端口、库名、账号、密码。新增数据库凭证时贴一串就填好，不用一格格抄。
// 认得：URL（mysql:// postgres:// sqlserver:// mongodb:// redis:// oracle://）、JDBC、ADO.NET / Npgsql 的 key=value;、mysql 命令行。
export interface ConnInfo { kind?: string; host?: string; port?: string; db?: string; user?: string; password?: string }

const SCHEME: Record<string, string> = {
  mysql: 'MySQL', 'mysql+pymysql': 'MySQL', 'mysql2': 'MySQL', mariadb: 'MariaDB', postgres: 'PostgreSQL', postgresql: 'PostgreSQL', 'postgresql+psycopg2': 'PostgreSQL', pgsql: 'PostgreSQL',
  sqlserver: 'SQL Server', mssql: 'SQL Server', oracle: 'Oracle', mongodb: 'MongoDB', 'mongodb+srv': 'MongoDB', redis: 'Redis', rediss: 'Redis',
}
const dec = (s?: string) => { if (s === undefined) return undefined; try { return decodeURIComponent(s) } catch { return s } }
const clean = (o: ConnInfo): ConnInfo | null => {
  const r = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as ConnInfo
  return r.host ? r : null
}

/** 认不出来返回 null */
export function parseConn(raw: string): ConnInfo | null {
  const s = raw.trim().replace(/^["']|["']$/g, '')
  if (!s) return null
  // JDBC：jdbc:mysql://h:p/db?user=&password=、jdbc:sqlserver://h:p;databaseName=;user=;password=、jdbc:oracle:thin:@//h:p/svc
  const ora = s.match(/^jdbc:oracle:thin:(?:([^/@]+)\/([^@]+))?@(?:\/\/)?([^:/]+)(?::(\d+))?[/:](\w[\w.]*)/i)
  if (ora) return clean({ kind: 'Oracle', user: ora[1], password: ora[2], host: ora[3], port: ora[4], db: ora[5] })
  const ms = s.match(/^jdbc:sqlserver:\/\/([^:;\\/]+)(?:\\\w+)?(?::(\d+))?(.*)$/i)
  if (ms) { const kv = keyVals(ms[3]); return clean({ kind: 'SQL Server', host: ms[1], port: ms[2], db: kv.databasename ?? kv.database, user: kv.user ?? kv.username, password: kv.password }) }
  const u = s.replace(/^jdbc:/i, '').match(/^([a-z][\w+.-]*):\/\/(?:([^:@/]*)(?::([^@]*))?@)?([^/?#;]+?)(?::(\d+))?(?:\/([^?#;]*))?(?:[?;](.*))?$/i)
  if (u && SCHEME[u[1].toLowerCase()]) {
    const q = keyVals(u[7] ?? '')
    const kind = SCHEME[u[1].toLowerCase()]
    const [h0, p0] = u[4].split(',')[0].split(':')
    return clean({ kind, host: h0, port: u[5] ?? p0, db: dec(u[6]) || q.database || q.databasename, user: dec(u[2]) || q.user || q.username, password: dec(u[3]) || q.password })
  }
  // key=value;（ADO.NET、Npgsql、ODBC）
  if (/[;]/.test(s) && /=/.test(s)) {
    const kv = keyVals(s)
    const hostRaw = kv.server ?? kv.host ?? kv['data source'] ?? kv.address ?? kv.addr
    if (hostRaw) {
      const [h, p] = hostRaw.replace(/^tcp:/i, '').split(/[,:]/)
      const port = kv.port ?? p
      const kind = (kv.driver && /mysql/i.test(kv.driver)) || port === '3306' || kv.uid !== undefined ? 'MySQL' : port === '5432' || kv.username !== undefined || kv.host !== undefined ? 'PostgreSQL' : 'SQL Server'
      return clean({ kind, host: h, port, db: kv.database ?? kv['initial catalog'] ?? kv.db, user: kv['user id'] ?? kv.uid ?? kv.user ?? kv.username, password: kv.password ?? kv.pwd })
    }
  }
  // mysql -h host -P 3306 -u user -pPASS db / psql -h host -p 5432 -U user -d db
  const cli = s.match(/^(mysql|mariadb|psql)\s+(.*)$/)
  if (cli) {
    const t = cli[2]
    const pg = cli[1] === 'psql'
    const opt = (re: RegExp) => t.match(re)?.[1]
    return clean({ kind: pg ? 'PostgreSQL' : cli[1] === 'mariadb' ? 'MariaDB' : 'MySQL', host: opt(/(?:-h\s*|--host=)(\S+)/), port: opt(pg ? /(?:-p\s*|--port=)(\d+)/ : /(?:-P\s*|--port=)(\d+)/), user: opt(pg ? /(?:-U\s*|--username=)(\S+)/ : /(?:-u\s*|--user=)(\S+)/),
      password: pg ? undefined : opt(/(?:^|\s)(?:-p(?!\s)|--password=)(\S+)/), db: pg ? opt(/(?:-d\s*|--dbname=)(\S+)/) : t.replace(/--?\w[\w-]*(?:=\S+|\s+\S+)?/g, ' ').trim().split(/\s+/).pop() || undefined })
  }
  return null
}

function keyVals(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of s.split(/[;&]/)) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = dec(part.slice(i + 1).trim()) ?? ''
  }
  return out
}
