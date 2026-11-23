// 官网设置。官网只放介绍和试用（静态）；安装全走 GitHub，不连我们的服务器。
export const GITHUB_URL = 'https://github.com/yimaworks/opero'
export const INSTALL_DOC = `${GITHUB_URL}/blob/main/INSTALL.md`
export const INSTALL_CMD = 'curl -fsSL https://raw.githubusercontent.com/yimaworks/opero/main/code/server/scripts/install.sh | sudo bash'
/** 推荐的装法：把这句话发给服务器上的 Claude Code / Codex */
export const AI_PROMPT = {
  zh: `按 ${INSTALL_DOC} 帮我在这台服务器上装好 Opero`,
  en: `Install Opero on this server by following ${INSTALL_DOC}`,
}

/** 官网文案有两份底稿：英文用 en，其它语言都用中文底稿再按字典换（i18n） */
export type Lang = 'zh' | 'en'
/** 旧的按域名选（已不用：现在跟随系统 / 用户选的，见 i18n） */
export const siteLang: Lang = (() => {
  const q = new URLSearchParams(location.search).get('lang')
  if (q === 'zh' || q === 'en') return q
  return location.hostname.endsWith('yimakeji.cn') ? 'zh' : 'en'
})()

/** 试用版：/demo 开头的地址打开界面原型（假数据，不连服务器） */
export const isDemoPath = () => location.pathname === '/demo' || location.pathname.startsWith('/demo/')
