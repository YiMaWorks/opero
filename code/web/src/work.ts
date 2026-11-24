// 每个员工都是一个 work：模型 · 思考方式 · 审核方式 的选项和文字
import type { Approval, Effort } from './types'

/** 各执行器能选的模型。没列出的执行器只给「执行器默认」（用它自己配置里的模型）。 */
const MODELS: Record<string, string[]> = {
  'Claude Code': ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5', 'Fable 5.1'],
}
/** 真的一套：后台从 Anthropic / OpenAI 读到的完整列表（GET /api/ai/models），读到了就用它 */
let liveModels: { claude: string[]; codex: string[] } | null = null
export const setLiveModels = (m: { claude: string[]; codex: string[] }) => { liveModels = m }
export const modelsFor = (executor: string) => (liveModels ? (/codex/i.test(executor) ? liveModels.codex : liveModels.claude) : null) ?? MODELS[executor] ?? ['执行器默认']

export const EFFORTS: { value: Effort; label: string; desc: string }[] = [
  { value: 'low', label: '低', desc: '最快，简单问答' },
  { value: 'medium', label: '中', desc: '日常' },
  { value: 'high', label: '高', desc: '排查、改代码' },
  { value: 'xhigh', label: '超高', desc: '难题、大改动' },
  { value: 'max', label: '最大', desc: '最慢最贵，少用' },
]

export const APPROVALS: { value: Approval; label: string; short: string; desc: string }[] = [
  { value: 'auto', label: '自动', short: '自动', desc: '信任 AI：有权限就直接做（推荐）；危险操作照样要你本人' },
  { value: 'edits', label: '改文件自动，跑命令要问', short: '命令要问', desc: '改代码不问；执行命令前出卡片让你点' },
  { value: 'ask', label: '每一步都问', short: '每步都问', desc: '改文件、跑命令都先问你' },
  { value: 'plan', label: '只看不改', short: '只看不改', desc: '计划模式：只读、只分析，给方案不动手' },
]

export const effortLabel = (e: Effort) => EFFORTS.find((x) => x.value === e)?.label ?? e
export const approvalShort = (a: Approval) => APPROVALS.find((x) => x.value === a)?.short ?? a
export const approvalLabel = (a: Approval) => APPROVALS.find((x) => x.value === a)?.label ?? a
