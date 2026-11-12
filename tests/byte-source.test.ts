import { describe, expect, it, vi } from 'vitest'
// Exercise the production reader without requiring a browser PDF worker.
vi.mock('pdfjs-dist', () => ({ PDFDataRangeTransport: class { onDataRange() {} } }))
import { openWorkspaceSource, HostRangeTransport, type WorkspaceFilesRemote } from '../src/client/viewer/byte-source'
const remote = (overrides: Partial<WorkspaceFilesRemote> = {}): WorkspaceFilesRemote => ({
 stat: async () => ({ok:true,value:{bytes:141945163,version:'opaque:v1'}}),
 readBytes: async (_s,_p,o) => ({ok:true,value:{data:new Uint8Array(o.range!.length),offset:o.range!.offset,version:'opaque:v1'}}),
 ...overrides,
})
describe('production workspace byte reader', () => {
 it('settles a hung host read on timeout and abort even when the host ignores the signal',async()=>{
  await expect(openWorkspaceSource(remote({stat:()=>new Promise(()=>{})}),'s','a',undefined,10)).rejects.toThrow('超时')
  const controller=new AbortController();const source=await openWorkspaceSource(remote({readBytes:()=>new Promise(()=>{})}),'s','a',undefined,1000);const read=source.read(0,4,controller.signal);controller.abort();await expect(read).rejects.toThrow()
 })
 it('reads a large file using bytes and preserves the opaque string version',async()=>{
  const r=remote(); const spy=vi.spyOn(r,'readBytes'); const s=await openWorkspaceSource(r,'s','a.pdf');
  expect(s.length).toBe(141945163);expect(s.version).toBe('opaque:v1');
  expect((await s.read(141945160,100)).length).toBe(3);expect(spy.mock.calls[0]?.[2]).toEqual({range:{offset:141945160,length:3}})
 })
 it('rejects short reads, wrong offsets and changed source versions',async()=>{
  for(const value of [{data:new Uint8Array(1),offset:0,version:'opaque:v1'},{data:new Uint8Array(4),offset:1,version:'opaque:v1'},{data:new Uint8Array(4),offset:0,version:'opaque:v2'}]){
   const s=await openWorkspaceSource(remote({readBytes:async()=>({ok:true,value})}),'s','a');await expect(s.read(0,4)).rejects.toThrow()
  }
 })
 it('refuses size-only mock contracts and invalid range inputs',async()=>{
  await expect(openWorkspaceSource(remote({stat:async()=>({ok:true,value:{size:4} as never})}),'s','a')).rejects.toThrow('文件大小')
  const s=await openWorkspaceSource(remote(),'s','a');await expect(s.read(-1,3)).rejects.toThrow();await expect(s.read(0,NaN)).rejects.toThrow()
 })
 it('reports range failure instead of answering with an empty chunk',async()=>{
  const source={length:100,version:'v',read:async()=>{throw new Error('refused')}};const t=new HostRangeTransport(source);
  const failed=vi.fn();const data=vi.spyOn(t,'onDataRange');t.onError=failed;t.requestDataRange(0,4);await vi.waitFor(()=>expect(failed).toHaveBeenCalledOnce());expect(data).not.toHaveBeenCalled();t.dispose()
 })
})
