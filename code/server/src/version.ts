// 发布卡片上显示的版本号：主人要看「0.30.0」，不是「c0b6caa」。
// 先后：编译设置里配了版本号文件的用它读出来的 → 产物文件名里带的（opero-yima-0.30.0.tgz）→ 仓库里那个提交的常见版本号文件 → 实在没有才用短提交号。
import { git } from './git.ts'
import type { Workspace } from './types.ts'

/** 看着像提交号（或者空）：说明没认出版本号 */
export const shaLike = (v?: string) => !v || /^[0-9a-f]{7,40}$/i.test(v.trim())

const EXT = /\.(tar\.gz|tar\.xz|tgz|zip|apk|aab|ipa|dmg|pkg|msix|msixbundle|appx|exe|msi|appimage|deb|rpm|jar|war|whl|gz|xz|7z)$/i
/** 产物文件名里的版本号：app-1.2.3.apk、opero-0.30.0.tgz、MyApp_v2.0.1-beta.2.msix */
export function fromFileName(name?: string): string {
  if (!name) return ''
  const base = name.split('/').pop()!.replace(EXT, '')
  const m = base.match(/(?:^|[-_ .v])v?(\d+\.\d+\.\d+(?:\.\d+)?(?:-(?:alpha|beta|rc|pre|preview|dev|snapshot|canary|nightly)[0-9A-Za-z.]*)?)(?=$|[-_+ ])/i)
  return m?.[1] ?? ''
}

/** 常见版本号文件里读：package.json、VERSION、gradle versionName、pom.xml、Cargo.toml / pyproject.toml */
export function fromContent(file: string, text: string): string {
  const f = file.toLowerCase()
  const pick = (re: RegExp) => text.match(re)?.[1]?.trim() ?? ''
  if (f.endsWith('package.json')) { try { return String(JSON.parse(text).version ?? '') } catch { return pick(/"version"\s*:\s*"([^"]+)"/) } }
  if (/(^|\/)(version|version\.txt)$/.test(f)) return pick(/^\s*v?(\S+)/)
  if (/\.gradle(\.kts)?$/.test(f)) return pick(/versionName\s*=?\s*["']([^"']+)["']/)
  if (f.endsWith('pom.xml')) return pick(/<\/modelVersion>(?:\s*<parent>[\s\S]*?<\/parent>)?[\s\S]*?<version>([^<$]+)<\/version>/)
  if (f.endsWith('cargo.toml') || f.endsWith('pyproject.toml')) return pick(/^\s*\[(?:package|project|tool\.poetry)\][^[]*?^\s*version\s*=\s*["']([^"']+)["']/m)
  return ''
}

const NAMES = /(^|\/)(package\.json|VERSION|version\.txt|build\.gradle(\.kts)?|pom\.xml|Cargo\.toml|pyproject\.toml)$/
/** 仓库里那个提交的版本号：先看根目录；根目录没有，再看最浅一层——那一层几个文件版本号都一样才算（不一样说明是多个子项目，猜不准就不猜） */
export async function fromRepo(w: Workspace, sha: string): Promise<string> {
  if (!w.dir || !sha) return ''
  const o = { host: w.server, cwd: w.dir, timeoutMs: 20_000 }
  if ((await git(['cat-file', '-e', `${sha}^{commit}`], o)).code !== 0) await git(['fetch', '--quiet', 'origin'], { ...o, cred: w.credential, timeoutMs: 60_000 })
  const ls = await git(['ls-tree', '-r', '--name-only', sha], o)
  if (ls.code !== 0) return ''
  const files = ls.out.split('\n').map((x) => x.trim()).filter((x) => NAMES.test(x) && !/node_modules|\/test|\/example|\/vendor/i.test(x))
  const byDepth = new Map<number, string[]>()
  for (const f of files) { const d = f.split('/').length; if (d <= 4) byDepth.set(d, [...(byDepth.get(d) ?? []), f]) }
  for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
    const vs = new Set<string>()
    for (const f of byDepth.get(d)!) {
      const s = await git(['show', `${sha}:${f}`], o)
      const v = s.code === 0 ? fromContent(f, s.out) : ''
      if (v && !shaLike(v) && !/[${]/.test(v)) vs.add(v)
    }
    if (vs.size === 1) return [...vs][0]
    if (vs.size > 1) return ''
  }
  return ''
}

/** 定这次发布显示的版本号 */
export async function decide(o: { built?: string; pkgName?: string; w?: Workspace; sha: string }): Promise<string> {
  if (o.built && !shaLike(o.built)) return o.built
  const f = fromFileName(o.pkgName)
  if (f) return f
  if (o.w) { try { const r = await fromRepo(o.w, o.sha); if (r) return r } catch { /* 读不到就算了 */ } }
  return o.sha.slice(0, 7)
}
