// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { createAnnotationStore } from '../src/client/annotate/store'
import { createAnnotation, reviveStore } from '../src/client/annotate/model'
import { exportNotes, importNotes } from '../src/client/annotate/backup'
import { renderAnnotationPanel } from '../src/client/annotate/panel'
import { attachUniversalAnnotator } from '../src/client/annotate/universal'
import { attachImageAnnotations } from '../src/client/annotate/image'
afterEach(()=>{localStorage.clear();document.body.replaceChildren()})
const note=(id:string,sessionId='s')=>createAnnotation({id,sessionId,file:'a.pdf',page:1,quote:'原文',rects:[],createdAt:1})
it('filters corrupt rows without losing valid legacy notes',()=>{
 expect(reviveStore(JSON.stringify({version:1,annotations:[null,{},note('a'),{...note('b'),anchor:null}]})).annotations).toHaveLength(1)
})
it('roundtrips backups, deduplicates and preserves conflicting edits',()=>{
 const store=createAnnotationStore(localStorage);store.add('a',note('a'));const raw=exportNotes(store);
 expect(importNotes(store,raw)).toBe(0);store.update('a','a','新备注');expect(importNotes(store,raw)).toBe(1);expect(store.list('a')).toHaveLength(2);expect(store.list('a')[0]?.note).toBe('新备注')
})
it('validates a complete backup before mutating the store',()=>{
 const store=createAnnotationStore(localStorage);expect(()=>importNotes(store,JSON.stringify({format:'dsh-paper-margin',version:1,sources:[{address:'a',annotations:[note('a')]},{address:'b',annotations:[null]}]}))).toThrow();expect(store.addresses()).toHaveLength(0)
})
it('filters individual notes in shared sources and clears only displayed sent notes',()=>{
 const store=createAnnotationStore(localStorage);store.add('a',{...note('a','s1'),state:'sent'});store.add('a',{...note('b','s2'),state:'sent'});
 const c=document.createElement('div');document.body.append(c);const off=renderAnnotationPanel(c,store,()=>['a'],'session',{include:a=>a.sessionId==='s1',onSendDraft:async()=>true,onSendDirect:async()=>false});
 expect(c.querySelectorAll('article')).toHaveLength(1);[...c.querySelectorAll('button')].find(b=>b.textContent==='清除已带回')!.click();expect(store.list('a').map(a=>a.id)).toEqual(['b']);off()
})
it('offers image notes without intercepting native context, drag, zoom or pan gestures',()=>{
 document.body.innerHTML='<div data-textpreview-url="dsh-resource://file/session/s/a.png"><div data-image-preview><img alt="架构图" src="blob:test"></div></div>';let captured:unknown;const universal=attachUniversalAnnotator({onAnnotate:()=>undefined});const off=attachImageAnnotations(a=>{captured=a;return 'ok'});
 const menu=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});document.querySelector('img')!.dispatchEvent(menu);expect(menu.defaultPrevented).toBe(false);expect(captured).toBeUndefined();
 document.querySelector<HTMLButtonElement>('[data-paper-margin-image] button')!.click();expect(captured).toMatchObject({kind:'image',quote:'架构图',sourceAddress:'dsh-resource://file/session/s/a.png'});off();universal();expect(document.querySelector('[data-paper-margin-image]')).toBeNull()
})
