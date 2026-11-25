// 服务器登记的目录（员工能读 / 能写 / 能部署）和日志：网页和员工工具共用的检查、按目录给 AI 用户开 ACL
import { cfg } from './config.ts'
import { get } from './db.ts'
import { bad } from './http.ts'
import { execOn, LOCAL_ID, localRoot } from './ssh.ts'
import type { LogSource, Server, ServerDir } from './types.ts'

/** 服务器登记的目录：绝对路径、不是系统目录、最多 30 个 */
export function cleanDirs(list: unknown): ServerDir[] {
  if (!Array.isArray(list)) return []
  const SYS = /^\/(etc|usr|bin|sbin|lib|lib64|boot|proc|sys|dev|run|var\/lib|root)(\/|$)/
  return list.slice(0, 30).map((x: any) => {
    const p = String(x?.path ?? '').trim().replace(/\/+$/, '')
    if (!/^\/[\w./@+-]+$/.test(p) || p.includes('..') || p.split('/').length < 3 && !/^\/(srv|opt|data|home|www|var)\/?/.test(p)) throw bad(`目录不对：${p}（要绝对路径，至少两层，比如 /srv/app）`)
    if (SYS.test(p) && x?.mode !== 'read') throw bad(`${p} 是系统目录，只能登记成「只读」`)
    return { path: p, mode: ['read', 'write', 'deploy'].includes(x?.mode) ? x.mode : 'read', note: String(x?.note ?? '').slice(0, 80) || undefined }
  })
}
/** 登记的日志：文件（可带 *）/ 目录 / 系统服务，最多 30 个 */
export function cleanLogs(list: unknown): LogSource[] {
  if (!Array.isArray(list)) return []
  return list.slice(0, 30).map((x: any) => {
    const kind: LogSource['kind'] = ['file', 'dir', 'service'].includes(x?.kind) ? x.kind : 'file'
    const p = String(x?.path ?? '').trim().replace(/(.)\/+$/, '$1')
    if (kind === 'service' ? !/^[\w@.:-]+$/.test(p) : (!/^\/[\w./*@+-]+$/.test(p) || p.includes('..'))) throw bad(kind === 'service' ? `服务名不对：${p}` : `日志路径不对：${p}（要绝对路径，可以带 *）`)
    return { kind, path: p, note: String(x?.note ?? '').slice(0, 80) || undefined }
  })
}
/** 按登记的目录给 AI 用户开权限（ACL）：只读 = r-X，读写 = rwX（连默认 ACL，新文件也跟着），能部署的由 Agent 以 root 部署、不用开。去掉的收回 */
export async function applyDirs(sv: Server, dirs: ServerDir[], save: (sv: Server) => void) {
  const before = sv.dirs ?? []
  const results: ServerDir[] = []
  const local = sv.id === LOCAL_ID && !localRoot() // 本机装了 Agent 就和别的机器一样经 Agent（root）开
  const ai = local ? (cfg.aiUser || 'opero-ai') : 'opero-ai'
  for (const d of dirs) {
    if (d.mode === 'deploy') { results.push({ ...d, ok: true }); continue }
    const perm = d.mode === 'write' ? 'rwX' : 'rX'
    const cmd = `set -e; command -v setfacl >/dev/null || { echo "这台没有 setfacl（装 acl 包：apt install acl / yum install acl）"; exit 3; }; test -d ${shq(d.path)} || { echo "目录不存在"; exit 4; }
p=${shq(d.path)}; while [ "$p" != "/" ]; do p=$(dirname "$p"); setfacl -m u:${ai}:x "$p" 2>/dev/null || true; done
setfacl -R -m u:${ai}:${perm} ${shq(d.path)} && setfacl -R -d -m u:${ai}:${perm} ${shq(d.path)} && echo OK`
    if (local) { results.push({ ...d, ok: false, error: `Opero 这台要你自己用 root 跑：setfacl -R -m u:${ai}:${perm} ${d.path} && setfacl -R -d -m u:${ai}:${perm} ${d.path}` }); continue }
    const r = await execOn(sv, cmd, 120_000)
    results.push({ ...d, ok: r.out.includes('OK'), error: r.out.includes('OK') ? undefined : r.out.trim().split('\n').pop()?.slice(0, 200) })
  }
  for (const old of before.filter((x) => x.mode !== 'deploy' && !dirs.some((d) => d.path === x.path && d.mode !== 'deploy'))) {
    if (!local) await execOn(sv, `command -v setfacl >/dev/null && setfacl -R -x u:${ai} ${shq(old.path)} 2>/dev/null; setfacl -R -d -x u:${ai} ${shq(old.path)} 2>/dev/null; true`, 120_000).catch(() => {})
  }
  const cur = get<Server>('servers', sv.id)
  if (cur) save({ ...cur, dirs: results })
}
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
