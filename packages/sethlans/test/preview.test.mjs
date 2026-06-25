// Test della logica pura di lib/preview.js (merge idempotente di launch.json,
// mappatura modalità→env/porta). Nessuna interazione, nessuna copia su filesystem
// reale: si esercitano solo le funzioni esportate da _internal / mergeLaunchJson.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeLaunchJson, _internal } from '../lib/preview.js'

const { deriveEnvAndPort, buildLaunchEntry, PREVIEW_ENTRY_NAME } = _internal

test('mergeLaunchJson: file assente -> crea solo la nostra entry', () => {
  const out = mergeLaunchJson(null, { program: 'node server.mjs', cwd: '.sethlans/board-preview', port: 9955 })
  const parsed = JSON.parse(out)
  assert.deepEqual(Object.keys(parsed), [PREVIEW_ENTRY_NAME])
  assert.equal(parsed[PREVIEW_ENTRY_NAME].port, 9955)
  assert.ok(out.endsWith('\n'))
})

test('mergeLaunchJson: preserva altre entry esistenti e rimpiazza solo la nostra', () => {
  const existing = JSON.stringify({
    'other-tool': { program: 'node other.js', cwd: 'tools/other', port: 1234 },
    [PREVIEW_ENTRY_NAME]: { program: 'node server.mjs', cwd: '.sethlans/board-preview', port: 9955 }
  })
  const newEntry = { program: 'node server.mjs', cwd: '.sethlans/board-preview', port: 9966, env: { SETHLANS_UPSTREAM_URL: 'http://localhost:9955' } }
  const out = mergeLaunchJson(existing, newEntry)
  const parsed = JSON.parse(out)

  assert.deepEqual(parsed['other-tool'], { program: 'node other.js', cwd: 'tools/other', port: 1234 })
  assert.deepEqual(parsed[PREVIEW_ENTRY_NAME], newEntry)
})

test('mergeLaunchJson: rieseguendo con la stessa entry il risultato è identico (idempotenza)', () => {
  const newEntry = { program: 'node server.mjs', cwd: '.sethlans/board-preview', port: 9966 }
  const first = mergeLaunchJson(null, newEntry)
  const second = mergeLaunchJson(first, newEntry)
  assert.equal(first, second)
})

test('mergeLaunchJson: JSON invalido preesistente -> lancia, non distrugge', () => {
  const invalid = '{ questo non è json valido '
  assert.throws(
    () => mergeLaunchJson(invalid, { program: 'node server.mjs', cwd: '.sethlans/board-preview', port: 9955 }),
    /non è JSON valido/
  )
})

test('mergeLaunchJson: radice JSON non-oggetto (array) -> lancia, non distrugge', () => {
  const invalid = '[1, 2, 3]'
  assert.throws(
    () => mergeLaunchJson(invalid, { program: 'node server.mjs', cwd: '.sethlans/board-preview', port: 9955 }),
    /non è un oggetto JSON/
  )
})

test('mergeLaunchJson: stringa vuota equivale a file assente', () => {
  const out = mergeLaunchJson('', { program: 'node server.mjs', cwd: '.sethlans/board-preview', port: 9955 })
  const parsed = JSON.parse(out)
  assert.deepEqual(Object.keys(parsed), [PREVIEW_ENTRY_NAME])
})

test('deriveEnvAndPort: embedded -> nessun upstream, porta 9955 di default', () => {
  const { port, env } = deriveEnvAndPort({ mode: 'embedded' })
  assert.equal(port, 9955)
  assert.deepEqual(env, {})
})

test('deriveEnvAndPort: local -> upstream/web-url locali di default, porta 9966', () => {
  const { port, env } = deriveEnvAndPort({ mode: 'local' })
  assert.equal(port, 9966)
  assert.equal(env.SETHLANS_UPSTREAM_URL, 'http://localhost:9955')
  assert.equal(env.SETHLANS_BOARD_WEB_URL, 'http://localhost:5173')
  assert.equal(env.SETHLANS_SERVICE_API_TOKEN, undefined)
})

test('deriveEnvAndPort: remote -> upstream/web-url remoti di default, porta 9966, token opzionale', () => {
  const { port, env } = deriveEnvAndPort({ mode: 'remote', token: 'shh' })
  assert.equal(port, 9966)
  assert.equal(env.SETHLANS_UPSTREAM_URL, 'https://board-api.sethlans-ai.com')
  assert.equal(env.SETHLANS_BOARD_WEB_URL, 'https://board.sethlans-ai.com')
  assert.equal(env.SETHLANS_SERVICE_API_TOKEN, 'shh')
})

test('deriveEnvAndPort: override espliciti di upstream/web-url/port sono rispettati', () => {
  const { port, env } = deriveEnvAndPort({ mode: 'local', upstream: 'http://custom:1', webUrl: 'http://custom:2', port: 7777 })
  assert.equal(port, 7777)
  assert.equal(env.SETHLANS_UPSTREAM_URL, 'http://custom:1')
  assert.equal(env.SETHLANS_BOARD_WEB_URL, 'http://custom:2')
})

test('deriveEnvAndPort: token assente non viene mai aggiunto all\'env', () => {
  const { env } = deriveEnvAndPort({ mode: 'remote', token: null })
  assert.equal('SETHLANS_SERVICE_API_TOKEN' in env, false)
})

test('deriveEnvAndPort: modalità non valida -> lancia', () => {
  assert.throws(() => deriveEnvAndPort({ mode: 'bogus' }), /modalità non valida/)
})

test('buildLaunchEntry: cwd è sempre la stringa letterale POSIX, anche se generata su Windows', () => {
  const entry = buildLaunchEntry({ port: 9955, env: {} })
  assert.equal(entry.cwd, '.sethlans/board-preview')
  assert.equal(entry.program, 'node server.mjs')
  assert.equal('env' in entry, false) // env vuoto -> omesso, come nel launch.json esistente (embedded)
})

test('buildLaunchEntry: env non vuoto viene incluso', () => {
  const entry = buildLaunchEntry({ port: 9966, env: { SETHLANS_UPSTREAM_URL: 'http://localhost:9955' } })
  assert.deepEqual(entry.env, { SETHLANS_UPSTREAM_URL: 'http://localhost:9955' })
})
