/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_BASE_URL ?? ''
  // I dev proxas alla API-anrop genom dev-servern (samma origin) istället för
  // att webbläsaren pratar direkt med API Gateway. Det gör lokal inloggning
  // oberoende av API:ts CORS-allowlist — den listan täcker bara de deployade
  // domänerna, inte localhost. Bygget (npm run build) påverkas inte: där
  // används VITE_API_BASE_URL från .env / project.env som vanligt.
  const useDevProxy = mode === 'development' && /^https?:/.test(apiTarget)

  return {
    plugins: [react()],
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
