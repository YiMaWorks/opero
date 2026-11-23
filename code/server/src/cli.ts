// 服务器上的小工具（经 /usr/local/bin/opero 调，以 opero 用户、带着 /etc/opero/opero.env 跑）：
//   reset-password   给主人换一个随机密码（所有地方都要重新登录）
//   info             看数据目录、员工数、版本
//   fingerprint      这套 Opero 的指纹（Agent 认它）
import crypto from 'node:crypto'
import { cfg } from './config.ts'
import { all } from './db.ts'
import { owner, setPassword } from './auth.ts'
import { SERVER_FP } from './keys.ts'

const cmd = process.argv[2]
if (cmd === 'reset-password') {
  const o = owner()
  if (!o) { console.log('还没有主人：打开网页就会让你设一个。'); process.exit(0) }
  const pwd = crypto.randomBytes(9).toString('base64url')
  setPassword(pwd)
  console.log(`主人 ${o.email} 的新密码：${pwd}\n登录后在「我 → 账号安全」里改成你自己的。`)
} else if (cmd === 'info') {
  console.log(JSON.stringify({ version: cfg.version, data: cfg.data, work: cfg.work, web: cfg.web, aiUser: cfg.aiUser || null, owner: owner()?.email ?? null, employees: all('employees').length, servers: all('servers').length }, null, 2))
} else if (cmd === 'fingerprint') {
  console.log(`这套 Opero 的指纹：${SERVER_FP}`)
  console.log('Agent 只执行这个指纹签过名的活；迁移到新地址时数据目录带过去，指纹不变，Agent 改个地址就接上。')
} else {
  console.log('用法：opero reset-password | opero info | opero fingerprint')
}
