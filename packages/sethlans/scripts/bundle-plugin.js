#!/usr/bin/env node
// prepack script: copies packages/sethlans-claude-plugin into ./claude-plugin/
// so that the published npm package is self-contained.
import { cpSync, rmSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const src  = resolve(packageRoot, '../sethlans-claude-plugin')
const dest = resolve(packageRoot, 'claude-plugin')

if (!existsSync(src)) {
  console.error(`bundle-plugin: source not found: ${src}`)
  process.exit(1)
}

if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true })
console.log(`bundle-plugin: copied ${src} → ${dest}`)
