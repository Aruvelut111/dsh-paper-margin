export function parseFileAddress(address: string, currentSession = ''): { sessionId: string; path: string } | undefined {
  const prefix = 'dsh-resource://file/'
  const clean = String(address ?? '')
  if (!clean.startsWith(prefix)) return undefined
  const end = clean.search(/[?#]/)
  const body = end === -1 ? clean.slice(prefix.length) : clean.slice(prefix.length, end)
  const [scope, ...rest] = body.split('/')
  if (scope === 'absolute' && currentSession) {
    try {
      const unc = rest[0] === '' && rest.length > 1
      const parts = (unc ? rest.slice(1) : rest).map(decodeURIComponent)
      if (!parts[0]) return undefined
      const decoded = parts.join('/')
      const path = unc ? `//${decoded}` : /^[A-Za-z]:$/.test(parts[0]) ? decoded : `/${decoded}`
      return { sessionId: currentSession, path }
    } catch { return undefined }
  }
  if (scope !== 'session') return undefined
  const [rawId, ...segments] = rest
  if (rawId === undefined || rawId === '' || segments.length === 0) return undefined
  try {
    return {
      sessionId: decodeURIComponent(rawId),
      path: segments.map(decodeURIComponent).join('/'),
    }
  } catch {
    return undefined
  }
}
