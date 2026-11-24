// 员工的记忆仓库：每个员工一个 git 仓库（在它干活那台机器上：<工作根>/emp/<员工>/memory），换会话、换执行器、换服务器都从这里接着干。
//   CLAUDE.md（AGENTS.md 链到它）：「我的角色」「我的人设」「规矩」由 Opero 按员工设置写（每次派活前对一遍），下面的地方员工自己记；
//   docs/交接.md：每次做完在最上面加一条；docs/记录/YYYY-MM.md：流水；docs/机器/<机器>.md：机器笔记；docs/资料/：自己的资料。
// 配了远端（员工设置里的「记忆仓库地址」+ 凭证）就拉 / 推远端，换服务器时在新机器上拉下来；没配就只在那台机器上有版本记录。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cfg } from './config.ts'
import { get } from './db.ts'
import { git, handBackDir, q } from './git.ts'
import * as agents from './agents.ts'
import * as hosts from './hosts.ts'
import type { Employee, Server, Workspace } from './types.ts'

const START = '<!-- opero:start（这一段由 Opero 按员工设置自动写，改员工设置就会更新，别手改） -->'
const END = '<!-- opero:end（下面随便记） -->'

/** 项目员工（项目在它干活那台）：不另建记忆仓库，记忆就是项目自己的 docs/（同一项目的员工共用） */
export function projectOf(emp: Employee, host: string): Workspace | undefined {
  const ws = emp.workspace ? get<Workspace>('workspaces', emp.workspace) : undefined
  return ws && (ws.server ?? hosts.LOCAL) === host ? ws : undefined
}
export function memDir(emp: Employee, host: string): string {
  const ws = projectOf(emp, host)
  if (ws) return ws.dir
  return hosts.isLocal(host) ? path.join(cfg.work, 'emp', emp.id, 'memory') : path.posix.join(agents.REMOTE_WORK, 'emp', emp.id, 'memory')
}

const month = () => new Date().toISOString().slice(0, 7)
const hostLabel = (host: string) => (hosts.isLocal(host) ? 'opero' : (get<Server>('servers', host)?.name ?? host).replace(/[^\w.\-一-龥]+/g, '-'))

/** Opero 管的那一段 */
function managed(emp: Employee, host: string): string {
  const persona = [emp.gender && `性别：${emp.gender}`, emp.persona?.trim() && `性格 / 说话风格：${emp.persona.trim()}`].filter(Boolean)
  return [
    START,
    `# ${emp.name}${emp.title ? ` · ${emp.title}` : ''}`,
    '',
    '> 这是我的记忆仓库（Opero 管）。开工先读这个文件和 docs/交接.md 最上面几条；做完更新交接和本月记录。',
    '',
    '## 我的角色',
    emp.prompt?.trim() || '（主人还没写职责，按主人每次说的做）',
    '',
    '## 我的人设',
    persona.length ? persona.map((x) => `- ${x}`).join('\n') : '- 简洁、先给结论',
    '',
    '## 规矩',
    '- 每次做完：在 docs/交接.md 最上面加一条（做了什么、为什么、怎么验证、还剩什么、下一步）；在 docs/记录/<年-月>.md 记一行流水（日期 + 一句话）。',
    `- 机器相关的（装了什么、目录在哪、踩过的坑）记在 docs/机器/${hostLabel(host)}.md。`,
    '- 自己的资料放 docs/资料/；所有员工都要用的，用 Opero 的 kb_save 存进知识库。',
    '- 这里不写密码、令牌、私钥。',
    '- 这个仓库每轮干完由 Opero 自动提交，你不用自己 commit。',
    END,
  ].join('\n')
}

function template(emp: Employee, host: string): Record<string, string> {
  const sv = hosts.isLocal(host) ? undefined : get<Server>('servers', host)
  const sys = sv?.sys
  return {
    'CLAUDE.md': `${managed(emp, host)}\n\n## 我的笔记\n`,
    'docs/交接.md': '# 交接\n\n> 最新的写在最上面：做了什么、为什么、怎么验证、还剩什么、下一步。\n',
    [`docs/记录/${month()}.md`]: `# ${month()} 记录\n\n`,
    [`docs/机器/${hostLabel(host)}.md`]: `# ${hostLabel(host)}\n\n${sys ? `- ${sys.os} · ${sys.cores} 核 · ${sys.memGb}G 内存 · ${sys.diskGb}G 磁盘\n- 主机名 ${sys.hostname}\n` : ''}- 工作目录 ${hosts.workRoot(host)}\n`,
    'docs/资料/.gitkeep': '',
  }
}

const author = (emp: Employee) => ['-c', `user.name=${emp.name}`, '-c', `user.email=${emp.id}@opero.local`]

async function exists(host: string, p: string): Promise<boolean> {
  if (hosts.isLocal(host)) return fs.existsSync(p)
  const r = await agents.exec(host, `test -e ${q(p)} && echo HAVE || true`)
  return r.out.includes('HAVE')
}
async function readText(host: string, p: string): Promise<string | undefined> {
  if (hosts.isLocal(host)) { try { return fs.readFileSync(p, 'utf8') } catch { return undefined } }
  const r = await agents.exec(host, `cat ${q(p)} 2>/dev/null && echo; echo __OPERO_END__$?`)
  if (!/__OPERO_END__0\s*$/.test(r.out)) return undefined
  return r.out.replace(/\n?__OPERO_END__0\s*$/, '').replace(/\n$/, '')
}
async function writeText(host: string, p: string, text: string) {
  if (hosts.isLocal(host)) {
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o2770 })
    fs.writeFileSync(p, text, { mode: 0o660 })
    return
  }
  agents.writeFile(host, p, Buffer.from(text))
  await new Promise((r) => setTimeout(r, 300)) // 写文件是派给 Agent 的活：等它落盘再跑 git
}

/** 派活前：没有就建（有远端就拉），有就把 Opero 管的那段对一遍。出错不挡派活，返回一句提示 */
export async function ensureMemory(emp: Employee, host: string): Promise<{ dir: string; note?: string }> {
  const dir = memDir(emp, host)
  try {
    if (!(await exists(host, path.posix.join(dir, '.git')))) await init(emp, host, dir)
    const f = path.posix.join(dir, 'CLAUDE.md')
    const cur = await readText(host, f)
    const want = managed(emp, host)
    if (cur === undefined) await writeText(host, f, `${want}\n\n## 我的笔记\n`)
    else {
      const a = cur.indexOf(START)
      const b = cur.indexOf(END)
      const next = a >= 0 && b > a ? cur.slice(0, a) + want + cur.slice(b + END.length) : `${want}\n\n${cur}`
      if (next !== cur) await writeText(host, f, next)
    }
    if (!hosts.isLocal(host)) await handBackDir(host, dir)
    return { dir }
  } catch (e) {
    return { dir, note: `记忆仓库没准备好：${(e as Error).message.slice(0, 200)}` }
  }
}

async function init(emp: Employee, host: string, dir: string) {
  if (hosts.isLocal(host)) fs.mkdirSync(dir, { recursive: true, mode: 0o2770 })
  else await agents.exec(host, `mkdir -p ${q(dir)}`)
  let cloned = false
  if (emp.memRepo) {
    const r = await git(['clone', emp.memRepo, dir], { cred: emp.memCred, host, timeoutMs: 300_000 })
    cloned = r.code === 0
    if (!cloned && !/empty repository/i.test(r.out)) throw new Error(`拉不下记忆仓库：${r.out.slice(-200)}`)
  }
  if (!cloned) {
    await git(['init', '-q', dir], { host })
    if (emp.memRepo) await git(['remote', 'add', 'origin', emp.memRepo], { host, cwd: dir })
  }
  await git(['config', 'core.sharedRepository', 'group'], { host, cwd: dir })
  // 拉下来的仓库里已经有的文件不覆盖
  for (const [rel, text] of Object.entries(template(emp, host))) {
    const p = path.posix.join(dir, rel)
    if (!(await exists(host, p))) await writeText(host, p, text)
  }
  if (!(await exists(host, path.posix.join(dir, 'AGENTS.md')))) {
    if (hosts.isLocal(host)) fs.symlinkSync('CLAUDE.md', path.join(dir, 'AGENTS.md'))
    else await agents.exec(host, `ln -s CLAUDE.md ${q(path.posix.join(dir, 'AGENTS.md'))}`)
  }
  await commitMemory(emp, host, `${emp.name}: 建记忆仓库`)
}

/** 干完一轮：有改动就提交（配了远端就推）；返回一句给聊天看的结果，没改动返回空 */
export async function commitMemory(emp: Employee, host: string, message: string): Promise<string> {
  const dir = memDir(emp, host)
  const o = { host, cwd: dir }
  await git(['add', '-A'], o)
  const st = await git(['status', '--porcelain'], o)
  let out = ''
  if (st.out.trim()) {
    const c = await git([...author(emp), 'commit', '-q', '-m', message], o)
    out = c.code === 0 ? '记忆已提交' : `记忆没提交上：${c.out.slice(-200)}`
  }
  if (emp.memRepo) {
    const p = await git(['push', '-u', 'origin', 'HEAD'], { ...o, cred: emp.memCred, timeoutMs: 120_000 })
    if (p.code !== 0 && !/up.to.date/i.test(p.out)) out = `${out ? out + '，' : ''}推送记忆仓库失败：${p.out.slice(-200)}`
    else if (out) out += '并推送'
  }
  await handBackDir(host, dir)
  return out
}

/** 网页「记忆」页：列文件 / 读 / 写（写完自动提交） */
export async function listFiles(emp: Employee, host: string): Promise<string[]> {
  const r = await git(['ls-files'], { host, cwd: memDir(emp, host) })
  const all = r.code === 0 ? r.out.split('\n').filter((f) => f && !f.endsWith('.gitkeep')) : []
  // 项目员工：只给看项目的说明和 docs/
  const mine = projectOf(emp, host) ? all.filter((f) => f.startsWith('docs/') || /^(CLAUDE|AGENTS|README)[\w.-]*\.md$/i.test(f)) : all
  return mine.slice(0, 300)
}
export async function readFile(emp: Employee, host: string, rel: string): Promise<string | undefined> {
  if (!safeRel(rel)) return undefined
  return readText(host, path.posix.join(memDir(emp, host), rel))
}
export async function writeFile(emp: Employee, host: string, rel: string, text: string): Promise<string> {
  if (!safeRel(rel)) throw new Error('路径不对')
  await writeText(host, path.posix.join(memDir(emp, host), rel), text)
  if (projectOf(emp, host)) return `已保存 ${rel}（项目的文件：下一轮员工干完会跟代码一起提交）`
  return commitMemory(emp, host, `主人改了 ${rel}`)
}
const safeRel = (rel: string) => !!rel && !rel.startsWith('/') && !rel.split('/').includes('..') && !rel.startsWith('.git')

/** 员工换了服务器、又没配远端：把记忆仓库（连 .git）从旧机器搬到新机器。配了远端的不用搬，新机器上会拉 */
export async function moveMemory(emp: Employee, from: string, to: string): Promise<string> {
  if (emp.memRepo || from === to || projectOf(emp, from) || projectOf(emp, to)) return ''
  const src = memDir(emp, from)
  const dst = memDir(emp, to)
  if (!(await exists(from, path.posix.join(src, '.git')))) return ''
  if (await exists(to, path.posix.join(dst, '.git'))) return '新机器上已经有它的记忆仓库，没覆盖'
  // 打包：本机直接 tar，远程经 Agent 输出 base64
  let tgz: Buffer
  if (hosts.isLocal(from)) tgz = execFileSync('tar', ['czf', '-', '-C', src, '.'], { maxBuffer: 200 * 1024 * 1024 })
  else {
    const r = await agents.exec(from, `tar czf - -C ${q(src)} . | base64 -w0`, { timeoutMs: 300_000 })
    if (r.code !== 0) throw new Error(`旧机器上打包失败：${r.out.slice(-200)}`)
    tgz = Buffer.from(r.out.trim(), 'base64')
  }
  if (tgz.length > 30 * 1024 * 1024) throw new Error('记忆仓库太大（超过 30 MB），配一个远端仓库再换服务器')
  // 解开：本机直接 tar，远程先放一个临时文件再解
  if (hosts.isLocal(to)) {
    fs.mkdirSync(dst, { recursive: true, mode: 0o2770 })
    const tmp = path.join(os.tmpdir(), `opero-mem-${emp.id}.tgz`)
    fs.writeFileSync(tmp, tgz, { mode: 0o600 })
    try { execFileSync('tar', ['xzf', tmp, '-C', dst]) } finally { fs.rmSync(tmp, { force: true }) }
  } else {
    const tmp = path.posix.join(agents.REMOTE_WORK, 'emp', emp.id, '.memory-move.tgz')
    agents.writeFile(to, tmp, tgz)
    await new Promise((r) => setTimeout(r, 1500))
    const r = await agents.exec(to, `mkdir -p ${q(dst)} && tar xzf ${q(tmp)} -C ${q(dst)} && rm -f ${q(tmp)}`, { timeoutMs: 300_000 })
    if (r.code !== 0) throw new Error(`新机器上解开失败：${r.out.slice(-200)}`)
    await handBackDir(to, dst)
  }
  return `记忆仓库已从旧机器搬过来（${Math.max(1, Math.round(tgz.length / 1024))} KB）`
}
