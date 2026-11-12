import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The Files-tab address parser must agree with the host byte for byte.
 *
 * The host mints `dsh-resource://file/session/<id>/<path>` with two rules that
 * are easy to get wrong and impossible to see in the UI (`readBytes` just fails
 * for a path the user can plainly see):
 *   - backslashes are normalized to `/` before encoding, so a Windows path
 *     always comes back slash-separated;
 *   - each segment is percent-encoded individually, so the drive colon arrives
 *     as `E%3A` and must be decoded per segment.
 */
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

import { parseFileAddress } from '../src/client/viewer/address'

/** A host-shaped address for a Windows absolute path. */
function hostAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  const encodePath = (p: string): string => p.split('/').map(encodeURIComponent).join('/')
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${encodePath(normalized)}`
}

describe('file address round-trip', () => {
  it('returns a slash-separated path for a Windows absolute path', () => {
    const address = hostAddress('sess-1', 'E:\\workspace\\papers\\a.pdf')
    const parsed = parseFileAddress(address)
    expect(parsed?.sessionId).toBe('sess-1')
    // The regression: keeping backslashes here made readBytes fail silently.
    expect(parsed?.path).toBe('E:/workspace/papers/a.pdf')
    expect(parsed?.path).not.toContain('\\')
  })

  it('round-trips a workspace-relative path unchanged', () => {
    const address = hostAddress('sess-2', 'papers/main.pdf')
    expect(parseFileAddress(address)).toEqual({ sessionId: 'sess-2', path: 'papers/main.pdf' })
  })

  it('decodes the drive colon segment', () => {
    const address = hostAddress('s', 'D:\\work\\x.pdf')
    expect(address).toContain('D%3A')
    expect(parseFileAddress(address)?.path.startsWith('D:/')).toBe(true)
  })

  it('survives spaces and CJK in the path', () => {
    const address = hostAddress('s', 'E:\\资料\\我的 论文.pdf')
    expect(parseFileAddress(address)?.path).toBe('E:/资料/我的 论文.pdf')
  })

  it('ignores query and fragment suffixes', () => {
    const address = `${hostAddress('s', 'a/b.pdf')}#p=3`
    expect(parseFileAddress(address)?.path).toBe('a/b.pdf')
  })

  it('rejects non-session scopes and empty paths', () => {
    expect(parseFileAddress('dsh-resource://file/absolute/x.pdf')).toBeUndefined()
    expect(parseFileAddress('dsh-resource://file/session/s1')).toBeUndefined()
    expect(parseFileAddress('https://example.com/a.pdf')).toBeUndefined()
  })

  it('handles absolute addresses only with current session context', () => {
    expect(parseFileAddress('dsh-resource://file/absolute/E%3A/a.pdf', 's')).toEqual({sessionId:'s',path:'E:/a.pdf'})
  })
})
