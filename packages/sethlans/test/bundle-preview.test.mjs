// Test della logica di esclusione usata da scripts/bundle-preview.js: verifica che il
// filtro passato a cpSync escluda node_modules/ e data/ a qualunque profondità diretta,
// gestendo anche il prefisso UNC esteso "\\?\" che Node antepone ai path su Windows.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relative, sep, resolve } from 'node:path'

const EXCLUDED_DIRS = new Set(['node_modules', 'data'])
const UNC_PREFIX = '\\\\?\\'

function stripUncPrefix(p) {
  return p.startsWith(UNC_PREFIX) ? p.slice(UNC_PREFIX.length) : p
}

function makeFilter(src) {
  return function filter(path) {
    const rel = relative(src, stripUncPrefix(path))
    if (!rel) return true
    const firstSegment = rel.split(sep)[0]
    return !EXCLUDED_DIRS.has(firstSegment)
  }
}

test('bundle filter: esclude data/ e node_modules/ alla radice', () => {
  const src = resolve('fake-src')
  const filter = makeFilter(src)
  assert.equal(filter(resolve(src, 'data')), false)
  assert.equal(filter(resolve(src, 'node_modules')), false)
  assert.equal(filter(resolve(src, 'data', 'board.db')), false)
  assert.equal(filter(resolve(src, 'node_modules', 'pkg', 'index.js')), false)
})

test('bundle filter: include la radice e le altre cartelle/file', () => {
  const src = resolve('fake-src')
  const filter = makeFilter(src)
  assert.equal(filter(src), true)
  assert.equal(filter(resolve(src, 'server.mjs')), true)
  assert.equal(filter(resolve(src, 'src', 'router.mjs')), true)
  assert.equal(filter(resolve(src, 'public', 'index.html')), true)
})

test('bundle filter: non esclude cartelle che contengono "data" o "node_modules" solo come sottostringa', () => {
  const src = resolve('fake-src')
  const filter = makeFilter(src)
  assert.equal(filter(resolve(src, 'database')), true)
  assert.equal(filter(resolve(src, 'metadata')), true)
})

test('bundle filter: gestisce correttamente il prefisso UNC esteso di Windows', () => {
  const src = resolve('fake-src')
  const filter = makeFilter(src)
  const uncPath = UNC_PREFIX + resolve(src, 'data', 'board.db')
  assert.equal(filter(uncPath), false)
})
