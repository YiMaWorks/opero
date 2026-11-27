// 跑：cd code/server && npm test。发布卡片上的版本号：产物文件名、版本号文件、仓库里认，认不出才用提交号
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-ver-'))
const v = await import('./version.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))

test('产物文件名', () => {
  assert.equal(v.fromFileName('opero-yima-0.30.0.tgz'), '0.30.0')
  assert.equal(v.fromFileName('app-release-1.2.3.apk'), '1.2.3')
  assert.equal(v.fromFileName('MyApp_v2.0.1-beta.2.msix'), '2.0.1-beta.2')
  assert.equal(v.fromFileName('Opero-1.4.0-arm64.dmg'), '1.4.0')
  assert.equal(v.fromFileName('dist.tar.gz'), '')
  assert.equal(v.fromFileName(undefined), '')
})

test('版本号文件', () => {
  assert.equal(v.fromContent('package.json', '{"name":"x","version":"0.31.1"}'), '0.31.1')
  assert.equal(v.fromContent('VERSION', ' v1.2.0\n'), '1.2.0')
  assert.equal(v.fromContent('app/build.gradle.kts', 'versionCode = 3\n versionName = "0.4.2"'), '0.4.2')
  assert.equal(v.fromContent('Cargo.toml', '[package]\nname = "x"\nversion = "0.9.1"\n[dependencies]\nserde = { version = "1" }'), '0.9.1')
  assert.equal(v.fromContent('pom.xml', '<project><modelVersion>4.0.0</modelVersion><groupId>a</groupId><version>3.1.0</version></project>'), '3.1.0')
})

test('先用编译读出来的，再文件名，再仓库，最后提交号', async () => {
  assert.equal(await v.decide({ built: '2.0.0', pkgName: 'a-1.0.0.tgz', sha: 'abcdef1234' }), '2.0.0')
  assert.equal(await v.decide({ built: 'abcdef1', pkgName: 'a-1.0.0.tgz', sha: 'abcdef1234' }), '1.0.0')
  assert.equal(await v.decide({ sha: 'abcdef1234' }), 'abcdef1')
})

test('仓库里那个提交：根目录优先；子项目版本号不一样就不猜', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-ver-repo-'))
  after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't')
  fs.mkdirSync(path.join(dir, 'code/server'), { recursive: true }); fs.mkdirSync(path.join(dir, 'code/web'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'code/server/package.json'), '{"version":"0.31.1"}')
  fs.writeFileSync(path.join(dir, 'code/web/package.json'), '{"version":"0.48.0"}')
  g('add', '.'); g('commit', '-qm', 'a')
  const w: any = { dir, server: 'local' }
  assert.equal(await v.fromRepo(w, g('rev-parse', 'HEAD')), '', '两个子项目版本号不同：不猜')
  fs.writeFileSync(path.join(dir, 'VERSION'), '1.5.0\n')
  g('add', '.'); g('commit', '-qm', 'b')
  assert.equal(await v.fromRepo(w, g('rev-parse', 'HEAD')), '1.5.0', '根目录有就用根目录的')
})
