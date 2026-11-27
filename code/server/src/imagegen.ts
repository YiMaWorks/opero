// 生图：用主人存在保险箱里的 AI Key（员工被授权的那个）按提示词出图，图片下载到 Opero 这边，再交给员工 / 发到聊天。
// Key 只在这里用，员工拿不到值。各家的接口不一样：通义万相是异步任务（提交 → 轮询），其它是 OpenAI 风格的 /images/generations。
import { AI_BASE } from './creds.ts'

export interface ImageReq { prompt: string; negative?: string; width: number; height: number; n: number; model?: string }
export interface ImageOut { data: Buffer; ext: 'png' | 'jpg' | 'webp' }
interface Provider {
  /** 默认模型 */
  model: string
  /** 一次最多几张（超过就分几次要） */
  max: number
  run(base: string, key: string, r: ImageReq, n: number, signal: AbortSignal): Promise<ImageOut[]>
}

/** 能生图的 AI 厂商（凭证的 kind）。通义万相实测过；其它照各家官方文档接的 */
export const IMAGE_PROVIDERS: Record<string, Provider> = {
  '通义千问（阿里云百炼）': { model: 'wan2.2-t2i-plus', max: 4, run: wanx },
  OpenAI: { model: 'gpt-image-1', max: 4, run: (b, k, r, n, s) => openaiLike(b, k, { model: r.model ?? 'gpt-image-1', prompt: r.prompt, n, size: nearest(r, ['1024x1024', '1536x1024', '1024x1536']) }, s) },
  '豆包（火山方舟）': { model: 'doubao-seedream-4-0-250828', max: 1, run: (b, k, r, n, s) => openaiLike(b, k, { model: r.model ?? 'doubao-seedream-4-0-250828', prompt: r.prompt, size: `${r.width}x${r.height}`, response_format: 'url', watermark: false }, s) },
  '智谱 GLM': { model: 'cogview-4-250304', max: 1, run: (b, k, r, n, s) => openaiLike(b, k, { model: r.model ?? 'cogview-4-250304', prompt: r.prompt, size: `${r.width}x${r.height}` }, s) },
  硅基流动: { model: 'Kwai-Kolors/Kolors', max: 4, run: (b, k, r, n, s) => openaiLike(b, k, { model: r.model ?? 'Kwai-Kolors/Kolors', prompt: r.prompt, negative_prompt: r.negative, image_size: `${r.width}x${r.height}`, batch_size: n }, s) },
}

export const canDraw = (kind: string) => kind in IMAGE_PROVIDERS

/** 解析尺寸：1024x1024 / 1024*1024 / 正方形；各家都要在 512–2048 之间 */
export function parseSize(s: unknown): { width: number; height: number } | string {
  const m = String(s ?? '1024x1024').trim().match(/^(\d{3,4})\s*[x*×]\s*(\d{3,4})$/i)
  if (!m) return 'size 写成 宽x高，比如 1024x1024'
  const width = Number(m[1]), height = Number(m[2])
  if (width < 512 || height < 512 || width > 2048 || height > 2048) return '宽高都要在 512 到 2048 之间'
  return { width, height }
}

/** 只支持几种固定尺寸的（OpenAI）：挑比例最接近的 */
function nearest(r: ImageReq, list: string[]): string {
  const want = r.width / r.height
  return list.map((x) => { const [w, h] = x.split('x').map(Number); return { x, d: Math.abs(Math.log(w / h / want)) } }).sort((a, b) => a.d - b.d)[0].x
}

export async function generate(kind: string, base0: string | undefined, key: string, r: ImageReq): Promise<ImageOut[]> {
  const p = IMAGE_PROVIDERS[kind]
  if (!p) throw new Error(`「${kind}」不能生图`)
  const base = (base0?.trim() || AI_BASE[kind]?.base || '').replace(/\/+$/, '')
  const signal = AbortSignal.timeout(5 * 60_000)
  const out: ImageOut[] = []
  while (out.length < r.n) {
    const n = Math.min(p.max, r.n - out.length)
    out.push(...await retry(() => p.run(base, key, r, n, signal)))
  }
  return out.slice(0, r.n)
}

class Throttled extends Error {}
/** 限流（每秒 / 并发次数用满）：等一会再来，最多 4 次 */
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn() } catch (e) {
      if (!(e instanceof Throttled) || i >= 3) throw e instanceof Throttled ? new Error('生图接口一直在限流（同时要的太多），过一会再试') : e
      await new Promise((ok) => setTimeout(ok, 4000 * (i + 1)))
    }
  }
}

async function json(r: Response): Promise<any> {
  const t = await r.text()
  let j: any = null
  try { j = JSON.parse(t) } catch { /* 不是 JSON */ }
  const code = String(j?.code ?? j?.error?.code ?? '')
  if (r.status === 429 || /Throttling|rate_limit|RateLimit/i.test(code)) throw new Throttled(code)
  if (r.status === 401 || r.status === 403) throw new Error(`Key 不对或没开通生图（${r.status}${code ? ` ${code}` : ''}）`)
  if (!r.ok) throw new Error(`${r.status}：${String(j?.message ?? j?.error?.message ?? t).slice(0, 200)}`)
  return j
}

async function fetchImage(url: string, signal: AbortSignal): Promise<ImageOut> {
  const r = await fetch(url, { signal })
  if (!r.ok) throw new Error(`下载图片失败（${r.status}）`)
  const data = Buffer.from(await r.arrayBuffer())
  if (data.length > 30 * 1024 * 1024) throw new Error('图片太大')
  return { data, ext: sniff(data) }
}
function sniff(b: Buffer): ImageOut['ext'] {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg'
  if (b.subarray(8, 12).toString() === 'WEBP') return 'webp'
  return 'png'
}

// 通义万相：提交异步任务，3 秒问一次，好了拿图片地址（24 小时有效）下载
async function wanx(base: string, key: string, r: ImageReq, n: number, signal: AbortSignal): Promise<ImageOut[]> {
  const root = base.replace(/\/compatible-mode\/v1$/, '')
  const sub = await json(await fetch(`${root}/api/v1/services/aigc/text2image/image-synthesis`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({ model: r.model ?? 'wan2.2-t2i-plus', input: { prompt: r.prompt, ...(r.negative ? { negative_prompt: r.negative } : {}) }, parameters: { size: `${r.width}*${r.height}`, n, prompt_extend: false } }),
  }))
  const task = sub?.output?.task_id
  if (!task) throw new Error(`提交失败：${JSON.stringify(sub).slice(0, 200)}`)
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 3000))
    if (signal.aborted) throw new Error('生图超时（5 分钟）')
    const s = await json(await fetch(`${root}/api/v1/tasks/${task}`, { headers: { Authorization: `Bearer ${key}` }, signal }))
    const st = s?.output?.task_status
    if (st === 'SUCCEEDED') {
      const urls: string[] = (s.output.results ?? []).map((x: any) => x.url).filter(Boolean)
      if (!urls.length) throw new Error(`没出图：${String(s.output.results?.[0]?.message ?? '可能提示词没过内容审核').slice(0, 200)}`)
      return Promise.all(urls.map((u) => fetchImage(u, signal)))
    }
    if (st === 'FAILED' || st === 'UNKNOWN' || st === 'CANCELED') {
      const code = String(s?.output?.code ?? '')
      if (/Throttling/i.test(code)) throw new Throttled(code)
      throw new Error(`生图失败：${String(s?.output?.message ?? code ?? st).slice(0, 200)}`)
    }
  }
}

// OpenAI 风格：POST /images/generations，回 data[].b64_json 或 data[].url（硅基流动回 images[].url）
async function openaiLike(base: string, key: string, body: Record<string, unknown>, signal: AbortSignal): Promise<ImageOut[]> {
  const j = await json(await fetch(`${base}/images/generations`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))),
  }))
  const list: any[] = j?.data ?? j?.images ?? []
  if (!list.length) throw new Error(`没出图：${JSON.stringify(j).slice(0, 200)}`)
  return Promise.all(list.map(async (x) => {
    if (x.b64_json) { const data = Buffer.from(x.b64_json, 'base64'); return { data, ext: sniff(data) } }
    if (x.url) return fetchImage(x.url, signal)
    throw new Error('返回里没有图片')
  }))
}
