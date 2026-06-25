// Minimal interactive prompts — no external dependencies, only Node.js readline
import { createInterface } from 'readline'

const rl = createInterface({ input: process.stdin, output: process.stdout })

export function ask(question) {
  return new Promise(resolve => rl.question(question, resolve))
}

export function close() {
  rl.close()
}

/**
 * Present a numbered menu, return the chosen index (0-based).
 * items: string[]
 */
export async function menu(question, items) {
  console.log(`\n${question}`)
  items.forEach((item, i) => console.log(`  ${i + 1}. ${item}`))
  while (true) {
    const answer = (await ask(`  › `)).trim()
    const n = parseInt(answer, 10)
    if (n >= 1 && n <= items.length) return n - 1
    console.log(`  Please enter a number between 1 and ${items.length}.`)
  }
}

/**
 * Yes/No confirmation, defaults to `Yes` on empty input.
 */
export async function confirm(question, defaultYes = true) {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  const answer = (await ask(`  ${question} [${hint}] `)).trim().toLowerCase()
  if (!answer) return defaultYes
  return answer === 'y' || answer === 'yes'
}
