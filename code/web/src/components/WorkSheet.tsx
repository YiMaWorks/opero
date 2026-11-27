// 员工的 work 设置：AI 执行器（换 = 开新 work + 自动交接）· 模型 · 思考方式 · 审核方式 · 用哪个 Claude 账号（选了就记住）
// WorkSettings 是设置本身：聊天「···」面板里直接摊开；WorkSheet 是从员工资料 / 聊天顶部点开的弹窗（同一套 + 上下文）。
import { useEffect, useState } from 'react'
import type { Employee } from '../types'
import { compactContext, newTopic, setWork, switchExecutor, switchWork, toast } from '../store'
import { call } from '../live'
import { LIVE } from '../mode'
import type { ClaudeAccount } from './ExecutorSetup'
import { APPROVALS, EFFORTS, modelsFor } from '../work'
import { Meter, Segmented, Sheet } from './ui'

const EXECUTORS = ['Claude Code', 'Codex'] as const

/** 一行一项：左边名字、右边选；思考方式、审核方式下面一行小字说明当前这档是什么意思 */
export function WorkSettings({ emp, onSwitched }: { emp: Employee; onSwitched?: () => void }) {
  const models = modelsFor(emp.executor)
  const save = (p: Partial<Pick<Employee, 'model' | 'effort' | 'approval'>>) => { setWork(emp.id, p); toast('已记住，下次派活也用它') }
  const cur = /codex/i.test(emp.executor) ? 'Codex' : 'Claude Code'
  // 登录了好几个 Claude 账号时：这个员工用哪个
  const [accts, setAccts] = useState<ClaudeAccount[]>([])
  useEffect(() => { if (LIVE && cur === 'Claude Code') void call<ClaudeAccount[]>('GET', '/api/ai/accounts?kind=claude').then((r) => r && setAccts(r)) }, [emp.id, cur])
  const [acct, setAcct] = useState(emp.claudeAccount ?? '')
  const pickAcct = async (id: string) => { setAcct(id); await call('PUT', `/api/employees/${emp.id}`, { claudeAccount: id }, id ? '已指定，下一轮起用它' : '改回用默认账号') }
  const swap = (to: (typeof EXECUTORS)[number]) => {
    if (to === cur) return
    if (!confirm(`把「${emp.name}」换成 ${to}？\n\n会开一段新的 work（新执行器、上下文清空），Opero 自动发一条交接：它负责什么、目录和项目在哪、上一段做到哪。它读完自己的文档接着干。现在在干活的话先等这一轮做完。`)) return
    switchExecutor(emp.id, to)
    onSwitched?.()
  }
  const effort = EFFORTS.find((x) => x.value === emp.effort)
  const approval = APPROVALS.find((x) => x.value === emp.approval)
  return (
    <div className="ws-form">
      <div className="ws-row">
        <span className="ws-k">执行器</span>
        <Segmented value={cur} onChange={swap} options={EXECUTORS.map((x) => ({ value: x, label: x }))} />
        <span className="ws-hint">换了开一段新的 work，自动交接；目录、项目、记忆都在。要先在「应用 → AI 执行器」装好、登录</span>
      </div>
      <div className="ws-row">
        <span className="ws-k">模型</span>
        {models.length <= 3
          ? <Segmented value={emp.model} onChange={(v) => save({ model: v })} options={models.map((m) => ({ value: m, label: m }))} />
          : <select className="ctl-select" value={emp.model} onChange={(e) => save({ model: e.target.value })}>{models.map((m) => <option key={m} value={m}>{m}</option>)}</select>}
        {models.length === 1 && <span className="ws-hint">{emp.executor} 用它自己配置里的模型</span>}
      </div>
      {accts.length > 1 && (
        <div className="ws-row">
          <span className="ws-k">账号</span>
          <select className="ctl-select" value={acct} onChange={(e) => pickAcct(e.target.value)}>
            <option value="">{`默认账号（${accts.find((a) => a.isDefault)?.name ?? ''}）`}</option>
            {accts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.limitedUntil > 0 ? '（用量到上限）' : ''}</option>)}
          </select>
        </div>
      )}
      <div className="ws-row">
        <span className="ws-k">思考</span>
        <Segmented value={emp.effort} onChange={(v) => save({ effort: v })} options={EFFORTS.map((e) => ({ value: e.value, label: e.label }))} />
        {effort && <span className="ws-hint">{effort.desc}</span>}
      </div>
      <div className="ws-row">
        <span className="ws-k">审核</span>
        <Segmented value={emp.approval} onChange={(v) => save({ approval: v })} options={APPROVALS.map((a) => ({ value: a.value, label: a.short }))} />
        {approval && <span className="ws-hint">{approval.desc}</span>}
      </div>
    </div>
  )
}

export function WorkSheet({ emp, sid, onClose }: { emp: Employee; sid?: string; onClose: () => void }) {
  return (
    <Sheet title={`${emp.name} 的 work`} onClose={onClose}>
      <div className="work-sheet">
        <p className="sub">{emp.executor} · 跑在 {emp.host}{emp.workspace ? ` · 项目 ${emp.workspace}` : ''}</p>
        <WorkSettings emp={emp} onSwitched={onClose} />
        {sid && (
          <div className="ws-group">
            <Meter label="上下文" value={emp.contextUsed ?? 0} />
            <span className="field-hint">快满时会提醒你，换不换由你定：可以压缩、开新话题，或者换一个 work（旧的写好交接，新的读完接着干）。不换也能继续用，执行器自己会压缩。</span>
            <div className="row-actions">
              <button className="btn default sm" onClick={() => { compactContext(sid, emp.id); onClose() }}>压缩上下文</button>
              <button className="btn default sm" onClick={() => { newTopic(sid, emp.id); onClose() }}>新话题</button>
              <button className="btn primary sm" onClick={() => { switchWork(sid, emp.id, '你让换的'); onClose() }}>换一个 work</button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
