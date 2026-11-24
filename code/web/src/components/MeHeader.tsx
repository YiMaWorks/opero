// 「我」的顶部：一人一套，顶部按你的喜好来——封面（预设渐变或自己的图，先裁剪）、头像（裁成圆）、名字、签名、问候语、今日概况。
import type { ReactNode } from 'react'
import { badgeOf, setMe, toast, useStore } from '../store'
import { CUR, LIVE } from '../mode'
import { Avatar } from './Avatar'
import { editImage, fileToDataUrl, pickImages } from './ImageEditor'

export const COVERS: { key: string; name: string; css: string; dark?: boolean }[] = [
  { key: 'aurora', name: '极光', css: 'linear-gradient(135deg, #6D5BF7, #4FB3F6 60%, #2EE6B0)' },
  { key: 'dusk', name: '晚霞', css: 'linear-gradient(135deg, #F2A93B, #D9541E 55%, #7A2E5B)' },
  { key: 'ocean', name: '深海', css: 'linear-gradient(135deg, #0F1B3D, #2F6BFF 60%, #5CCBFF)' },
  { key: 'forest', name: '森林', css: 'linear-gradient(135deg, #0E3B2E, #2F7D4F 55%, #A7D3A6)' },
  { key: 'night', name: '夜航', css: 'linear-gradient(135deg, #0D0E10, #1E2A10 60%, #8DB51F)' },
  { key: 'paper', name: '纸', css: 'linear-gradient(135deg, #F3EEE3, #E6D9C2)', dark: true },
]
export const coverOf = (c?: string) => {
  if (c?.startsWith('data:')) return { css: `center / cover no-repeat url("${c}")`, dark: false }
  const p = COVERS.find((x) => x.key === c) ?? COVERS[0]
  return { css: p.css, dark: !!p.dark }
}

export async function changeCover() {
  const [f] = await pickImages({ aspect: 3, maxSize: 1600, title: '换封面', okText: '用这张', allowOriginal: false })
  if (f) { setMe({ cover: await fileToDataUrl(f) }); toast('封面换好了') }
}
export async function changeAvatar(file?: File) {
  const f = file ? await editImage(file, { aspect: 1, round: true, maxSize: 256, title: '换头像', allowOriginal: false })
    : (await pickImages({ aspect: 1, round: true, maxSize: 256, title: '换头像', allowOriginal: false }))[0]
  if (f) { setMe({ avatarImg: await fileToDataUrl(f) }); toast('头像换好了') }
}

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'
}

export function MeHeader({ onEdit, extra }: { onEdit: () => void; extra?: ReactNode }) {
  const me = useStore((s) => s.me)
  const sessions = useStore((s) => s.sessions)
  const employees = useStore((s) => s.employees)
  const usage = useStore((s) => s.usage)
  const budget = useStore((s) => s.settings.budget)
  const cover = coverOf(me.cover)
  const working = sessions.filter((x) => x.working).length
  const deciding = sessions.filter((x) => badgeOf(x, employees.find((e) => e.id === x.employee)) === 'red').length
  const cost = usage.reduce((a, u) => a + u.cost, 0)
  const d = new Date()
  return (
    <div className="me-head">
      <div className={'me-cover' + (cover.dark ? ' ink' : '')} style={{ background: cover.css }}>
        {me.showGreeting !== false && (
          <div className="me-greet">
            <b>{greeting()}，{me.name}</b>
            <span>{d.getMonth() + 1} 月 {d.getDate()} 日 · 星期{'日一二三四五六'[d.getDay()]}</span>
          </div>
        )}
        <button className="me-cover-btn" onClick={changeCover} title="换封面">换封面</button>
      </div>
      <div className="me-id">
        <button className="me-avatar" onClick={() => changeAvatar()} title="换头像"><Avatar id="me" size={76} /></button>
        <div className="me-name">
          <b>{me.name}</b>
          {me.signature && <span>{me.signature}</span>}
        </div>
        <button className="btn default sm" onClick={onEdit}>编辑资料</button>
      </div>
      {me.showToday !== false && (
        <div className="me-today">
          <div className={working ? 'run' : ''}><b>{working}</b><span>个员工在干活</span></div>
          <div className={deciding ? 'hot' : ''}><b>{deciding}</b><span>件等你决定</span></div>
          <div><b>{CUR}{LIVE ? cost.toFixed(2) : Math.round(cost)}</b><span>本月花了{budget ? ` / ${budget}` : ''}</span></div>
        </div>
      )}
      {extra}
    </div>
  )
}
