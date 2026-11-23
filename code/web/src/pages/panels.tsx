// 聊天面板里用的几页：看改动 · 查询结果 · 还没做的占位
import { useState } from 'react'
import { diffFiles } from '../data/mock'
import { revertMerge, useStore } from '../store'
import { Empty, PageHeader, Table } from '../components/ui'
import { headNav, type PageProps } from './nav'

export function DiffPage({ params, nav }: PageProps) {
  const [fi, setFi] = useState(0)
  const f = diffFiles[fi]
  return (
    <div className="page">
      <PageHeader title="看改动" sub="fix/pay-sign-42 · 2 个文件 +20 −5" {...headNav(nav)} />
      <div className="page-body">
        <div className="file-tabs pad">
          {diffFiles.map((x, i) => (
            <button key={x.name} className={'chip' + (i === fi ? ' on' : '')} onClick={() => setFi(i)}>
              {x.name} <span className="add">+{x.add}</span> <span className="del">−{x.del}</span>
            </button>
          ))}
        </div>
        <div className="diff mono">
          {f.lines.map(([k, n, t], i) =>
            k === '@' ? (
              <div key={i} className="dl hunk">{t}</div>
            ) : (
              <div key={i} className={'dl ' + (k === '+' ? 'add' : k === '-' ? 'del' : '')}>
                <span className="ln">{n}</span>
                <span className="sg">{k === ' ' ? '' : k}</span>
                <span className="tx">{t}</span>
              </div>
            ),
          )}
        </div>
        <div className="note-box">
          <span className="sub">员工说明</span>
          <p>签名不再用缓存的 key，每次从配置取；配置里的 merchantKey 变了就清签名缓存。</p>
        </div>
        <div className="panel-actions">
          <button className="btn ghost" onClick={() => nav.openChat('shop-dev')}>对这里说…</button>
          {params.sid && <button className="btn default" onClick={() => { revertMerge(params.sid); nav.close?.() }}>撤销合并</button>}
        </div>
      </div>
    </div>
  )
}

export function QueryResultPage({ params, nav }: PageProps) {
  const card = useStore((s) => (s.messages[params.sid] ?? []).find((m) => m.card?.id === params.cardId)?.card)
  return (
    <div className="page">
      <PageHeader title="查询结果" sub={card?.data.source} {...headNav(nav)} />
      <div className="page-body">
        {!card ? <Empty>找不到这次查询</Empty> : (
          <>
            <div className="sql mono wrap">{card.data.sql}</div>
            <Table cols={card.data.cols} rows={card.data.rows} bad={(v) => typeof v === 'string' && /failed|ERR/.test(v)} />
            <p className="sub">完整结果由界面直接向后台取（分页、排序、导出不经过 AI）。</p>
            <div className="panel-actions">
              <button className="btn default" onClick={() => nav.push({ page: 'query', params: { source: 'shop-prod', sql: card.data.sql } })}>在查询台里打开</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function PlaceholderPage({ params, nav }: PageProps) {
  return (
    <div className="page">
      <PageHeader title={params.title ?? '面板'} {...headNav(nav)} />
      <div className="page-body">
        <Empty>「{params.title}」是这个员工的底部菜单。<br />正式版由插件声明：点了直接打开面板，不经过 AI。</Empty>
      </div>
    </div>
  )
}
