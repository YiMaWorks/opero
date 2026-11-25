// 试编译：只编不发（员工配好编译 / 流水线后自己试，失败看日志改到编通）。每个编译组件同时只有一个（不同组件可以一起编）；最近一次的结果记在 kv，重启也看得到
import fs from 'node:fs'
import path from 'node:path'
import { cfg } from './config.ts'
import { get, kvGet, kvSet, uid } from './db.ts'
import { git } from './git.ts'
import * as build from './build.ts'
import type { Workspace } from './types.ts'

export interface BuildJob { id: string; ws: string; build: string; buildName?: string; by: string; status: 'running' | 'ok' | 'fail'; mode?: string; sha?: string; version?: string; files?: string[]; error?: string; log: string[]; at: number; end?: number }

const running = new Map<string, BuildJob>()
const key = (ws: string, build: string) => `${ws}:${build}`
const save = (j: BuildJob) => kvSet(`buildJob:${key(j.ws, j.build)}`, { ...j, log: j.log.slice(-200) })

/** 这个组件最近一次（在跑的优先） */
export const lastOf = (ws: string, build: string): BuildJob | undefined => running.get(key(ws, build)) ?? kvGet<BuildJob | undefined>(`buildJob:${key(ws, build)}`, undefined)

export function start(w: Workspace, b: build.BuildComp, by: string): BuildJob {
  const k = key(w.id, b.id)
  if (running.has(k)) throw new Error(`「${b.name}」正在试编译，等它做完（build_status 看进度）`)
  const j: BuildJob = { id: uid('bj'), ws: w.id, build: b.id, buildName: b.name, by, status: 'running', log: [], at: Date.now() }
  running.set(k, j)
  save(j)
  const step = (msg: string) => { j.log.push(`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${msg}`); if (j.log.length > 400) j.log.splice(0, 100) }
  ;(async () => {
    try {
      const lr = await git(['ls-remote', w.repo, w.branch || 'HEAD'], { cred: w.credential, timeoutMs: 60_000 })
      const sha = lr.out.split(/\s+/)[0]
      if (!/^[0-9a-f]{7,40}$/.test(sha ?? '')) throw new Error(`拿不到远端最新提交（先把改动推上去）：${lr.out.slice(-200)}`)
      j.sha = sha
      step(`编「${b.name}」：远端 ${w.branch || '默认分支'} 的 ${sha.slice(0, 7)}（${build.providerName(b)}）`)
      const res = await build.run(w, b, `try-${j.id}`, sha, step)
      j.status = 'ok'
      j.version = res.version
      j.files = res.files
      step(`编好了：${res.files.join('、')}（版本 ${res.version || sha.slice(0, 7)}）`)
    } catch (e) {
      j.status = 'fail'
      j.error = (e as Error).message.slice(0, 2000)
      step(`没编过：${j.error}`)
    } finally {
      j.end = Date.now()
      running.delete(k)
      save(j)
      // 试编译的产物不留（真发布时会重新编）
      fs.rm(path.join(cfg.data, 'releases', `try-${j.id}`), { recursive: true, force: true }, () => {})
    }
  })()
  return j
}

export const wsOf = (id: string) => get<Workspace>('workspaces', id)
