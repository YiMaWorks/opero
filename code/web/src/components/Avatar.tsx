import { useStore } from '../store'

export function Avatar({ id, size = 40, dot }: { id: string; size?: number; dot?: 'ok' | 'warn' }) {
  const e = useStore((s) => s.employees.find((x) => x.id === id))
  const me = useStore((s) => (id === 'me' ? s.me : null))
  const isMe = id === 'me'
  const text = isMe ? me?.avatar || me?.name.slice(0, 1) || '我' : e?.avatar ?? '?'
  const img = isMe ? me?.avatarImg : e?.avatarImg
  // 表情头像字号小一点，看起来才和字头像一样大
  const emoji = /\p{Extended_Pictographic}/u.test(text)
  return (
    <span className="avatar" style={{ width: size, height: size, ['--c' as string]: isMe ? '#64748B' : e?.color ?? '#5B4FE9', fontSize: size * (emoji ? 0.5 : 0.42) }}>
      {img ? <img src={img} alt="" /> : text}
      {dot && <i className={'avatar-dot ' + dot} />}
    </span>
  )
}
