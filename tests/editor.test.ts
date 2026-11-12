// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { openInlineEditor } from '../src/client/annotate/editor'
afterEach(() => document.body.replaceChildren())
it('edits at the passage, protects IME/Shift+Enter, and prevents chat Enter', () => {
  const save=vi.fn(), draft=vi.fn(); const close=openInlineEditor({quote:'原文',x:20,y:40,save,draft}); const input=document.querySelector('textarea')!
  expect(document.activeElement).toBe(input); input.value='anything <tag> 😀'; input.dispatchEvent(new Event('input')); expect(draft).toHaveBeenLastCalledWith(input.value)
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true})); expect(save).not.toHaveBeenCalled()
  input.dispatchEvent(new CompositionEvent('compositionstart')); input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); expect(save).not.toHaveBeenCalled()
  input.dispatchEvent(new CompositionEvent('compositionend')); const key=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}); input.dispatchEvent(key); expect(key.defaultPrevented).toBe(true); expect(save).toHaveBeenLastCalledWith(input.value); expect(document.querySelector('[data-paper-margin-editor]')).toBeNull(); close()
})
it('preserves typing on outside click and when opening the next selection', () => {
  const save=vi.fn(); openInlineEditor({quote:'one',x:20,y:40,save}); document.querySelector('textarea')!.value='first'
  const close=openInlineEditor({quote:'two',x:20,y:40,save}); expect(save).toHaveBeenLastCalledWith('first'); document.querySelector('textarea')!.value='second'; document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); expect(save).toHaveBeenLastCalledWith('second');close()
})
