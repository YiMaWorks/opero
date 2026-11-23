// 官网设置。官网只放介绍和试用（静态）；安装全走 GitHub，不连我们的服务器。
export const GITHUB_URL = 'https://github.com/wfcaven/opero'
export const INSTALL_DOC = `${GITHUB_URL}/blob/main/INSTALL.md`
export const INSTALL_CMD = 'curl -fsSL https://raw.githubusercontent.com/wfcaven/opero/main/code/server/scripts/install.sh | sudo bash'
/** 推荐的装法：把这句话发给服务器上的 Claude Code / Codex */
export const AI_PROMPT = {
  zh: `按 ${INSTALL_DOC} 帮我在这台服务器上装好 Opero`,
  en: `Install Opero on this server by following ${INSTALL_DOC}`,
}

export type Lang = 'zh' | 'en'
/** 英文域名（yimaworks.com）默认英文，中文域名默认中文；地址带 ?lang= 时以它为准 */
export const siteLang: Lang = (() => {
  const q = new URLSearchParams(location.search).get('lang')
  if (q === 'zh' || q === 'en') return q
  return location.hostname.endsWith('yimakeji.cn') ? 'zh' : 'en'
})()

/** 试用版：/demo 开头的地址打开界面原型（假数据，不连服务器） */
export const isDemoPath = () => location.pathname === '/demo' || location.pathname.startsWith('/demo/')
