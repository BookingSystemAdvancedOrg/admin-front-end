import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // API:ets CORS-policy (x-amazon-apigateway-cors i infra-repot) tillåter
    // bara http://localhost:8081 som lokal origin — inte Vites standard 5173.
    // strictPort så att dev-servern inte tyst byter till en annan port och
    // CORS-blockeras igen.
    port: 8081,
    strictPort: true,
  },
})
