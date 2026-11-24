// {{secret:凭证名}} → 值（只认「员工能用」的凭证）；拿到的值要从输出里抹掉（scrub）
import { all } from './db.ts'
import { getSecret } from './vault.ts'
import type { Credential, Employee } from './types.ts'

/** emp：员工用的时候只认它档案里勾了的凭证；不给 = 主人自己配的（比如发布的部署命令） */
export function fillSecrets(text: string, emp?: Employee): { text: string; secrets: string[] } | { error: string } {
  const secrets: string[] = []
  let err = ''
  const out = text.replace(/\{\{secret:([^}]+)\}\}/g, (_, name: string) => {
    const c = all<Credential>('credentials').find((x) => x.name === name.trim() || x.id === name.trim())
    if (!c) { err = `没有叫「${name}」的凭证（list_credentials 看有哪些）`; return '' }
    if (!c.aiAllowed) { err = `凭证「${c.name}」设成了只有主人本人能用`; return '' }
    if (emp && !emp.creds?.includes(c.id)) { err = `凭证「${c.name}」没给你开：请主人在员工「${emp.name}」的档案 →「能用的凭证」里勾上它`; return '' }
    const v = getSecret(c.id)
    if (!v) { err = `凭证「${c.name}」没有存值`; return '' }
    secrets.push(v)
    return v
  })
  return err ? { error: err } : { text: out, secrets }
}
