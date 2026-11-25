// 员工的 work 设置：模型 · 思考方式 · 审核方式（选了就记住）· 上下文
import { useEffect, useState } from 'react'
import type { Employee } from '../types'
import { compactContext, newTopic, setWork, switchWork, toast } from '../store'
import { call } from '../live'
import { LIVE } from '../mode'
import type { ClaudeAccount } from './ExecutorSetup'
import { APPROVALS, EFFORTS, modelsFor } from '../work'
import { Meter, Segmented, Sheet } from './ui'

export function WorkSheet({ emp, sid, onClose }: { emp: Employee; sid?: string; onClose: () => void }) {
  const models = modelsFor(emp.executor)
  const save = (p: Partial<Pick<Employee, 'model' | 'effort' | 'approval'>>) => { setWork(emp.id, p); toast('已记住，下次派活也用它') }
  const effort = EFFORTS.find((x) => x.value === emp.effort)
  // 登录了好几个 Claude 账号时：这个员工用哪个
  const [accts, setAccts] = useState<ClaudeAccount[]>([])
  useEffect(() => { if (LIVE && !/codex/i.test(emp.executor)) void call<ClaudeAccount[]>('GET', '/api/ai/claude-accounts').then((r) => r && setAccts(r)) }, [emp.id, emp.executor])
  const [acct, setAcct] = useState(emp.claudeAccount ?? '')
  const pickAcct = async (id: string) => { setAcct(id); await call('PUT', `/api/employees/${emp.id}`, { claudeAccount: id }, id ? '已指定，下一轮起用它' : '改回用默认账号') }
  return (
    <Sheet title={`${emp.name} 的 work`} onClose={onClose}>
      <div className="work-sheet">
        <p className="sub">{emp.executor} · 跑在 {emp.host} · 项目 {emp.workspace}</p>

        <div className="ws-group">
          <span className="ws-label">模型</span>
          <div className="radio-list">
            {models.map((m) => (
              <button key={m} className={'radio-row' + (emp.model === m ? ' on' : '')} onClick={() => save({ model: m })}>
                <i className="radio" /><span>{m}</span>
              </button>
            ))}
          </div>
          {models.length === 1 && <span className="field-hint">{emp.executor} 用它自己配置里的模型；以后接上它的模型列表再在这里选。</span>}
        </div>

        {accts.length > 1 && (
          <div className="ws-group">
            <span className="ws-label">用哪个 Claude 账号</span>
            <div className="radio-list">
              <button className={'radio-row' + (!acct ? ' on' : '')} onClick={() => pickAcct('')}><i className="radio" /><span className="radio-main"><span>默认账号</span><span className="sub">{accts.find((a) => a.isDefault)?.name ?? ''}</span></span></button>
              {accts.map((a) => (
                <button key={a.id} className={'radio-row' + (acct === a.id ? ' on' : '')} onClick={() => pickAcct(a.id)}>
                  <i className="radio" /><span className="radio-main"><span>{a.name}</span>{a.limitedUntil > 0 && <span className="sub">用量到上限，暂时会先用别的</span>}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ws-group">
          <span className="ws-label">思考方式 <span className="sub">· {effort?.desc}</span></span>
          <Segmented value={emp.effort} onChange={(v) => save({ effort: v })} options={EFFORTS.map((e) => ({ value: e.value, label: e.label }))} />
        </div>

        <div className="ws-group">
          <span className="ws-label">审核方式</span>
          <div className="radio-list">
            {APPROVALS.map((a) => (
              <button key={a.value} className={'radio-row' + (emp.approval === a.value ? ' on' : '')} onClick={() => save({ approval: a.value })}>
                <i className="radio" />
                <span className="radio-main"><span>{a.label}</span><span className="sub">{a.desc}</span></span>
              </button>
            ))}
          </div>
        </div>

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
