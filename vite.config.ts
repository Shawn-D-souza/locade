import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
  },
  build: {
    rolldownOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('posthog-js') || id.includes('@posthog/react')) {
            return 'analytics';
          }
          if (id.includes('node_modules/peerjs') || id.includes('node_modules/webrtc-adapter') || id.includes('peerjs-js-binarypack')) {
            return 'peerjs';
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router') || id.includes('node_modules/scheduler')) {
            return 'vendor';
          }
        },
      },
    },
  },
})
