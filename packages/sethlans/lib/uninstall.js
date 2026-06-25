// sethlans uninstall — removes Sethlans from ~/.claude/ (plugin files, agents,
// MCP registrations and code-intelligence entries) and, optionally, the local
// board containers and the integration MCPs.
//
// The board DATABASE is ALWAYS preserved: the board is brought down with
// `docker compose down` WITHOUT `--volumes`, so the named `sethlans-board-data`
// volume survives a reinstall.
import { existsSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import { confirm, close } from './prompts.js'
import { readConfig } from './copy-plugin.js'
import { isDockerAvailable, dockerDown } from './docker.js'
import { MCP_PATH } from './lsp.js'

const CLAUDE_HOME = join(homedir(), '.claude')

const SKILLS = [
  'sethlans.md', 'sethlans-onboard.md', 'sethlans-healthcheck.md', 'sethlans-design.md',
]
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

// `sethlans-board` and the integration MCPs are registered in ~/.claude.json via
// `claude mcp add -s user` — deregister them the same way. Try the user scope
// first (newer CLIs require it), fall back to scopeless for older ones.
function claudeMcpRemove(name) {
  for (const cmd of [`mcp remove ${name} -s user`, `mcp remove ${name}`]) {
    try {
      execSync(`claude ${cmd}`, { stdio: 'pipe' })
      console.log(`  ✔ deregistered MCP: ${name}`)
      return true
    } catch { /* try next form */ }
  }
  console.log(`  - MCP ${name} not registered (skipped)`)
  return false
}

// agent-lsp / serena live in the managed file ~/.claude/.mcp.json (written by the
// postinstall / setup), NOT in ~/.claude.json. Drop only those two keys, keeping
// any other server the user may have added to that file.
function removeGlobalLspEntries() {
  if (!existsSync(MCP_PATH)) return
  let cfg
  try {
    cfg = JSON.parse(readFileSync(MCP_PATH, 'utf8'))
  } catch {
    console.log(`  ! ${MCP_PATH} is not valid JSON — left untouched`)
    return
  }
  if (!cfg?.mcpServers) return
  let changed = false
  for (const k of ['agent-lsp', 'serena']) {
    if (cfg.mcpServers[k]) {
      delete cfg.mcpServers[k]
      changed = true
      console.log(`  ✔ removed ${k} from ${MCP_PATH}`)
    }
  }
  if (changed) writeFileSync(MCP_PATH, JSON.stringify(cfg, null, 2))
}

export async function uninstall() {
  console.log('\n── Uninstall Sethlans ──')
  console.log('Removes the plugin files, agents, MCP registrations and code-intelligence entries')
  console.log('from ~/.claude/. The board database (Docker volume sethlans-board-data) is kept.\n')

  if (!(await confirm('Proceed?', false))) {
    console.log('  Aborted — nothing changed.')
    close()
    return
  }

  // 1. Plugin files (skills, protocol docs, agents, board MCP server)
  for (const f of SKILLS) remove(join(CLAUDE_HOME, 'commands', f))
  for (const f of PROTOCOL_FILES) remove(join(CLAUDE_HOME, f))
  for (const f of AGENTS) remove(join(CLAUDE_HOME, 'agents', f))
  remove(join(CLAUDE_HOME, 'mcp', 'server.mjs'))

  // 2. Sethlans-owned MCP servers: the board + the code-intelligence multiplexers
  claudeMcpRemove('sethlans-board')
  removeGlobalLspEntries()

  // 3. Integration MCPs — wired globally by /sethlans-onboard, but generic
  //    (atlassian, github, codacy, …) and possibly shared with other tools.
  //    Opt-in only.
  const config = readConfig()
  const providers = [...new Set(Object.values(config.mcps || {}).filter(Boolean))]
  if (providers.length) {
    console.log(`\n  Integration MCPs wired for Sethlans: ${providers.join(', ')}.`)
    if (await confirm('Deregister them too? (they may be used by other tools)', false)) {
      for (const p of providers) claudeMcpRemove(p)
    } else {
      console.log('  - kept (deregister manually with `claude mcp remove <name> -s user`).')
    }
  }

  // 4. Local board containers — DB volume is ALWAYS preserved (no `down --volumes`)
  if (isDockerAvailable()) {
    if (await confirm('\nStop and remove the Sethlans Board containers? (database volume is kept)', false)) {
      try {
        dockerDown()
        console.log('  ✔ board containers removed — volume sethlans-board-data preserved')
      } catch (err) {
        console.log(`  ! could not stop the containers: ${err.message}`)
      }
    }
  } else {
    console.log('\n  - Docker not available — skipping board container cleanup.')
  }

  // 5. Config (last, so the integration-MCP list above is still readable)
  remove(join(CLAUDE_HOME, 'sethlans-config.json'))

  console.log('\nDone. Restart Claude Code to apply.')
  console.log('Note: globally-installed CLIs (agent-lsp, serena, pylsp, typescript-language-server,')
  console.log('jdtls) and the board database volume were left in place — remove them manually if')
  console.log('you really want a clean slate (`docker volume rm sethlans-board-data`).')
  close()
}
