export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request)
    const headers = new Headers(response.headers)
    headers.set('Cross-Origin-Opener-Policy', 'same-origin')
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
    headers.set('Cross-Origin-Resource-Policy', 'same-origin')
    if (new URL(request.url).pathname.includes('/engine/')) {
      headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
}
