/**
 * Settings page: one card, one switch (direct submit). Rendered into the
 * host's settings.section slot with the same h() discipline as the reader;
 * state rides the host config form via MarginPreferences.
 */
import { h } from './h'
import type { MarginPreferences } from './preferences'

export function registerMarginSettings(ctx: unknown, preferences: MarginPreferences): void {
  const c = ctx as {
    slots: {
      inject(name: string, factory: () => unknown): unknown
      register(definition: Record<string, unknown>, component: unknown): unknown
    }
  }
  c.slots.inject('settings.section', () => c.slots.register({
    name: 'settings.section',
    id: 'dsh-paper-margin',
    label: 'Paper Margin',
    order: 81,
    registrant: 'dsh-paper-margin',
  }, () => MarginSettings(preferences)))
}

function MarginSettings(preferences: MarginPreferences) {
  const React = require('react') as {
    useSyncExternalStore: (subscribe: (fn: () => void) => () => void, getSnapshot: () => unknown) => unknown
  }
  const state = React.useSyncExternalStore(preferences.subscribe, preferences.getSnapshot) as ReturnType<MarginPreferences['getSnapshot']>
  return h('section', { 'aria-label': 'Paper Margin 设置' },
    h('h2', { style: titleStyle }, 'Paper Margin'),
    h('p', { style: descriptionStyle }, '论文阅读与批注：流式大文件、划选锚定、批量回流。'),
    h('div', { style: rowStyle, role: 'group', 'aria-label': '直接发送批注' },
      h('div', { style: copyStyle },
        h('span', { style: labelStyle }, '显示「直接发送」按钮'),
        h('p', { style: hintStyle }, '独立批注面板的可选快捷操作。「加入输入框」始终只添加草稿；接入 sidenote 后随主输入框一起发送。')),
      h('button', {
        role: 'switch',
        'aria-checked': state.directSubmit,
        disabled: state.status !== 'ready' || !state.writable || state.saving,
        title: '显示或隐藏独立面板的直接发送按钮',
        style: state.directSubmit ? switchOnStyle : switchOffStyle,
        onClick: () => { void preferences.setDirectSubmit(!state.directSubmit) },
      }, state.directSubmit ? '开' : '关')),
    state.saving ? h('p', { style: statusStyle }, '保存中…') : null,
    state.status === 'unavailable' ? h('p', { style: errorStyle2 }, '设置服务不可用') : null,
    state.failed ? h('p', { style: errorStyle2 }, '保存失败，请重试') : null)
}

type CSSStyle = Record<string, string | number>
const titleStyle: CSSStyle = { fontSize: 15, fontWeight: 600, margin: '0 0 4px', color: 'var(--dsw-alias-label-primary, inherit)' }
const descriptionStyle: CSSStyle = { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #888)', margin: '0 0 12px' }
const rowStyle: CSSStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '8px 0' }
const copyStyle: CSSStyle = { display: 'flex', flexDirection: 'column', gap: 2 }
const labelStyle: CSSStyle = { fontSize: 13, color: 'var(--dsw-alias-label-primary, inherit)' }
const hintStyle: CSSStyle = { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #888)', margin: 0 }
const statusStyle: CSSStyle = { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #888)' }
const errorStyle2: CSSStyle = { fontSize: 11, color: 'var(--dsw-alias-interactive-text-error, #c33)' }
const switchOnStyle: CSSStyle = {
  minWidth: 44, padding: '4px 10px', borderRadius: 12, border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 12,
  background: 'var(--dsw-alias-interactive-bg-accent, #4d6bfe)', color: '#fff',
}
const switchOffStyle: CSSStyle = {
  minWidth: 44, padding: '4px 10px', borderRadius: 12, border: '0.5px solid var(--dsw-alias-border-l2, #bbb)', cursor: 'pointer', font: 'inherit', fontSize: 12,
  background: 'transparent', color: 'var(--dsw-alias-label-secondary, #888)',
}
