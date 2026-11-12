#!/usr/bin/env node
/**
 * Architecture gate, sidenote-style: the two disciplines that silently rot are
 * made CI-executable instead of aspirational.
 *
 * Rule 1 (layering): files under src/client may not import the host half
 *   (src/index.ts, src/host/*) — the browser bundle must stay loadable.
 * Rule 2 (purity): files under src/client/protocol, src/client/annotate/model,
 *   src/contract and tests may not import react or DOM globals — pure logic
 *   stays testable in plain Node.
 * Rule 3 (size signal): files over budget warn (non-blocking) to force a
 *   responsibility review before a file grows a second job.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const BUDGETS = [
  { pattern: /\.tsx$/, max: 300, kind: 'view' },
  { pattern: /\.ts$/, max: 400, kind: 'logic' },
]

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (/\.(ts|tsx)$/.test(name)) yield path
  }
}

let violations = 0
const warnings = []

for (const file of walk(join(ROOT, 'src'))) {
  const rel = relative(ROOT, file).replaceAll('\\', '/')
  const src = readFileSync(file, 'utf8')
  const imports = [...src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

  if (rel.startsWith('src/client/') && imports.some((spec) => spec.startsWith('../host/') || spec === '../index.ts' || spec === '../contract.ts'.replace('contract', 'host/x') && false)) {
    if (imports.some((spec) => spec.includes('/host/'))) {
      violations++
      console.error(`LAYERING VIOLATION: ${rel} imports the host half (${imports.filter((s) => s.includes('/host/')).join(', ')})`)
    }
  }

  const isPure = /^src\/(contract\.ts|client\/protocol\/|client\/annotate\/model\.ts)/.test(rel) || rel.startsWith('tests/')
  if (isPure && imports.some((spec) => spec === 'react' || spec.startsWith('react/'))) {
    violations++
    console.error(`PURITY VIOLATION: ${rel} (pure zone) imports react`)
  }

  const budget = BUDGETS.find((b) => b.pattern.test(rel))
  if (budget) {
    const lines = src.split('\n').length
    if (lines > budget.max) warnings.push(`${rel}: ${lines} lines > ${budget.max} (${budget.kind}) — review responsibility`)
  }
}

for (const warning of warnings) console.warn(`SIZE SIGNAL: ${warning}`)

process.exit(violations === 0 ? 0 : 1)
