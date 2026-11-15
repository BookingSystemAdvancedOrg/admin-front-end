/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { helpCorpusPlugin } from './scripts/help-corpus.mjs'
import { WHATS_NEW, latestN } from './src/whatsNew.ts'

/**
 * "Nytt i versionen" / "What's new": bäddar in högsta n som __WHATS_NEW_N__
 * och lägger hela listan som whats-new.json i dist (deployen laddar upp den
 * med no-cache). I dev serveras samma fil av dev-servern.
 */
function whatsNewPlugin(): Plugin {
  const json = JSON.stringify({ entries: WHATS_NEW })
  return {
    name: 'booqy-whats-new',
    config: () => ({ define: { __WHATS_NEW_N__: JSON.stringify(latestN(WHATS_NEW)) } }),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'whats-new.json', source: json })
    },
    configureServer(server) {
      server.middlewares.use('/whats-new.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(json)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_BASE_URL ?? ''
  // I dev proxas alla API-anrop genom dev-servern (samma origin) istället för
  // att webbläsaren pratar direkt med API Gateway. Det gör lokal inloggning
  // oberoende av API:ts CORS-allowlist - den listan täcker bara de deployade
  // domänerna, inte localhost. Bygget (npm run build) påverkas inte: där
  // används VITE_API_BASE_URL från .env / project.env som vanligt.
  const useDevProxy = mode === 'development' && /^https?:/.test(apiTarget)

  return {
    plugins: [react(), helpCorpusPlugin(), whatsNewPlugin()],
    // Egen cache-mapp för testkörningar - annars kan `npm test` krocka med en
    // samtidigt körande `npm run dev` som skriver till samma node_modules/.vite.
    cacheDir: mode === 'test' ? 'node_modules/.vitest' : 'node_modules/.vite',
    // Skriver om API-bas-URL:en till den proxade sökvägen i dev, så att
    // fetch-anropen går same-origin (localhost:7070/api/...) och proxyn nedan
    // vidarebefordrar dem till det riktiga API:t.
    define: useDevProxy
      ? { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') }
      : {},
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      globals: true,
      // desktop/ har egna tester för node:test (npm test i desktop/).
      exclude: [...configDefaults.exclude, 'desktop/**'],
    },
    server: {
      // 8081 krockar med Docker Desktop och 8090 med ett Wondershare-verktyg
      // på den här datorn. strictPort så att dev-servern inte tyst byter port.
      port: 7070,
      strictPort: true,
      proxy: useDevProxy
        ? {
            '/api': {
              target: apiTarget,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/api/, ''),
            },
          }
        : undefined,
    },
  }
})
