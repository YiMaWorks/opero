// 项目的安装包：每个项目按「端 × 渠道」分格（安卓-测试、安卓-正式、iPhone-正式…），每格只留最新一个，新的进来旧的删掉。
// 包从三条路来：发布环境选「存进安装包」（编完签好自动放）、员工 package_upload（从它的目录传）、主人在网页上拖进来（苹果 / Windows 在本地打的包）。
// 文件放在数据目录 packages/<项目>/<端>-<渠道>/ 里，不进仓库；下载要登录，或者用分享链接（带口令、默认 7 天过期，扫码装）。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { cfg } from './config.ts'
import { all, del, get, kvGet, put } from './db.ts'
import { emit } from './bus.ts'
import { audit } from './chat.ts'
import * as agents from './agents.ts'
import * as hosts from './hosts.ts'
import { expectBlob, pendingBlobs } from './build.ts'
import type { Workspace } from './types.ts'

export const PLATFORMS = {
  android: { label: '安卓', exts: ['apk', 'aab'] },
  ios: { label: 'iPhone / iPad', exts: ['ipa'] },
  mac: { label: 'Mac', exts: ['dmg', 'pkg'] },
  windows: { label: 'Windows', exts: ['msix', 'msixbundle', 'appx', 'msi', 'exe'] },
  linux: { label: 'Linux', exts: ['appimage', 'deb', 'rpm'] },
} as const
export type Platform = keyof typeof PLATFORMS
export const CHANNELS = { test: '测试', prod: '正式' } as const
export type Channel = keyof typeof CHANNELS

/** 一格里的那一个包（id = 项目:端:渠道，同一格永远是这个 id） */
export interface AppPackage {
  id: string
  ws: string
  platform: Platform
  channel: Channel
  file: string
  size: number
  sha256: string
  version?: string
  /** 编译号（versionCode / CFBundleVersion…），知道就记 */
  build?: string
  /** 哪个提交编的 */
  commit?: string
  /** 签过名没有：true / false；不知道（别处打好拖进来的）不写 */
  signed?: boolean
  note?: string
  /** 谁放的：主人 / 员工名 / 「发布 · 环境名」 */
  by: string
  at: number
  /** 分享链接：有口令、到期时间；没有 = 只有登录的人能下 */
  share?: { token: string; until: number }
}

const MAX = 2 * 1024 * 1024 * 1024 // 2 GB
const root = () => path.join(cfg.data, 'packages')
const slotDir = (ws: string, p: Platform, c: Channel) => path.join(root(), ws, `${p}-${c}`)
export const idOf = (ws: string, p: Platform, c: Channel) => `${ws}:${p}:${c}`
export const fileOf = (x: AppPackage) => path.join(slotDir(x.ws, x.platform, x.channel), x.file)
export const list = (ws?: string) => all<AppPackage>('packages').filter((x) => !ws || x.ws === ws).sort((a, b) => a.platform.localeCompare(b.platform) || a.channel.localeCompare(b.channel))
export const isPlatform = (v: unknown): v is Platform => typeof v === 'string' && v in PLATFORMS
export const isChannel = (v: unknown): v is Channel => v === 'test' || v === 'prod'
/** 给网页 / 员工看的：不带分享口令以外的内部东西，加上格子的名字 */
export const pub = (x: AppPackage) => ({ ...x, slot: `${PLATFORMS[x.platform].label} · ${CHANNELS[x.channel]}` })

/** 看文件名猜是哪个端：.apk / .aab 安卓、.ipa 苹果手机、.dmg / .pkg Mac、.msix / .exe / .msi Windows、.AppImage / .deb / .rpm Linux */
export function guessPlatform(name: string): Platform | undefined {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  return (Object.keys(PLATFORMS) as Platform[]).find((p) => (PLATFORMS[p].exts as readonly string[]).includes(ext))
}
/** 看文件名猜版本：app-1.2.3.apk、Opero_0.4.0_x64.msix、opero-v2.1.0-release.ipa… */
export function guessVersion(name: string): string | undefined {
  return name.match(/(?:^|[-_ v])v?(\d+\.\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.]+)?)(?=[-_ .])/)?.[1]?.replace(/[-+](unsigned|signed|release|debug)$/i, '')
}

/** 放进一格：src 是 Opero 这台上的临时文件（会被挪走）。旧的那个删掉，记下大小、SHA256，推给网页 */
export function store(w: Workspace, platform: Platform, channel: Channel, src: string, m: { name: string; version?: string; build?: string; commit?: string; signed?: boolean; note?: string; by: string }): AppPackage {
  const st = fs.statSync(src)
  if (!st.isFile() || st.size === 0) throw new Error('包是空的')
  if (st.size > MAX) throw new Error('包太大（最多 2 GB）')
  const name = path.basename(m.name).replace(/[^\w.@+ ()一-鿿-]/g, '_').slice(0, 120) || `package.${PLATFORMS[platform].exts[0]}`
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex')
  const dir = slotDir(w.id, platform, channel)
  // 只留最新：整个格子清掉再放
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dst = path.join(dir, name)
  try { fs.renameSync(src, dst) } catch { fs.copyFileSync(src, dst); fs.rmSync(src, { force: true }) }
  const old = get<AppPackage>('packages', idOf(w.id, platform, channel))
  const x: AppPackage = {
    id: idOf(w.id, platform, channel), ws: w.id, platform, channel, file: name, size: st.size, sha256,
    version: (m.version || guessVersion(name) || '').slice(0, 60) || undefined, build: m.build?.slice(0, 30) || undefined, commit: m.commit?.slice(0, 40) || undefined,
    signed: m.signed, note: m.note?.slice(0, 500) || undefined, by: m.by, at: Date.now(),
    // 分享链接换了包照样能用（还没过期的话）
    ...(old?.share && old.share.until > Date.now() ? { share: old.share } : {}),
  }
  put('packages', x)
  emit({ t: 'put', coll: 'packages', item: pub(x) })
  audit({ via: m.by, action: 'package.store', target: `${w.name} · ${pub(x).slot} · ${name}${x.version ? ` ${x.version}` : ''}`, level: '写', result: '成功', how: old ? `换掉了 ${old.file}${old.version ? ` ${old.version}` : ''}` : '这一格的第一个' })
  return x
}

export function remove(id: string, by: string) {
  const x = get<AppPackage>('packages', id)
  if (!x) return
  fs.rmSync(slotDir(x.ws, x.platform, x.channel), { recursive: true, force: true })
  del('packages', id)
  emit({ t: 'del', coll: 'packages', id })
  audit({ via: by, action: 'package.remove', target: `${x.file}`, level: '写', result: '成功', how: '' })
}

/** 开 / 关分享链接（days = 0 关掉）；返回新的那条 */
export function share(id: string, days: number, by: string): AppPackage {
  const x = get<AppPackage>('packages', id)
  if (!x) throw new Error('这一格还没有包')
  const next: AppPackage = days > 0 ? { ...x, share: { token: crypto.randomBytes(18).toString('base64url'), until: Date.now() + Math.min(days, 90) * 86400_000 } } : { ...x, share: undefined }
  put('packages', next)
  emit({ t: 'put', coll: 'packages', item: pub(next) })
  audit({ via: by, action: days > 0 ? 'package.share' : 'package.unshare', target: x.file, level: '写', result: '成功', how: days > 0 ? `${days} 天有效` : '' })
  return next
}
/** 分享链接用的：口令对、没过期才给 */
export function byShare(token: string): AppPackage | undefined {
  if (!/^[\w-]{20,40}$/.test(token)) return undefined
  return all<AppPackage>('packages').find((x) => x.share?.token === token && x.share.until > Date.now())
}

/** 把干活那台上的文件拿到 Opero 这台的临时文件（本机直接复制；别的服务器让 Agent 推上来）。员工传包、发文件都用它 */
export async function pullFromHost(host: string, file: string, max = MAX): Promise<{ tmp: string; size: number }> {
  const tmpDir = path.join(cfg.data, 'tmp')
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 })
  const tmp = path.join(tmpDir, `pull-${crypto.randomBytes(8).toString('hex')}`)
  if (hosts.isLocal(host)) {
    const st = fs.statSync(file)
    if (!st.isFile()) throw new Error('不是文件')
    if (st.size > max) throw new Error(`文件太大（最多 ${Math.round(max / 1048576)} MB）`)
    fs.copyFileSync(file, tmp)
    return { tmp, size: st.size }
  }
  const sz = await hosts.runAiOn(host, 'stat', ['-c', '%s', file], { timeoutMs: 20_000 })
  const size = Number(sz.out.trim().split('\n').pop())
  if (sz.code !== 0 || !Number.isFinite(size)) throw new Error('文件不存在或读不到')
  if (size > max) throw new Error(`文件太大（最多 ${Math.round(max / 1048576)} MB）`)
  const key = crypto.randomBytes(16).toString('hex')
  expectBlob(key, host, tmp)
  const t = await agents.blobTask(host, { t: 'push', key, path: file }).finally(() => pendingBlobs.delete(key))
  if (t.code !== 0 || !fs.existsSync(tmp)) { fs.rmSync(tmp, { force: true }); throw new Error(`从那台拿文件失败：${t.out.slice(-200)}`) }
  return { tmp, size }
}

/** 把 Opero 这台上的一个文件放到干活那台（员工 package_get 用）：本机直接复制，别的服务器让 Agent 来拿（带 sha256 核对） */
export async function pushToHost(host: string, file: string, dst: string, sha256: string): Promise<void> {
  if (hosts.isLocal(host)) {
    // 本机：工作目录是 Opero 和 AI 用户共用的组（setgid、umask 007），Opero 复制过去 AI 用户就能读写
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(file, dst)
    fs.chmodSync(dst, 0o660)
    return
  }
  const { allowPull, forgetPull } = await import('./releases.ts')
  const key = crypto.randomBytes(16).toString('hex')
  allowPull(key, host, file)
  const t = await agents.blobTask(host, { t: 'pull', key, path: dst, sha256 }).finally(() => forgetPull(key))
  if (t.code !== 0) throw new Error(`发不过去：${t.out.slice(-200) || 'Agent 要升级'}`)
}

/** 对外的网址（分享链接用）：配了 OPERO_URL 用它，没配用主人最近一次打开 Opero 的地址 */
export const publicBase = () => cfg.publicUrl || kvGet<string>('seenBase', '')
