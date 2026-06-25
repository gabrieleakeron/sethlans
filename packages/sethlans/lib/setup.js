// sethlans setup — standalone configuration wizard.
// Bootstraps the machine-wide capabilities only: plugin files, the local
// Sethlans Board (SQLite/PostgreSQL) + its MCP, and code intelligence (LSP).
// Each step can be configured, tested, saved, or skipped independently; a final
// confirmation step writes the config to disk and prints a summary.
//
// Integration MCPs (tickets/docs/code-quality) are intentionally NOT handled
// here: they are wired globally on demand by /sethlans-onboard (always at user
// scope, one token per provider), and each project keeps only the references
// (Jira key, Confluence space, Codacy/CodeScene project) in
// .claude/project-profile.yaml. See sethlans-onboard.md §0-C.
import { execSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { ask, menu, confirm, close } from './prompts.js'
import { copyPlugin, readConfig, writeConfig } from './copy-plugin.js'
import { isDockerAvailable, isDatabaseAvailable, dockerUp } from './docker.js'
import { uninstall } from './uninstall.js'
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
  const state = { boardUrl: 'http://localhost:9955', dbUrl: null, bringUp: false, dbChoice: 0, configured: false }

  return runStep('Step 1 — Sethlans Board (local: Docker + DB + MCP)', {
    isConfigured: () => state.configured,

    async configure() {
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
      state.configured = true
    },

    async test() {
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
    },

    async save() {
      if (state.bringUp) {
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
      mcpCmd += ` -- node "${MCP_SERVER_PATH}"`
      console.log(`\n  Registering MCP server: claude ${mcpCmd}`)
      runClaude(mcpCmd)

      config.board = { mode: 'local', url: state.boardUrl, dbUrl: state.dbUrl }
    }
  })
}

/**
 * Step 2 — Code intelligence (LSP). `agent-lsp` is a multiplexer: it needs a
 * real backend resolvable per language (jdtls/typescript-language-server/pylsp).
 * Full installs all three; Custom lets the user pick. Java additionally asks
 * for an existing JDK 21 (validated) or offers to download jdtls into our own
 * managed directory — never touches the system PATH.
 */
async function stepLsp(config) {
  const state = { languages: null, javaHome: null, jdtlsPath: null }

  return runStep('Step 2 — Code intelligence (LSP)', {
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
  console.log(`  Board: ${config.board ? `${config.board.url} (${config.board.dbUrl ? 'PostgreSQL' : 'SQLite'})` : 'not configured'}`)
  console.log(`  LSP languages: ${config.lsp?.languages ? Object.entries(config.lsp.languages).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none' : 'not configured'}`)
  console.log(`  Integration MCPs (tickets/docs/code-quality): wired per project by /sethlans-onboard`)

  const ok = await confirm('Save this configuration?', true)
  if (ok) writeConfig(config)
  return ok
}

export async function setup(args) {
  const isUpdate = args.includes('--update')
  const config = readConfig()

  console.log('\n')
  console.log('╔═══════════════════════════════════╗')
  console.log('║  Sethlans — Configuration Wizard  ║')
  console.log('╚═══════════════════════════════════╝')

  // On a fresh run (not --update) offer uninstall as a top-level alternative.
  if (!isUpdate) {
    const action = await menu('What do you want to do?', [
      'Install / update Sethlans',
      'Uninstall Sethlans (keeps the board database)'
    ])
    if (action === 1) {
      // uninstall() is interactive and calls close() itself.
      await uninstall()
      return
    }
  }

  let copyPluginConfirm = await confirm('Install claude plugin files?', true)
  if (!copyPluginConfirm) { close(); process.exit(1) }

  console.log('\nCopying plugin files into ~/.claude/ ...')
  const ok = await copyPlugin(isUpdate)
  if (!ok) { close(); process.exit(1) }

  await stepBoard(config)
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
