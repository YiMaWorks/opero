// 员工的 work 设置：模型 · 思考方式 · 审核方式（选了就记住）· 上下文
import type { Employee } from '../types'
import { compactContext, newTopic, setWork, switchWork, toast } from '../store'
import { APPROVALS, EFFORTS, modelsFor } from '../work'
import { Meter, Segmented, Sheet } from './ui'

export function WorkSheet({ emp, sid, onClose }: { emp: Employee; sid?: string; onClose: () => void }) {
  const models = modelsFor(emp.executor)
  const save = (p: Partial<Pick<Employee, 'model' | 'effort' | 'approval'>>) => { setWork(emp.id, p); toast('已记住，下次派活也用它') }
  const effort = EFFORTS.find((x) => x.value === emp.effort)
  return (
    <Sheet title={`${emp.name} 的 work`} onClose={onClose}>
      <div className="work-sheet">
        <p className="sub">{emp.executor} · 跑在 {emp.host} · 工作空间 {emp.workspace}</p>

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
            <span className="field-hint">满了就换一个 work：旧的写好交接提交到 {emp.repo}，新的读完接着干，什么都不丢。</span>
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
