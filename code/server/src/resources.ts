// 读一台机器现在的资源（可用内存、工作目录所在盘剩余、核数、1 分钟负载）：编译前看够不够、自动选本地还是流水线时用
import { execFile } from 'node:child_process'
import * as hosts from './hosts.ts'
import * as agents from './agents.ts'
import { parseRes, RES_CMD, type Res } from './policy.ts'

export async function hostRes(host: string): Promise<Res | undefined> {
  try {
    const dir = hosts.workRoot(host)
    const out = hosts.isLocal(host)
      ? await new Promise<string>((resolve) => execFile('sh', ['-c', RES_CMD(dir)], { timeout: 10_000 }, (_e, o) => resolve(String(o ?? ''))))
      : (await agents.exec(host, RES_CMD(dir), { timeoutMs: 10_000 })).out
    return parseRes(out)
  } catch { return undefined }
}
