// 运行模式：装在自己服务器上的 Opero，后台在 index.html 里注入 window.OPERO_MODE='instance'，网页走真的接口；
// 官网和 /demo 没有这句，用 data/mock.ts 的假数据。
export const LIVE = (window as { OPERO_MODE?: string }).OPERO_MODE === 'instance'

/** 钱的单位：真的一套按执行器报的美元算；演示是人民币 */
export const CUR = LIVE ? '$' : '¥'
