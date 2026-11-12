import { describe, expect, it, vi } from 'vitest'
import { observeAdmission } from '../src/client/protocol/admission'
describe('native admission evidence',()=>{
 const setup=()=>{
  let state:{nodes:any[];queue:any[];promptError?:unknown}={nodes:[],queue:[]};const listeners=new Set<()=>void>();
  const session={getSnapshot:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}}};
  return {ctx:{sessions:{binding:()=>({session})}},set:(next:Partial<typeof state>)=>{state={...state,...next};listeners.forEach(f=>f())},listeners}
 }
 it('does not accept empty draft or local echoes, times out and cleans subscriptions',async()=>{
  vi.useFakeTimers();try{const h=setup();const p=observeAdmission(h.ctx,'s','block')!.start(()=>{});await vi.advanceTimersByTimeAsync(15001);expect(await p).toBe(false);expect(h.listeners.size).toBe(0)}finally{vi.useRealTimers()}
 })
 it('accepts a newly admitted durable user row',async()=>{
  const h=setup();const p=observeAdmission(h.ctx,'s','block')!.start(()=>{h.set({nodes:[{seq:1,id:'new',kind:'user',content:[{type:'text',text:'block\nquestion'}]}]})});expect(await p).toBe(true);expect(h.listeners.size).toBe(0)
 })
 it('does not mistake an old queued message moving to history for this submission',async()=>{
  const h=setup();const old={id:'old',content:[{type:'text',text:'block'}]};h.set({queue:[old]});const p=observeAdmission(h.ctx,'s','block')!.start(()=>h.set({queue:[],nodes:[{...old,seq:2,kind:'user'}],promptError:{op:'send'}}));expect(await p).toBe(false)
 })
 it('accepts new inbox/queue identity and refuses hosts without evidence',async()=>{
  const h=setup();expect(await observeAdmission(h.ctx,'s','block')!.start(()=>h.set({queue:[{id:'new',content:[{type:'text',text:'block'}]}]}))).toBe(true);expect(observeAdmission({},'s','block')).toBeUndefined()
 })
})
