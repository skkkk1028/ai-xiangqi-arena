import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../../worker/static-site-worker.mjs'

describe('KataGo same-origin worker proxy', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fails closed when the upstream is not configured', async () => {
    const response = await worker.fetch(new Request('https://site.example/api/go/katago/session', {
      method: 'POST',
    }), { ASSETS: { fetch: vi.fn() } })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'KATAGO_NOT_CONFIGURED' })
  })

  it('adds the private proxy secret and streams the upstream response', async () => {
    const upstream = vi.fn(async (request) => {
      expect(request.url).toBe('https://gpu.example/api/go/katago/analyze')
      expect(request.headers.get('x-katago-proxy-secret')).toBe('bridge-secret')
      return new Response('{"type":"analysis"}\n', {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    })
    vi.stubGlobal('fetch', upstream)
    const response = await worker.fetch(new Request('https://site.example/api/go/katago/analyze', {
      method: 'POST',
      headers: { Origin: 'https://site.example' },
      body: '{}',
    }), {
      KATAGO_ORIGIN: 'https://gpu.example',
      KATAGO_PROXY_SECRET: 'bridge-secret',
      ASSETS: { fetch: vi.fn() },
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('analysis')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
