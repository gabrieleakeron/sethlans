// Code-intelligence (LSP) installers shared by `scripts/postinstall.js` (automatic,
// non-interactive, best-effort) and `lib/setup.js` (interactive, Full/Custom).
//
// `agent-lsp` is a multiplexer MCP server, not a language server itself: it spawns
// the real per-language backend (jdtls, typescript-language-server, pylsp) as a
// subprocess based on file extension. Each backend must therefore be resolvable —
// either on PATH, or as an absolute path baked into the `agent-lsp` args.
import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream, readdirSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import { execSync } from 'child_process'

export const CLAUDE_HOME = join(homedir(), '.claude')
export const MCP_PATH = join(CLAUDE_HOME, '.mcp.json')
export const TOOLS_HOME = join(CLAUDE_HOME, 'tools')
export const JDTLS_HOME = join(TOOLS_HOME, 'jdtls')
export const JDTLS_DATA_HOME = join(TOOLS_HOME, 'jdtls-data')
export const JDTLS_URL = 'https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz'

/**
 * Genera il launcher `jdtls`/`jdtls.cmd` dentro `${jdtlsHome}/bin`.
 *
 * L'archivio ufficiale di Eclipse JDT LS (scaricato da `installJdtls`) NON
 * contiene un launcher eseguibile: contiene solo `plugins/` (con il jar
 * dell'Equinox launcher), `config_win/`, `config_linux/`, `config_mac/`. Va
 * costruito a mano il comando java che lo avvia — esattamente quello che fa
 * `install-jdtls-launcher.ps1` a mano sui sistemi Windows. Senza questo step
 * `findJdtls()` non troverà mai un launcher utilizzabile dopo il download.
 */
function buildJdtlsLauncher(jdtlsHome, javaHome) {
  const pluginsDir = join(jdtlsHome, 'plugins')
  const launcherJar = readdirSync(pluginsDir)
    .filter(f => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(f))
    .sort()
    .pop()
  if (!launcherJar) throw new Error(`launcher Equinox non trovato in ${pluginsDir}`)

  const configDirName = process.platform === 'win32' ? 'config_win'
    : process.platform === 'darwin' ? 'config_mac' : 'config_linux'
  const configDir = join(jdtlsHome, configDirName)
  if (!existsSync(configDir)) throw new Error(`config dir non trovata: ${configDir}`)

  const binDir = join(jdtlsHome, 'bin')
  mkdirSync(binDir, { recursive: true })
  mkdirSync(JDTLS_DATA_HOME, { recursive: true })

  const launcherJarPath = join(pluginsDir, launcherJar)
  const javaArgs = [
    '-Declipse.application=org.eclipse.jdt.ls.core.id1',
    '-Dosgi.bundles.defaultStartLevel=4',
    '-Declipse.product=org.eclipse.jdt.ls.core.product',
    '-Dlog.level=ALL', '-Xmx1G',
    '--add-modules=ALL-SYSTEM',
    '--add-opens java.base/java.util=ALL-UNNAMED',
    '--add-opens java.base/java.lang=ALL-UNNAMED'
  ]

  if (process.platform === 'win32') {
    const launcherPath = join(binDir, 'jdtls.cmd')
    const javaExe = javaHome ? `"${join(javaHome, 'bin', 'java.exe')}"` : 'java.exe'
    const setJavaHome = javaHome ? `set "JAVA_HOME=${javaHome}"\r\n` : ''
    const script = `@echo off\r\n${setJavaHome}${javaExe} ^\r\n ${javaArgs.join(' ^\r\n ')} ^\r\n -jar "${launcherJarPath}" ^\r\n -configuration "${configDir}" ^\r\n -data "${JDTLS_DATA_HOME}" %*\r\n`
    writeFileSync(launcherPath, script, { encoding: 'utf8' })
    return launcherPath
  }

  const launcherPath = join(binDir, 'jdtls')
  const javaExe = javaHome ? `"${join(javaHome, 'bin', 'java')}"` : 'java'
  const setJavaHome = javaHome ? `export JAVA_HOME="${javaHome}"\n` : ''
  const script = `#!/usr/bin/env bash\n${setJavaHome}exec ${javaExe} \\\n ${javaArgs.join(' \\\n ')} \\\n -jar "${launcherJarPath}" \\\n -configuration "${configDir}" \\\n -data "${JDTLS_DATA_HOME}" "$@"\n`
  writeFileSync(launcherPath, script, { encoding: 'utf8' })
  chmodSync(launcherPath, 0o755)
  return launcherPath
}

export function commandExists(cmd) {
  try {
    if (process.platform === 'win32') {
      execSync(`where ${cmd}`, { stdio: 'ignore' })
    } else {
      execSync(`command -v ${cmd} || which ${cmd}`, { stdio: 'ignore', shell: '/bin/sh' })
    }
    return true
  } catch {
    return false
  }
}

export function runSafe(cmd, opts = {}) {
  try {
    execSync(cmd, { stdio: 'inherit', ...opts })
    return true
  } catch {
    console.warn(`  ! comando fallito: ${cmd}`)
    return false
  }
}

export function ensureAgentLsp() {
  if (commandExists('agent-lsp')) return { item: 'agent-lsp', state: 'present' }
  console.log('agent-lsp non trovato, installo @blackwell-systems/agent-lsp...')
  const ok = runSafe('npm i -g @blackwell-systems/agent-lsp')
  return { item: 'agent-lsp', state: ok ? 'installed' : 'warning',
    detail: ok ? undefined : 'installazione fallita: esegui manualmente `npm i -g @blackwell-systems/agent-lsp`' }
}

export function ensureSerena() {
  if (commandExists('serena')) return { item: 'serena', state: 'present' }
  if (!commandExists('uv')) {
    return { item: 'serena', state: 'skipped',
      detail: 'uv non trovato: installa uv (https://docs.astral.sh/uv/) e poi ri-esegui `node <sethlans>/scripts/postinstall.js`' }
  }
  console.log('serena non trovato, installo serena-agent via uv...')
  const ok = runSafe('uv tool install -p 3.13 serena-agent')
  if (ok) runSafe('uv tool update-shell')
  return { item: 'serena', state: ok ? 'installed' : 'warning',
    detail: ok ? undefined : 'installazione fallita: esegui manualmente `uv tool install -p 3.13 serena-agent`' }
}

export function ensurePylsp() {
  if (commandExists('pylsp')) return { item: 'pylsp', state: 'present' }
  // Preferito: `uv tool install` mette pylsp in una bin-dir gestita e stabile
  // (vedi `uv tool dir`), a differenza di `pip install` che su Windows finisce
  // spesso in una directory non sul PATH.
  if (commandExists('uv')) {
    console.log('pylsp non trovato, installo python-lsp-server via uv tool...')
    if (runSafe('uv tool install --force python-lsp-server')) {
      runSafe('uv tool update-shell')
      return { item: 'pylsp', state: 'installed' }
    }
  }
  console.log('pylsp non trovato, installo python-lsp-server via pip...')
  const candidates = ['pip install python-lsp-server', 'python -m pip install python-lsp-server', 'pip3 install python-lsp-server']
  let ok = false
  for (const cmd of candidates) {
    if (runSafe(cmd)) { ok = true; break }
  }
  return { item: 'pylsp', state: ok ? 'installed' : 'warning',
    detail: ok ? undefined : 'installazione fallita: esegui manualmente `uv tool install python-lsp-server` (preferito) o `pip install python-lsp-server`' }
}

export function ensureTypescriptLanguageServer() {
  if (commandExists('typescript-language-server')) return { item: 'typescript-language-server', state: 'present' }
  console.log('typescript-language-server non trovato, installo typescript + typescript-language-server...')
  const ok = runSafe('npm i -g typescript typescript-language-server')
  return { item: 'typescript-language-server', state: ok ? 'installed' : 'warning',
    detail: ok ? undefined : 'installazione fallita: esegui manualmente `npm i -g typescript typescript-language-server`' }
}

/**
 * Best-effort detection of a usable JDK 21 at `javaHome` (or on PATH if omitted).
 * Returns { ok, version } — `version` is the raw `java -version` stderr output.
 */
export function checkJavaHome(javaHome) {
  const javaBin = javaHome
    ? join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java'
  try {
    const out = execSync(`"${javaBin}" -version`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
      || execSync(`"${javaBin}" -version 2>&1`, { stdio: ['ignore', 'pipe', 'ignore'], shell: true }).toString()
    return { ok: /"21\./.test(out) || /version "21/.test(out), version: out.trim() }
  } catch (err) {
    // `java -version` writes to stderr; execSync above with shell:true 2>&1 covers most
    // platforms, but fall back to inspecting the error's own stderr capture.
    const out = (err.stderr || err.stdout || '').toString()
    return { ok: /"21\./.test(out) || /version "21/.test(out), version: out.trim() || null }
  }
}

/**
 * Detect whether `jdtls` is already resolvable, either on PATH or in our own
 * managed install directory (~/.claude/tools/jdtls).
 * Returns the absolute launcher path if found in the managed dir, or `'jdtls'`
 * if found on PATH, or `null` if not found at all.
 */
export function findJdtls() {
  if (commandExists('jdtls')) return 'jdtls'
  const launcher = join(JDTLS_HOME, 'bin', process.platform === 'win32' ? 'jdtls.cmd' : 'jdtls')
  return existsSync(launcher) ? launcher : null
}

/**
 * Download and extract the Eclipse JDT Language Server into our own managed
 * directory (~/.claude/tools/jdtls), never touching the system PATH. Requires
 * `tar` on PATH (bundled with Windows 10+, macOS, and virtually every Linux).
 * Returns the absolute path to the `jdtls`/`jdtls.cmd` launcher, or null on failure.
 */
export async function installJdtls(javaHome) {
  if (!commandExists('tar')) {
    console.warn('  ! `tar` non trovato sul PATH: impossibile estrarre jdtls automaticamente.')
    return null
  }
  // Se non passato esplicitamente, prova a riusare un JAVA_HOME di sistema
  // già valido (JDK 21) per "imbustarlo" nel launcher generato.
  const resolvedJavaHome = javaHome || (process.env.JAVA_HOME && checkJavaHome(process.env.JAVA_HOME).ok ? process.env.JAVA_HOME : undefined)
  try {
    mkdirSync(JDTLS_HOME, { recursive: true })
    const archivePath = join(tmpdir(), `jdtls-${Date.now()}.tar.gz`)
    console.log(`  Scarico jdtls da ${JDTLS_URL} ...`)
    const res = await fetch(JDTLS_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await new Promise((resolve, reject) => {
      const out = createWriteStream(archivePath)
      res.body.pipeTo(new WritableStream({
        write(chunk) { out.write(chunk) },
        close() { out.end(); resolve() },
        abort(err) { reject(err) }
      })).catch(reject)
    })
    console.log(`  Estraggo in ${JDTLS_HOME} ...`)
    execSync(`tar -xzf "${archivePath}" -C "${JDTLS_HOME}"`, { stdio: 'inherit' })
    // L'archivio ufficiale non contiene un launcher eseguibile: lo generiamo noi.
    console.log('  Genero il launcher jdtls...')
    const launcher = buildJdtlsLauncher(JDTLS_HOME, resolvedJavaHome)
    return launcher
  } catch (err) {
    console.warn(`  ! installazione jdtls fallita: ${err?.message ?? err}`)
    return null
  }
}

/**
 * Merge the agent-lsp / serena entries into the global ~/.claude/.mcp.json,
 * preserving every other key already there (e.g. sethlans-board, configured
 * separately by `sethlans setup`).
 *
 * `langCommands` lets callers override individual `agent-lsp` per-language
 * commands with an absolute path (e.g. a jdtls launcher we just installed
 * ourselves) instead of the bare command name resolved from PATH.
 * `javaHome` — if set, written as `env.JAVA_HOME` on the agent-lsp entry so
 * jdtls's own launcher script (which reads JAVA_HOME) finds the right JDK
 * without requiring a system-wide environment variable.
 */
export function writeGlobalMcpConfig({ langCommands = {}, javaHome } = {}) {
  mkdirSync(CLAUDE_HOME, { recursive: true })

  let config = {}
  if (existsSync(MCP_PATH)) {
    try {
      config = JSON.parse(readFileSync(MCP_PATH, 'utf8'))
    } catch {
      console.warn(`  ! ${MCP_PATH} esistente ma non è JSON valido, verrà ricreato.`)
      config = {}
    }
  }
  if (typeof config !== 'object' || config === null) config = {}
  config.mcpServers ??= {}

  const java = langCommands.java || 'jdtls'
  const typescript = langCommands.typescript || 'typescript-language-server,--stdio'
  const python = langCommands.python || 'pylsp'

  const agentLspEntry = {
    type: 'stdio',
    command: 'agent-lsp',
    args: [`java:${java}`, `typescript:${typescript}`, `python:${python}`]
  }
  if (javaHome) agentLspEntry.env = { ...(config.mcpServers['agent-lsp']?.env), JAVA_HOME: javaHome }

  config.mcpServers['agent-lsp'] = agentLspEntry
  config.mcpServers['serena'] = {
    command: 'serena',
    args: ['start-mcp-server', '--context=claude-desktop']
  }

  writeFileSync(MCP_PATH, JSON.stringify(config, null, 2))
  return MCP_PATH
}
