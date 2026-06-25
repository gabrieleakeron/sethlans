import { execSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { ask, menu, confirm, close } from './prompts.js'
import { copyPlugin, readConfig, writeConfig } from './copy-plugin.js'
import { isDockerAvailable, isDatabaseAvailable, dockerPullAndUp } from './docker.js'

const CLAUDE_HOME = join(homedir(), '.claude')
const MCP_SERVER_PATH = join(CLAUDE_HOME, 'mcp', 'server.mjs')

function runClaude(args) {
  try {
    execSync(`claude ${args}`, { stdio: 'inherit' })
    return true
  } catch {
    console.log(`  ! Could not run: claude ${args}`)
    console.log(`    Run it manually after setup completes.`)
    return false
  }
}

async function collectEnvVars(envVarDefs) {
  const collected = {}
  for (const { key, prompt } of envVarDefs) {
    const val = (await ask(`  ${prompt}`)).trim()
    if (val) collected[key] = val
  }
  return collected
}

// `-s user` registers the MCP server at the global ("user") scope — available
// in every project, not just the one the wizard happens to be run from (the
// default `claude mcp add` scope is per-project/"local").
function buildMcpAddCommand(provider, envVars) {
  const envFlags = Object.entries(envVars).map(([k, v]) => `-e ${k}=${v}`).join(' ')
  const cmd = provider.command.join(' ')
  return `mcp add ${provider.mcpName} -s user ${envFlags} -- ${cmd}`
}

/**
 * Drives a single wizard step. `handlers` provides:
 *   configure() — collect input, mutate local state, may be called multiple times
 *   test()      — probe the configured state, print the result, never mutates config
 *   save()      — persist side effects (register MCP, start Docker, ...) and return
 *                 the value to merge into the step's slice of `config`
 *   isConfigured() — whether `save`/`test` should be offered yet
 * Returns 'saved' or 'skipped'.
 */
async function runStep(title, handlers) {
  console.log(`\n── ${title} ──`)
  while (true) {
    const options = []
    options.push(handlers.isConfigured() ? 'Reconfigure' : 'Configure')
    if (handlers.isConfigured()) options.push('Test')
    if (handlers.isConfigured()) options.push('Save & continue')
    options.push('Skip this step')

    const choice = await menu('What do you want to do?', options)
    const label = options[choice]

    if (label === 'Configure' || label === 'Reconfigure') {
      await handlers.configure()
    } else if (label === 'Test') {
      await handlers.test()
    } else if (label === 'Save & continue') {
      await handlers.save()
      return 'saved'
    } else {
      return 'skipped'
    }
  }
}

async function stepBoard(config) {
  const state = { boardUrl: 'http://localhost:9955', mode: null, dbUrl: null, bringUp: false, dbChoice: 0 }

  return runStep('Step 1 — Sethlans Board (Docker, DB, MCP)', {
    isConfigured: () => state.mode !== null,

    async configure() {
      const modeChoice = await menu('Where does Sethlans Board run?', [
        'Local (started with Docker, default port 9955)',
        'Remote — enter URL'
      ])
      state.mode = modeChoice === 0 ? 'local' : 'remote'

      if (state.mode === 'local') {
        state.dbChoice = await menu('Database for the Board?', [
          'SQLite (default, zero config)',
          'PostgreSQL — enter connection URL'
        ])
        if (state.dbChoice === 1) {
          const pgHost = (await ask('  PostgreSQL Host [localhost]: ')).trim() || 'localhost'
          const pgPort = (await ask('  PostgreSQL Port [5432]: ')).trim() || '5432'
          const pgUser = (await ask('  PostgreSQL User [postgres]: ')).trim() || 'postgres'
          const pgPwd = (await ask('  PostgreSQL Password [password]: ')).trim() || 'password'
          const pgDb = (await ask('  PostgreSQL Database [sethlans_service]: ')).trim() || 'sethlans_service'
          state.dbUrl = `postgresql+psycopg2://${pgUser}:${pgPwd}@${pgHost}:${pgPort}/${pgDb}`
        } else {
          state.dbUrl = null
        }
        state.bringUp = isDockerAvailable() && await confirm('Bring up Sethlans Board on Docker now?', true)
      } else {
        state.boardUrl = (await ask('  Board URL: ')).trim() || state.boardUrl
      }
    },

    async test() {
      if (state.mode === 'local') {
        if (!isDockerAvailable()) {
          console.log('  ! Docker is not installed or not running.')
          return
        }
        console.log('  ✔ Docker is available.')
        if (state.dbUrl) {
          console.log('  Testing connection to PostgreSQL...')
          console.log(isDatabaseAvailable(state.dbUrl) ? '  ✔ PostgreSQL reachable.' : '  ! Could not reach PostgreSQL with these parameters.')
        } else {
          console.log('  ✔ SQLite — no external dependency to test.')
        }
      } else {
        try {
          const res = await fetch(state.boardUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
          console.log(`  ✔ Reachable (HTTP ${res.status}).`)
        } catch (err) {
          console.log(`  ! Could not reach ${state.boardUrl}: ${err.message}`)
        }
      }
    },

    async save() {
      if (state.mode === 'local' && state.bringUp) {
        console.log('\n  Starting Sethlans Board on Docker...')
        try {
          dockerPullAndUp({ dbUrl: state.dbUrl })
          console.log('  ✔ Board started — UI http://localhost:5173, API http://localhost:9955/docs')
        } catch (err) {
          console.log(`  ! Failed to start Docker containers: ${err.message}`)
          console.log('    Run /sethlans-healthcheck to diagnose, or start them manually (see Getting Started).')
        }
      }

      let mcpCmd = `mcp add sethlans-board -s user -e SETHLANS_SERVICE_API_URL=${state.boardUrl}`
      if (state.dbUrl) mcpCmd += ` -e SETHLANS_SERVICE_DB_URL=${state.dbUrl}`
      mcpCmd += ` -- node "${MCP_SERVER_PATH}"`
      console.log(`\n  Registering MCP server: claude ${mcpCmd}`)
      runClaude(mcpCmd)

      config.board = { url: state.boardUrl, dbUrl: state.dbUrl }
    }
  })
}

export async function updateBoard(args) {
  const config = readConfig()
  config.mcps = config.mcps || {}

  console.log('\n')
  console.log('╔══════════════════════════════════╗')
  console.log('║  Sethlans — Update Board Wizard  ║')
  console.log('╚══════════════════════════════════╝')

  await stepBoard(config)

  console.log('\n')
  console.log('╔═══════════════════════════════════╗')
  console.log('║     Board updated                 ║')
  console.log('╚═══════════════════════════════════╝')
  console.log('\n')

  close()
}
