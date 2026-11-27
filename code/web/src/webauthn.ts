// 通行密钥（WebAuthn）在浏览器这边：后台给的选项里 base64url 的字段转成二进制交给 navigator.credentials，结果再转回 base64url 交给后台。
const b64u = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))

export const passkeySupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials

export async function createPasskey(o: any) {
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...o,
      challenge: unb64u(o.challenge),
      user: { ...o.user, id: unb64u(o.user.id) },
      excludeCredentials: (o.excludeCredentials ?? []).map((c: any) => ({ ...c, id: unb64u(c.id) })),
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('没有完成')
  const r = cred.response as AuthenticatorAttestationResponse
  return { id: cred.id, rawId: b64u(cred.rawId), type: cred.type, response: { clientDataJSON: b64u(r.clientDataJSON), attestationObject: b64u(r.attestationObject) } }
}

export async function getPasskey(o: any) {
  const cred = (await navigator.credentials.get({
    publicKey: { ...o, challenge: unb64u(o.challenge), allowCredentials: (o.allowCredentials ?? []).map((c: any) => ({ ...c, id: unb64u(c.id) })) },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('没有完成')
  const r = cred.response as AuthenticatorAssertionResponse
  return { id: cred.id, type: cred.type, response: { clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature), userHandle: r.userHandle ? b64u(r.userHandle) : null } }
}

/** 浏览器报的错（英文、看不懂）换成能照着做的话 */
export function passkeyError(e: unknown, creating = false): string {
  const n = (e as DOMException)?.name
  if (n === 'NotAllowedError') return creating ? '没加上：取消了，或者等太久超时了' : '这台设备上没找到能用的指纹（通行密钥），或者取消了 / 超时了。之前可能是在别的设备上加的：先用密码，验证完可以在这台也加上'
  if (n === 'InvalidStateError') return '这台设备已经加过指纹了'
  if (n === 'SecurityError') return `这个地址用不了指纹：要用加通行密钥时的那个 https 地址打开（现在是 ${location.host}）`
  if (n === 'AbortError') return '取消了'
  if (n === 'NotSupportedError') return '这个浏览器不支持指纹（通行密钥），用密码'
  return (e as Error)?.message || '没成功'
}

// 这台浏览器上有没有能用的通行密钥：浏览器不告诉网页，只能自己记——在这台加过、或者在这台用成功过就记一下；在这台用失败过也记一下
const HERE = () => `opero.pk.here.${location.hostname}`
const MISS = () => `opero.pk.miss.${location.hostname}`
export const pkHere = () => !!localStorage.getItem(HERE())
export const pkMissed = () => !!localStorage.getItem(MISS())
export function markPkHere() { localStorage.setItem(HERE(), '1'); localStorage.removeItem(MISS()) }
export function markPkMissed() { if (!pkHere()) localStorage.setItem(MISS(), '1') }
