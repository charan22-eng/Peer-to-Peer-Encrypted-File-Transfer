import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(), 
    tailwindcss(),
    VitePWA({ 
      registerType: 'autoUpdate',
       includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Peer/Link',
        short_name: 'PeerLink',
        description: 'P2P File Transfer Platform',
        theme_color: '#000000',
         icons: [
           {
             src: 'favicon.svg',
             sizes: 'any',
             type: 'image/svg+xml'
           }
         ]
      }
    })
  ],
})
