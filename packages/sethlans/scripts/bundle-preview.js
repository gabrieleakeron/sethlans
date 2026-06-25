#!/usr/bin/env node
// prepack script: copia packages/sethlans-board-preview in ./board-preview/, così che
// il package npm pubblicato sia autosufficiente (stesso pattern di bundle-plugin.js).
// Esclude node_modules/ (non presente oggi: il preview è zero-dipendenze, ma ci
// proteggiamo comunque) e data/ (contiene board.db: il DB embedded NON va bundlato
// nel package — ogni repo utente deve partire con un DB proprio, non con quello di sviluppo
// di questo monorepo).
import { cpSync, rmSync, existsSync } from 'fs'
import { resolve, dirname, relative, sep } from 'path'
import { fileURLToPath } from 'url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const src  = resolve(packageRoot, '../sethlans-board-preview')
const dest = resolve(packageRoot, 'board-preview')

const EXCLUDED_DIRS = new Set(['node_modules', 'data'])

// Su Windows Node passa al filter di cpSync i path con il prefisso UNC esteso
// "\\?\" (necessario per superare il limite storico dei 260 caratteri): va
// normalizzato PRIMA di calcolare il path relativo a `src`, altrimenti
// path.relative non riconosce `src` come prefisso e il filtro non esclude nulla.
const UNC_PREFIX = '\\\\?\\'
function stripUncPrefix(p) {
  return p.startsWith(UNC_PREFIX) ? p.slice(UNC_PREFIX.length) : p
}

// cpSync invoca filter per OGNI file/cartella (anche la radice stessa): consideriamo
// "escluso" qualunque path il cui primo segmento, relativo a `src`, sia in EXCLUDED_DIRS.
function filter(path) {
  const rel = relative(src, stripUncPrefix(path))
  if (!rel) return true // src stesso
  const firstSegment = rel.split(sep)[0]
  return !EXCLUDED_DIRS.has(firstSegment)
}

if (!existsSync(src)) {
  console.error(`bundle-preview: source not found: ${src}`)
  process.exit(1)
}

if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true, filter })
console.log(`bundle-preview: copied ${src} → ${dest} (escluse: ${[...EXCLUDED_DIRS].join(', ')})`)
