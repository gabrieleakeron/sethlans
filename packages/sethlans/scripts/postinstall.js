#!/usr/bin/env node
// postinstall.js — eseguito automaticamente da `npm install -g sethlans`.
// Configura l'intelligenza del codice a livello GLOBALE (non per-repo):
//   - agent-lsp (+ backend LSP: pylsp, typescript-language-server, jdtls)
//   - serena
//   - merge dei due server MCP in ~/.claude/.mcp.json
//
// Nessuna interazione (postinstall non ha una TTY): installa sempre tutti i
// backend "leggeri" (pylsp, typescript-language-server) automaticamente; jdtls
// richiede JDK 21 + un download pesante, quindi qui resta sempre un avviso
// manuale — la scelta Full/Custom e il setup guidato di JDK 21 + jdtls sono
// disponibili interattivamente via `sethlans setup` (step "Code intelligence").
//
// Regola fondamentale: NON deve mai far fallire `npm install -g sethlans`.
// Ogni passo è avvolto in try/catch indipendenti; in caso di errore si stampa
// un avviso con le istruzioni di rimedio manuale e si continua. Esce sempre 0.

import {
  ensureAgentLsp, ensureSerena, ensurePylsp, ensureTypescriptLanguageServer,
  findJdtls, checkJavaHome, writeGlobalMcpConfig, MCP_PATH
} from '../lib/lsp.js'

const summary = [] // { item, state: 'installed'|'present'|'skipped'|'warning', detail }

function ensureJdtls() {
  const jdtls = findJdtls()
  const javaHome = process.env.JAVA_HOME
  const javaOk = javaHome ? checkJavaHome(javaHome).ok : false

  if (jdtls && javaOk) return { item: 'jdtls', state: 'present' }
  return { item: 'jdtls', state: 'skipped',
    detail: 'jdtls/JDK21 non rilevati. Esegui `sethlans setup` per installarli in modo guidato, oppure manualmente: ' +
      '1) installa un JDK 21 e imposta JAVA_HOME; 2) installa jdtls (https://github.com/eclipse-jdtls/eclipse.jdt.ls).' }
}

function ensureGlobalMcpConfig() {
  try {
    writeGlobalMcpConfig()
    summary.push({ item: '.mcp.json globale', state: 'installed', detail: MCP_PATH })
  } catch (err) {
    summary.push({ item: '.mcp.json globale', state: 'warning',
      detail: `scrittura fallita (${err?.message ?? err}): aggiungi manualmente le voci agent-lsp/serena in ${MCP_PATH}` })
  }
}

function printSummary() {
  console.log('\n=== Sethlans postinstall: code-intelligence setup ===')
  for (const { item, state, detail } of summary) {
    const icon = state === 'installed' ? '✔' : state === 'present' ? '=' : state === 'skipped' ? '·' : '!'
    const label = state === 'installed' ? 'installato' : state === 'present' ? 'già presente' : state === 'skipped' ? 'saltato' : 'avviso'
    console.log(`  ${icon} ${item}: ${label}${detail ? ` — ${detail}` : ''}`)
  }
  console.log('======================================================\n')
}

function main() {
  summary.push(ensureAgentLsp())
  summary.push(ensureSerena())
  summary.push(ensurePylsp())
  summary.push(ensureTypescriptLanguageServer())
  summary.push(ensureJdtls())
  ensureGlobalMcpConfig()
  printSummary()
}

try {
  main()
} catch (err) {
  // Rete di sicurezza finale: qualsiasi errore non previsto non deve mai
  // far fallire `npm install -g sethlans`.
  console.warn('Sethlans postinstall: si è verificato un errore imprevisto, setup automatico saltato.')
  console.warn(`  ${err?.message ?? err}`)
  console.warn('Puoi completare la configurazione manualmente eseguendo:')
  console.warn('  node <percorso-pacchetto-sethlans>/scripts/postinstall.js')
}

process.exit(0)
