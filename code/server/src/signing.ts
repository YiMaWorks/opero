// 签名：apk 用 apksigner，aab 用 jarsigner；证书在保险箱里（凭证组「签名证书」，值是 JSON），密码只经环境变量，用完就删
import crypto from 'node:crypto'
import { get } from './db.ts'
import { audit } from './chat.ts'
import { execOnEnv } from './ssh.ts'
import { q } from './git.ts'
import { getSecret } from './vault.ts'
import type { Credential, Server } from './types.ts'
import path from 'node:path'
import { cfg } from './config.ts'

/** 签名工具放哪：Opero 这台在数据目录的缓存里；别的服务器（Agent 以 root 跑）放 /var/cache/opero */
export const signCache = (sv: Server) => (sv.id === 'local' ? path.join(cfg.data, 'cache', 'android-sign') : '/var/cache/opero/android-sign')
const JDK_URLS = ['https://repo.huaweicloud.com/openjdk/21/openjdk-21_linux-x64_bin.tar.gz', 'https://download.java.net/java/GA/jdk21.0.2/f2283984656d49e1b2d3f0ab4cd5b1d2/13/GPL/openjdk-21.0.2_linux-x64_bin.tar.gz']
const BT_URLS = ['https://mirrors.cloud.tencent.com/AndroidSDK/build-tools_r35_linux.zip', 'https://dl.google.com/android/repository/build-tools_r35_linux.zip']
/** 签名要的工具：这台有 apksigner / jarsigner 就用；没有就准备一份到缓存目录（JDK 21 + build-tools 里的 apksigner.jar），只下一次，
 *  国内先走镜像（华为云 JDK、腾讯 build-tools）。自己部署 Opero 的人大多没装 Android SDK，不能让人手动装（安卓员工 2026-11-28 报的）。
 *  用法：脚本里先放这一段，再 need_apksigner / need_jarsigner，之后用 $APKSIGNER / $JARSIGNER */
export function toolsPrelude(cache: string): string {
  return `T=${q(cache)}
mkdir -p "$T"
fetch() { out=$1; shift; for u in "$@"; do curl -fsSL --retry 2 --connect-timeout 15 -o "$out.part" "$u" && mv -f "$out.part" "$out" && return 0; done; rm -f "$out.part"; return 1; }
JBIN=""
if command -v jarsigner >/dev/null 2>&1; then JBIN=$(dirname "$(readlink -f "$(command -v jarsigner)")"); fi
need_jdk() {
  [ -n "$JBIN" ] && [ -x "$JBIN/java" ] && return 0
  if [ ! -x "$T/jdk/bin/jarsigner" ]; then
    echo "这台没有 JDK：准备一份到 $T（只下一次）…" >&2
    fetch "$T/jdk.tgz" ${JDK_URLS.map(q).join(' ')} || { echo "下不到 JDK（华为云镜像、java.net 都连不上）：在这台装一个 JDK 17 以上，或者在「服务器和 Agent → 网络出口」给它配个出口"; exit 3; }
    rm -rf "$T/jdk.new"; mkdir -p "$T/jdk.new"
    tar xzf "$T/jdk.tgz" -C "$T/jdk.new" --strip-components=1 || { echo "JDK 解压失败"; exit 3; }
    rm -rf "$T/jdk"; mv "$T/jdk.new" "$T/jdk"; rm -f "$T/jdk.tgz"; rm -rf "$T/jdk/jmods" "$T/jdk/lib/src.zip" # 签名用不着，省 100 来 MB
  fi
  JBIN="$T/jdk/bin"
}
need_jarsigner() { need_jdk; JARSIGNER="$JBIN/jarsigner"; }
need_apksigner() {
  if command -v apksigner >/dev/null 2>&1; then APKSIGNER=apksigner; return 0; fi
  need_jdk
  if [ ! -s "$T/apksigner.jar" ]; then
    echo "这台没有 apksigner：准备一份到 $T（只下一次）…" >&2
    fetch "$T/bt.zip" ${BT_URLS.map(q).join(' ')} || { echo "下不到 Android build-tools（腾讯镜像、Google 都连不上）：在这台装 Android build-tools，或者在「服务器和 Agent → 网络出口」给它配个出口"; exit 3; }
    python3 - "$T/bt.zip" "$T/apksigner.jar" <<'PY' 2>/dev/null || { rm -rf "$T/bt"; mkdir -p "$T/bt"; (cd "$T/bt" && "$JBIN/jar" xf "$T/bt.zip") && cp "$(find "$T/bt" -name apksigner.jar | head -1)" "$T/apksigner.jar"; rm -rf "$T/bt"; }
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
n = next(x for x in z.namelist() if x.endswith('/lib/apksigner.jar'))
open(sys.argv[2], 'wb').write(z.read(n))
PY
    rm -f "$T/bt.zip"
    [ -s "$T/apksigner.jar" ] || { echo "build-tools 里没找到 apksigner.jar"; exit 3; }
  fi
  APKSIGNER="$JBIN/java -jar $T/apksigner.jar"
}`
}

// ---------- 签名：apk 用 apksigner，aab 用 jarsigner；证书在保险箱里（凭证「签名证书」），密码只经环境变量 ----------
/** 签名证书凭证的值（JSON）。type 不写 = 安卓（以前存的都是安卓）：
 *  android { keystore: base64, storePass, alias, keyPass? }
 *  apple   { p12: base64, password, profile?: base64（.mobileprovision）, teamId?, use?: 'development' | 'distribution' }——iOS / Mac 签名，要在 Mac 上用
 *  asc     { p8: 文本, keyId, issuerId }——App Store Connect API Key：传 TestFlight / App Store（xcrun altool / fastlane）
 *  windows { pfx: base64, password, timestamp?: 时间戳服务器 }——Windows 代码签名（signtool），要在 Windows 上用 */
export interface SignSecret { type?: 'android' | 'apple' | 'asc' | 'windows'; keystore: string; storePass: string; alias: string; keyPass?: string }
export const CERT_TYPES = { android: '安卓签名', apple: '苹果证书', asc: 'App Store Connect API Key', windows: 'Windows 代码签名' } as const
/** 这张证书是哪种（看存的值；读不出来当安卓） */
export function certType(credId: string): keyof typeof CERT_TYPES {
  try { const t = JSON.parse(getSecret(credId) ?? '{}').type; return t in CERT_TYPES ? t : 'android' } catch { return 'android' }
}
const notAndroid = (s: SignSecret) => s.type && s.type !== 'android' ? `这是「${CERT_TYPES[s.type]}」，不能签安卓包：${s.type === 'windows' ? 'Windows 代码签名要在 Windows 上用 signtool' : s.type === 'asc' ? 'App Store Connect API Key 是用来上传 TestFlight / App Store 的' : '苹果证书要在 Mac 上用 Xcode / codesign'}` : ''
export async function signDir(sv: Server, out: string, credId: string): Promise<{ ok: boolean; msg: string }> {
  const c = get<Credential>('credentials', credId)
  const raw = getSecret(credId)
  if (!c || !raw) return { ok: false, msg: '签名证书不在了' }
  let s: SignSecret
  try { s = JSON.parse(raw) } catch { return { ok: false, msg: '签名证书的内容不对（要在「权限和凭证」里重新上传）' } }
  if (notAndroid(s)) return { ok: false, msg: notAndroid(s) }
  const ks = `/tmp/opero-ks-${crypto.randomBytes(6).toString('hex')}`
  const env = { OPERO_KS_B64: s.keystore, KS_PASS: s.storePass, KEY_PASS: s.keyPass || s.storePass, KS_ALIAS: s.alias }
  const script = `set -e
umask 077
printf %s "$OPERO_KS_B64" | base64 -d > ${ks}
trap 'rm -f ${ks}' EXIT
${toolsPrelude(signCache(sv))}
n=0
for f in $(find ${q(out)} -type f \\( -name '*.apk' -o -name '*.aab' \\)); do
  case "$f" in
    *.apk) need_apksigner
           $APKSIGNER sign --ks ${ks} --ks-pass env:KS_PASS --ks-key-alias "$KS_ALIAS" --key-pass env:KEY_PASS "$f"
           $APKSIGNER verify "$f" >/dev/null ;;
    *.aab) need_jarsigner
           "$JARSIGNER" -keystore ${ks} -storepass:env KS_PASS -keypass:env KEY_PASS -digestalg SHA-256 "$f" "$KS_ALIAS" >/dev/null ;;
  esac
  n=$((n+1))
done
echo "签了 $n 个"`
  const r = await execOnEnv(sv, script, env, 10 * 60_000)
  audit({ via: '发布', action: 'sign', target: `${c.name} · ${out}`, level: '写', result: r.code === 0 ? '成功' : '失败', how: '密码经环境变量' })
  return { ok: r.code === 0, msg: (r.out.trim().split('\n').pop() ?? '').slice(0, 200) || `退出码 ${r.code}` }
}

/** 员工的 sign_package：给它目录里的一个 apk / aab 签名，签好的放旁边（*-signed.*） */
export async function signFile(sv: Server, file: string, credId: string): Promise<{ ok: boolean; msg: string }> {
  const c = get<Credential>('credentials', credId)
  const raw = getSecret(credId)
  if (!c || !raw || c.group !== '签名证书') return { ok: false, msg: '没有这个签名证书' }
  let s: SignSecret
  try { s = JSON.parse(raw) } catch { return { ok: false, msg: '签名证书的内容不对（在「权限和凭证」里重新上传）' } }
  if (notAndroid(s)) return { ok: false, msg: notAndroid(s) }
  if (!/\.(apk|aab)$/i.test(file)) return { ok: false, msg: '只能签 .apk / .aab' }
  const out = file.replace(/\.(apk|aab)$/i, '-signed.$1')
  const ks = `/tmp/opero-ks-${crypto.randomBytes(6).toString('hex')}`
  const env = { OPERO_KS_B64: s.keystore, KS_PASS: s.storePass, KEY_PASS: s.keyPass || s.storePass, KS_ALIAS: s.alias }
  const script = `set -e
umask 077
printf %s "$OPERO_KS_B64" | base64 -d > ${ks}
trap 'rm -f ${ks}' EXIT
${toolsPrelude(signCache(sv))}
case ${q(file)} in
  *.apk|*.APK) need_apksigner
         $APKSIGNER sign --ks ${ks} --ks-pass env:KS_PASS --ks-key-alias "$KS_ALIAS" --key-pass env:KEY_PASS --out ${q(out)} ${q(file)}
         $APKSIGNER verify --print-certs ${q(out)} | head -n 3 ;;
  *) need_jarsigner
     cp ${q(file)} ${q(out)}
     "$JARSIGNER" -keystore ${ks} -storepass:env KS_PASS -keypass:env KEY_PASS -digestalg SHA-256 ${q(out)} "$KS_ALIAS" >/dev/null && echo signed ;;
esac
echo "签好了：${out}"`
  const r = await execOnEnv(sv, script, env, 10 * 60_000)
  audit({ via: '员工', action: 'sign', target: `${c.name} · ${file}`, level: '写', result: r.code === 0 ? '成功' : '失败', how: '密码经环境变量，员工拿不到' })
  return { ok: r.code === 0, msg: r.out.trim().slice(-600) }
}

