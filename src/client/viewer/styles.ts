/**
 * Stylesheet installation for the reader.
 *
 * The pdf.js text layer is only selectable when its stylesheet is present: the
 * spans it builds are transparent, absolutely positioned, and sized from CSS
 * custom properties. Without these rules text is unhittable and no selection
 * can form — the annotation toolbar never appears.
 *
 * Compatibility note: the host's built-in PDF preview defines the same
 * `.textLayer` rules (it ships the same pdf.js sheet), so re-declaring them is
 * idempotent rather than a restyle — verified against
 * `dsh-client-ui-sidebar-documentpreview/lib/client.pdf.js`, and the same
 * global-injection approach dsh-cite-lens uses on this host. The plugin's own
 * classes are all `pm-` prefixed so nothing of ours can collide.
 */
import textLayerCss from './textlayer.css'

const STYLE_ID = 'dsh-paper-margin-style'

let installed = false

export function ensureStyles(): void {
  if (installed) return
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) {
    installed = true
    return
  }
  const style = document.createElement('style')
  style.id = STYLE_ID
  // The host's client-modules only removes <style> tags it can attribute to a
  // package on unload; without this marker the sheet outlives the plugin.
  style.setAttribute('data-plugin-css', 'dsh-paper-margin')
  style.textContent = [
    textLayerCss,
    // Our own rules, every selector `pm-` prefixed or attribute-scoped.
    '.pm-flash { outline: 2px solid rgba(230,160,0,.9); outline-offset: -2px; }',
    '[data-paper-margin-annotate]:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }',
    '[data-paper-margin-mark] { z-index: 3; }',
    '[data-paper-margin-scroll] .textLayer { z-index: 2; }',
    '[data-paper-margin-page] canvas { position: relative; z-index: 1; }',
    // pagelinks.ts registers this custom-highlight name; without a paint rule
    // the citation range exists but stays invisible.
    '::highlight(dsh-paper-margin-cite) { background-color: rgba(47,136,255,.22); text-decoration: underline rgba(47,136,255,.7); }',
  ].join('\n')
  document.head.appendChild(style)
  installed = true
}

/** Test seam: forget that the tag exists (the tag itself is left in place). */
export function resetStylesForTests(): void {
  installed = false
}
