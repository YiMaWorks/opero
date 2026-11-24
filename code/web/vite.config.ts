import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [react()],
  base: './', // 相对路径 + index.html 里的 <base href>：能装在子路径下
  // 「关于」里显示的网页版本 = package.json 的 version（发版只改那一处）
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: 'dist', sourcemap: false },
})
