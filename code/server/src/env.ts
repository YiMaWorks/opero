// 环境是标签：随便起名、要几个都行（开发、测试、生产、uat、海外生产、客户 A…）。
// 「改东西先确认」是单独的开关（Server / DataSource 的 protect）；没设过时按标签猜：像生产的就开。
export const PROD_RE = /生产|正式|線上|线上|prod|production|live/i

/** 收到的环境标签：去空格、限长，空的用默认 */
export function envOf(v: unknown, def: string): string {
  const s = String(v ?? '').trim().slice(0, 20)
  return s || def
}

/** 员工在上面改东西要不要先出确认卡片 */
export const isProtected = (x: { env: string; protect?: boolean }) => x.protect ?? PROD_RE.test(x.env)
