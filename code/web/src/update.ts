// 发了新版自动换上（手机浏览器会把首页缓存住，发版后还看到旧页面）：
// 打开时、回到前台时、每 5 分钟问一次 /version.txt（不走缓存），和自己的版本不一样就换个地址重新打开首页（绕开缓存）。
// 根治还要 nginx 给 index.html 加 Cache-Control: no-cache（见 deploy/README.md）。
const KEY = 'opero.updateTo'

async function check() {
  try {
    const r = await fetch(`/version.txt?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return
    const v = (await r.text()).trim()
    if (!/^\d+\.\d+\.\d+/.test(v) || v === __APP_VERSION__) return
    // 同一个新版本只自动刷一次，刷完还是旧的（比如代理缓存）就不再刷，免得来回跳
    if (sessionStorage.getItem(KEY) === v) return
    sessionStorage.setItem(KEY, v)
    location.replace(`${location.pathname}?v=${encodeURIComponent(v)}${location.hash}`)
  } catch { /* 离线：下次再说 */ }
}

export function startUpdateCheck() {
  if (import.meta.env.DEV) return
  // 刚刷过的地址上带着 ?v=…：去掉，地址栏干净
  if (new URLSearchParams(location.search).has('v')) history.replaceState(history.state, '', location.pathname + location.hash)
  check()
  setInterval(check, 5 * 60_000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
}
