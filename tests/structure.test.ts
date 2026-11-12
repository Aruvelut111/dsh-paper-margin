import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Structural guards for the reader's DOM and wiring contracts.
 *
 * These read source rather than rendering it: the failures they prevent are
 * silent ones — a missing stylesheet, spans parented to the wrong container, a
 * property written onto the guarded ctx, a preview that outranks the host's own
 * — that only show up as "nothing happens" in a real browser. Every case here
 * regressed at least once.
 */
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8')

describe('text layer contract', () => {
  const pdfView = read('src/client/viewer/pdf-view.ts')

  it('creates a dedicated .textLayer container instead of parenting spans to the page', () => {
    expect(pdfView).toContain("textLayerDiv.className = 'textLayer'")
    expect(pdfView).toContain('container: textLayerDiv')
    // The regression: handing the page slot straight to pdf.js.
    expect(pdfView).not.toContain('container: slot')
  })

  it('sets the scale custom properties the text layer CSS reads', () => {
    expect(pdfView).toContain('--scale-factor')
    expect(pdfView).toContain('--total-scale-factor')
  })

  it('appends the text layer inside the page slot so it sits over the canvas', () => {
    expect(pdfView).toMatch(/slot\.appendChild\(textLayerDiv\)/)
  })
})

describe('stylesheet installation', () => {
  const styles = read('src/client/viewer/styles.ts')
  const preview = read('src/client/viewer/preview.tsx')

  it('ships the pdf.js text layer sheet', () => {
    expect(styles).toContain("from './textlayer.css'")
  })

  it('is installed before a preview can mount', () => {
    expect(preview).toContain('ensureStyles()')
  })

  it('declares every own rule with a pm- or attribute-scoped selector', () => {
    const ownRules = [...styles.matchAll(/'((?:\\.|[^'])*(?:\{|:hover)[^']*)'/g)].map((m) => m[1])
    const rules = ownRules.filter((rule) => rule.trim().startsWith('.') || rule.trim().startsWith('['))
    expect(rules.length).toBeGreaterThan(2)
    for (const rule of rules) {
      const selector = rule.slice(0, rule.indexOf('{'))
      expect(selector === '' || selector.includes('pm-') || selector.includes('data-paper-margin')).toBe(true)
    }
  })
})

describe('client ctx discipline', () => {
  const files = [
    'src/client/index.ts',
    'src/client/viewer/preview.tsx',
    'src/client/annotate/store.ts',
    'src/client/annotate/universal.ts',
    'src/client/protocol/pagelinks.ts',
  ]

  it('never writes properties onto the guarded client ctx', () => {
    // The cordis client ctx is a proxy: an unknown property write throws
    // "cannot set property … without provide" and fails activation outright.
    for (const rel of files) {
      const src = read(rel)
      const writes = [...src.matchAll(/^\s*(?:ctx|c)\.(\w+)\s*=\s*(?!undefined)/gm)]
        .map((m) => m[1])
        .filter((name) => !['onScrolled', 'onScroll'].includes(name))
      expect({ rel, writes }).toEqual({ rel, writes: [] })
    }
  })

  it('wraps every effect registration in a factory', () => {
    // effect(fn) CALLS fn; passing a disposer directly runs it immediately and
    // registers its return value as a no-op. That silently disarmed the
    // annotator once.
    const src = read('src/client/index.ts')
    for (const call of src.matchAll(/\.effect\?\.\(([^,]+),/g)) {
      const arg = call[1].trim()
      expect(arg.startsWith('() =>')).toBe(true)
    }
  })

  it('keeps shared state in module scope with explicit accessors', () => {
    const index = read('src/client/index.ts')
    expect(index).toContain('export function sharedRegistry')
    expect(index).toContain('export function setSharedPreferences')
    expect(read('src/client/annotate/store.ts')).toContain('let sharedStore')
  })
})

describe('preview registration', () => {
  const index = read('src/client/index.ts')
  const preview = read('src/client/viewer/preview.tsx')

  it('does not claim Office extensions the host preview already serves', () => {
    // Claiming docx/xlsx/pptx with priority 'extension' outranked the host's
    // 'builtin' definition, so Office files opened in a preview that could not
    // convert them. Office is out of scope by design.
    expect(index).not.toContain('applyOfficePreview')
    expect(preview).not.toContain('OFFICE')
    expect(preview).toContain("extensions: ['pdf']")
  })
})

describe('annotation surfaces', () => {
  const universal = read('src/client/annotate/universal.ts')

  it('excludes this plugin’s own PDF pages', () => {
    // The reader keeps its own capture; listing its page attribute here made a
    // single selection produce two toolbars, one of which wrote to a key no
    // panel renders.
    expect(universal).not.toContain("'[data-paper-margin-page]'")
    expect(universal).toContain("'[data-diff-code]'")
    expect(universal).toContain("'[data-textpreview-body]'")
  })

  it('confirms a committed annotation visibly', () => {
    // Surfaces without a side panel used to swallow the annotation silently.
    expect(universal).toContain('data-paper-margin-toast')
    expect(universal).toContain('say(confirmation')
  })
})

describe('citation surface', () => {
  const pageLinks = read('src/client/protocol/pagelinks.ts')
  const index = read('src/client/index.ts')

  it('targets the host’s real transcript attributes', () => {
    expect(pageLinks).toContain('[data-conversation-content]')
    expect(pageLinks).not.toContain("querySelector('[data-conversation]')")
  })

  it('observes the body, not a root captured before the transcript exists', () => {
    expect(pageLinks).toContain('rescanObserver.observe(doc.body')
  })

  it('does not treat openResource’s void return as a success flag', () => {
    // The host's openResource returns nothing, so `=== true` was always false
    // and every jump claimed the file could not be opened.
    expect(index).not.toContain('openResource?.(address) === true')
    expect(index).toContain('sidebar.openResource(address)')
  })
})

describe('reader error surfacing', () => {
  const preview = read('src/client/viewer/preview.tsx')
  const pdfView = read('src/client/viewer/pdf-view.ts')

  it('awaits the document before reporting ready', () => {
    expect(preview).toContain('await opened.ready')
    expect(preview).toContain('describeOpenFailure')
  })

  it('classifies the failures pdf.js actually raises', () => {
    expect(preview).toContain('PasswordException')
    expect(preview).toContain('InvalidPDFException')
    expect(preview).toContain('MissingPDFException')
  })

  it('reads bytes through the host Remote, not a private HTTP route', () => {
    // A private signed route needs a key, a fence and a mint step; each was a
    // place for the reader to fail with nothing visible. The host's own
    // workspace-files Remote is the supported primitive (the built-in preview
    // injects the same row).
    const view = read('src/client/viewer/pdf-view.ts')
    expect(view).not.toContain('/paper-margin/asset')
    expect(view).not.toContain('mintStreamUrl')
    const source = read('src/client/viewer/byte-source.ts')
    expect(source).toContain('remote.readBytes')
    expect(source).toContain('{ range: { offset, length: clamped } }')
    expect(read('src/client/index.ts')).toContain("'remote.workspaceFiles'")
  })

  it('feeds pdf.js a range transport instead of materializing the file', () => {
    const source = read('src/client/viewer/byte-source.ts')
    expect(source).toContain('extends pdfjs.PDFDataRangeTransport')
    expect(source).toContain('requestDataRange')
    const view = read('src/client/viewer/pdf-view.ts')
    expect(view).toContain('getDocument({ range: transport')
  })
})

describe('silent-failure guards (audit round 2)', () => {
  it('registers the PDF preview as a renderer, not bytes-complete', () => {
    // bytes-complete makes the host read the whole file via readBytes, capped at
    // 32MB, and never touches the signed stream — streaming was dead code.
    const preview = read('src/client/viewer/preview.tsx')
    expect(preview).toContain("loading: 'renderer'")
    expect(preview).not.toContain("loading: 'bytes-complete'")
  })

  it('subscribes to an agent event the host actually emits', () => {
    // agent/session-start does not exist; the guide silently never ran.
    const guide = read('src/host/citation-guide.ts')
    const subscribed = [...guide.matchAll(/ctx\.on\('([^']+)'/g)].map((m) => m[1])
    expect(subscribed).toEqual(['agent/created'])
  })

  it('paints the citation custom-highlight name pagelinks registers', () => {
    const styles = read('src/client/viewer/styles.ts')
    expect(styles).toContain('::highlight(dsh-paper-margin-cite)')
  })

  it('marks its style tag so package unload removes it', () => {
    expect(read('src/client/viewer/styles.ts')).toContain("data-plugin-css")
  })

  it('no longer carries its own HTTP byte route', () => {
    // The private signed route (key file + trust fence + mint endpoint) was
    // replaced by the host's workspace-files Remote; the host half must not
    // re-introduce it.
    const host = read('src/index.ts')
    expect(host).not.toContain('webServer')
    expect(host).not.toContain('/paper-margin/asset')
    expect(host).not.toContain('assetHandler')
  })

  it('never rebuilds a chip-carrying draft with setDraft', () => {
    // setDraft destroys the composer document (and the user's @file chips).
    const composer = read('src/client/protocol/composer.ts')
    expect(composer).toContain('insertText')
    expect(composer).toContain('hasChips')
  })

  it('judges submit acceptance by draft consumption and promptError', () => {
    // "phase left plain" is true during adjudicating, so failures looked sent.
    const composer = read('src/client/protocol/composer.ts')
    expect(composer).toContain('promptError')
    expect(composer).not.toContain("snap.phase !== 'plain') finish(true)")
  })
})

describe('settings schema', () => {
  const host = read('src/index.ts')

  it('exports a Config schema so the settings card is writable', () => {
    // Without a Config export the settings service lists no schema for this
    // entry, the client form stays 'unavailable', and the switch is永久 disabled.
    expect(host).toContain('export const Config')
    expect(host).toContain('directSubmit')
    expect(host).toContain('.volatile()')
  })
})

it('preserves native preview choices and global workspace limits', () => {
  expect(read('cordis.patch.yml')).not.toContain('maxFileBytes')
  expect(read('src/client/viewer/html-preview.ts')).toContain("priority: 'builtin'")
  expect(read('src/client/annotate/image.ts')).not.toContain("addEventListener('contextmenu'")
})
