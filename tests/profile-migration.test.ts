import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { migratePatch, migrateProfile } from '../src/migrate-profile'

describe('single-plugin profile upgrade', () => {
  it('changes only the legacy identity, retaining comments and unrelated expressions', () => {
    const before = '# keep\r\n- id: side-chat\r\n  name: dsh-sidenote # user choice\r\n  config:\r\n    finalRepliesDefaultAttempted: true\r\n- id: other\r\n  config: !!js process.env.TEST\r\n'
    const result = migratePatch(before)
    expect(result.text).toBe(before.replace('name: dsh-sidenote', 'name: "dsh-paper-margin"'))
    expect(result.changes).toBe(1)
    expect(migratePatch(result.text)).toEqual({ text: result.text, changes: 0 })
  })

  it('preserves both effective configs despite host whole-config replacement', () => {
    const before = '- id: paper-margin\n  config: { directSubmit: false }\n- id: paper-margin\n  config: { directSubmit: true }\n- id: side-chat\n  name: dsh-sidenote\n  config: { hideNativeQuote: false, showSideChatNote: false, finalRepliesDefaultAttempted: true }\n'
    const result = migratePatch(before)
    const patches = parse(result.text)
    expect(patches.every((p: { id: string }) => p.id === 'side-chat')).toBe(true)
    expect(patches.at(-1).config).toEqual({ directSubmit: true, hideNativeQuote: false, showSideChatNote: false, finalRepliesDefaultAttempted: true })
    expect(migratePatch(result.text).changes).toBe(0)
  })

  it('does not claim other plugins using the same id', () => {
    const before = '- id: side-chat\n  name: someone-elses-chat\n  config: { hideNativeQuote: false }\n'
    expect(migratePatch(before)).toEqual({ text: before, changes: 0 })
  })

  it('preserves semantic trailing blank lines in another plugin’s keep-chomping scalar', () => {
    const before = '- id: paper-margin\n  config: { directSubmit: true }\n- id: side-chat\n  name: dsh-sidenote\n  config: { hideNativeQuote: false }\n- id: unrelated\n  config:\n    template: |+\n      keep these blank lines\n\n\n\n'
    const after = parse(migratePatch(before).text)
    expect(after.find((entry: { id: string }) => entry.id === 'unrelated')).toEqual(parse(before).at(-1))
  })

  it('fails before writing an unsupported manual insert or malformed YAML', () => {
    expect(() => migratePatch('- insert:\n    - id: side-chat\n      name: dsh-sidenote\n')).toThrow('manually inserted')
    expect(() => migratePatch('- id: [\n')).toThrow('could not be parsed')
  })

  it('preflights without writing, backs up exact original bytes and is repeatable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paper-margin-migration-'))
    const path = join(dir, 'cordis.patch.yml')
    const before = '- id: side-chat\n  name: dsh-sidenote\n  config: { finalRepliesDefaultAttempted: true }\n'
    writeFileSync(path, before)
    expect(migrateProfile(dir, true)).toBe(1)
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(migrateProfile(dir)).toBe(1)
    expect(readFileSync(path + '.before-paper-margin-unified', 'utf8')).toBe(before)
    expect(migrateProfile(dir)).toBe(0)
    expect(readFileSync(path + '.before-paper-margin-unified', 'utf8')).toBe(before)
  })
})
