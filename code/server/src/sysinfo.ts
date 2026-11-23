// 机器信息（Agent 心跳带上、Opero 这台自己读）：只用 Node 自带的东西，agent.ts 也 import 它。
import fs from 'node:fs'
import os from 'node:os'

export interface SysInfo {
  hostname: string
  os: string
  kernel: string
  arch: string
  cpuModel: string
  cores: number
  memGb: number
  diskGb: number
  /** 内网地址（不含 127.0.0.1） */
  ips: string[]
  /** 开机多久（秒） */
  uptime: number
}

export function sysInfo(): SysInfo {
  let pretty = ''
  try { pretty = fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1] ?? '' } catch { /* 不是 Linux */ }
  let diskGb = 0
  try { const s = fs.statfsSync('/'); diskGb = Math.round((s.blocks * s.bsize) / 1073741824) } catch { /* 读不到 */ }
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && !a.internal && a.family === 'IPv4')
    .map((a) => a.address)
  const cpus = os.cpus()
  return {
    hostname: os.hostname(),
    os: pretty || `${os.type()} ${os.release()}`,
    kernel: os.release(),
    arch: os.arch(),
    cpuModel: (cpus[0]?.model ?? '').replace(/\s+/g, ' ').trim(),
    cores: cpus.length,
    memGb: Math.round(os.totalmem() / 1073741824 * 10) / 10,
    diskGb,
    ips: [...new Set(ips)].slice(0, 8),
    uptime: Math.round(os.uptime()),
  }
}

/** 收到的机器信息只留认得的字段、限长（Agent 报上来的不全信） */
export function cleanSys(v: unknown): SysInfo | undefined {
  if (!v || typeof v !== 'object') return undefined
  const b = v as Record<string, unknown>
  const s = (x: unknown, n = 120) => String(x ?? '').slice(0, n)
  const n = (x: unknown) => Math.max(0, Number(x) || 0)
  return {
    hostname: s(b.hostname, 80), os: s(b.os), kernel: s(b.kernel, 80), arch: s(b.arch, 20), cpuModel: s(b.cpuModel), cores: n(b.cores),
    memGb: n(b.memGb), diskGb: n(b.diskGb), ips: Array.isArray(b.ips) ? b.ips.slice(0, 8).map((x) => s(x, 45)) : [], uptime: n(b.uptime),
  }
}
