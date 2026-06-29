// sethlans setup — standalone configuration wizard.
// Bootstraps the machine-wide capabilities: plugin files, the local Sethlans
// Board (SQLite/PostgreSQL) + its MCP, code intelligence (LSP), and — optionally
// — the GLOBAL half of the integration MCPs (tickets/docs/code-quality): pick a
// provider, store its token in an env var, and register the server `-s user`.
// Each step can be configured, tested, saved, or skipped independently; a final
// confirmation step writes the config to disk and prints a summary.
//
// The PER-PROJECT half of the integrations (which Jira key / repo / Confluence
// space / Codacy project to act on) is intentionally NOT handled here — it is
// recorded by /sethlans-onboard into .claude/project-profile.yaml, since this
// wizard has no notion of "the current project". See sethlans-onboard.md §0-C.
import { execSync } from 'child_process'
import https from 'node:https'
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

// Best-effort, output-swallowing `claude` call — used to drop a stale server
// entry before re-registering, so re-running the wizard stays idempotent.
function runClaudeQuiet(args) {
  try { execSync(`claude ${args}`, { stdio: 'ignore' }); return true } catch { return false }
}

// Best-effort token probe (never throws). Hits the GitHub REST API with the
// resolved token to confirm it's valid — catches expired/under-scoped PATs that
// a mere "env var is visible" check would wave through.
function probeGithub(token) {
  return new Promise(resolve => {
    const req = https.request({
      host: 'api.github.com', path: '/user', method: 'GET',
      headers: { 'User-Agent': 'sethlans-setup', Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    }, res => {
      let body = ''
      res.on('data', d => { body += d })
      res.on('end', () => {
        if (res.statusCode === 200) {
          let login = ''
          try { login = JSON.parse(body).login } catch {}
          resolve({ ok: true, detail: login ? `authenticated as ${login}` : 'authenticated' })
        } else {
          resolve({ ok: false, detail: `GitHub returned HTTP ${res.statusCode} (token invalid or under-scoped)` })
        }
      })
    })
    req.on('error', e => resolve({ ok: false, detail: e.message }))
    req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false, detail: 'timeout reaching api.github.com' }) })
    req.end()
  })
}

// ── Integration MCP catalog (tickets · docs · code quality) ──────────────────
// The golden rule (see code-quality-protocol.md): a token is NEVER written into
// a config file. The user stores it in an environment variable (setx/export) and
// we register the server with the literal ${VAR} placeholder, which Claude Code
// resolves at launch. Only non-secret bits (URL, email) are passed inline.
const INTEGRATION_SLOTS = [
  { key: 'ticket', title: 'Tickets', providers: ['github', 'atlassian', 'linear'] },
  { key: 'docs', title: 'Docs', providers: ['atlassian', 'notion', 'github-wiki'] },
  { key: 'codeQuality', title: 'Code quality', providers: ['codacy', 'codescene', 'sonarqube'] }
]

const PROVIDERS = {
  // The user stores a plain GITHUB_TOKEN (the de-facto standard, often already
  // set for git/gh), but the official server reads GITHUB_PERSONAL_ACCESS_TOKEN,
  // so we map one to the other via `mcpEnv`. Official image (the old
  // @modelcontextprotocol/server-github is archived).
  github: { server: 'github', env: 'GITHUB_TOKEN', mcpEnv: 'GITHUB_PERSONAL_ACCESS_TOKEN',
    tokenHint: 'github.com → Settings → Developer settings → Personal access tokens → Fine-grained → Generate. On the target repos grant: Contents (Read-only), Pull requests (Read/Write), Issues (Read/Write), Metadata (Read-only)',
    inline: [], probe: probeGithub,
    pkg: ['docker', 'run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'] },
  atlassian: { server: 'atlassian', env: 'ATLASSIAN_API_TOKEN',
    tokenHint: 'id.atlassian.com → Security → API tokens → Create',
    inline: [{ flag: 'ATLASSIAN_BASE_URL', q: 'Atlassian base URL (e.g. https://your.atlassian.net): ' },
             { flag: 'ATLASSIAN_EMAIL', q: 'Atlassian account email: ' }],
    pkg: ['npx', '-y', '@atlassian/mcp@latest'] },
  linear: { server: 'linear', env: 'LINEAR_API_KEY',
    tokenHint: 'linear.app → Settings → Security & access → Personal API keys → New key',
    inline: [], pkg: ['npx', '-y', '@linear/mcp@latest'] },
  notion: { server: 'notion', env: 'NOTION_API_TOKEN',
    tokenHint: 'notion.so/my-integrations → New integration → copy the secret',
    inline: [], pkg: ['npx', '-y', '@modelcontextprotocol/server-notion@latest'] },
  'github-wiki': { server: null, env: null,
    note: 'github-wiki has no global server or token — it is a per-project reference. Run /sethlans-onboard to record the wiki repo URL.' },
  codacy: { server: 'codacy', env: 'CODACY_ACCOUNT_TOKEN',
    tokenHint: 'Codacy → Account → Access Management → Create API token',
    inline: [], pkg: ['npx', '-y', '@codacy/codacy-mcp@latest'] },
  codescene: { server: 'codescene', env: 'CS_ACCESS_TOKEN',
    tokenHint: 'CodeScene Cloud → codescene.io/users/me/pat · on-prem → https://<your-cs-host>/configuration/user/token',
    inline: [{ flag: 'CS_ONPREM_URL', q: 'CodeScene on-prem URL (leave empty for CodeScene Cloud): ' }],
    pkg: ['docker', 'run', '-i', '--rm', '-e', 'CS_ONPREM_URL', '-e', 'CS_ACCESS_TOKEN', 'codescene/codescene-mcp'] },
  sonarqube: { server: 'sonarqube', env: 'SONARQUBE_TOKEN',
    tokenHint: 'Sonar → My Account → Security → Generate Tokens',
    inline: [{ flag: 'SONARQUBE_URL', q: 'SonarQube/SonarCloud URL: ' }],
    pkg: ['<sonar-mcp-launch-command>'] }
}

// The value Claude Code must STORE is the literal "${VAR}". On POSIX sh we
// single-quote it so the shell doesn't expand it at registration time; on
// Windows cmd.exe ${VAR} isn't a variable syntax, so it passes through bare.
function envPlaceholder(varName) {
  return process.platform === 'win32' ? `\${${varName}}` : `'\${${varName}}'`
}

// Walk one provider through: create token → store as env var → register server.
async function wireProvider(providerKey, slotKey, config) {
  const p = PROVIDERS[providerKey]
  if (!p) return
  if (!p.server) { console.log(`  ${p.note}`); return }

  console.log(`\n  ${providerKey}:`)
  console.log(`  1. Create the token:  ${p.tokenHint}`)
  const setCmd = process.platform === 'win32'
    ? `setx ${p.env} "<token>"`
    : `export ${p.env}="<token>"   # then add this line to ~/.zshrc or ~/.bashrc`
  console.log(`  2. Store it in an environment variable, then open a NEW terminal:`)
  console.log(`        ${setCmd}`)
  const ready = await confirm(`     Done — is ${p.env} set?`, false)
  if (!ready) {
    console.log(`     Skipped ${providerKey} — set ${p.env} and re-run "sethlans setup --update" later.`)
    return
  }
  if (process.env[p.env]) {
    if (p.probe) {
      const r = await p.probe(process.env[p.env])
      console.log(r.ok ? `     ✔ Token works — ${r.detail}.` : `     ! Token check failed — ${r.detail}. Registering anyway; fix the token and re-run later.`)
    }
  } else {
    console.log(`     ! ${p.env} isn't visible in this shell yet (setx/export only affects new processes).`)
    console.log(`       Registering anyway — it resolves once you restart Claude Code + terminal.`)
  }

  const inlineArgs = []
  for (const item of (p.inline || [])) {
    const v = (await ask(`     ${item.q}`)).trim()
    if (v) inlineArgs.push(`-e ${item.flag}=${v}`)
  }

  // The env var the user stores (p.env) may differ from the one the MCP reads
  // (p.mcpEnv) — e.g. GITHUB_TOKEN → GITHUB_PERSONAL_ACCESS_TOKEN. The -e flag
  // carries the MCP-expected name; its value is the ${user-var} placeholder.
  const mcpEnv = p.mcpEnv || p.env
  const cmd = `mcp add ${p.server} -s user ${inlineArgs.join(' ')} -e ${mcpEnv}=${envPlaceholder(p.env)} -- ${p.pkg.join(' ')}`.replace(/\s+/g, ' ').trim()
  if (p.pkg.some(a => a.includes('<'))) {
    console.log(`     ${providerKey}'s launch command is vendor-specific — see code-quality-protocol.md.`)
    console.log(`     Once you know it, run:  claude ${cmd}`)
    config.mcps[slotKey] = providerKey
    return
  }
  // Drop any prior user-scope entry so re-running the wizard doesn't duplicate
  // or clash with a stale registration.
  runClaudeQuiet(`mcp remove ${p.server} -s user`)
  console.log(`     Registering: claude ${cmd}`)
  runClaude(cmd)
  config.mcps[slotKey] = providerKey
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

/**
 * Step 3 — Integrations (global half). Per slot (tickets/docs/code-quality):
 * pick a provider, walk the user through creating a token and storing it in an
 * env var (setx/export), then register the server `-s user` with a ${VAR}
 * placeholder — the secret never touches a config file. The per-project
 * reference is recorded later by /sethlans-onboard.
 */
async function stepIntegrations(config) {
  config.mcps = config.mcps || {}

  return runStep('Step 3 — Integrations (tickets · docs · code quality, global)', {
    isConfigured: () => Object.keys(config.mcps).length > 0,

    async configure() {
      console.log('  Optional MCP servers used by the subagents (PO, architect, reviewer).')
      console.log('  Secrets stay in environment variables — never written to a config file.')
      console.log('  The per-project reference (Jira key, repo, CQ project) is recorded later by /sethlans-onboard.')
      for (const slot of INTEGRATION_SLOTS) {
        const opts = [...slot.providers, 'Skip this slot']
        const choice = await menu(`${slot.title} — which provider?`, opts)
        if (choice === opts.length - 1) continue
        await wireProvider(slot.providers[choice], slot.key, config)
      }
    },

    async test() {
      const entries = Object.entries(config.mcps)
      if (!entries.length) { console.log('  No integration providers selected.'); return }
      for (const [slot, prov] of entries) {
        const p = PROVIDERS[prov]
        const env = p?.env
        if (!env) { console.log(`  ${slot}: ${prov} — no token (non-MCP)`); continue }
        if (!process.env[env]) { console.log(`  ${slot}: ${prov} — ${env} NOT visible yet — restart your terminal`); continue }
        if (p.probe) {
          const r = await p.probe(process.env[env])
          console.log(`  ${slot}: ${prov} — ${r.ok ? `✔ ${r.detail}` : `! ${r.detail}`}`)
        } else {
          console.log(`  ${slot}: ${prov} — ${env} visible (not probed)`)
        }
      }
    },

    async save() {
      const entries = Object.entries(config.mcps)
      console.log(entries.length
        ? `  ✔ Providers recorded: ${entries.map(([s, p]) => `${s}:${p}`).join(', ')}. Restart Claude Code + terminal so tokens resolve.`
        : '  No integration providers — wire them later via /sethlans-onboard.')
    }
  })
}

async function stepConfirm(config) {
  console.log('\n── Final step — Confirm & save ──')
  console.log(`  Board: ${config.board ? `${config.board.url} (${config.board.dbUrl ? 'PostgreSQL' : 'SQLite'})` : 'not configured'}`)
  console.log(`  LSP languages: ${config.lsp?.languages ? Object.entries(config.lsp.languages).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none' : 'not configured'}`)
  console.log(`  Integrations: ${config.mcps && Object.keys(config.mcps).length ? Object.entries(config.mcps).map(([s, p]) => `${s}:${p}`).join(', ') : 'none'} (global servers; per-project refs via /sethlans-onboard)`)

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
  await stepIntegrations(config)

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
