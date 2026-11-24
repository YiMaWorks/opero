// 员工底部菜单注册表（二开入口，说明见 docs/规范/底部菜单.md）
// 员工配置里只写菜单名（Employee.menus）；点了打开哪个页面在这里登记。不经过 AI，秒开。
// 正式版：插件在清单里声明 menus（名字 + ui://界面 或 内核页面），加载插件时登记到这里。
import type { Route } from './types'
import { LIVE } from './mode'

export interface MenuDef {
  /** 点了打开哪一页；拿得到员工 id 和它的项目 */
  route: (ctx: { employeeId: string; workspace: string }) => Route
  /** 一句话说明（编辑员工时给人看） */
  desc: string
  /** 来自哪个插件（内核的写 core） */
  plugin: string
}

export const MENU_REGISTRY: Record<string, MenuDef> = {
  问题清单: { plugin: 'core', desc: '这个员工负责的项目的问题', route: ({ employeeId }) => ({ page: 'issues', params: { project: employeeId.startsWith('shop') ? 'shop' : undefined } }) },
  日志扫描: { plugin: 'server', desc: '日志扫描触发器', route: () => ({ page: 'triggers' }) },
  查生产库: { plugin: 'data', desc: '查询台（只读账号）', route: () => (LIVE ? { page: 'data' } : { page: 'query', params: { source: 'shop-prod' } }) },
  发布记录: { plugin: 'release', desc: '最近的发布', route: () => ({ page: 'releases' }) },
  应用: { plugin: 'release', desc: '应用和环境、AI 发版设置', route: () => ({ page: 'releases', params: { tab: 'apps' } }) },
  改动记录: { plugin: 'core', desc: '项目的提交和分支', route: ({ workspace }) => ({ page: 'workspace', params: { id: workspace } }) },
  预览: { plugin: 'core', desc: '项目的预览环境', route: ({ workspace }) => ({ page: 'workspace', params: { id: workspace } }) },
  服务器: { plugin: 'server', desc: '服务器列表和监控', route: () => ({ page: 'servers' }) },
  收件箱: { plugin: 'message', desc: '所有渠道的消息，分好类', route: () => ({ page: 'inbox' }) },
  消息渠道: { plugin: 'message', desc: '邮件、Slack、Telegram… 的接入', route: () => ({ page: 'channels' }) },
  知识库: { plugin: 'core', desc: '所有员工共用的资料', route: () => ({ page: 'knowledge' }) },
  流程: { plugin: 'core', desc: '存好的固定步骤，点一下就跑', route: () => ({ page: 'flows' }) },
  员工: { plugin: 'core', desc: '所有员工', route: () => ({ page: 'employees' }) },
  设置: { plugin: 'core', desc: '系统设置', route: () => ({ page: 'settings' }) },
  插件: { plugin: 'core', desc: '插件列表', route: () => ({ page: 'plugins' }) },
}

/** 菜单名 → 页面；没登记的打开占位页（提示去二开） */
export function menuRoute(menu: string, employeeId: string, workspace: string): Route {
  const def = MENU_REGISTRY[menu]
  return def ? def.route({ employeeId, workspace }) : { page: 'placeholder', params: { title: menu } }
}
