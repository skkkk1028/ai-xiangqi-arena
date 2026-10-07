import type { KataGoTransport } from './KataGoTransport'

export async function createConfiguredKataGoTransport(options: { isolated?: boolean } = {}): Promise<KataGoTransport> {
  if (import.meta.env.VITE_KATAGO_BRIDGE === '1') {
    const { HttpKataGoTransport } = await import('./KataGoTransport')
    return new HttpKataGoTransport()
  }
  const { BrowserKataGoTransport } = await import('./BrowserKataGoTransport')
  return new BrowserKataGoTransport(options)
}
