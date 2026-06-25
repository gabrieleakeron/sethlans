#!/usr/bin/env node
// sethlans — entry point: routes subcommands
import { setup } from '../lib/setup.js'
import { uninstall } from '../lib/uninstall.js'
import { boardUp } from '../lib/board.js'
import { updateBoard } from '../lib/updateBoard.js'
import { previewInit } from '../lib/preview.js'

const [, , cmd, ...rest] = process.argv

if (!cmd || cmd === 'setup') {
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
  console.error(`Unknown command: ${cmd}\nUsage: sethlans setup [--update] | sethlans board up | sethlans preview init | sethlans uninstall`)
  process.exit(1)
}
