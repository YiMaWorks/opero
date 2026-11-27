// 聊天里的图片 / 文件：下载、复制图片、系统分享（手机上可以直接发微信等）、全屏看图。
// 下载走 ?dl=1（后台一律回附件），在浏览器、桌面版、App 外壳里都是存到本机。
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Download, Forward, Share2, X } from 'lucide-react'
import type { Message } from '../types'
import { toast } from '../store'

type F = NonNullable<Message['file']>

export function fileHref(f: F, dl = false): string {
  if (!f.url) return ''
  if (f.url.startsWith('data:') || f.url.startsWith('blob:')) return f.url
  const u = new URL(f.url, document.baseURI) // 和 <img src> 一样按页面的 <base> 算（装在子路径下也对）
  if (dl) u.searchParams.set('dl', '1')
  return u.toString()
}

export function downloadFile(f: F) {
  if (!f.url) { toast('这个文件还没传好'); return }
  const a = document.createElement('a')
  a.href = fileHref(f, true)
  a.download = f.name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function blobOf(f: F): Promise<Blob> {
  const r = await fetch(fileHref(f), { credentials: 'same-origin' })
  if (!r.ok) throw new Error(r.status === 404 ? '文件已经没了' : `取文件失败（${r.status}）`)
  return r.blob()
}

/** 这个浏览器能不能把文件交给系统分享（手机、Mac Safari、Windows 上的 Chrome / Edge 一般都能） */
export const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
/** 能不能把图片放进剪贴板（电脑上复制了直接粘到微信 / 飞书） */
export const canCopyImage = typeof window !== 'undefined' && 'ClipboardItem' in window && !!navigator.clipboard?.write

export async function shareFile(f: F) {
  try {
    const b = await blobOf(f)
    const file = new File([b], f.name, { type: b.type || 'application/octet-stream' })
    if (!navigator.canShare?.({ files: [file] })) { toast('这个浏览器不支持分享文件，先下载吧'); return }
    await navigator.share({ files: [file], title: f.name })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return // 自己取消了
    toast((e as Error).message || '分享没成功')
  }
}

export async function copyImage(f: F) {
  try {
    let b = await blobOf(f)
    // 剪贴板一般只收 PNG：别的格式先画成 PNG
    if (b.type !== 'image/png') {
      const bmp = await createImageBitmap(b)
      const cv = document.createElement('canvas')
      cv.width = bmp.width; cv.height = bmp.height
      cv.getContext('2d')!.drawImage(bmp, 0, 0)
      b = await new Promise<Blob>((ok, no) => cv.toBlob((x) => (x ? ok(x) : no(new Error('转换图片失败'))), 'image/png'))
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])
    toast('图片已复制，可以直接粘贴')
  } catch (e) {
    toast((e as Error).message || '复制没成功，先下载吧')
  }
}

/** 全屏看图：下载 / 复制 / 分享 / 转发；左右键、左右滑看这个会话里的别的图片，Esc 或点空白关 */
export function ImageViewer({ list, start, onClose, onForward }: { list: Message[]; start: string; onClose: () => void; onForward: (m: Message) => void }) {
  const [i, setI] = useState(() => Math.max(0, list.findIndex((m) => m.id === start)))
  const m = list[i]
  const f = m?.file
  const go = (d: number) => setI((x) => Math.min(list.length - 1, Math.max(0, x + d)))
  const touch = useRef<number | null>(null)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [list.length])
  if (!m || !f) return null
  return (
    <div className="iv" role="dialog" aria-label={f.name} onClick={onClose}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX }}
      onTouchEnd={(e) => { const x0 = touch.current; touch.current = null; if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1) }}>
      <div className="iv-top" onClick={(e) => e.stopPropagation()}>
        <span className="iv-name" data-no-i18n=""><b>{f.name}</b><small>{f.size}{list.length > 1 ? ` · ${i + 1} / ${list.length}` : ''}</small></span>
        <button type="button" className="iv-x" aria-label="关闭" onClick={onClose}><X size={22} /></button>
      </div>
      <div className="iv-stage">
        {i > 0 && <button type="button" className="iv-nav l" aria-label="上一张" onClick={(e) => { e.stopPropagation(); go(-1) }}><ChevronLeft size={26} /></button>}
        <img key={m.id} src={fileHref(f)} alt={f.name} onClick={(e) => e.stopPropagation()} />
        {i < list.length - 1 && <button type="button" className="iv-nav r" aria-label="下一张" onClick={(e) => { e.stopPropagation(); go(1) }}><ChevronRight size={26} /></button>}
      </div>
      <div className="iv-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => downloadFile(f)}><Download size={20} /><span>下载</span></button>
        {canCopyImage && <button type="button" onClick={() => copyImage(f)}><Copy size={20} /><span>复制</span></button>}
        {canShare && <button type="button" onClick={() => shareFile(f)}><Share2 size={20} /><span>分享</span></button>}
        <button type="button" onClick={() => onForward(m)}><Forward size={20} /><span>转给员工</span></button>
      </div>
    </div>
  )
}
