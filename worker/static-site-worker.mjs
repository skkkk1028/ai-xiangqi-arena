export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/go/model/strong.bin.gz') {
      return proxyBrowserKataGoModel(request)
    }
    if (url.pathname.startsWith('/api/go/katago/')) {
      return proxyKataGo(request, env, url)
    }

    const response = await env.ASSETS.fetch(request)
    const headers = new Headers(response.headers)
    headers.set('Cross-Origin-Opener-Policy', 'same-origin')
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
    headers.set('Cross-Origin-Resource-Policy', 'same-origin')
    if (url.pathname.includes('/engine/')) {
      headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
}

const BROWSER_KATAGO_MODEL_URL =
  'https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz'

async function proxyBrowserKataGoModel(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }

  const upstreamHeaders = new Headers()
  const range = request.headers.get('Range')
  if (range) upstreamHeaders.set('Range', range)
  try {
    const response = await fetch(BROWSER_KATAGO_MODEL_URL, {
      method: request.method,
      headers: upstreamHeaders,
    })
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'public, max-age=14400, stale-while-revalidate=86400')
    headers.set('Cross-Origin-Resource-Policy', 'same-origin')
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch {
    return jsonError(502, 'KATAGO_MODEL_FETCH_FAILED', '浏览器围棋 AI 强模型暂时无法下载。')
  }
}

async function proxyKataGo(request, env, requestUrl) {
  if (!env.KATAGO_ORIGIN || !env.KATAGO_PROXY_SECRET) {
    return jsonError(503, 'KATAGO_NOT_CONFIGURED', 'KataGo AI 服务尚未配置。')
  }
  let upstreamBase
  try {
    upstreamBase = new URL(env.KATAGO_ORIGIN)
  } catch {
    return jsonError(503, 'KATAGO_NOT_CONFIGURED', 'KataGo AI 服务地址无效。')
  }
  if (upstreamBase.protocol !== 'https:' && upstreamBase.hostname !== '127.0.0.1' && upstreamBase.hostname !== 'localhost') {
    return jsonError(503, 'KATAGO_INSECURE_ORIGIN', 'KataGo AI 服务必须使用 HTTPS。')
  }

  const upstreamUrl = new URL(requestUrl.pathname + requestUrl.search, upstreamBase)
  const headers = new Headers(request.headers)
  headers.set('X-KataGo-Proxy-Secret', env.KATAGO_PROXY_SECRET)
  headers.delete('Host')
  headers.delete('CF-Connecting-IP')
  try {
    const upstreamRequest = new Request(upstreamUrl, request)
    const response = await fetch(new Request(upstreamRequest, { headers }))
    const responseHeaders = new Headers(response.headers)
    responseHeaders.set('Cache-Control', 'no-store')
    responseHeaders.set('Cross-Origin-Resource-Policy', 'same-origin')
    responseHeaders.set('X-Content-Type-Options', 'nosniff')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  } catch {
    return jsonError(502, 'KATAGO_UPSTREAM_FAILED', 'KataGo AI 服务连接失败。')
  }
}

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
