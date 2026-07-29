import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const output = resolve(root, 'dist')

await rm(output, { recursive: true, force: true })
await mkdir(resolve(output, 'server'), { recursive: true })
await cp(resolve(root, '.vite-output'), resolve(output, 'client'), { recursive: true })
await cp(resolve(root, 'worker', 'static-site-worker.mjs'), resolve(output, 'server', 'index.js'))
await mkdir(resolve(output, '.openai'), { recursive: true })
await cp(resolve(root, '.openai', 'hosting.json'), resolve(output, '.openai', 'hosting.json'))
