// 员工头像：哪里显示头像哪里能换（EditableAvatar），点了弹 AvatarPicker——
// 默认头像（public/avatars，写实 40 张 + 五套画风 + 机器人，女生 / 男生）· 上传图片（先过图片编辑器裁剪，这是所有图片的默认）· 用字或表情 + 底色。
// 选的默认头像和上传的一样存成 data URL（Employee.avatarImg），网页、原生 App 都直接能显示。
// 起名字的候选也在这里（randomName）：按界面语言挑中文 / 英文名，分女生 / 男生。
import { useEffect, useState } from 'react'
import { Camera, Shuffle } from 'lucide-react'
import type { Employee } from '../types'
import { setLook, toast, useStore } from '../store'
import { lang } from '../i18n'
import NAMES from '../data/names.json'
import { Avatar } from './Avatar'
import { fileToDataUrl, pickImages } from './ImageEditor'
import { Segmented, Sheet } from './ui'

/** 默认头像分几套画风：「写实」是通义万相生成的照片（rl-，JPG），其它是 DiceBear 的（PNG）。生成参数见 docs/设计.md「默认头像和名字」、许可见 public/avatars/README.md。g：f 女生、m 男生、x 机器人 */
const SET = (set: string, prefix: string, f: number, m: number, x = 0) => [
  ...Array.from({ length: f }, (_, i) => ({ id: `${prefix}f${String(i + 1).padStart(2, '0')}`, g: 'f' as const, set })),
  ...Array.from({ length: m }, (_, i) => ({ id: `${prefix}m${String(i + 1).padStart(2, '0')}`, g: 'm' as const, set })),
  ...Array.from({ length: x }, (_, i) => ({ id: `${prefix}${String(i + 1).padStart(2, '0')}`, g: 'x' as const, set })),
]
export const AVATAR_SETS = ['写实', '卡通', '扁平', 'Q 版', '简约', '插画', '机器人']
export const PRESETS: { id: string; g: 'f' | 'm' | 'x'; set: string }[] = [
  ...SET('写实', 'rl-', 20, 20),
  ...SET('卡通', 'av-', 14, 14),
  ...SET('扁平', 'mi-', 10, 10),
  ...SET('Q 版', 'th-', 8, 8),
  ...SET('简约', 'pe-', 8, 8),
  ...SET('插画', '', 18, 18),
  ...SET('机器人', 'bt-', 0, 0, 12),
]
const isPhoto = (id: string) => id.startsWith('rl-')
export const presetUrl = (id: string) => `${import.meta.env.BASE_URL}avatars/${id}.${isPhoto(id) ? 'jpg' : 'png'}`
/** 默认头像读成 data URL（存进员工资料） */
export async function presetData(id: string): Promise<string> {
  const b = await (await fetch(presetUrl(id))).blob()
  return fileToDataUrl(new File([b], `${id}.${isPhoto(id) ? 'jpg' : 'png'}`, { type: isPhoto(id) ? 'image/jpeg' : 'image/png' }))
}
const genderOf = (g?: string): 'f' | 'm' | undefined => (g === '女' || g === 'f' ? 'f' : g === '男' || g === 'm' ? 'm' : undefined)

/** 随机起一个名字：按界面语言（中文 / 英文）、性别（不给就随便），避开已经有人用的 */
export function randomName(gender?: string, taken: string[] = []): string {
  const set = lang().startsWith('zh') ? NAMES.zh : NAMES.en
  const g = genderOf(gender) ?? (Math.random() < 0.5 ? 'f' : 'm')
  const pool = set[g].filter((n) => !taken.includes(n))
  const list = pool.length ? pool : set[g]
  return list[Math.floor(Math.random() * list.length)]
}
/** 随机挑一张默认头像（按性别；不给性别就从人里挑，不挑机器人）。新员工默认用写实的；set 给了就从那套里挑 */
export function randomPreset(gender?: string, set = '写实'): string {
  const g = genderOf(gender)
  const list = PRESETS.filter((p) => (g ? p.g === g : p.g !== 'x') && (!set || p.set === set))
  return list[Math.floor(Math.random() * list.length)].id
}

const EMOJIS = ['🤖', '🛠️', '📮', '🚀', '🐞', '📊', '🧑‍💻', '🦉', '⚙️', '🌙']
const COLORS = ['#10B981', '#EC4899', '#0EA5E9', '#F97316', '#6366F1', '#475569', '#8B5CF6', '#5B4FE9', '#EF4444', '#14B8A6']

/** 能点的头像：右下角一个小相机，点了换头像。用在员工资料、项目页员工行、聊天信息这些地方 */
export function EditableAvatar({ id, size = 48 }: { id: string; size?: number }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="av-edit" style={{ width: size, height: size }} title="换头像" onClick={(e) => { e.stopPropagation(); setOpen(true) }}>
        <Avatar id={id} size={size} />
        <span className="av-edit-badge" style={{ width: Math.max(18, size * 0.36), height: Math.max(18, size * 0.36) }}><Camera size={Math.max(11, Math.round(size * 0.2))} strokeWidth={2.2} /></span>
      </button>
      {open && <AvatarPicker empId={id} onClose={() => setOpen(false)} />}
    </>
  )
}

/** 换头像的面板：默认头像（全部 / 女生 / 男生）、上传图片（裁剪）、用字或表情和底色 */
export function AvatarPicker({ empId, onClose }: { empId: string; onClose: () => void }) {
  const e = useStore((s) => s.employees.find((x) => x.id === empId)) as Employee | undefined
  const [tab, setTab] = useState<'all' | 'f' | 'm' | 'x'>(() => genderOf(e?.gender) ?? 'all')
  const [busy, setBusy] = useState('')
  const [text, setText] = useState(e?.avatarImg ? '' : e?.avatar ?? '')
  useEffect(() => { if (e && !e.avatarImg) setText(e.avatar) }, [e?.avatar, e?.avatarImg]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!e) return null
  const pick = async (id: string) => {
    setBusy(id)
    try { setLook(e.id, { avatarImg: await presetData(id) }); toast('头像已换') } catch { toast('读不到这张图，刷新页面再试') }
    setBusy('')
  }
  const upload = async () => {
    const [f] = await pickImages({ aspect: 1, round: true, maxSize: 256, title: `${e.name} 的头像`, allowOriginal: false })
    if (f) { setLook(e.id, { avatarImg: await fileToDataUrl(f) }); toast('头像已换') }
  }
  const saveText = () => {
    const t = Array.from(text.trim()).slice(0, 2).join('')
    if (!t || (t === e.avatar && !e.avatarImg)) return
    setLook(e.id, { avatar: t, avatarImg: undefined }); toast('头像已换')
  }
  // 按画风分组显示；选了女生 / 男生 / 机器人就只看那一种
  const groups = AVATAR_SETS.map((set) => ({ set, list: PRESETS.filter((p) => p.set === set && (tab === 'all' || p.g === tab)) })).filter((x) => x.list.length)
  return (
    <Sheet title={`${e.name} 的头像`} onClose={onClose} size="lg">
      <div className="av-pick">
        <div className="av-pick-top">
          <Avatar id={e.id} size={72} />
          <div className="av-pick-acts">
            <button className="btn primary" onClick={upload}><Camera size={15} /> 上传图片</button>
            <button className="btn default" onClick={() => pick(tab === 'x' ? ((r) => r[Math.floor(Math.random() * r.length)].id)(PRESETS.filter((p) => p.g === 'x')) : randomPreset(tab === 'all' ? e.gender : tab))}><Shuffle size={15} /> 随机换一个</button>
            {e.avatarImg && <button className="btn ghost" onClick={() => { setLook(e.id, { avatarImg: undefined }); toast('改回用字') }}>不用图片</button>}
          </div>
        </div>
        <div className="av-pick-head"><b>{`选一个 · ${PRESETS.length} 个`}</b><Segmented value={tab} onChange={setTab} options={[{ value: 'all', label: '全部' }, { value: 'f', label: '女生' }, { value: 'm', label: '男生' }, { value: 'x', label: '机器人' }]} /></div>
        {groups.map((gr) => (
          <div key={gr.set} className="av-group">
            {groups.length > 1 && <span className="av-group-k">{gr.set}</span>}
            <div className="av-grid">
              {gr.list.map((p) => (
                <button key={p.id} type="button" className={'av-cell' + (busy === p.id ? ' busy' : '')} disabled={!!busy} onClick={() => pick(p.id)}>
                  <img src={presetUrl(p.id)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="av-pick-head"><b>或者用字、表情</b></div>
        <div className="chips">
          <input className="avatar-text" value={text} placeholder="字" onChange={(x) => setText(x.target.value)} onBlur={saveText}
            onKeyDown={(x) => { if (x.key === 'Enter' && !x.nativeEvent.isComposing) (x.target as HTMLInputElement).blur() }} />
          {EMOJIS.map((x) => <button key={x} className={'chip emoji' + (!e.avatarImg && e.avatar === x ? ' on' : '')} onClick={() => { setLook(e.id, { avatar: x, avatarImg: undefined }); setText(x) }}>{x}</button>)}
        </div>
        <div className="swatches">
          {COLORS.map((c) => <button key={c} className={'swatch' + (c === e.color ? ' on' : '')} style={{ background: c }} onClick={() => setLook(e.id, { color: c })} aria-label={c} />)}
        </div>
        <p className="field-hint">图片都会先裁剪成正方形。写实头像是 AI 生成的，不是真人；其它默认头像来自 DiceBear（作者和许可见「关于 Opero → 用到的素材」）。</p>
      </div>
    </Sheet>
  )
}
