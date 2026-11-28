// 网页是同一份打包（官网和自己服务器上的 Opero 共用 index.html）。
/** 自己服务器上的 Opero：官网给搜索引擎的那两段（site-meta / site-static）去掉，标 noindex（私有的，不该被收录），注入 instance */
export function instanceHtml(raw: string, base: string): string {
  return raw
    .replace(/<!--site-meta[\s\S]*?<!--\/site-meta-->/, '<meta name="robots" content="noindex,nofollow" />')
    .replace(/<!--site-static[\s\S]*?<!--\/site-static-->/, '')
    .replace(/<title>[^<]*<\/title>/, '<title>Opero</title>')
    .replace(/<base href="[^"]*"\s*\/?>/, `<base href="${base}" />`)
    .replace('</head>', `<script>window.OPERO_MODE='instance'</script></head>`)
}
