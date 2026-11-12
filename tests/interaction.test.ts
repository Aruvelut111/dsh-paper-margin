// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createAnnotationStore } from '../src/client/annotate/store'
import { createAnnotation } from '../src/client/annotate/model'
import { renderAnnotationPanel } from '../src/client/annotate/panel'
import { appendToDraft, sendDirect } from '../src/client/protocol/composer'
const note = (id = 'a', sessionId = 's') => createAnnotation({ id, file: '测试.md', page: 0, quote: '<script>原文</script>', rects: [], createdAt: 1, sessionId })
afterEach(() => { document.body.replaceChildren(); localStorage.clear() })
describe('real annotation panel', () => {
 it('mounts DOM, edits continuously, keeps focus and persists Chinese text', () => {
  const store = createAnnotationStore(localStorage); store.add('md', note())
  const container = document.createElement('div'); document.body.append(container)
  const off = renderAnnotationPanel(container, store, 'md', '测试', { onSendDraft: async () => true, onSendDirect: async () => false })
  const input = container.querySelector('textarea')!; input.focus()
  for (const value of ['中', '中文', '中文备注']) { input.value = value; input.dispatchEvent(new Event('input')); expect(container.querySelector('textarea')).toBe(input); expect(document.activeElement).toBe(input) }
  expect(createAnnotationStore(localStorage).list('md')[0]?.note).toBe('中文备注')
  expect(container.querySelector('script')).toBeNull(); off()
 })
 it('retains notes on rejected draft and marks only accepted batches', async () => {
  const store = createAnnotationStore(localStorage); store.add('md', note())
  let accepted = false
  const c = document.createElement('div');document.body.append(c)
  const off=renderAnnotationPanel(c,store,'md','测试',{onSendDraft: async () => accepted,onSendDirect:async()=>false})
  const button=c.querySelector<HTMLButtonElement>('[data-paper-margin-draft]')!
  button.click(); await Promise.resolve();await Promise.resolve();expect(store.list('md')[0]?.state).toBe('active')
  accepted=true;button.click();await Promise.resolve();await Promise.resolve();expect(store.list('md')[0]?.state).toBe('sent')
  const input=c.querySelector('textarea')!;input.value='补充';input.dispatchEvent(new Event('input'));expect(store.list('md')[0]?.state).toBe('active');off()
 })
 it('keeps an in-memory copy and reports storage quota failure',()=>{
  const broken={getItem:()=>null,setItem:()=>{throw new Error('quota')},removeItem:()=>{},length:0,key:()=>null} as unknown as Storage
  const store=createAnnotationStore(broken);store.add('a',note());expect(store.list('a')).toHaveLength(1);expect(store.persistenceError?.()).toContain('未能持久保存')
 })
})
describe('composer preservation',()=>{
 it('uses CAS insertion without destroying reference chips',()=>{
  let state={draft:'用户问题',phase:'plain',draftRev:1,occurrences:[{}]}
  const input={state:{getSnapshot:()=>state,subscribe:()=>()=>{}},setDraft:()=>{throw new Error('destructive')},insertText:(text:string)=>{state={...state,draft:text+state.draft};return true}}
  expect(appendToDraft(input,'批注')).toBe(true);expect(state.draft).toBe('批注\n\n用户问题')
 })
 it('does not falsely accept a phase change or erase rejected drafts',async()=>{
  let state={draft:'原问题',phase:'plain',draftRev:1,promptError:undefined as unknown};const listeners=new Set<()=>void>()
  const input={state:{getSnapshot:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}}},setDraft:(draft:string)=>{state={...state,draft}},submit:()=>{state={...state,phase:'adjudicating'};for(const fn of listeners)fn();state={...state,phase:'plain',promptError:{op:'send'}};for(const fn of listeners)fn()}}
  const session = {getSnapshot:()=>({nodes:[],promptError:state.promptError}),subscribe:input.state.subscribe}
  const ctx={sessions:{scope:()=>({}),binding:()=>({session})},get:()=>({input:{for:()=>input}})}
  expect(await sendDirect(ctx,'s','批注')).toBe(false);expect(state.draft).toBe('批注\n\n原问题')
 })
})
