/** Feed PDF.js small text batches, yielding to selection/input between them.
 * PDF.js's default object input processes a dense page in one microtask. */
export function pacedTextStream(source: ReadableStream, blocked: () => boolean, stopped: () => boolean): ReadableStream {
  const reader = source.getReader()
  let pending: { items: unknown[]; styles: Record<string, unknown>; lang?: string } | undefined
  let offset = 0
  return new ReadableStream({
    async pull(controller) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      while (blocked() && !stopped()) await new Promise<void>(resolve => setTimeout(resolve, 20))
      if (stopped()) { await reader.cancel(); controller.close(); return }
      if (!pending) {
        const next = await reader.read()
        if (next.done) { controller.close(); return }
        pending = next.value; offset = 0
      }
      const chunk = pending!
      controller.enqueue({ ...chunk, items: chunk.items.slice(offset, offset + 128) })
      offset += 128
      if (offset >= chunk.items.length) pending = undefined
    },
    cancel(reason) { return reader.cancel(reason) },
  })
}
