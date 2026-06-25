// sethlans preview init — bundla il preview della board nel repo utente e scrive/aggiorna
// in modo idempotente .claude/launch.json, così Claude Preview lo lancia senza step manuali.
// Decisioni vincolanti: epica e9e6fa7b4 "## Architettura target — matrice delle 3 modalità"
// e story sa8aa4fec (preview-launch-packaging).
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, appendFileSync } from 'fs'
import { resolve, join, relative, sep } from 'path'
import { homedir } from 'os'
import { ask, menu, confirm, close } from './prompts.js'

const PREVIEW_ENTRY_NAME = 'sethlans-board-preview'
const LOCAL_DEFAULT_UPSTREAM = 'http://localhost:9955'
const LOCAL_DEFAULT_WEB_URL = 'http://localhost:5173'
const LOCAL_DEFAULT_PORT = 9966
const REMOTE_DEFAULT_UPSTREAM = 'https://board-api.sethlans-ai.com'
const REMOTE_DEFAULT_WEB_URL = 'https://board.sethlans-ai.com'
const REMOTE_DEFAULT_PORT = 9966
const EMBEDDED_DEFAULT_PORT = 9955

const EXCLUDED_DIRS = new Set(['node_modules', 'data'])
const UNC_PREFIX = '\\\\?\\'

function stripUncPrefix(p) {
  return p.startsWith(UNC_PREFIX) ? p.slice(UNC_PREFIX.length) : p
}

/**
 * Risolve la cartella sorgente dell'artefatto preview, stesso pattern
 * `findPluginRoot` di copy-plugin.js: priorità al bundle pack-time
 * (board-preview/ dentro questo package), fallback al sibling nel monorepo
 * (dev senza prepack).
 */
function findPreviewRoot() {
  const candidates = [
    resolve(import.meta.dirname, '../board-preview'),               // bundled (pubblicato)
    resolve(import.meta.dirname, '../../sethlans-board-preview')    // monorepo sibling (dev)
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'server.mjs'))) return c
  }
  return null
}

/** Copia l'artefatto preview in dest, escludendo node_modules/ e data/ (stesso filtro di bundle-preview.js). */
function copyPreviewArtifact(src, dest) {
  function filter(path) {
    const rel = relative(src, stripUncPrefix(path))
    if (!rel) return true
    const firstSegment = rel.split(sep)[0]
    return !EXCLUDED_DIRS.has(firstSegment)
  }
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
  cpSync(src, dest, { recursive: true, filter })
}

/** Append idempotente di una riga a un file (lo crea se manca). Best-effort: non lancia. */
function ensureGitignoreLine(gitignorePath, line) {
  try {
    let content = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : ''
    const lines = content.split(/\r?\n/)
    if (lines.includes(line)) return
    if (content && !content.endsWith('\n')) content += '\n'
    content += `${line}\n`
    writeFileSync(gitignorePath, content)
  } catch (err) {
    console.log(`  ! Non sono riuscito ad aggiornare ${gitignorePath}: ${err.message}`)
  }
}

/**
 * Deriva { port, env } secondo la matrice delle 3 modalità (epica e9e6fa7b4).
 * embedded: nessun upstream, porta 9955 (comportamento odierno del preview).
 * local:    upstream Docker locale, porta 9966 (diversa da 9955 per evitare conflitto),
 *           web-url React locale per il link "Apri nella board".
 * remote:   upstream + web-url remoti (Render), porta 9966, token opzionale.
 */
function deriveEnvAndPort({ mode, upstream, webUrl, port, token }) {
  const env = {}
  let resolvedPort = port

  if (mode === 'embedded') {
    resolvedPort = resolvedPort || EMBEDDED_DEFAULT_PORT
  } else if (mode === 'local') {
    env.SETHLANS_UPSTREAM_URL = upstream || LOCAL_DEFAULT_UPSTREAM
    env.SETHLANS_BOARD_WEB_URL = webUrl || LOCAL_DEFAULT_WEB_URL
    resolvedPort = resolvedPort || LOCAL_DEFAULT_PORT
  } else if (mode === 'remote') {
    env.SETHLANS_UPSTREAM_URL = upstream || REMOTE_DEFAULT_UPSTREAM
    env.SETHLANS_BOARD_WEB_URL = webUrl || REMOTE_DEFAULT_WEB_URL
    resolvedPort = resolvedPort || REMOTE_DEFAULT_PORT
  } else {
    throw new Error(`modalità non valida: ${mode}`)
  }

  if (token) env.SETHLANS_SERVICE_API_TOKEN = token

  return { port: resolvedPort, env }
}

/**
 * Costruisce l'intera entry da scrivere in launch.json. `cwd` è SEMPRE una stringa
 * letterale POSIX (separatore "/"), indipendentemente dall'OS: launch.json è
 * consumato da Claude Preview, non dal filesystem nativo del processo che lo scrive.
 */
function buildLaunchEntry({ port, env }) {
  const entry = {
    program: 'node server.mjs',
    cwd: '.sethlans/board-preview',
    port
  }
  if (Object.keys(env).length > 0) entry.env = env
  return entry
}

/**
 * Legge .claude/launch.json (se esiste), fa merge SOLO della entry
 * "sethlans-board-preview" (la rimpiazza interamente), preserva tutte le altre
 * entry esistenti, riscrive con indent 2 + newline finale.
 * Se il file esiste ma non è JSON valido: NON lo distrugge, lancia un errore
 * con istruzioni manuali (il caller decide come terminare il processo).
 */
export function mergeLaunchJson(existingContent, newEntry) {
  let config = {}
  if (existingContent != null && existingContent.trim() !== '') {
    try {
      config = JSON.parse(existingContent)
    } catch (err) {
      const detail = err && err.message ? err.message : String(err)
      throw new Error(
        `.claude/launch.json esiste ma non è JSON valido (${detail}). ` +
        `Non lo sovrascrivo per non perdere configurazione esistente: correggilo manualmente, ` +
        `poi aggiungi a mano la entry "${PREVIEW_ENTRY_NAME}": ${JSON.stringify(newEntry)}`
      )
    }
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      throw new Error(
        `.claude/launch.json esiste ma la radice non è un oggetto JSON. ` +
        `Non lo sovrascrivo: correggilo manualmente, poi aggiungi a mano la entry "${PREVIEW_ENTRY_NAME}".`
      )
    }
  }

  config[PREVIEW_ENTRY_NAME] = newEntry
  return JSON.stringify(config, null, 2) + '\n'
}

function writeLaunchJson(repoRoot, newEntry) {
  const claudeDir = join(repoRoot, '.claude')
  const launchPath = join(claudeDir, 'launch.json')

  const existingContent = existsSync(launchPath) ? readFileSync(launchPath, 'utf8') : null
  const merged = mergeLaunchJson(existingContent, newEntry) // può lanciare: il caller non deve catturarlo silenziosamente

  mkdirSync(claudeDir, { recursive: true })
  writeFileSync(launchPath, merged)
  return launchPath
}

/** Legge ~/.claude/sethlans-config.json per proporre come default l'upstream già configurato. */
function readConfiguredBoardUrl() {
  try {
    const p = join(homedir(), '.claude', 'sethlans-config.json')
    if (!existsSync(p)) return null
    const config = JSON.parse(readFileSync(p, 'utf8'))
    return config?.board?.url || null
  } catch {
    return null
  }
}

/** Parsing minimale dei flag non interattivi: --mode, --upstream, --web-url, --port, --token, --write-token. */
function parseArgs(args) {
  const out = { mode: null, upstream: null, webUrl: null, port: null, token: null, writeToken: false }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--mode') out.mode = args[++i]
    else if (a === '--upstream') out.upstream = args[++i]
    else if (a === '--web-url') out.webUrl = args[++i]
    else if (a === '--port') out.port = Number(args[++i])
    else if (a === '--token') out.token = args[++i]
    else if (a === '--write-token') out.writeToken = true
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

function printHelp() {
  console.log(`
Uso: sethlans preview init [opzioni]

Rende disponibile il server di preview della board nel repo corrente
(.sethlans/board-preview/) e scrive/aggiorna .claude/launch.json in modo
idempotente, così Claude Preview lo rileva e lo lancia senza step manuali.

Senza opzioni parte un wizard interattivo. Opzioni non interattive:
  --mode <embedded|local|remote>   modalità (assente ⇒ wizard)
  --upstream <url>                 BE upstream (local/remote)
  --web-url <url>                  URL della board React per il link "Apri nella board"
  --port <n>                       porta del preview (default: 9955 embedded, 9966 local/remote)
  --token <t>                      SETHLANS_SERVICE_API_TOKEN (mai loggato)
  --write-token                    scrive il token in chiaro in .claude/launch.json
                                    (default: non scritto, va passato come env a runtime)
  --help                           mostra questo messaggio
`)
}

async function chooseModeInteractive() {
  const choice = await menu('Modalità del preview della board?', [
    'Embedded — DB SQLite locale al preview, nessun BE esterno (uso cloud/usa-e-getta)',
    'Locale + Docker — proxy verso il BE FastAPI Docker (porta 9955)',
    'Remoto — proxy verso un BE remoto (es. Render), con token condiviso'
  ])
  return ['embedded', 'local', 'remote'][choice]
}

async function collectLocalOrRemoteOptions(mode, defaults) {
  const defaultUpstream = mode === 'local' ? LOCAL_DEFAULT_UPSTREAM : (defaults.boardUrl || REMOTE_DEFAULT_UPSTREAM)
  const defaultWebUrl = mode === 'local' ? LOCAL_DEFAULT_WEB_URL : REMOTE_DEFAULT_WEB_URL

  const upstream = (await ask(`  URL upstream BE [${defaultUpstream}]: `)).trim() || defaultUpstream
  const webUrl = (await ask(`  URL board React (per "Apri nella board") [${defaultWebUrl}]: `)).trim() || defaultWebUrl

  let token = null
  let writeToken = false
  if (mode === 'remote') {
    token = (await ask('  Token condiviso (SETHLANS_SERVICE_API_TOKEN), lascia vuoto se non richiesto: ')).trim() || null
    if (token) {
      writeToken = await confirm('  Scrivere il token in chiaro in .claude/launch.json? (altrimenti va impostato come env a runtime)', false)
    }
  }

  return { upstream, webUrl, token, writeToken }
}

export async function previewInit(args) {
  const flags = parseArgs(args)
  if (flags.help) {
    printHelp()
    close()
    return
  }

  const repoRoot = process.cwd()

  // 1. Risolve e copia l'artefatto preview in .sethlans/board-preview/ (idempotente).
  const previewRoot = findPreviewRoot()
  if (!previewRoot) {
    console.error('  ✗ Non trovo l\'artefatto del preview (board-preview/ nel package o sethlans-board-preview/ nel monorepo).')
    console.error('    Assicurati che il package "sethlans" sia installato correttamente (npm install -g sethlans).')
    close()
    process.exitCode = 1
    return
  }

  const destDir = join(repoRoot, '.sethlans', 'board-preview')
  console.log(`\nCopio il preview da ${previewRoot} a ${destDir} ...`)
  copyPreviewArtifact(previewRoot, destDir)
  console.log('  ✔ Preview copiato.')

  // 2. .gitignore del repo utente: .sethlans/ è generato, non va versionato.
  ensureGitignoreLine(join(repoRoot, '.gitignore'), '.sethlans/')

  // 3. Modalità: flag non interattivi se --mode è presente, altrimenti wizard.
  let mode = flags.mode
  let upstream = flags.upstream
  let webUrl = flags.webUrl
  let token = flags.token
  let writeToken = flags.writeToken

  if (mode && !['embedded', 'local', 'remote'].includes(mode)) {
    console.error(`  ✗ --mode non valido: "${mode}" (valori ammessi: embedded, local, remote).`)
    close()
    process.exitCode = 1
    return
  }

  if (!mode) {
    mode = await chooseModeInteractive()
    if (mode !== 'embedded') {
      const configuredBoardUrl = readConfiguredBoardUrl()
      const collected = await collectLocalOrRemoteOptions(mode, { boardUrl: configuredBoardUrl })
      upstream = collected.upstream
      webUrl = collected.webUrl
      token = collected.token
      writeToken = collected.writeToken
    }
  }

  // 4. Deriva env + porta secondo la matrice, costruisce la entry.
  const { port, env } = deriveEnvAndPort({ mode, upstream, webUrl, port: flags.port, token: writeToken ? token : null })
  const entry = buildLaunchEntry({ port, env })

  // 5. Scrive .claude/launch.json con read-merge-write idempotente.
  let launchPath
  try {
    launchPath = writeLaunchJson(repoRoot, entry)
  } catch (err) {
    console.error(`\n  ✗ ${err.message}`)
    close()
    process.exitCode = 1
    return
  }
  console.log(`  ✔ ${launchPath} aggiornato (entry "${PREVIEW_ENTRY_NAME}").`)

  // 6. Token: se non scritto in chiaro, avvisa e protegge .claude/launch.json via .gitignore.
  if (token && !writeToken) {
    console.log('\n  Il token NON è stato scritto in chiaro in launch.json.')
    console.log('  Impostalo come variabile d\'ambiente a runtime (SETHLANS_SERVICE_API_TOKEN) prima di lanciare il preview,')
    console.log('  oppure ri-esegui con --write-token per scriverlo nel file (sconsigliato se il repo è condiviso).')
  }
  if (token && writeToken) {
    ensureGitignoreLine(join(repoRoot, '.gitignore'), '.claude/launch.json')
    console.log('\n  ! Il token è stato scritto in chiaro in .claude/launch.json: ho aggiunto .claude/launch.json al .gitignore.')
    console.log('    Verifica che non sia già stato committato in precedenza.')
  }

  console.log(`\nFatto. Modalità: ${mode}, porta: ${port}.`)
  if (mode !== 'embedded') {
    console.log(`  Upstream: ${env.SETHLANS_UPSTREAM_URL}`)
    console.log(`  Board web URL: ${env.SETHLANS_BOARD_WEB_URL}`)
  }

  close()
}

// Esportati per i test unitari (logica pura, senza I/O o interazione).
export const _internal = { mergeLaunchJson, deriveEnvAndPort, buildLaunchEntry, PREVIEW_ENTRY_NAME }
