// 编辑资料：「我」顶部的个性化（头像、名字、签名、封面、显示什么）
import { setMe, toast, useStore } from '../store'
import { Avatar } from '../components/Avatar'
import { COVERS, changeAvatar, changeCover, coverOf } from '../components/MeHeader'
import { Field, PageHeader, Section, Toggle } from '../components/ui'
import { headNav, type PageProps } from './nav'

export function MeEditPage({ nav }: PageProps) {
  const me = useStore((s) => s.me)
  const cur = coverOf(me.cover)
  return (
    <div className="page">
      <PageHeader title="编辑资料" sub="这套 Opero 只有你一个人用，顶部按你的喜好来" {...headNav(nav)} />
      <div className="page-body form">
        <div className="me-edit-av">
          <Avatar id="me" size={72} />
          <div className="row-actions wrap">
            <button className="btn default sm" onClick={() => changeAvatar()}>换头像（先裁剪）</button>
            {me.avatarImg && <button className="btn ghost sm" onClick={() => { setMe({ avatarImg: undefined }); toast('改回文字头像') }}>不用图片</button>}
          </div>
        </div>
        <Field label="名字"><input value={me.name} maxLength={16} onChange={(e) => setMe({ name: e.target.value || '主人' })} /></Field>
        <div className="field">
          <span className="field-label">封面</span>
          <div className="cover-grid">
            {COVERS.map((c) => (
              <button key={c.key} className={'cover-tile' + ((me.cover ?? 'aurora') === c.key ? ' on' : '')} style={{ background: c.css }} onClick={() => setMe({ cover: c.key })}>
                <span className={c.dark ? 'ink' : ''}>{c.name}</span>
              </button>
            ))}
            <button className={'cover-tile up' + (me.cover?.startsWith('data:') ? ' on' : '')} style={me.cover?.startsWith('data:') ? { background: cur.css } : undefined} onClick={changeCover}>
              <span>{me.cover?.startsWith('data:') ? '换一张' : '＋ 用自己的图'}</span>
            </button>
          </div>
          <span className="field-hint">自己的图会先打开裁剪（3:1 横幅），可以旋转、调亮度。</span>
        </div>
        <Section title="顶部显示">
          <div className="lrow">
            <span className="row-main"><span className="row-title">问候语和日期</span><span className="row-sub">早上好，{me.name}</span></span>
            <Toggle on={me.showGreeting !== false} onChange={(v) => setMe({ showGreeting: v })} />
          </div>
          <div className="lrow">
            <span className="row-main"><span className="row-title">今日概况</span><span className="row-sub">几个员工在干活、几件等你决定、本月花了多少</span></span>
            <Toggle on={me.showToday !== false} onChange={(v) => setMe({ showToday: v })} />
          </div>
        </Section>
      </div>
    </div>
  )
}
