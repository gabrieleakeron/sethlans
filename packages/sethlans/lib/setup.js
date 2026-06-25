// sethlans setup — standalone configuration wizard.
// Each step (Board, ticket MCP, docs MCP, code-quality MCP) can be configured,
// tested, saved, or skipped independently. A final confirmation step writes the
// config to disk and prints a summary.
import { execSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { ask, menu, confirm, close } from './prompts.js'
import { copyPlugin, readConfig, writeConfig } from './copy-plugin.js'
import { TICKET_PROVIDERS, DOCS_PROVIDERS, CODE_QUALITY_PROVIDERS, testProvider } from './mcp-providers.js'
import { isDockerAvailable, isDatabaseAvailable, dockerUp } from './docker.js'
import {
  ensureAgentLsp, ensureSerena, ensurePylsp, ensureTypescriptLanguageServer,
  findJdtls, checkJavaHome, installJdtls, writeGlobalMcpConfig
} from './lsp.js'

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
  const state = {
    boardUrl: 'http://localhost:9955', mode: null, dbUrl: null, bringUp: false, dbChoice: 0,
    cfAccessClientId: null, cfAccessClientSecret: null
  }

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
        const behindAccess = await confirm('  Is the board behind Cloudflare Access (Zero Trust)?', false)
        if (behindAccess) {
          console.log('    Create a Service Token in Zero Trust → Access → Service Auth → Service Tokens.')
          state.cfAccessClientId = (await ask('  Cloudflare Access Client ID: ')).trim() || null
          state.cfAccessClientSecret = (await ask('  Cloudflare Access Client Secret: ')).trim() || null
        } else {
          state.cfAccessClientId = null
          state.cfAccessClientSecret = null
        }
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
        const headers = {}
        if (state.cfAccessClientId && state.cfAccessClientSecret) {
          headers['CF-Access-Client-Id'] = state.cfAccessClientId
          headers['CF-Access-Client-Secret'] = state.cfAccessClientSecret
        }
        try {
          const res = await fetch(state.boardUrl, { method: 'HEAD', headers, signal: AbortSignal.timeout(5000) })
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
          dockerUp({ dbUrl: state.dbUrl })
          console.log('  ✔ Board started — UI http://localhost:5173, API http://localhost:9955/docs')
        } catch (err) {
          console.log(`  ! Failed to start Docker containers: ${err.message}`)
          console.log('    Run /sethlans-healthcheck to diagnose, or start them manually (see Getting Started).')
        }
      }

      let mcpCmd = `mcp add sethlans-board -s user -e SETHLANS_SERVICE_API_URL=${state.boardUrl}`
      if (state.dbUrl) mcpCmd += ` -e SETHLANS_SERVICE_DB_URL=${state.dbUrl}`
      if (state.cfAccessClientId) mcpCmd += ` -e SETHLANS_SERVICE_CF_ACCESS_CLIENT_ID=${state.cfAccessClientId}`
      if (state.cfAccessClientSecret) mcpCmd += ` -e SETHLANS_SERVICE_CF_ACCESS_CLIENT_SECRET=${state.cfAccessClientSecret}`
      mcpCmd += ` -- node "${MCP_SERVER_PATH}"`
      console.log(`\n  Registering MCP server: claude ${mcpCmd}`)
      runClaude(mcpCmd)

      config.board = {
        url: state.boardUrl, dbUrl: state.dbUrl,
        cfAccessClientId: state.cfAccessClientId || undefined,
        cfAccessClientSecret: state.cfAccessClientSecret || undefined
      }
    }
  })
}

/**
 * Shared driver for the ticket / docs / code-quality MCP steps — structurally
 * identical: pick a provider, collect its env vars, test, save (register +
 * record in config.mcps[categoryKey]), or skip.
 */
async function stepMcpCategory(title, providers, config, categoryKey, { reuseCategoryKey } = {}) {
  const state = { provider: null, envVars: {}, reused: false }

  return runStep(title, {
    isConfigured: () => state.provider !== null,

    async configure() {
      const choice = await menu(`MCP for ${categoryKey}?`, providers.map(p =>
        (reuseCategoryKey && p.reusesTicket && p.reusesTicket === config.mcps?.[reuseCategoryKey])
          ? `${p.label} ✔ already configured`
          : p.label
      ))
      state.provider = providers[choice]
      state.reused = !!(reuseCategoryKey && state.provider.reusesTicket && state.provider.reusesTicket === config.mcps?.[reuseCategoryKey])
      state.envVars = state.reused ? {} : await collectEnvVars(state.provider.envVars || [])
    },

    async test() {
      if (state.reused) {
        console.log('  ✔ Reuses an already-configured MCP server — nothing new to test.')
        return
      }
      const result = await testProvider(state.provider, state.envVars)
      console.log(result.ok ? `  ✔ ${result.message}` : `  ! ${result.message}`)
    },

    async save() {
      config.mcps = config.mcps || {}
      if (state.reused) {
        console.log('  Already registered — reusing existing MCP.')
      } else {
        runClaude(buildMcpAddCommand(state.provider, state.envVars))
      }
      config.mcps[categoryKey] = state.provider.id
    }
  })
}

/**
 * Step 5 — Code intelligence (LSP). `agent-lsp` is a multiplexer: it needs a
 * real backend resolvable per language (jdtls/typescript-language-server/pylsp).
 * Full installs all three; Custom lets the user pick. Java additionally asks
 * for an existing JDK 21 (validated) or offers to download jdtls into our own
 * managed directory — never touches the system PATH.
 */
async function stepLsp(config) {
  const state = { languages: null, javaHome: null, jdtlsPath: null }

  return runStep('Step 5 — Code intelligence (LSP)', {
    isConfigured: () => state.languages !== null,

    async configure() {
      const modeChoice = await menu('Install LSP backends for agent-lsp?', [
        'Full (Python + TypeScript + Java)',
        'Custom — choose per language'
      ])

      if (modeChoice === 0) {
        state.languages = { python: true, typescript: true, java: true }
      } else {
        state.languages = {
          python: await confirm('Install Python LSP (pylsp)?', true),
          typescript: await confirm('Install TypeScript LSP (typescript-language-server)?', true),
          java: await confirm('Install Java LSP (jdtls)?', false)
        }
      }

      if (state.languages.java) {
        const existing = (await ask('  Existing JDK 21 home (JAVA_HOME), leave empty to download jdtls without one: ')).trim()
        if (existing) {
          const check = checkJavaHome(existing)
          if (check.ok) {
            state.javaHome = existing
            console.log('  ✔ JDK 21 confirmed at this path.')
          } else {
            console.log(`  ! Could not confirm a JDK 21 at this path (got: ${check.version || 'no output'}). Continuing without JAVA_HOME — jdtls's own launcher may still find a JDK on PATH.`)
          }
        }
      }
    },

    async test() {
      const selected = Object.entries(state.languages).filter(([, v]) => v).map(([k]) => k)
      console.log(`  Selected: ${selected.join(', ') || 'none'}.`)
      console.log('  Run "Save & continue" to install/verify the selected backends.')
    },

    async save() {
      const langCommands = {}

      if (state.languages.python) {
        const r = ensurePylsp()
        console.log(`  ${r.state === 'warning' ? '!' : '✔'} pylsp: ${r.state}${r.detail ? ` — ${r.detail}` : ''}`)
      }
      if (state.languages.typescript) {
        const r = ensureTypescriptLanguageServer()
        console.log(`  ${r.state === 'warning' ? '!' : '✔'} typescript-language-server: ${r.state}${r.detail ? ` — ${r.detail}` : ''}`)
      }
      if (state.languages.java) {
        let jdtls = findJdtls()
        if (!jdtls) {
          console.log('  jdtls not found — downloading into ~/.claude/tools/jdtls ...')
          jdtls = await installJdtls(state.javaHome)
        }
        if (jdtls) {
          state.jdtlsPath = jdtls
          console.log(`  ✔ jdtls: ${jdtls}`)
        } else {
          console.log('  ! jdtls installation failed — Java support will be skipped in agent-lsp. See manual steps: https://github.com/eclipse-jdtls/eclipse.jdt.ls')
        }
        if (jdtls && jdtls !== 'jdtls') langCommands.java = jdtls
      }

      // agent-lsp / serena themselves (the actual MCP servers, not their backends)
      for (const r of [ensureAgentLsp(), ensureSerena()]) {
        console.log(`  ${r.state === 'warning' ? '!' : '✔'} ${r.item}: ${r.state}${r.detail ? ` — ${r.detail}` : ''}`)
      }

      writeGlobalMcpConfig({ langCommands, javaHome: state.javaHome })
      config.lsp = {
        languages: state.languages,
        javaHome: state.javaHome || undefined,
        jdtlsPath: state.jdtlsPath || undefined
      }
      console.log('  ✔ ~/.claude/.mcp.json updated.')
    }
  })
}

async function stepConfirm(config) {
  console.log('\n── Final step — Confirm & save ──')
  console.log(`  Board: ${config.board ? config.board.url : 'not configured'}`)
  console.log(`  Ticket MCP: ${config.mcps?.ticket || 'not configured'}`)
  console.log(`  Docs MCP: ${config.mcps?.docs || 'not configured'}`)
  console.log(`  Code quality MCP: ${config.mcps?.codeQuality || 'not configured'}`)
  console.log(`  LSP languages: ${config.lsp?.languages ? Object.entries(config.lsp.languages).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none' : 'not configured'}`)

  const ok = await confirm('Save this configuration?', true)
  if (ok) writeConfig(config)
  return ok
}

export async function setup(args) {
  const isUpdate = args.includes('--update')
  const config = readConfig()
  config.mcps = config.mcps || {}

  console.log('\n')
  console.log('╔═══════════════════════════════════╗')
  console.log('║  Sethlans — Configuration Wizard  ║')
  console.log('╚═══════════════════════════════════╝')

  let copyPluginConfirm = await confirm('Install claude plugin files?', true)
  if (!copyPluginConfirm) { close(); process.exit(1) }

  console.log('\nCopying plugin files into ~/.claude/ ...')
  const ok = await copyPlugin(isUpdate)
  if (!ok) { close(); process.exit(1) }

  await stepBoard(config)
  await stepMcpCategory('Step 2 — Ticket management MCP', TICKET_PROVIDERS, config, 'ticket')
  await stepMcpCategory('Step 3 — Document management MCP', DOCS_PROVIDERS, config, 'docs', { reuseCategoryKey: 'ticket' })
  await stepMcpCategory('Step 4 — Code quality MCP', CODE_QUALITY_PROVIDERS, config, 'codeQuality')
  await stepLsp(config)

  let saved = false
  while (!saved) {
    saved = await stepConfirm(config)
    if (!saved) {
      const retry = await confirm('Re-run the wizard from the start instead?', true)
      if (retry) return setup(args)
      console.log('  Configuration discarded.')
      break
    }
  }

  console.log('\n')
  console.log('╔═══════════════════════════════════╗')
  console.log('║     Setup complete                ║')
  console.log('╚═══════════════════════════════════╝')
  console.log('\n')
  console.log(`Restart Claude Code, then:`)
  console.log(`  /sethlans-onboard   ← configure the current project`)
  console.log(`  /sethlans <request> ← start the workflow\n`)

  close()
}
