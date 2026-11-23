import type { Route } from '../types'

/** 页面拿到的导航：同一个页面可以放在页签里，也可以放在聊天右侧面板里 */
export interface Nav {
  push: (r: Route) => void
  back: () => void
  canBack: boolean
  /** 在面板里时：关掉面板 */
  close?: () => void
  /** 打开和某个员工的聊天 */
  openChat: (employeeId: string) => void
  mobile: boolean
}

export interface PageProps {
  params: Record<string, any>
  nav: Nav
}

/** 页头的返回 / 关闭按钮 */
export function headNav(nav: Nav) {
  return {
    onBack: nav.canBack ? nav.back : undefined,
    onClose: !nav.canBack && nav.close ? nav.close : undefined,
  }
}
