/** Upgrade only the former reader/chat entry identities; retain all other YAML bytes. */
import { isMap, isScalar, isSeq, parseDocument, stringify, type YAMLMap } from 'yaml'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'

export function migratePatch(source: string): { text: string; changes: number } {
  const doc = parseDocument(source, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] })
  if (doc.errors.length) throw new Error('Profile YAML could not be parsed: ' + doc.errors[0]!.message)
  if (!isSeq(doc.contents)) return { text: source, changes: 0 }
  const edits: { start: number; end: number; value: string }[] = []
  const configs = new Map<string, YAMLMap>()
  const inspect = (entry: unknown, inserted = false) => {
    if (!isMap(entry)) return
    const id = entry.get('id'), name = entry.get('name')
    if (['side-chat', 'paper-margin'].includes(String(id)) && (name === undefined || ['dsh-sidenote', 'dsh-paper-margin'].includes(String(name)))) {
      // Manual insert lists are not regular overrides: two inserts would create
      // two lifetimes. Stop before editing; the standard installer uses bundles.
      if (inserted) throw new Error('Move the manually inserted reader/chat entry to the profile bundle list before upgrading.')
      const config = entry.get('config', true)
      if (config !== undefined) {
        if (!isMap(config)) throw new Error('Reader/chat config must be a YAML mapping before upgrading.')
        configs.set(String(id), config)
      }
      for (const [key, value] of [['id', 'side-chat'], ['name', 'dsh-paper-margin']] as const) {
        const node = entry.get(key, true)
        if (isScalar(node) && node.value !== value && node.range) edits.push({ start: node.range[0], end: node.range[1], value: JSON.stringify(value) })
      }
    }
    const insert = entry.get('insert', true)
    if (isSeq(insert)) for (const child of insert.items) inspect(child, true)
  }
  for (const entry of doc.contents.items) inspect(entry)
  let text = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.value + text.slice(edit.end)
  // DSH replaces an entry's entire config on each override. Renaming both ids
  // alone would silently drop the earlier preferences, so finish with their
  // effective union. Other YAML, including !!js expressions, stays untouched.
  if (edits.length && configs.has('paper-margin') && configs.has('side-chat')) {
    const merged = configs.get('paper-margin')!.clone() as YAMLMap
    const chat = configs.get('side-chat')!.clone() as YAMLMap
    for (const pair of chat.items) merged.set(pair.key, pair.value)
    // Trailing newlines may belong to another plugin's |+ scalar. Preserve
    // them exactly, and terminate its block with a root-level comment.
    text += (/[\r\n]$/.test(text) ? '' : '\n') + '# Combined reader and side-chat preferences.\n' + stringify([{ id: 'side-chat', name: 'dsh-paper-margin', config: merged }])
  }
  return { text, changes: edits.length }
}

export function migrateProfile(directory: string, checkOnly = false): number {
  const path = join(resolve(directory), 'cordis.patch.yml')
  if (!existsSync(path)) return 0
  const source = readFileSync(path, 'utf8'), result = migratePatch(source)
  if (!result.changes || checkOnly) return result.changes
  const backup = path + '.before-paper-margin-unified'
  if (!existsSync(backup)) writeFileSync(backup, source, { flag: 'wx' })
  if (readFileSync(path, 'utf8') !== source) throw new Error('Profile changed during migration; retry the installer.')
  const temporary = path + '.paper-margin-' + process.pid
  writeFileSync(temporary, result.text, { flag: 'wx' })
  renameSync(temporary, path)
  return result.changes
}

if (typeof require !== 'undefined' && require.main === module) {
  const args = process.argv.slice(2), checkOnly = args[0] === '--check'
  const directory = args[checkOnly ? 1 : 0]
  if (!directory) throw new Error('Usage: node migrate-profile.cjs [--check] <profile-directory>')
  console.log('Paper Margin profile changes: ' + migrateProfile(directory, checkOnly))
}
