import { expect, it } from 'vitest'
import { pacedTextStream } from '../src/client/viewer/text-stream'

it('keeps every text item and styles while yielding between bounded batches', async () => {
  const items = Array.from({ length: 2000 }, (_, i) => ({ str: 'word ' + i }))
  const input = new ReadableStream({ start(controller) { controller.enqueue({ items, styles: { font: { size: 12 } } }); controller.close() } })
  const reader = pacedTextStream(input, () => false, () => false).getReader()
  let timerRan = false; setTimeout(() => { timerRan = true }, 0)
  const result: unknown[] = []
  for (;;) { const { value, done } = await reader.read(); if (done) break; expect(value.items.length).toBeLessThanOrEqual(128); expect(value.styles.font.size).toBe(12); result.push(...value.items) }
  expect(timerRan).toBe(true); expect(result).toEqual(items)
})

it('stops a paused stream on teardown instead of leaving a pending task', async () => {
  let stopped = false; let cancelled = false
  const input = new ReadableStream({ start(controller) { controller.enqueue({ items: ['a'], styles: {} }) }, cancel() { cancelled = true } })
  const reader = pacedTextStream(input, () => true, () => stopped).getReader()
  const read = reader.read(); setTimeout(() => { stopped = true }, 10)
  expect((await read).done).toBe(true); expect(cancelled).toBe(true)
})
