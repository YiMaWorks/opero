// 签名：apk 用 apksigner，aab 用 jarsigner；证书在保险箱里（凭证组「签名证书」，值是 JSON），密码只经环境变量，用完就删
import crypto from 'node:crypto'
import { get } from './db.ts'
import { audit } from './chat.ts'
import { execOnEnv } from './ssh.ts'
import { q } from './git.ts'
import { getSecret } from './vault.ts'
import type { Credential, Server } from './types.ts'

// ---------- 签名：apk 用 apksigner，aab 用 jarsigner；证书在保险箱里（凭证「签名证书」），密码只经环境变量 ----------
/** 签名证书凭证的值：JSON { keystore: base64, storePass, alias, keyPass } */
export interface SignSecret { keystore: string; storePass: string; alias: string; keyPass?: string }
export async function signDir(sv: Server, out: string, credId: string): Promise<{ ok: boolean; msg: string }> {
  const c = get<Credential>('credentials', credId)
  const raw = getSecret(credId)
  if (!c || !raw) return { ok: false, msg: '签名证书不在了' }
  let s: SignSecret
  try { s = JSON.parse(raw) } catch { return { ok: false, msg: '签名证书的内容不对（要在「权限和凭证」里重新上传）' } }
  const ks = `/tmp/opero-ks-${crypto.randomBytes(6).toString('hex')}`
  const env = { OPERO_KS_B64: s.keystore, KS_PASS: s.storePass, KEY_PASS: s.keyPass || s.storePass, KS_ALIAS: s.alias }
  const script = `set -e
umask 077
printf %s "$OPERO_KS_B64" | base64 -d > ${ks}
trap 'rm -f ${ks}' EXIT
n=0
for f in $(find ${q(out)} -type f \\( -name '*.apk' -o -name '*.aab' \\)); do
  case "$f" in
    *.apk) command -v apksigner >/dev/null || { echo "这台没有 apksigner（装 Android build-tools，并把它放进 PATH）"; exit 3; }
           apksigner sign --ks ${ks} --ks-pass env:KS_PASS --ks-key-alias "$KS_ALIAS" --key-pass env:KEY_PASS "$f"
           apksigner verify "$f" >/dev/null ;;
    *.aab) command -v jarsigner >/dev/null || { echo "这台没有 jarsigner（装 JDK）"; exit 3; }
           jarsigner -keystore ${ks} -storepass:env KS_PASS -keypass:env KEY_PASS -digestalg SHA-256 "$f" "$KS_ALIAS" >/dev/null ;;
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
  if (!/\.(apk|aab)$/i.test(file)) return { ok: false, msg: '只能签 .apk / .aab' }
  const out = file.replace(/\.(apk|aab)$/i, '-signed.$1')
  const ks = `/tmp/opero-ks-${crypto.randomBytes(6).toString('hex')}`
  const env = { OPERO_KS_B64: s.keystore, KS_PASS: s.storePass, KEY_PASS: s.keyPass || s.storePass, KS_ALIAS: s.alias }
  const script = `set -e
umask 077
printf %s "$OPERO_KS_B64" | base64 -d > ${ks}
trap 'rm -f ${ks}' EXIT
case ${q(file)} in
  *.apk|*.APK) command -v apksigner >/dev/null || { echo "这台没有 apksigner（装 Android build-tools）"; exit 3; }
         apksigner sign --ks ${ks} --ks-pass env:KS_PASS --ks-key-alias "$KS_ALIAS" --key-pass env:KEY_PASS --out ${q(out)} ${q(file)}
         apksigner verify --print-certs ${q(out)} | head -n 3 ;;
  *) command -v jarsigner >/dev/null || { echo "这台没有 jarsigner（装 JDK）"; exit 3; }
     cp ${q(file)} ${q(out)}
     jarsigner -keystore ${ks} -storepass:env KS_PASS -keypass:env KEY_PASS -digestalg SHA-256 ${q(out)} "$KS_ALIAS" >/dev/null && echo signed ;;
esac
echo "签好了：${out}"`
  const r = await execOnEnv(sv, script, env, 10 * 60_000)
  audit({ via: '员工', action: 'sign', target: `${c.name} · ${file}`, level: '写', result: r.code === 0 ? '成功' : '失败', how: '密码经环境变量，员工拿不到' })
  return { ok: r.code === 0, msg: r.out.trim().slice(-600) }
}

