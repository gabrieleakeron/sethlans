// Smoke test for lib/setup.js — static source assertions.
// setup() is an interactive wizard and cannot be invoked in tests without
// mocking all prompt I/O, so we assert directly against the source text.
// This catches accidental re-introduction of the removed Step 3 symbols.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const src = readFileSync(
  join(import.meta.dirname, '../lib/setup.js'),
  'utf8'
)

test('setup.js does not import node:https', () => {
  assert.ok(!src.includes("import https from 'node:https'"), "Dead import 'node:https' must be removed")
})

test('setup.js has no stepIntegrations definition or call', () => {
  assert.ok(!src.includes('stepIntegrations'), 'stepIntegrations must not appear in setup.js')
})

test('setup.js has no INTEGRATION_SLOTS', () => {
  assert.ok(!src.includes('INTEGRATION_SLOTS'), 'INTEGRATION_SLOTS must not appear in setup.js')
})

test('setup.js has no PROVIDERS catalog', () => {
  // Match the const declaration, not incidental substrings
  assert.ok(!/\bPROVIDERS\b/.test(src), 'PROVIDERS must not appear in setup.js')
})

test('setup.js has no wireProvider', () => {
  assert.ok(!src.includes('wireProvider'), 'wireProvider must not appear in setup.js')
})

test('setup.js has no envPlaceholder', () => {
  assert.ok(!src.includes('envPlaceholder'), 'envPlaceholder must not appear in setup.js')
})

test('setup.js has no probeGithub', () => {
  assert.ok(!src.includes('probeGithub'), 'probeGithub must not appear in setup.js')
})

test('setup.js has no Step 3 label', () => {
  assert.ok(!src.includes('Step 3'), 'Step 3 label must not appear in setup.js')
})

test('setup.js does not register integration MCP servers', () => {
  const forbidden = ['mcp add github', 'mcp add atlassian', 'mcp add linear',
                     'mcp add notion', 'mcp add codacy', 'mcp add codescene', 'mcp add sonarqube']
  for (const s of forbidden) {
    assert.ok(!src.includes(s), `"${s}" must not appear in setup.js`)
  }
})

test('setup.js does not print an Integrations summary line', () => {
  assert.ok(!src.includes('Integrations:'), 'stepConfirm must not print an Integrations summary')
})

test('setup.js exports setup as a function', async () => {
  const mod = await import('../lib/setup.js')
  assert.strictEqual(typeof mod.setup, 'function', 'setup must be an exported function')
  // setup.js → prompts.js opens a readline interface on stdin at import time,
  // which keeps the process alive. Release it so the test runner can exit.
  const { close } = await import('../lib/prompts.js')
  close()
})

test('setup.js still runs the four core wizard steps', () => {
  // Positive assertions: guard against a false-green if the file were gutted —
  // the four core steps (plugin copy + Board + LSP + Confirm) must remain.
  for (const sym of ['copyPlugin', 'stepBoard', 'stepLsp', 'stepConfirm']) {
    assert.ok(src.includes(sym), `${sym} must remain in setup.js`)
  }
})

test('setup.js has no dead runClaudeQuiet helper', () => {
  assert.ok(!src.includes('runClaudeQuiet'), 'dead runClaudeQuiet helper must be removed')
})
