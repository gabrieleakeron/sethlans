// Copies the Sethlans Claude Code plugin files into ~/.claude/
// Mirrors the logic of the old install.ps1 / install.sh scripts.
import { existsSync, readdirSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import { homedir } from 'os'
import { ask } from './prompts.js'

const CLAUDE_HOME = join(homedir(), '.claude')

// Resolve the plugin root.
// Priority 1: claude-plugin/ bundled inside this package (npm install / npm pack).
// Priority 2: sethlans-claude-plugin sibling in the monorepo (dev without prepack).
function findPluginRoot() {
  const candidates = [
    resolve(import.meta.dirname, '../claude-plugin'),            // bundled (published)
    resolve(import.meta.dirname, '../../sethlans-claude-plugin') // monorepo sibling (dev)
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'plugin.json'))) return c
  }
  return null
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true })
}

async function copyFileSafe(src, dest, force) {
  if (existsSync(dest) && !force) {
    const answer = (await ask(`  Overwrite ${dest}? [y/N] `)).trim().toLowerCase()
    if (answer !== 'y') {
      console.log(`  skipped: ${dest}`)
      return
    }
  }
  copyFileSync(src, dest)
  console.log(`  ✔ ${dest}`)
}

export async function copyPlugin(force = false) {
  const pluginRoot = findPluginRoot()
  if (!pluginRoot) {
    console.error('  ✗ Could not locate sethlans-claude-plugin. Make sure the package is installed.')
    return false
  }

  ensureDir(join(CLAUDE_HOME, 'commands'))
  ensureDir(join(CLAUDE_HOME, 'agents'))
  ensureDir(join(CLAUDE_HOME, 'mcp'))

  // Commands (slash skills)
  const commandsDir = join(pluginRoot, 'commands')
  for (const f of readdirSync(commandsDir).filter(f => f.endsWith('.md'))) {
    await copyFileSafe(join(commandsDir, f), join(CLAUDE_HOME, 'commands', f), force)
  }

  // Protocol files
  for (const f of ['board-protocol.md', 'code-quality-protocol.md']) {
    const src = join(pluginRoot, f)
    if (existsSync(src)) await copyFileSafe(src, join(CLAUDE_HOME, f), force)
  }

  // Agents
  const agentsDir = join(pluginRoot, 'agents')
  for (const f of readdirSync(agentsDir).filter(f => f.endsWith('.md'))) {
    await copyFileSafe(join(agentsDir, f), join(CLAUDE_HOME, 'agents', f), force)
  }

  // MCP server
  const mcpSrc = join(pluginRoot, 'mcp', 'server.mjs')
  if (existsSync(mcpSrc)) await copyFileSafe(mcpSrc, join(CLAUDE_HOME, 'mcp', 'server.mjs'), force)

  return true
}

// Read/write ~/.claude/sethlans-config.json
export function readConfig() {
  const p = join(CLAUDE_HOME, 'sethlans-config.json')
  if (!existsSync(p)) return {}
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return {} }
}

export function writeConfig(config) {
  ensureDir(CLAUDE_HOME)
  writeFileSync(join(CLAUDE_HOME, 'sethlans-config.json'), JSON.stringify(config, null, 2))
}
