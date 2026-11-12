/** Shared h() helper for the client bundle: resolves react from the shell
 * module table once, no JSX compile step, no imports beyond the table. */
type ReactFactory = (tag: string, props?: Record<string, unknown>, ...children: unknown[]) => unknown

let factory: ReactFactory | undefined

export function h(tag: string, props?: Record<string, unknown>, ...children: unknown[]): unknown {
  if (factory === undefined) {
    const React = require('react') as { createElement: ReactFactory }
    factory = React.createElement.bind(React)
  }
  return factory(tag, props, ...children)
}
