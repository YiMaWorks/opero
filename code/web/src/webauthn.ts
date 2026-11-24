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
