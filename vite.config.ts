import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const kataGoOrigin = env.KATAGO_DEV_ORIGIN || 'http://127.0.0.1:8788'
  return {
    base: './',
    plugins: [react()],
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
      proxy: {
        '/api/go/model/strong.bin.gz': {
          target: 'https://media.katagotraining.org',
          changeOrigin: true,
          rewrite: () => '/uploaded/networks/models/kata1/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz',
        },
        '/api/go/katago': {
          target: kataGoOrigin,
          changeOrigin: true,
          headers: env.KATAGO_PROXY_SECRET
            ? { 'X-KataGo-Proxy-Secret': env.KATAGO_PROXY_SECRET }
            : undefined,
        },
      },
    },
    preview: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    },
    build: {
      outDir: '.vite-output',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          main: 'index.html',
          'browser-validation': 'browser-validation.html',
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: true,
      include: ['src/test/**/*.{test,spec}.{ts,tsx,mjs}'],
    },
  }
})
