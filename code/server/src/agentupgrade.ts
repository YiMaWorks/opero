// Agent 自动升级（照 KidLock 的做法，2026-11-28 主人定的）：Agent 比 Opero 旧，就挑那台空闲的时候自己升，不用人点「升级 Agent」。
//   空闲 = 那台上没有员工在干活、没有正在发到那台的发布；不空就等下一轮再看（两分钟一次）。
//   升级跟手动点一样：在那台另起一个 systemd 单元跑 opero update（Agent 重启也不会把它带走），程序从连着的这套 Opero 拿（同一个版本、不靠 GitHub）。
//   每个版本试一次；15 分钟还没升上来算失败，一小时后再试。Opero 这台自己的 Agent 跟 Opero 一起升，不管。每台能关（server.autoUpgrade = false）。
import { all, get, put } from './db.ts'
import { emit } from './bus.ts'
import { audit } from './chat.ts'
import { cfg } from './config.ts'
import * as agents from './agents.ts'
import * as runner from './runner.ts'
import type { Deploy, Employee, Release, Server, Workspace } from './types.ts'

export interface UpgradeState { target: string; at: number; status: 'running' | 'ok' | 'failed' | 'waiting'; msg?: string }
const RETRY = 60 * 60_000
const GIVE_UP = 15 * 60_000

/** 那台忙不忙：有员工在那台干活，或者正在往那台发布 */
export function busyWhy(sv: Server): string {
  const working = all<Employee>('employees').filter((e) => runner.hostOf(e) === sv.id && runner.isWorking(e.id))
  if (working.length) return `${working.map((e) => e.name).join('、')} 在这台干活`
  for (const r of all<Release>('releases').filter((x) => x.status === 'running')) {
    const d: Deploy | undefined = get<Workspace>('workspaces', r.ws)?.deploys?.find((x) => x.id === r.target)
    if (d?.servers?.includes(sv.id)) return `正在发布到这台（${r.targetName}）`
  }
  return ''
}

function save(sv: Server, st: UpgradeState) {
  const cur = get<Server>('servers', sv.id)
  if (!cur) return
  const next = { ...cur, agentUpgrade: st }
  put('servers', next)
  emit({ t: 'put', coll: 'servers', item: agents.pub(next) })
}

/** 看一台：该升就升，返回做了什么（测试、日志用） */
export async function check(sv: Server, now = Date.now(), exec: typeof agents.exec = agents.exec): Promise<string> {
  if (sv.id === 'local' || sv.via !== 'agent' || sv.autoUpgrade === false) return 'skip'
  const st = sv.agentUpgrade
  const target = cfg.version
  if (agents.agentAtLeast(sv, target)) {
    if (st && st.status !== 'ok' && st.target === target) save(sv, { target, at: now, status: 'ok', msg: `已升到 ${sv.agentVersion}` })
    return 'current'
  }
  if (!agents.agentOnline(sv)) return 'offline'
  if (st?.target === target) {
    if (st.status === 'running' && now - st.at < GIVE_UP) return 'running'
    if (st.status === 'running') { save(sv, { target, at: now, status: 'failed', msg: `15 分钟还没升上来（现在还是 ${sv.agentVersion || '旧版本'}），一小时后再试；也可以在那台上运行 sudo opero update 看看报什么` }); return 'failed' }
    if (st.status === 'failed' && now - st.at < RETRY) return 'wait-retry'
  }
  const why = busyWhy(sv)
  if (why) {
    if (st?.status !== 'waiting' || st.target !== target || st.msg !== `等空闲：${why}`) save(sv, { target, at: st?.target === target && st.status === 'waiting' ? st.at : now, status: 'waiting', msg: `等空闲：${why}` })
    return 'busy'
  }
  const r = await exec(sv.id, 'systemd-run --unit=opero-agent-upgrade --collect --quiet /usr/local/bin/opero update && echo STARTED', { timeoutMs: 30_000 })
  const ok = r.out.includes('STARTED')
  audit({ via: '—', action: 'agent.upgrade', target: `${sv.name}：${sv.agentVersion || '?'} → ${target}`, level: '写', result: ok ? '成功' : '失败', how: '自动升级（那台空闲时）' })
  save(sv, ok ? { target, at: now, status: 'running', msg: `在升级：${sv.agentVersion || '?'} → ${target}` } : { target, at: now, status: 'failed', msg: `没能开始升级：${r.out.slice(-200)}（一小时后再试）` })
  return ok ? 'started' : 'failed'
}

/** 两分钟看一次所有 Agent 服务器（Opero 刚启动先等一分钟，Agent 们连上来再看） */
export function startLoop() {
  const tick = async () => { for (const sv of all<Server>('servers')) { try { await check(sv) } catch { /* 下一轮再看 */ } } }
  setTimeout(tick, 60_000).unref()
  setInterval(tick, 2 * 60_000).unref()
}
