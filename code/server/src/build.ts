// 编译：每个项目可以有好几个编译组件（Workspace.builds：网页、安卓、后台…），各自的模板、命令、在哪编、流水线；发布目标选发哪个（Deploy.build）。
// 在哪编：云效流水线 / GitHub Actions / GitLab CI / Jenkins / 自己的某台服务器（local）。
// 产物约定（三种一样，也和以前在云效上用的一样）：编译脚本把要发的东西放进 out/，最后写 out/SHA256SUMS、out/COMMIT、out/VERSION；
//   node / go 模板打一个 <名字>-<版本>.tgz，包里带 deploy.sh（部署时 Agent 以 root 跑：bash deploy.sh <包目录> <发布编号>，
//   OPERO_DIR / KL_DIR = 部署目录）；android 模板出 *-unsigned.apk（签名在部署时做，证书不进流水线）；custom 自己的命令自己放。
// 云效：用 Codeup 仓库那个组织，「一键生成流水线」按模板建 / 改 YAML；跑的时候带分支，轮询状态，拿产物下载地址。
// GitHub：把工作流文件 .github/workflows/opero-build-<组件>.yml 提交进仓库（用项目的令牌，要有 workflow 权限），workflow_dispatch 触发，产物是 zip。
// 自己的服务器：在那台上拉一份干净的代码跑同一个脚本，out/ 打成 tgz 经 Opero 拿回来。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { cfg } from './config.ts'
import { get } from './db.ts'
import { getSecret } from './vault.ts'
import { git, q } from './git.ts'
import { execOnEnv } from './ssh.ts'
import * as agents from './agents.ts'
import * as hosts from './hosts.ts'
import type { Deploy, Server, Workspace } from './types.ts'
import { hostRes } from './resources.ts'
import * as pipes from './pipelines.ts'
import { resourceBlock } from './policy.ts'
import { failLog } from './faillog.ts'
export { failLog }

export type BuildKind = 'node' | 'go' | 'android' | 'spring' | 'custom'
export interface BuildCfg {
  kind: BuildKind
  /** 在哪编：auto = 编之前看本地资源，够就本地、不够走流水线（默认）；local = 总是本地；pipeline = 总是流水线 */
  where?: 'auto' | 'local' | 'pipeline'
  /** 流水线用哪个打包工具（local = 没有流水线，只能本地编） */
  provider: 'yunxiao' | 'github' | 'gitlab' | 'jenkins' | 'local'
  /** 代码在仓库的哪个子目录（node / go / android / spring 用） */
  subdir?: string
  /** custom：在仓库根目录跑的命令，自己把产物放进 out/ */
  cmd?: string
  /** 版本号从哪读（文件 + 正则，第一个括号是版本号）；不填用提交号 */
  versionFile?: string
  versionRe?: string
  /** node / go 的 deploy.sh 最后重启哪个 systemd 服务 */
  service?: string
  /** spring：maven / gradle、JDK 17 / 21、编译命令、jar 在哪、一起带上的目录 */
  spring?: { tool?: 'maven' | 'gradle'; jdk?: 17 | 21; task?: string; jar?: string; dirs?: string[] }
  /** 发哪个产物文件（默认 node / go / custom：*.tgz，android：*.apk，spring：bundle.tgz） */
  file?: string
  /** 云效：令牌在哪个凭证、组织（默认 Codeup 地址里的）、流水线编号（一键生成后记下）、构建镜像 */
  yunxiao?: { cred: string; org?: string; pipelineId?: string; image?: string; at?: number }
  /** GitHub：工作流文件名（默认 opero-build-<组件编号>.yml）、生成时间 */
  github?: { workflow?: string; at?: number }
  /** GitLab CI：生成时间（流水线文件提交进仓库，令牌用项目的 GitLab 凭证） */
  gitlab?: { at?: number }
  /** Jenkins：凭证（「凭证 → 其它 → Jenkins」）、任务名、生成时间 */
  jenkins?: { cred: string; job?: string; at?: number }
  /** 本地编：在哪台编（默认项目所在那台） */
  local?: { server: string }
  /** 自动建流水线没成功的原因（给主人看，能重新生成） */
  pipelineError?: string
}

/** 一个编译组件：编译设置 + 编号 + 名字（「网页」「安卓」）。一个项目可以有好几个 */
export interface BuildComp extends BuildCfg { id: string; name: string }
export const buildsOf = (w: Workspace): BuildComp[] => w.builds ?? []
/** 按编号或名字找；不给的话项目只有一个组件就是它 */
export function findBuild(w: Workspace, key?: string): BuildComp | undefined {
  const list = buildsOf(w)
  if (!key) return list.length === 1 ? list[0] : undefined
  return list.find((b) => b.id === key) ?? list.find((b) => b.name === key)
}
/** 这个发布目标发哪个组件：build = 'none' 不编译（只跑部署命令）；没填且项目只有一个组件就用它 */
export function buildForDeploy(w: Workspace, d: Deploy): BuildComp | undefined {
  if (d.build === 'none') return undefined
  const list = buildsOf(w)
  if (d.build) {
    const b = list.find((x) => x.id === d.build)
    if (!b) throw new Error(`发布目标「${d.name}」选的编译组件已经删了：重新选一个`)
    return b
  }
  if (list.length > 1) throw new Error(`「${w.name}」有 ${list.length} 个编译组件，发布目标「${d.name}」要选发哪个`)
  return list[0]
}
/** 新组件的编号：名字里的字母数字（web、android），没有就随机；不和已有的重 */
export function newBuildId(w: Workspace, name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || `b${crypto.randomBytes(2).toString('hex')}`
  const ids = new Set(buildsOf(w).map((b) => b.id))
  let id = base
  for (let i = 2; ids.has(id); i++) id = `${base}-${i}`
  return id
}

/** 在哪编（以前 provider = local 就是「总是本地」） */
export const whereOf = (b: BuildCfg) => b.where ?? (b.provider === 'local' ? 'local' : 'auto')
/** 流水线建好了没有 */
export const pipelineReady = (b: BuildCfg) => (b.provider === 'yunxiao' ? !!b.yunxiao?.pipelineId : b.provider === 'github' ? !!b.github?.at : b.provider === 'gitlab' ? !!b.gitlab?.at : b.provider === 'jenkins' ? !!b.jenkins?.at : false)
/** 各模板编译时大概要多少（拿一条代表命令去 policy 的表里查） */
const KIND_CMD: Record<BuildKind, string> = { node: 'npm run build', go: 'go build', spring: 'mvn package', android: './gradlew assembleRelease', custom: 'make' }
export const kindCmd = (k: BuildKind) => KIND_CMD[k]

const sh = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`
const subdirOf = (b: BuildCfg) => (b.subdir ?? '').replace(/^\/+|\/+$/g, '') || '.'
export const fileOf = (b: BuildCfg) => b.file || (b.kind === 'android' ? '*.apk' : b.kind === 'spring' ? 'bundle.tgz' : '*.tgz')
/** 包名 / 产物名用的代号：项目名，组件不是 main 时后面带组件编号（opero-android） */
export const codeOf = (w: Workspace, b?: { id: string }) => `${w.name.replace(/[^\w.-]+/g, '-').toLowerCase().slice(0, 40) || 'app'}${b && b.id !== 'main' ? `-${b.id}` : ''}`

// ---------- 编译脚本（三种地方跑同一个） ----------
function versionCmd(b: BuildCfg) {
  const re = b.versionRe || guessVersionRe(b.versionFile)
  if (!b.versionFile || !re) return 'V=$(git rev-parse --short HEAD)'
  b = { ...b, versionRe: re }
  return `V=$(node -e ${sh(`const s=require("fs").readFileSync(${JSON.stringify(b.versionFile)},"utf8");const m=new RegExp(${JSON.stringify(b.versionRe)}).exec(s);process.stdout.write(m?m[1]:"")`)} 2>/dev/null || python3 -c ${sh(`import re;m=re.search(${JSON.stringify(b.versionRe)},open(${JSON.stringify(b.versionFile)}).read());print(m.group(1) if m else "",end="")`)})
[ -n "$V" ] || V=$(git rev-parse --short HEAD)`
}
const NODE = `NODE_V=22.22.0
if ! node -v 2>/dev/null | grep -q '^v22\\.'; then
  if [ ! -x "$CACHE/node22/bin/node" ]; then mkdir -p "$CACHE/node22"; curl -fsSL --retry 3 "https://cdn.npmmirror.com/binaries/node/v$NODE_V/node-v$NODE_V-linux-x64.tar.xz" | tar xJ -C "$CACHE/node22" --strip-components=1; fi
  export PATH="$CACHE/node22/bin:$PATH"
fi
export npm_config_registry=https://registry.npmmirror.com npm_config_cache="$CACHE/npm"`
/** Gradle 发行包：自己下（阿里 → 腾讯 → 华为 → 官方轮流试，每次 unzip -t 校验），再让 wrapper 用本地文件。
 *  以前只把地址换成腾讯镜像交给 gradlew 自己下，云效上会下到坏的 zip（错误页 / 半截）直接失败。仓库里的地址不改（开源用户在国外照样能编）。
 *  在 gradle/wrapper/gradle-wrapper.properties 所在的目录（项目根）里跑；要 unzip（构建机上没有就装一个）。 */
const GRADLE_DIST = `command -v unzip >/dev/null || yum install -y -q unzip >/dev/null 2>&1 || apt-get install -y -qq unzip >/dev/null 2>&1 || true
WP=gradle/wrapper/gradle-wrapper.properties
if [ -f "$WP" ]; then
  GURL=$(sed -n 's/^distributionUrl=//p' "$WP" | tr -d '\\r' | sed 's#\\\\:#:#g')
  GZIP=$(basename "$GURL")
  GVER=$(echo "$GZIP" | sed -n 's/^gradle-\\(.*\\)-\\(bin\\|all\\)\\.zip$/\\1/p')
  GDIR="$CACHE/gradle-dist"; mkdir -p "$GDIR"
  # wrapper 缓存里以前下坏的：校验不过的 zip、半截的 .part、锁
  for z in "$HOME"/.gradle/wrapper/dists/gradle-*/*/*.zip; do [ -f "$z" ] && ! unzip -tq "$z" >/dev/null 2>&1 && rm -rf "$(dirname "$z")"; done
  rm -f "$HOME"/.gradle/wrapper/dists/gradle-*/*/*.part "$HOME"/.gradle/wrapper/dists/gradle-*/*/*.lck 2>/dev/null || true
  if [ -n "$GVER" ] && ! unzip -tq "$GDIR/$GZIP" >/dev/null 2>&1; then
    for u in "https://mirrors.aliyun.com/gradle/distributions/v$GVER/$GZIP" "https://mirrors.cloud.tencent.com/gradle/$GZIP" "https://mirrors.huaweicloud.com/gradle/$GZIP" "$GURL"; do
      echo "下载 Gradle $GVER：$u"
      rm -f "$GDIR/$GZIP.tmp"
      if curl -fsSL --retry 3 --connect-timeout 20 -o "$GDIR/$GZIP.tmp" "$u" && unzip -tq "$GDIR/$GZIP.tmp" >/dev/null 2>&1; then mv "$GDIR/$GZIP.tmp" "$GDIR/$GZIP"; break; fi
      echo "这个地址下的不对，换下一个"
    done
    rm -f "$GDIR/$GZIP.tmp"
  fi
  if [ -n "$GVER" ] && unzip -tq "$GDIR/$GZIP" >/dev/null 2>&1; then sed -i "s#^distributionUrl=.*#distributionUrl=file://$GDIR/$GZIP#" "$WP"; echo "Gradle $GVER 用本地的 $GDIR/$GZIP"
  else echo "Gradle 发行包几个地址都没下好，交给 gradlew 自己下"; fi
fi`
const SUMS = 'cd "$ROOT/out" && sha256sum * > /tmp/SHA256SUMS && mv /tmp/SHA256SUMS SHA256SUMS && git -C "$ROOT" rev-parse HEAD > COMMIT && echo "$V" > VERSION && cat SHA256SUMS COMMIT VERSION'

function deployScript(b: BuildCfg, body: string) {
  const svc = (b.service ?? '').replace(/[^A-Za-z0-9@._-]/g, '')
  return `cat > "$PKG/deploy.sh" <<'OPERODEPLOY'
#!/bin/bash
# Opero「发布」生成的部署脚本：Agent 以 root 跑；OPERO_DIR（= KL_DIR）= 部署目录
set -euo pipefail
IN="$1"; B="\${OPERO_DIR:-\${KL_DIR:?}}"
mkdir -p "$B"
${body}
${svc ? `systemctl restart ${svc} && sleep 2 && systemctl is-active ${svc}` : 'echo "（没设要重启的服务）"'}
echo "部署完成"
OPERODEPLOY`
}

/** 版本号正则没填：按版本号文件猜（package.json / gradle versionName / pom.xml / VERSION） */
function guessVersionRe(file?: string): string {
  if (!file) return ''
  if (/package\.json$/.test(file)) return '"version"\\s*:\\s*"([^"]+)"'
  if (/\.gradle(\.kts)?$/.test(file)) return 'versionName\\s*=?\\s*"([^"]+)"'
  if (/pom\.xml$/.test(file)) return '<modelVersion>[^<]*</modelVersion>(?:\\s*<parent>[\\s\\S]*?</parent>)?[\\s\\S]*?<version>([^<]+)</version>'
  if (/(^|\/)VERSION$/.test(file)) return '^\\s*(\\S+)'
  return ''
}
export function script(b: BuildCfg, code: string): string {
  const head = `set -euo pipefail
ROOT=$(pwd); CACHE=\${OPERO_CACHE:-/root/.cache/opero}; mkdir -p "$CACHE" "$ROOT/out"`
  const dir = subdirOf(b)
  if (b.kind === 'node') return `${head}
${NODE}
cd ${sh(dir)}
npm ci --no-audit --no-fund
npm run build --if-present
cd "$ROOT"
${versionCmd(b)}
PKG=$(mktemp -d)
tar --exclude=node_modules --exclude=.git -C ${sh(dir)} -cf - . | tar -C "$PKG" -xf -
${deployScript(b, `tar --exclude=deploy.sh -C "$IN" -cf - . | tar -C "$B" -xf -
cd "$B" && [ -f package.json ] && npm ci --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com || true`)}
tar czf "out/${code}-$V.tgz" -C "$PKG" .
${SUMS}`
  if (b.kind === 'go') return `${head}
export LANG=C LC_ALL=C
if [ ! -x "$CACHE/go/bin/go" ]; then mkdir -p "$CACHE/go"; curl -fsSL --retry 3 https://mirrors.aliyun.com/golang/go1.24.7.linux-amd64.tar.gz | tar xz -C "$CACHE/go" --strip-components=1; fi
export PATH="$CACHE/go/bin:$PATH" GOPROXY=https://goproxy.cn,direct GOMODCACHE="$CACHE/gomod" GOCACHE="$CACHE/gobuild"
${versionCmd(b)}
PKG=$(mktemp -d)
(cd ${sh(dir)} && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "$PKG/${code}" .)
${deployScript(b, `install -m 755 "$IN/${code}" "$B/${code}.new" && mv "$B/${code}.new" "$B/${code}"`)}
tar czf "out/${code}-$V.tgz" -C "$PKG" .
${SUMS}`
  if (b.kind === 'android') return `${head}
command -v unzip >/dev/null || yum install -y -q unzip >/dev/null 2>&1 || apt-get install -y -qq unzip >/dev/null 2>&1 || true
if ! java -version 2>&1 | grep -q 'version "21'; then
  if [ ! -x "$CACHE/jdk21/bin/java" ]; then mkdir -p "$CACHE/jdk21"; curl -fsSL --retry 3 https://repo.huaweicloud.com/openjdk/21/openjdk-21_linux-x64_bin.tar.gz | tar xz -C "$CACHE/jdk21" --strip-components=1; fi
  export JAVA_HOME="$CACHE/jdk21" PATH="$CACHE/jdk21/bin:$PATH"
fi
export ANDROID_HOME="$CACHE/android-sdk" ANDROID_SDK_ROOT="$CACHE/android-sdk"
SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [ ! -x "$SDKM" ]; then
  mkdir -p "$ANDROID_HOME/cmdline-tools" /tmp/op-clt && curl -fsSL --retry 3 -o /tmp/op-clt/clt.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  (cd /tmp/op-clt && unzip -q -o clt.zip) && rm -rf "$ANDROID_HOME/cmdline-tools/latest" && mv /tmp/op-clt/cmdline-tools "$ANDROID_HOME/cmdline-tools/latest"
fi
yes | "$SDKM" --licenses >/dev/null 2>&1 || true
cd ${sh(dir)}
echo "sdk.dir=$ANDROID_HOME" > local.properties
${GRADLE_DIST}
cat > /tmp/op-mirror.gradle <<'OPINIT'
def ali = ['https://maven.aliyun.com/repository/google', 'https://maven.aliyun.com/repository/central', 'https://maven.aliyun.com/repository/gradle-plugin']
settingsEvaluated { s ->
  [s.pluginManagement.repositories, s.dependencyResolutionManagement.repositories].each { repos ->
    def mirrors = ali.collect { u -> repos.maven { url u } }
    mirrors.each { repos.remove(it) }
    mirrors.reverse().each { repos.addFirst(it) }
  }
}
OPINIT
chmod +x gradlew
./gradlew --no-daemon --console=plain --max-workers=2 -I /tmp/op-mirror.gradle -Dorg.gradle.jvmargs="-Xmx2560m -XX:MaxMetaspaceSize=768m -Dfile.encoding=UTF-8" -Pkotlin.compiler.execution.strategy=in-process assembleRelease
cd "$ROOT"
${versionCmd(b)}
APK=$(ls ${sh(dir)}/app/build/outputs/apk/release/*-unsigned.apk ${sh(dir)}/*/build/outputs/apk/release/*-unsigned.apk 2>/dev/null | head -1)
[ -n "$APK" ] || { echo "没找到没签名的 release 包（流水线里不放签名证书，签名在部署时做）"; exit 1; }
cp "$APK" "out/${code}-$V-unsigned.apk"
${SUMS}`
  if (b.kind === 'spring') {
    const s = b.spring ?? {}
    const jdk = s.jdk === 21 ? 21 : 17
    const jdkUrl = jdk === 21 ? 'https://repo.huaweicloud.com/openjdk/21/openjdk-21_linux-x64_bin.tar.gz' : 'https://repo.huaweicloud.com/openjdk/17.0.2/openjdk-17.0.2_linux-x64_bin.tar.gz'
    const gradle = s.tool === 'gradle'
    const jar = s.jar || (gradle ? 'build/libs/*.jar' : 'target/*.jar')
    const dirs = (s.dirs ?? []).map((d) => `[ -e ${sh(`${dir}/${d}`)} ] && cp -r ${sh(`${dir}/${d}`)} "$BUNDLE/" || { echo "没找到要带上的目录 ${d}"; exit 1; }`).join('\n')
    const build = gradle
      ? `cd ${sh(dir)}
${GRADLE_DIST}
chmod +x gradlew
./gradlew --no-daemon --console=plain --max-workers=2 -Dorg.gradle.jvmargs="-Xmx2g -Dfile.encoding=UTF-8" ${s.task || 'clean build -x test'}
cd "$ROOT"`
      : `cd ${sh(dir)}
mkdir -p "$CACHE/m2"
cat > /tmp/op-settings.xml <<'OPM2'
<settings><mirrors><mirror><id>aliyun</id><mirrorOf>*</mirrorOf><url>https://maven.aliyun.com/repository/public</url></mirror></mirrors></settings>
OPM2
MVN=mvn
if [ -f ./mvnw ]; then chmod +x mvnw; if timeout 180 ./mvnw -B -v >/dev/null 2>&1; then MVN=./mvnw; fi; fi
if ! command -v "$MVN" >/dev/null 2>&1 && [ "$MVN" = mvn ]; then
  if [ ! -x "$CACHE/maven/bin/mvn" ]; then mkdir -p "$CACHE/maven"; curl -fsSL --retry 3 https://maven.aliyun.com/repository/public/org/apache/maven/apache-maven/3.9.9/apache-maven-3.9.9-bin.tar.gz | tar xz -C "$CACHE/maven" --strip-components=1; fi
  MVN="$CACHE/maven/bin/mvn"
fi
$MVN -B -s /tmp/op-settings.xml -Dmaven.repo.local="$CACHE/m2" ${s.task || 'clean package -DskipTests'} \${OPERO_PROFILE:+-P"$OPERO_PROFILE"}
cd "$ROOT"`
    return `${head}
if ! java -version 2>&1 | grep -q 'version "${jdk}'; then
  if [ ! -x "$CACHE/jdk${jdk}/bin/java" ]; then mkdir -p "$CACHE/jdk${jdk}"; curl -fsSL --retry 3 ${jdkUrl} | tar xz -C "$CACHE/jdk${jdk}" --strip-components=1; fi
  export JAVA_HOME="$CACHE/jdk${jdk}" PATH="$CACHE/jdk${jdk}/bin:$PATH"
fi
${build}
${versionCmd(b)}
JAR=$(ls ${dir === '.' ? '' : `${sh(dir)}/`}${jar} 2>/dev/null | grep -v -- '-plain\\.jar$' | head -1)
[ -n "$JAR" ] || { echo "没找到编好的 jar（${jar}）"; exit 1; }
BUNDLE=$(mktemp -d)
cp "$JAR" "$BUNDLE/app.jar"
${dirs}
tar czf out/bundle.tgz -C "$BUNDLE" .
${SUMS}`
  }
  return `${head}
${b.cmd || 'echo "没写编译命令"; exit 1'}
cd "$ROOT"
${versionCmd(b)}
[ -f out/SHA256SUMS ] || (${SUMS})`
}

// ---------- 云效（阿里云 DevOps）：Codeup 仓库 + Flow 流水线 ----------
const YX = 'https://openapi-rdc.aliyuncs.com'
export function codeupRepo(url: string): { org: string; path: string; full: string; https: string } | null {
  const s = url.trim().replace(/^git@codeup\.aliyun\.com:/, 'https://codeup.aliyun.com/').replace(/^[a-z]+:\/\/[^@/]*@/, 'https://')
  const m = /^https?:\/\/codeup\.aliyun\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_./-]+?)(?:\.git)?\/?$/.exec(s)
  return m ? { org: m[1], path: m[2], full: `${m[1]}/${m[2]}`, https: `https://codeup.aliyun.com/${m[1]}/${m[2]}.git` } : null
}
async function yx(token: string, method: string, p: string, body?: unknown): Promise<any> {
  const r = await fetch(YX + p, { method, headers: { 'x-yunxiao-token': token, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
  const text = await r.text()
  let d: any = null
  try { d = text ? JSON.parse(text) : null } catch { d = text }
  if (r.status >= 300) throw new Error(`云效：${String(d?.errorMessage ?? d?.message ?? d?.errorCode ?? text ?? r.status).replaceAll(token, '***').slice(0, 300)}`)
  return d
}
/** 云效组织里已有的流水线（接入时读出来：有现成的就照着它配） */
export async function yunxiaoPipelines(credId: string, org: string): Promise<{ id: string; name: string }[]> {
  const t = getSecret(credId)
  if (!t) throw new Error('这个 Codeup 凭证没有值')
  const d = await yx(t, 'GET', `/oapi/v1/flow/organizations/${org}/pipelines?perPage=100&page=1`)
  const list = Array.isArray(d) ? d : d?.data ?? d?.pipelines ?? []
  return list.slice(0, 100).map((p: any) => ({ id: String(p.id ?? p.pipelineId ?? ''), name: String(p.name ?? p.pipelineName ?? '') }))
}
/** 一条云效流水线的定义（YAML）：里面的步骤就是它怎么编、怎么发的 */
export async function yunxiaoPipeline(credId: string, org: string, id: string): Promise<string> {
  const t = getSecret(credId)
  if (!t) throw new Error('这个 Codeup 凭证没有值')
  const d = await yx(t, 'GET', `/oapi/v1/flow/organizations/${org}/pipelines/${encodeURIComponent(id)}`)
  const yaml = d?.pipelineConfig?.flow ?? d?.content ?? d?.pipelineConfig?.content
  return String(yaml ?? JSON.stringify(d, null, 1)).replaceAll(t, '***').slice(0, 20_000)
}
const yxToken = (b: BuildCfg) => { const t = b.yunxiao?.cred ? getSecret(b.yunxiao.cred) : undefined; if (!t) throw new Error('云效的令牌没配（凭证的值填云效个人访问令牌）'); return t }

function yunxiaoYaml(w: Workspace, b: BuildComp, repo: { path: string; https: string }, connection: string): string {
  const body = script(b, codeOf(w, b)).split('\n').map((l) => `                ${l}`).join('\n')
  return `# Opero「发布」生成（项目 ${w.name}，编译组件 ${b.name}，模板 ${b.kind}）。在 Opero 里改编译设置后重新生成会覆盖这里
sources:
  repo:
    type: codeup
    name: ${JSON.stringify(repo.path.slice(0, 30))}
    endpoint: ${repo.https}
    branch: ${JSON.stringify(w.branch || 'master')}
    certificate:
      type: serviceConnection
      serviceConnection: ${connection}
defaultWorkspace: repo
stages:
  build:
    name: 编译
    jobs:
      build:
        name: ${JSON.stringify(`编译 ${w.name} · ${b.name}`.slice(0, 60))}
        runsOn:
          group: public/cn-beijing
          container: ${b.yunxiao?.image || 'build-steps-public-registry.cn-beijing.cr.aliyuncs.com/build-steps/alinux3:latest'}
        steps:
          build:
            name: 编译
            step: Command
            with:
              run: |
${body}
          upload:
            name: 上传产物
            step: ArtifactUpload
            with:
              uploadType: flowPublic
              artifact: opero-${codeOf(w, b)}
              filePath:
                - out/
`
}

/** 一键生成 / 更新流水线；返回更新后的编译设置 */
/** 一键生成 / 更新这个组件的流水线；返回更新后的组件 */
export async function generate(w: Workspace, b: BuildComp): Promise<BuildComp> {
  // GitLab：一个仓库一个 .opero/gitlab-ci.yml，里面放这个项目所有走 GitLab 的组件（每个一个任务，按 OPERO_COMPONENT 只跑对应的）
  if (b.provider === 'gitlab') {
    const comps = [...buildsOf(w).filter((x) => x.provider === 'gitlab' && x.id !== b.id), b]
    await pipes.gitlabGenerate(w, comps.map((x) => ({ id: x.id, name: x.name, script: script(x, codeOf(w, x)) })))
    return { ...b, gitlab: { at: Date.now() } }
  }
  if (b.provider === 'jenkins') {
    if (!b.jenkins?.cred) throw new Error('选一个 Jenkins 凭证（凭证 → 其它 → Jenkins）')
    const job = pipes.jenkinsJob(w, b, b.jenkins.job)
    await pipes.jenkinsGenerate(w, b.jenkins.cred, job, script(b, codeOf(w, b)))
    return { ...b, jenkins: { ...b.jenkins, job, at: Date.now() } }
  }
  if (b.provider === 'yunxiao') {
    const repo = codeupRepo(w.repo)
    if (!repo) throw new Error('云效流水线要用 Codeup 的仓库')
    const token = yxToken(b)
    const org = b.yunxiao?.org || repo.org
    const conns = await yx(token, 'GET', `/oapi/v1/flow/organizations/${org}/serviceConnections?serviceConnectionType=codeup&sericeConnectionType=codeup`)
    const conn = (Array.isArray(conns) ? conns : []).find((x: any) => String(x.type ?? '').toLowerCase() === 'codeup' && x.uuid)
    if (!conn) throw new Error('云效组织里没有 Codeup 服务连接：在云效「流水线 → 服务连接」里建一个')
    const yaml = yunxiaoYaml(w, b, repo, conn.uuid)
    const name = `Opero · ${w.name} · ${b.name}`.slice(0, 60)
    const id = b.yunxiao?.pipelineId
      ? (await yx(token, 'PUT', `/oapi/v1/flow/organizations/${org}/pipelines/${b.yunxiao.pipelineId}`, { name, content: yaml }), b.yunxiao.pipelineId)
      : String(await yx(token, 'POST', `/oapi/v1/flow/organizations/${org}/pipelines`, { name, content: yaml }))
    return { ...b, yunxiao: { ...b.yunxiao!, org, pipelineId: id, at: Date.now() } }
  }
  if (b.provider === 'github') {
    const file = workflowOf(b)
    const yml = githubYaml(w, b)
    // 用项目的令牌提交进仓库（要有 workflow 权限）：在 Opero 这台临时拉一份，改完推回去
    const tmp = path.join(cfg.data, 'tmp', `gh-${crypto.randomBytes(4).toString('hex')}`)
    fs.mkdirSync(tmp, { recursive: true })
    try {
      const c = await git(['clone', '-q', '--depth', '1', ...(w.branch ? ['--branch', w.branch] : []), w.repo, tmp], { cred: w.credential, timeoutMs: 300_000 })
      if (c.code !== 0) throw new Error(`拉仓库失败：${c.out.slice(-200)}`)
      fs.mkdirSync(path.join(tmp, '.github', 'workflows'), { recursive: true })
      fs.writeFileSync(path.join(tmp, '.github', 'workflows', file), yml)
      await git(['-C', tmp, 'add', '-A'])
      const st = await git(['-C', tmp, 'status', '--porcelain'])
      if (st.out.trim()) {
        await git(['-C', tmp, '-c', 'user.name=Opero', '-c', 'user.email=opero@opero.local', 'commit', '-q', '-m', `ci: Opero build workflow for ${b.id} (${b.kind})`])
        const p = await git(['-C', tmp, 'push', '-q', 'origin', 'HEAD'], { cred: w.credential, timeoutMs: 120_000 })
        if (p.code !== 0) throw new Error(`推送工作流失败（令牌要有 workflow 权限）：${p.out.slice(-200)}`)
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
    return { ...b, github: { workflow: file, at: Date.now() } }
  }
  return b
}

/** GitHub 工作流文件名：每个组件一个 */
const workflowOf = (b: BuildComp) => b.github?.workflow || `opero-build-${b.id}.yml`

function githubYaml(w: Workspace, b: BuildComp): string {
  const body = script({ ...b }, codeOf(w, b)).replace(/\/root\/\.cache\/opero/g, '$HOME/.cache/opero').split('\n').map((l) => `          ${l}`).join('\n')
  return `# Opero「发布」生成（项目 ${w.name}，编译组件 ${b.name}，模板 ${b.kind}）。在 Opero 里改编译设置后重新生成会覆盖这里
name: ${JSON.stringify(`Opero build · ${b.name}`)}
on:
  workflow_dispatch:
    inputs:
      release:
        description: Opero release id
        required: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/cache@v4
        with:
          path: ~/.cache/opero
          key: opero-\${{ runner.os }}-${b.kind}-${b.id}
      - name: Build
        shell: bash
        env:
          OPERO_CACHE: /home/runner/.cache/opero
        run: |
${body}
      - uses: actions/upload-artifact@v4
        with:
          name: opero-${codeOf(w, b)}
          path: out/
`
}

// ---------- 跑一次：返回下载到 Opero 这台的产物目录（里面是 out/ 的内容） ----------
export interface BuildRun { url?: string; dir: string; version: string; commit: string; files: string[] }
type Step = (msg: string) => void

export async function run(w: Workspace, b: BuildComp, rid: string, sha: string, step: Step): Promise<BuildRun> {
  const dir = path.join(cfg.data, 'releases', rid)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const mode = await decideWhere(w, b, step)
  if (mode === 'local') await runLocal(w, { ...b, local: { server: b.local?.server || w.server || 'local' } }, rid, sha, dir, step)
  else if (b.provider === 'yunxiao') await runYunxiao(w, b, dir, step)
  else if (b.provider === 'github') await runGithub(w, b, rid, dir, step)
  else if (b.provider === 'gitlab') await pipes.gitlabRun(w, b.id, rid, dir, step, unpack)
  else if (b.provider === 'jenkins') await pipes.jenkinsRun(w, b.jenkins!.cred, pipes.jenkinsJob(w, b, b.jenkins?.job), sha, rid, dir, step, unpack)
  else throw new Error('没有可用的流水线')
  return verify(dir)
}

/** 这次在哪编：auto 时看本地那台现在的资源（编译要多少见 policy.ts buildNeed），够就本地，不够走流水线；都不行就说清楚 */
export async function decideWhere(w: Workspace, b: BuildCfg, step: Step): Promise<'local' | 'pipeline'> {
  const where = whereOf(b)
  const ready = pipelineReady(b)
  if (where === 'pipeline') {
    if (!ready) throw new Error('设成了「总是流水线」，但流水线还没建好：在项目的编译设置里点「生成流水线」')
    return 'pipeline'
  }
  if (where === 'local') return 'local'
  const host = b.local?.server || w.server || 'local'
  const r = await hostRes(hosts.isLocal(host) ? hosts.LOCAL : host)
  const why = r ? resourceBlock(kindCmd(b.kind), r) : undefined
  if (!why) { step(`本地资源够，在 ${hosts.isLocal(host) ? 'Opero 这台' : get<Server>('servers', host)?.name ?? host} 上编`); return 'local' }
  if (ready) { step(`本地不编（${why.replace(/。.*$/, '')}），走流水线`); return 'pipeline' }
  throw new Error(`${why.replace(/。.*$/, '')}；流水线也还没建好（${b.pipelineError ?? '在编译设置里点「生成流水线」'}）`)
}

/** 核对产物：SHA256SUMS 里列的每个文件都要对得上；读 VERSION / COMMIT */
export function verify(dir: string): BuildRun {
  const files = fs.readdirSync(dir).filter((f) => !['SHA256SUMS', 'VERSION', 'COMMIT'].includes(f))
  const sums = path.join(dir, 'SHA256SUMS')
  if (fs.existsSync(sums)) {
    for (const line of fs.readFileSync(sums, 'utf8').split('\n').filter(Boolean)) {
      const [h, name] = line.trim().split(/\s+\*?/)
      if (!name || name === 'SHA256SUMS') continue
      const f = path.join(dir, path.basename(name))
      if (!fs.existsSync(f)) continue
      const got = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
      if (got !== h) throw new Error(`产物校验不对：${name}（SHA256SUMS 和下载下来的不一样）`)
    }
  }
  const read = (n: string) => { try { return fs.readFileSync(path.join(dir, n), 'utf8').trim() } catch { return '' } }
  if (!files.length) throw new Error('流水线成功了，但产物是空的：编译脚本要把东西放进 out/')
  return { dir, version: read('VERSION'), commit: read('COMMIT'), files }
}

async function download(url: string, headers: Record<string, string>, to: string) {
  const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(30 * 60_000) })
  if (!r.ok) throw new Error(`下载产物失败 HTTP ${r.status}`)
  const len = Number(r.headers.get('content-length') ?? 0)
  if (len > 600 * 1024 * 1024) throw new Error('产物超过 600 MB')
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length > 600 * 1024 * 1024) throw new Error('产物超过 600 MB')
  fs.writeFileSync(to, buf, { mode: 0o600 })
}

/** 解开产物压缩包到 dir（只取文件名，目录结构拍平，跟 out/ 一样） */
function unpack(file: string, dir: string) {
  const buf = fs.readFileSync(file)
  if (buf[0] === 0x50 && buf[1] === 0x4b) { unzip(buf, dir); return }
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const tar = zlib.gunzipSync(buf)
    for (let o = 0; o + 512 <= tar.length;) {
      const name = tar.subarray(o, o + 100).toString('utf8').replace(/\0.*$/s, '')
      if (!name) break
      const size = parseInt(tar.subarray(o + 124, o + 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8)
      const type = String.fromCharCode(tar[o + 156])
      if ((type === '0' || type === '\0') && !name.endsWith('/')) fs.writeFileSync(path.join(dir, path.basename(name)), tar.subarray(o + 512, o + 512 + size))
      o += 512 + Math.ceil(size / 512) * 512
    }
    return
  }
  fs.renameSync(file, path.join(dir, path.basename(file)))
}
/** 最小的 zip 解压（GitHub 的产物是 zip）：只认存储（0）和 deflate（8） */
function unzip(buf: Buffer, dir: string) {
  let e = buf.length - 22
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--
  if (e < 0) throw new Error('产物 zip 坏了')
  let p = buf.readUInt32LE(e + 16)
  const n = buf.readUInt16LE(e + 10)
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28)
    const xlen = buf.readUInt16LE(p + 30)
    const clen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8')
    p += 46 + nlen + xlen + clen
    if (name.endsWith('/')) continue
    const ln = buf.readUInt16LE(local + 26)
    const lx = buf.readUInt16LE(local + 28)
    const data = buf.subarray(local + 30 + ln + lx, local + 30 + ln + lx + csize)
    fs.writeFileSync(path.join(dir, path.basename(name)), method === 8 ? zlib.inflateRawSync(data) : data)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function runYunxiao(w: Workspace, b: BuildComp, dir: string, step: Step) {
  const token = yxToken(b)
  const org = b.yunxiao?.org || codeupRepo(w.repo)?.org
  const id = b.yunxiao?.pipelineId
  if (!org || !id) throw new Error('还没生成云效流水线：在项目「编译」里点「生成流水线」')
  const repo = codeupRepo(w.repo)
  const params = repo && w.branch ? { params: JSON.stringify({ runningBranchs: { [repo.https]: w.branch } }) } : {}
  const run = Number(await yx(token, 'POST', `/oapi/v1/flow/organizations/${org}/pipelines/${id}/runs`, params))
  step(`云效第 ${run} 次运行`)
  const t0 = Date.now()
  for (;;) {
    await sleep(15_000)
    const d = await yx(token, 'GET', `/oapi/v1/flow/organizations/${org}/pipelines/${id}/runs/${run}`)
    const st = String(d?.status ?? '')
    if (/SUCCESS/i.test(st)) {
      const jobs = (d?.stages ?? []).flatMap((s: any) => s.stageInfo?.jobs ?? [])
      let url = ''
      for (const j of jobs) {
        let res: any = {}
        try { res = JSON.parse(j.result ?? '{}').data ?? {} } catch { /* 没有 */ }
        for (const [k, v] of Object.entries(res)) if (/dynamic_output\./.test(k)) { try { const x = JSON.parse(String(v)); if (x.ARTIFACT_URL) url = x.ARTIFACT_URL } catch { /* 不是 */ } }
      }
      if (!url) throw new Error('云效成功了但没找到产物（流水线里要有「上传产物」步骤）')
      const f = path.join(dir, 'artifact.bin')
      await download(url, {}, f)
      unpack(f, dir)
      fs.rmSync(f, { force: true })
      step(`云效第 ${run} 次运行成功`)
      return
    }
    if (/FAIL|CANCEL/i.test(st)) {
      const jobs = (d?.stages ?? []).flatMap((s: any) => s.stageInfo?.jobs ?? [])
      const bad = jobs.find((j: any) => /FAIL/i.test(String(j.status)))
      let log = ''
      if (bad?.id) { try { const l = await yx(token, 'GET', `/oapi/v1/flow/organizations/${org}/pipelines/${id}/runs/${run}/job/${bad.id}/log`); log = failLog(String(l?.content ?? '')) } catch { /* 拿不到日志 */ } }
      throw new Error(`云效编译失败（第 ${run} 次）：https://flow.aliyun.com/pipelines/${id}/builds/${run}?orgId=${org}${log ? `\n${log.replaceAll(token, '***')}` : ''}`)
    }
    if (Date.now() - t0 > 90 * 60_000) throw new Error('云效编译超过 90 分钟，不等了')
  }
}

async function runGithub(w: Workspace, b: BuildComp, rid: string, dir: string, step: Step) {
  const m = w.repo.replace(/\.git$/, '').match(/github\.com[/:]([^/]+\/[^/]+)$/)
  if (!m) throw new Error('GitHub Actions 要用 GitHub 的仓库')
  const repo = m[1]
  const token = w.credential ? getSecret(w.credential) : undefined
  if (!token) throw new Error('项目没配 GitHub 令牌')
  const file = workflowOf(b)
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Opero' }
  const gh = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(`https://api.github.com${p}`, { method, headers: { ...h, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
    if (!r.ok) throw new Error(`GitHub：${r.status} ${(await r.text()).slice(0, 200)}`)
    return r.status === 204 ? null : r.json()
  }
  const since = new Date(Date.now() - 5000).toISOString()
  await gh('POST', `/repos/${repo}/actions/workflows/${file}/dispatches`, { ref: w.branch || 'main', inputs: { release: rid } })
  let runId = 0
  for (let i = 0; i < 20 && !runId; i++) {
    await sleep(5000)
    const r = await gh('GET', `/repos/${repo}/actions/workflows/${file}/runs?event=workflow_dispatch&created=>=${since}&per_page=5`)
    runId = r?.workflow_runs?.[0]?.id ?? 0
  }
  if (!runId) throw new Error('GitHub 没开始跑：看看工作流文件在不在默认分支上（先点「生成流水线」）')
  step(`GitHub Actions 运行 ${runId}`)
  const t0 = Date.now()
  for (;;) {
    await sleep(15_000)
    const r = await gh('GET', `/repos/${repo}/actions/runs/${runId}`)
    if (r.status === 'completed') {
      if (r.conclusion !== 'success') throw new Error(`GitHub Actions 编译失败：${r.html_url}`)
      const arts = await gh('GET', `/repos/${repo}/actions/runs/${runId}/artifacts`)
      const a = (arts?.artifacts ?? [])[0]
      if (!a) throw new Error('GitHub 成功了但没有产物（工作流里要 upload-artifact out/）')
      const f = path.join(dir, 'artifact.zip')
      await download(a.archive_download_url, h, f)
      unpack(f, dir)
      fs.rmSync(f, { force: true })
      // 产物里可能还套着 tgz 的 out：已经拍平了
      step(`GitHub Actions 成功`)
      return
    }
    if (Date.now() - t0 > 90 * 60_000) throw new Error('GitHub Actions 编译超过 90 分钟，不等了')
  }
}

/** 在自己的某台服务器上编：拉一份干净的代码跑同一个脚本，out/ 打包经 Opero 拿回来 */
async function runLocal(w: Workspace, b: BuildComp, rid: string, sha: string, dir: string, step: Step) {
  const sv = b.local?.server ? get<Server>('servers', b.local.server) : undefined
  if (!sv) throw new Error('选一台编译的服务器')
  const h = sv.id === 'local' ? hosts.LOCAL : sv.id
  const base = path.posix.join(hosts.workRoot(h), 'builds', codeOf(w, b), rid)
  const src = path.posix.join(base, 'src')
  const mk = await execOnEnv(sv, `rm -rf ${q(base)} && mkdir -p ${q(src)}`, {}, 60_000)
  if (mk.code !== 0) throw new Error(`编译那台建目录失败：${mk.out.slice(-200)}`)
  for (const args of [['init', '-q', src], ['-C', src, 'remote', 'add', 'origin', w.repo]]) await git(args, { host: h, timeoutMs: 60_000 })
  const f = await git(['-C', src, 'fetch', '-q', '--depth', '1', 'origin', sha], { cred: w.credential, host: h, timeoutMs: 600_000 })
  const co = f.code === 0 ? await git(['-C', src, 'checkout', '-q', 'FETCH_HEAD'], { host: h, timeoutMs: 120_000 }) : f
  if (co.code !== 0) throw new Error(`拉代码失败：${co.out.slice(-300)}`)
  step(`在 ${sv.name} 上编`)
  const r = await execOnEnv(sv, script(b, codeOf(w, b)), { OPERO_RELEASE: rid }, 60 * 60_000, src)
  fs.writeFileSync(path.join(dir, 'BUILD.log'), r.out.slice(-200_000))
  if (r.code !== 0) throw new Error(`编译失败（退出码 ${r.code}）：\n${failLog(r.out) || r.out.slice(-600)}`)
  const tgz = path.posix.join(base, 'out.tgz')
  const pk = await execOnEnv(sv, `tar czf ${q(tgz)} -C ${q(path.posix.join(src, 'out'))} .`, {}, 10 * 60_000)
  if (pk.code !== 0) throw new Error(`打包产物失败：${pk.out.slice(-200)}`)
  const local = path.join(dir, 'out.tgz')
  if (sv.id === 'local') fs.copyFileSync(tgz, local)
  else {
    const key = crypto.randomBytes(16).toString('hex')
    expectBlob(key, sv.id, local)
    const t = await agents.blobTask(sv.id, { t: 'push', key, path: tgz }).finally(() => pendingBlobs.delete(key))
    if (t.code !== 0) throw new Error(`从编译那台拿产物失败：${t.out.slice(-200)}`)
  }
  unpack(local, dir)
  fs.rmSync(local, { force: true })
  await execOnEnv(sv, `rm -rf ${q(base)}`, {}, 60_000).catch(() => {})
}

// 编译那台传回来的产物：key → 哪台能传、放哪（api.ts 的 /api/agent/blob/:key 用 releases.blobAllowed 查，这里登记）
export const pendingBlobs = new Map<string, { from: string; to: string; file: string; exp: number }>()
export function expectBlob(key: string, from: string, file: string) { pendingBlobs.set(key, { from, to: '', file, exp: Date.now() + 2 * 3600_000 }) }

const PIPE: Record<string, string> = { yunxiao: '云效', github: 'GitHub Actions', gitlab: 'GitLab CI', jenkins: 'Jenkins' }
/** 给人看的「在哪编」：自动（本地 / 云效）、总是本地、总是云效… */
export const providerName = (b?: BuildCfg) => {
  if (!b) return '不编译'
  const pipe = PIPE[b.provider]
  const where = whereOf(b)
  return where === 'local' || !pipe ? '本地编' : where === 'pipeline' ? `${pipe}流水线` : `自动（本地资源够就本地，不够走${pipe}）`
}

// ---------- 接入项目时自动配好：认出项目类型，按仓库平台建流水线（在哪编默认「自动」） ----------
async function lsDir(w: Workspace, rel = ''): Promise<string[]> {
  const dir = rel ? path.posix.join(w.dir, rel) : w.dir
  try {
    if (hosts.isLocal(w.server)) return fs.readdirSync(dir)
    const r = await agents.exec(w.server!, `ls -1A ${q(dir)} 2>/dev/null`, { timeoutMs: 15_000 })
    return r.out.split('\n').map((x) => x.trim()).filter(Boolean)
  } catch { return [] }
}
/** 按仓库里的文件猜：项目类型、版本号文件 */
export async function detectKind(w: Workspace): Promise<Pick<BuildCfg, 'kind' | 'versionFile' | 'spring' | 'cmd'>> {
  const top = await lsDir(w)
  const has = (n: string) => top.includes(n)
  const gb = (l: string[]) => l.find((n) => /^build\.gradle(\.kts)?$/.test(n))
  if (has('go.mod')) return { kind: 'go', ...(has('VERSION') ? { versionFile: 'VERSION' } : {}) }
  if (has('pom.xml')) return { kind: 'spring', spring: { tool: 'maven', jdk: 17 }, versionFile: 'pom.xml' }
  if (gb(top) || top.some((n) => /^settings\.gradle(\.kts)?$/.test(n))) {
    const app = has('app') ? await lsDir(w, 'app') : []
    if (gb(app)) return { kind: 'android', versionFile: `app/${gb(app)}` }
    return { kind: 'spring', spring: { tool: 'gradle', jdk: 17 }, versionFile: gb(top) }
  }
  if (has('package.json')) return { kind: 'node', versionFile: 'package.json' }
  return { kind: 'custom', cmd: has('deploy') ? 'bash deploy/build.sh' : 'mkdir -p out && echo "写好编译命令，把要发的东西放进 out/"' }
}
/** 第一次：认出类型、选打包工具（Codeup → 云效，GitHub → Actions，别的先只能本地）、建流水线，成为项目的第一个编译组件。失败不挡，记下原因 */
const KIND_NAME: Record<BuildKind, string> = { node: 'Node', go: 'Go', android: '安卓', spring: 'Java', custom: '主程序' }
export async function autoConfig(w: Workspace, codeupCred?: string): Promise<BuildComp> {
  const k = await detectKind(w)
  const provider: BuildCfg['provider'] = codeupRepo(w.repo) && codeupCred ? 'yunxiao' : /github\.com/i.test(w.repo) && w.credential ? 'github' : /gitlab/i.test(w.repo) && w.credential ? 'gitlab' : 'local'
  let b: BuildComp = { id: 'main', name: KIND_NAME[k.kind], ...k, provider, where: 'auto', ...(provider === 'yunxiao' ? { yunxiao: { cred: codeupCred! } } : {}) }
  if (provider !== 'local') {
    try { b = { ...(await generate(w, b)), pipelineError: undefined } } catch (e) { b = { ...b, pipelineError: (e as Error).message.slice(0, 300) } }
  }
  return b
}
