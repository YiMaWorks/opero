// 图片编辑器（照 KidLock components/ImageEditor.jsx）：选好图片先裁剪、缩放、旋转、翻转、调亮度 / 对比度 / 饱和度，再按尺寸和格式导出。
// 约定：所有上传图片的地方都先过它，让人自己切图。用法：const f = await editImage(原文件, { aspect: 1, round: true, maxSize: 256 })，取消返回 null。
// 一次选好几张就排队一张一张来；可以「用原图」。
import { useCallback, useEffect, useRef, useState } from 'react'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'

export interface EditOpts {
  /** 固定比例（1 = 正方形）；不给就可以自由选 */
  aspect?: number
  /** 圆形遮罩（头像）；导出的还是正方形 */
  round?: boolean
  /** 长边最多多少像素（默认 2048） */
  maxSize?: number
  title?: string
  okText?: string
  /** 能不能「用原图」（默认能） */
  allowOriginal?: boolean
}

// ---------- 全局队列：任何地方 await editImage(file, opts) ----------
type Job = { file: File; opts: EditOpts; resolve: (f: File | null) => void; key: number }
let queue: Job[] = []
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function editImage(file: File, opts: EditOpts = {}): Promise<File | null> {
  return new Promise((resolve) => {
    if (!/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file.type)) { resolve(file); return }
    queue = [...queue, { file, opts, resolve, key: Math.random() }]
    emit()
  })
}

/** 选图片（可多张）→ 一张张过编辑器 → 返回裁好的 */
export function pickImages(opts: EditOpts & { multiple?: boolean; capture?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    if (opts.multiple) input.multiple = true
    if (opts.capture) input.setAttribute('capture', 'environment')
    input.onchange = async () => {
      const out: File[] = []
      for (const f of Array.from(input.files ?? [])) { const r = await editImage(f, opts); if (r) out.push(r) }
      resolve(out)
    }
    input.click()
  })
}

/** 读成 data URL（原型里直接存本机 / 显示） */
export function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f) })
}
export function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ w: 0, h: 0 }); i.src = url })
}

export function ImageEditHost() {
  const [, force] = useState(0)
  useEffect(() => { const f = () => force((x) => x + 1); subs.add(f); return () => { subs.delete(f) } }, [])
  const job = queue[0]
  if (!job) return null
  const close = (r: File | null) => { job.resolve(r); queue = queue.slice(1); emit() }
  return <ImageEditor key={job.key} file={job.file} opts={job.opts} left={queue.length - 1} onCancel={() => close(null)} onDone={close} />
}

// ---------- 编辑器 ----------
const RATIOS: [string, number | 'orig'][] = [['自由', NaN], ['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['16:9', 16 / 9], ['9:16', 9 / 16], ['原图比例', 'orig']]
const SIZES = [0, 4096, 2048, 1280, 800, 512, 256, 128]
const ADJ0 = { brightness: 100, contrast: 100, saturate: 100 }
const ADJ_NAME: Record<keyof typeof ADJ0, string> = { brightness: '亮度', contrast: '对比度', saturate: '饱和度' }
const extOf = (t: string) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[t] ?? 'png'
const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const toBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((res) => c.toBlob(res, type, q))

function render(cr: Cropper, maxSize: number, adj: typeof ADJ0, fill?: string) {
  const d = cr.getData(true)
  const k = Math.min(1, (maxSize || 8192) / Math.max(1, d.width, d.height))
  const src = cr.getCroppedCanvas({ width: Math.max(1, Math.round(d.width * k)), height: Math.max(1, Math.round(d.height * k)), imageSmoothingEnabled: true, imageSmoothingQuality: 'high', fillColor: fill ?? 'transparent' })
  if (!src) return null
  if (adj.brightness === 100 && adj.contrast === 100 && adj.saturate === 100) return src
  const out = document.createElement('canvas')
  out.width = src.width; out.height = src.height
  const ctx = out.getContext('2d')!
  ctx.filter = `brightness(${adj.brightness}%) contrast(${adj.contrast}%) saturate(${adj.saturate}%)`
  ctx.drawImage(src, 0, 0)
  return out
}

function ImageEditor({ file, opts, left, onCancel, onDone }: { file: File; opts: EditOpts; left: number; onCancel: () => void; onDone: (f: File) => void }) {
  const imgRef = useRef<HTMLImageElement>(null)
  const crRef = useRef<Cropper | null>(null)
  const baseZoom = useRef(1)
  const [url] = useState(() => URL.createObjectURL(file))
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [ratio, setRatio] = useState(opts.aspect ? 'fixed' : '自由')
  const [zoom, setZoom] = useState(0)
  const [base, setBase] = useState(0)
  const [fine, setFine] = useState(0)
  const [adj, setAdj] = useState(ADJ0)
  const [maxSize, setMaxSize] = useState(opts.maxSize ?? 2048)
  const [format, setFormat] = useState('auto')
  const [quality, setQuality] = useState(0.88)
  const [info, setInfo] = useState<{ w: number; h: number; size: number } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [tab, setTab] = useState<'crop' | 'adj' | 'out'>('crop')
  const [busy, setBusy] = useState(false)
  const isGif = file.type === 'image/gif'
  const round = !!opts.round
  const outType = format === 'auto' ? (file.type === 'image/webp' ? 'image/webp' : file.type === 'image/png' || isGif ? 'image/png' : 'image/jpeg') : format
  useEffect(() => () => URL.revokeObjectURL(url), [url])

  // 预览和输出大小：拖动时不要每一帧都算
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef({ maxSize, adj, outType, quality })
  latest.current = { maxSize, adj, outType, quality }
  const schedule = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      const cr = crRef.current
      if (!cr) return
      const L = latest.current
      const cv = render(cr, L.maxSize, L.adj, L.outType === 'image/jpeg' ? '#fff' : undefined)
      if (!cv) return
      const b = await toBlob(cv, L.outType, L.quality)
      const small = document.createElement('canvas')
      const s = Math.min(1, 240 / Math.max(cv.width, cv.height))
      small.width = Math.max(1, Math.round(cv.width * s)); small.height = Math.max(1, Math.round(cv.height * s))
      small.getContext('2d')!.drawImage(cv, 0, 0, small.width, small.height)
      setPreview(small.toDataURL('image/png'))
      setInfo({ w: cv.width, h: cv.height, size: b?.size ?? 0 })
    }, 180)
  }, [])
  useEffect(() => { schedule() }, [maxSize, adj, format, quality, schedule])
  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    if (!imgRef.current) return
    const cr = new Cropper(imgRef.current, {
      viewMode: 1, dragMode: 'move', autoCropArea: opts.aspect ? 0.9 : 1, aspectRatio: opts.aspect ?? NaN, background: true, responsive: true,
      restore: false, guides: true, center: true, highlight: false, toggleDragModeOnDblclick: true, checkOrientation: true, zoomOnWheel: true, wheelZoomRatio: 0.08,
      ready() { const d = cr.getImageData(); baseZoom.current = d.width / d.naturalWidth; setNat({ w: d.naturalWidth, h: d.naturalHeight }); setZoom(0); schedule() },
      zoom(e) { const z = Math.round((e.detail.ratio / baseZoom.current - 1) * 100); if (z < -60 || z > 400) { e.preventDefault(); return } setZoom(z) },
      crop() { schedule() },
    })
    crRef.current = cr
    return () => { cr.destroy(); crRef.current = null }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps

  const cr = () => crRef.current
  const setAspect = (k: string, v: number | 'orig') => {
    setRatio(k)
    if (!cr()) return
    if (v === 'orig') { const d = cr()!.getImageData(); cr()!.setAspectRatio(d.naturalWidth / d.naturalHeight) } else cr()!.setAspectRatio(v)
  }
  const rotate = (b: number, f: number) => { setBase(b); setFine(f); cr()?.rotateTo(b + f) }
  const flip = (axis: 'x' | 'y') => { const d = cr()?.getData(); if (!d) return; if (axis === 'x') cr()!.scaleX(-(d.scaleX || 1)); else cr()!.scaleY(-(d.scaleY || 1)) }
  const zoomTo = (z: number) => { setZoom(z); cr()?.zoomTo(baseZoom.current * (1 + z / 100)) }
  const reset = () => { cr()?.reset(); setBase(0); setFine(0); setAdj(ADJ0); setZoom(0); if (opts.aspect) cr()?.setAspectRatio(opts.aspect) }
  const done = async () => {
    const c = cr()
    if (!c) return
    setBusy(true)
    try {
      const cv = render(c, maxSize, adj, outType === 'image/jpeg' ? '#fff' : undefined)
      const b = cv && await toBlob(cv, outType, quality)
      if (!b) return
      onDone(new File([b], `${(file.name || 'image').replace(/\.[^.]+$/, '')}.${extOf(outType)}`, { type: outType }))
    } finally { setBusy(false) }
  }
  const filterCss = `brightness(${adj.brightness}%) contrast(${adj.contrast}%) saturate(${adj.saturate}%)`

  return (
    <div className="modal-mask top imged-mask">
      <div className={'imged' + (round ? ' round' : '')} style={{ ['--imged-filter' as string]: filterCss }} onClick={(e) => e.stopPropagation()}>
        <header className="imged-head">
          <b>{opts.title ?? '编辑图片'}</b>
          {left > 0 && <em>还有 {left} 张</em>}
          {nat && <span className="mono">{nat.w} × {nat.h} · {fmtBytes(file.size)}</span>}
          <button className="icon-btn" onClick={onCancel} aria-label="关闭">✕</button>
        </header>
        <div className="imged-body">
          <div className="imged-stage">
            <div className="imged-canvas"><img ref={imgRef} src={url} alt="" /></div>
            <div className="imged-tools">
              <button title="向左转 90°" onClick={() => rotate((base - 90) % 360, fine)}><ToolIcon d="M8 4L4 8l4 4M4 8h9a7 7 0 1 1-6.5 9.6" /></button>
              <button title="向右转 90°" onClick={() => rotate((base + 90) % 360, fine)}><ToolIcon d="M16 4l4 4-4 4M20 8h-9a7 7 0 1 0 6.5 9.6" /></button>
              <button title="左右翻转" onClick={() => flip('x')}><ToolIcon d="M12 3v18M9 7L4 12l5 5zM15 7l5 5-5 5z" /></button>
              <button title="上下翻转" onClick={() => flip('y')}><ToolIcon d="M3 12h18M7 9l5-5 5 5zM7 15l5 5 5-5z" /></button>
              <span className="sep" />
              <span className="imged-zoom">
                <input type="range" min={-60} max={300} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} aria-label="缩放" />
                <span className="mono">{100 + zoom}%</span>
              </span>
              <span className="sep" />
              <button title="全部还原" onClick={reset}><ToolIcon d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4" /></button>
            </div>
            <p className="imged-hint">拖动图片移动 · 滚轮 / 双指缩放 · 拖框的边角改大小 · 双击切换移动图片 / 画新框</p>
          </div>
          <aside className="imged-side">
            <div className="seg">
              {([['crop', '裁剪'], ['adj', '调色'], ['out', '输出']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
            </div>
            {tab === 'crop' && (
              <div className="imged-grp">
                {opts.aspect ? <p className="sub">{round ? '头像：框是圆的，导出正方形，哪里显示都能用' : '这个地方的比例是固定的'}</p> : (
                  <>
                    <b>比例</b>
                    <div className="imged-ratios">
                      {RATIOS.map(([k, v]) => <button key={k} className={ratio === k ? 'on' : ''} onClick={() => setAspect(k, v)}>{k}</button>)}
                    </div>
                  </>
                )}
                <b>角度</b>
                <div className="imged-row">
                  <input type="range" min={-45} max={45} value={fine} onChange={(e) => rotate(base, Number(e.target.value))} />
                  <span className="mono">{base + fine}°</span>
                </div>
              </div>
            )}
            {tab === 'adj' && (
              <div className="imged-grp">
                {(Object.keys(ADJ0) as (keyof typeof ADJ0)[]).map((k) => (
                  <div key={k}>
                    <b>{ADJ_NAME[k]}</b>
                    <div className="imged-row">
                      <input type="range" min={40} max={160} value={adj[k]} onChange={(e) => setAdj((a) => ({ ...a, [k]: Number(e.target.value) }))} />
                      <span className="mono">{adj[k]}%</span>
                    </div>
                  </div>
                ))}
                <button className="btn default sm" onClick={() => setAdj(ADJ0)}>调色还原</button>
              </div>
            )}
            {tab === 'out' && (
              <div className="imged-grp">
                <b>尺寸</b>
                <select className="ctl-select" value={maxSize} onChange={(e) => setMaxSize(Number(e.target.value))}>
                  {SIZES.filter((s) => !opts.maxSize || s <= opts.maxSize * 2 || s === 0).map((s) => <option key={s} value={s}>{s ? `长边最多 ${s}` : '原尺寸'}</option>)}
                </select>
                <b>格式</b>
                <select className="ctl-select" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="auto">自动（照片 JPEG，透明 PNG）</option>
                  <option value="image/jpeg">JPEG</option>
                  <option value="image/png">PNG（保留透明）</option>
                  <option value="image/webp">WebP</option>
                </select>
                {outType !== 'image/png' && (
                  <>
                    <b>质量</b>
                    <div className="imged-row">
                      <input type="range" min={50} max={100} step={2} value={Math.round(quality * 100)} onChange={(e) => setQuality(Number(e.target.value) / 100)} />
                      <span className="mono">{Math.round(quality * 100)}</span>
                    </div>
                  </>
                )}
                {isGif && <p className="sub">动图编辑后会变成静态图；要保留动画请「用原图」</p>}
              </div>
            )}
            <div className="imged-pv">
              <b>效果</b>
              {preview
                ? (round ? <div className="imged-av">{[72, 40, 24].map((s) => <img key={s} src={preview} alt="" style={{ width: s, height: s }} />)}</div>
                  : <div className="imged-one"><img src={preview} alt="" /></div>)
                : <div className="imged-one empty" />}
            </div>
          </aside>
        </div>
        <footer className="imged-foot">
          {opts.allowOriginal !== false && <button className="btn default" onClick={() => onDone(file)} title={isGif ? '保留动画' : '不裁剪，直接用'}>用原图</button>}
          <span className="grow" />
          {info && <span className="imged-out mono">输出 {info.w} × {info.h} · {extOf(outType).toUpperCase()} · ≈ {fmtBytes(info.size)}</span>}
          <button className="btn default" onClick={onCancel}>取消</button>
          <button className="btn primary" disabled={busy} onClick={done}>{busy ? '处理中…' : opts.okText ?? '完成'}</button>
        </footer>
      </div>
    </div>
  )
}

function ToolIcon({ d }: { d: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
}
