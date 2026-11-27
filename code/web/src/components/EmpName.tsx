// 员工的名字 + 职位标签：职位放在名字后面，小 30%（0.7em），标签样子。哪里显示员工名字都用它
import type { Employee } from '../types'

export function EmpName({ e }: { e: Pick<Employee, 'name' | 'role'> }) {
  return <>{e.name}{e.role && <span className="role-tag" data-no-i18n="">{e.role}</span>}</>
}
