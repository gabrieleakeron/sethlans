// sethlans docker — bring up / tear down the Sethlans Board locally via docker compose
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', ...opts })
}

function runQuiet(cmd) {
  return execSync(cmd, { stdio: 'pipe' }).toString().trim()
}

export function isDockerAvailable() {
  try {
    runQuiet('docker version')
    return true
  } catch {
    return false
  }
}

/**
 * Locate the repo's docker-compose.yml, walking up from this package
 * (dev monorepo or installed-inside-a-checkout layouts), falling back to cwd.
 */
export function findComposeFile() {
  let dir = __dirname
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'docker-compose.yml')
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }
  const cwdCandidate = join(process.cwd(), 'docker-compose.yml')
  if (existsSync(cwdCandidate)) return cwdCandidate
  return null
}

/**
 * `localhost`/`127.0.0.1` seen from *inside* a Docker container is the
 * container itself, not the host machine — translate to `host.docker.internal`
 * whenever a DB URL is about to be handed to a Dockerized backend (compose,
 * or the one-off `pg_isready` probe container). Leave any other host as-is
 * (already a routable hostname/IP, e.g. a remote Postgres or another
 * container on the same compose network).
 */
export function dockerizeDbUrl(dbUrl) {
  if (!dbUrl || dbUrl.startsWith('sqlite')) return dbUrl
  const isLocal = /:\/\/[^@]*@(localhost|127\.0\.0\.1)([:/]|$)/.test(dbUrl)
  return isLocal ? dbUrl.replace(/@(localhost|127\.0\.0\.1)([:/]|$)/, '@host.docker.internal$2') : dbUrl
}

/**
 * Verify that a database is reachable for a given SETHLANS_SERVICE_DB_URL.
 * SQLite (the default, file-based) is always considered available. For
 * PostgreSQL we don't want a `pg` npm dependency, so we reuse Docker
 * (already required by this CLI) to run `pg_isready` from the official image.
 */
export function isDatabaseAvailable(dbUrl) {
  if (!dbUrl || dbUrl.startsWith('sqlite')) return true

  try {
    const containerUrl = dockerizeDbUrl(dbUrl)
    const url = new URL(containerUrl.replace('postgresql+psycopg2://', 'postgresql://'))
    const host = url.hostname
    const port = url.port || '5432'
    const user = decodeURIComponent(url.username) || 'postgres'
    const addHost = host === 'host.docker.internal' ? '--add-host=host.docker.internal:host-gateway' : ''

    runQuiet(`docker run --rm ${addHost} postgres:16-alpine pg_isready -h ${host} -p ${port} -U ${user}`)
    return true
  } catch {
    return false
  }
}

/**
 * Bring up the board via `docker compose up -d` against the repo's
 * docker-compose.yml — same path as `sethlans board up`, so there is a
 * single way the board is actually started (no more standalone `docker run`
 * containers drifting out of sync with the compose file).
 * opts: { dbUrl?: string }
 */
export function dockerUp({ dbUrl } = {}) {
  const composeFile = findComposeFile()
  if (!composeFile) {
    throw new Error('Could not find the repo\'s docker-compose.yml (run from inside the Sethlans repo checkout).')
  }

  const containerDbUrl = dockerizeDbUrl(dbUrl) || 'sqlite:////data/service.db'
  console.log(`  Starting board with docker compose (${composeFile})...`)
  run('docker compose up -d', {
    cwd: dirname(composeFile),
    env: { ...process.env, SETHLANS_SERVICE_DB_URL: containerDbUrl }
  })
}

export function dockerPullAndUp({ dbUrl } = {}) {
  const composeFile = findComposeFile()
  if (!composeFile) {
    throw new Error('Could not find the repo\'s docker-compose.yml (run from inside the Sethlans repo checkout).')
  }

  const containerDbUrl = dockerizeDbUrl(dbUrl) || 'sqlite:////data/service.db'
  
  console.log(`Pull new docker images...`)
  
  run('docker compose pull --policy always ', {
    cwd: dirname(composeFile),
  })

  console.log(`Starting board with docker compose (${composeFile})...`)

  run('docker compose up -d --force-recreate', {
    cwd: dirname(composeFile),
    env: { ...process.env, SETHLANS_SERVICE_DB_URL: containerDbUrl }
  })
}

export function dockerDown() {
  const composeFile = findComposeFile()
  if (!composeFile) return
  try {
    run('docker compose down', { cwd: dirname(composeFile) })
  } catch {}
}
