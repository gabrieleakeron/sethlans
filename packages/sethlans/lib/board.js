// sethlans board up — wizard interattivo per avviare il board via docker compose
import { execSync } from 'child_process'
import { dirname } from 'path'
import { ask, menu, close } from './prompts.js'
import { isDockerAvailable, findComposeFile, dockerizeDbUrl } from './docker.js'

const SQLITE_DEFAULT_URL = 'sqlite:////data/service.db'

function runQuiet(cmd) {
  return execSync(cmd, { stdio: 'pipe' }).toString().trim()
}

/**
 * Verifica la raggiungibilità di un Postgres esterno via `pg_isready`,
 * senza aggiungere `pg` come dipendenza npm: usiamo Docker (già richiesto)
 * per eseguire l'immagine ufficiale postgres e fare la prova da lì.
 *
 * NOTA: `localhost`/`127.0.0.1` visti dal container Docker sono il container
 * stesso, non l'host. In quel caso probiamo con `host.docker.internal`
 * (richiede `--add-host=host.docker.internal:host-gateway`, supportato su
 * Docker Desktop e Docker Engine recenti; su Linux puro un'alternativa è
 * `--network host`, non usata qui per restare cross-platform). Usa lo stesso
 * helper `dockerizeDbUrl` usato poi per costruire l'env reale del container
 * backend, così test e avvio vedono esattamente lo stesso host.
 */
function testPostgresConnection({ host, port, user }) {
  const targetHost = (host === 'localhost' || host === '127.0.0.1') ? 'host.docker.internal' : host
  const addHost = targetHost === 'host.docker.internal' ? '--add-host=host.docker.internal:host-gateway' : ''
  const cmd = `docker run --rm ${addHost} postgres:16-alpine pg_isready -h ${targetHost} -p ${port} -U ${user}`
  runQuiet(cmd)
}

async function collectPostgresUrl() {
  while (true) {
    const host = (await ask('  Host [localhost]: ')).trim() || 'localhost'
    const port = (await ask('  Porta [5432]: ')).trim() || '5432'
    const db = (await ask('  Database [sethlans_service]: ')).trim() || 'sethlans_service'
    const user = (await ask('  Utente [sethlans_service]: ')).trim() || 'sethlans_service'
    const password = (await ask('  Password [vuota]: ')).trim()

    console.log('  Verifico la connessione a Postgres...')
    try {
      testPostgresConnection({ host, port, user })
      console.log('  Postgres raggiungibile.')
      return `postgresql+psycopg2://${user}:${password}@${host}:${port}/${db}`
    } catch (err) {
      console.log(`  ! Connessione non riuscita: ${err.message.split('\n')[0]}`)
      const choice = await menu('Cosa vuoi fare?', [
        'Riprova (correggi i parametri)',
        'Continua comunque con questi valori',
      ])
      if (choice === 1) {
        return `postgresql+psycopg2://${user}:${password}@${host}:${port}/${db}`
      }
      // choice === 0: torna in cima al loop e ri-chiede i parametri
    }
  }
}

export async function boardUp(_args) {
  if (!isDockerAvailable()) {
    console.log('\n  ! Docker non è installato o non è in esecuzione.')
    console.log('    Installa/avvia Docker Desktop e rilancia `sethlans board up`.')
    close()
    return
  }

  const composeFile = findComposeFile()
  if (!composeFile) {
    console.log('\n  ! Non trovo il docker-compose.yml del repo Sethlans.')
    console.log('    Esegui `sethlans board up` dalla cartella del repo (o da un suo sottoalbero).')
    close()
    process.exitCode = 1
    return
  }

  const dbChoice = await menu('Database per il Board?', [
    'SQLite (default, zero config)',
    'PostgreSQL',
  ])

  let dbUrl = SQLITE_DEFAULT_URL
  if (dbChoice === 1) {
    dbUrl = await collectPostgresUrl()
  }

  console.log(`\n  Avvio Sethlans Board con docker compose (${composeFile})...`)
  try {
    execSync('docker compose up -d', {
      stdio: 'inherit',
      cwd: dirname(composeFile),
      env: { ...process.env, SETHLANS_SERVICE_DB_URL: dockerizeDbUrl(dbUrl) },
    })
    console.log('\n  Board avviato.')
    console.log('  UI  → http://localhost:5173')
    console.log('  API → http://localhost:9955/docs')
  } catch (err) {
    console.log(`\n  ! docker compose up non è riuscito: ${err.message}`)
    console.log('    Esegui /sethlans-healthcheck per diagnosticare.')
    process.exitCode = 1
  }

  close()
}
