import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const geojsonDir = resolve(__dirname, 'lbn_admin_boundaries.geojson')

export default defineConfig({
  plugins: [
    react(),
    // Serve GeoJSON files at /geojson/* from the existing lbn_admin_boundaries.geojson/ folder
    // so the source files don't need to be copied into public/
    {
      name: 'geojson-serve',
      configureServer(server) {
        server.middlewares.use('/geojson', (req, res, next) => {
          const file = (req.url ?? '').replace(/^\//, '').split('?')[0]
          if (!file) return next()
          const fp = resolve(geojsonDir, file)
          // security: stay inside geojsonDir
          if (!fp.startsWith(geojsonDir) || !existsSync(fp)) return next()
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'public, max-age=600')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          createReadStream(fp).pipe(res as any)
        })
      },
    },
  ],
})
