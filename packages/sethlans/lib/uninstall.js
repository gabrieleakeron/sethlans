// sethlans uninstall — removes all Sethlans plugin files from ~/.claude/
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'

const CLAUDE_HOME = join(homedir(), '.claude')

const SKILLS = ['sethlans.md', 'sethlans-onboard.md', 'sethlans-healthcheck.md']
const AGENTS = [
  'seth-architect.md', 'seth-be-java.md', 'seth-be-python.md', 'seth-devops.md',
  'seth-frontend.md', 'seth-fullstack.md', 'seth-product-owner.md',
  'seth-reviewer.md', 'seth-tester.md', 'seth-ux-designer.md',
]
const PROTOCOL_FILES = ['board-protocol.md', 'code-quality-protocol.md']

function remove(p) {
  if (existsSync(p)) {
    rmSync(p)
    console.log(`  ✔ removed ${p}`)
  }
}

export function uninstall() {
  console.log('Uninstalling Sethlans plugin from ~/.claude/ …\n')

  // MCP server registration
  try {
    execSync('claude mcp remove sethlans-board', { stdio: 'pipe' })
    console.log('  ✔ deregistered MCP server: sethlans-board')
  } catch {
    console.log('  - MCP server sethlans-board not registered (skipped)')
  }

  // Skills
  for (const f of SKILLS) remove(join(CLAUDE_HOME, 'commands', f))

  // Protocol files
  for (const f of PROTOCOL_FILES) remove(join(CLAUDE_HOME, f))

  // Agents
  for (const f of AGENTS) remove(join(CLAUDE_HOME, 'agents', f))

  // MCP server file
  remove(join(CLAUDE_HOME, 'mcp', 'server.mjs'))

  // Config
  remove(join(CLAUDE_HOME, 'sethlans-config.json'))

  console.log('\nDone. Restart Claude Code to apply.')
}
