#!/usr/bin/env node
// sethlans — entry point: routes subcommands
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { setup } from '../lib/setup.js'
import { uninstall } from '../lib/uninstall.js'
import { boardUp } from '../lib/board.js'
import { updateBoard } from '../lib/updateBoard.js'
import { previewInit } from '../lib/preview.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))

const USAGE = `sethlans v${pkg.version} — install the Sethlans plugin for Claude Code and configure the board

Usage:
  sethlans [setup] [--update]   Configuration wizard: copy the plugin into ~/.claude/,
                                bring up the local board (SQLite/PostgreSQL), wire LSP.
  sethlans board up             Bring up Sethlans Board on Docker (without the full wizard).
  sethlans update-board         Re-pull the board images and restart the containers.
  sethlans preview init         Set up the Preview companion server in the current repo.
  sethlans uninstall            Remove the plugin from ~/.claude/.

Options:
  -h, --help                    Show this help.
  -v, --version                 Print the version.
`

const [, , cmd, ...rest] = process.argv

if (cmd === '--version' || cmd === '-v') {
  console.log(pkg.version)
} else if (cmd === '--help' || cmd === '-h') {
  console.log(USAGE)
} else if (!cmd || cmd === 'setup') {
  setup(rest)
} else if (cmd === 'update-board') {
  updateBoard()
} else if (cmd === 'uninstall') {
  uninstall()
} else if (cmd === 'board' && rest[0] === 'up') {
  boardUp(rest.slice(1))
} else if (cmd === 'preview' && rest[0] === 'init') {
  previewInit(rest.slice(1))
} else {
  console.error(`Unknown command: ${cmd}\n\n${USAGE}`)
  process.exit(1)
}
