import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { parse } from 'yaml'

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const require = createRequire(import.meta.url)

it('ships a single bundle entry without the former companion dependency', () => {
  const manifest = JSON.parse(read('package.json'))
  expect(parse(read('cordis.patch.yml'))).toEqual([{ insert: [{ id: 'side-chat', name: 'dsh-paper-margin' }] }])
  expect({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies }).not.toHaveProperty('dsh-sidenote')
  expect(manifest.files).toContain('lib/migrate-profile.cjs')
})

it('loads the built reader/chat client with only DSH shared modules and class-map CSS', () => {
  const source = read('lib/client.js')
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
  const allowed = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives', 'cordis'])
  let client: { inject: string[]; apply: unknown } | undefined
  const browser = dom.window
  const sandbox = {
    window: browser, document: browser.document, navigator: browser.navigator, console,
    URL, Blob, TextEncoder, TextDecoder, setTimeout, clearTimeout, queueMicrotask,
  }
  Object.assign(browser, { __ModuleLoader__: { load({ id, factory }: { id: string; factory: (load: (specifier: string) => unknown) => typeof client }) {
    expect(id).toBe('dsh-paper-margin')
    client = factory(specifier => {
      expect(allowed.has(specifier), 'unexpected runtime dependency: ' + specifier).toBe(true)
      return specifier === '@deepseek-ai/dsh-client-ui-primitives' ? { Switch: () => null } : require(specifier)
    })
  } } })
  try {
    runInNewContext(source, sandbox, { filename: fileURLToPath(new URL('../lib/client.js', import.meta.url)) })
    expect(client?.apply).toBeTypeOf('function')
    expect(client?.inject).toEqual(expect.arrayContaining(['sessions', 'workspaces', 'configForms', 'documentPreviews', 'sidebarRight']))
    const styles = [...browser.document.querySelectorAll('style[data-plugin-css]')]
    expect(styles.length).toBeGreaterThanOrEqual(4)
    expect(styles.every(style => style.textContent!.includes('{'))).toBe(true)
  } finally { dom.window.close() }
})
