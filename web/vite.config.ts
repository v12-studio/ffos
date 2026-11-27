import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from /<repo>/; the deploy workflow sets VITE_BASE.
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Family Finance OS',
        short_name: 'FFOS',
        description: 'Track family income, expenses and future commitments together.',
        theme_color: '#1b4332',
        background_color: '#f6f7f9',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Long-press the installed app's icon (Android) → "Add expense" opens straight on the keypad.
        // HashRouter, so the query lives after the #; AppShell opens the sheet when it sees ?add.
        shortcuts: [
          {
            name: 'Add expense',
            short_name: 'Add',
            url: `${base}#/?add=expense`,
            icons: [{ src: 'pwa-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        // Only the app shell is cached; API calls (another origin) always go to the network.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Inter ships a file per script; only Latin is needed up front (others still load on demand when online).
        globIgnores: ['**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2'],
        navigateFallback: 'index.html',
        // Reminder notifications: push and notification-tap handlers (public/push-sw.js).
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Libraries change far less often than app code: a separate chunk stays cached across deploys.
        manualChunks: (id) => {
          if (/node_modules\/(react|react-dom|scheduler|react-router|@tanstack)\//.test(id)) return 'vendor';
          if (id.includes('node_modules/lucide-react/')) return 'icons';
        },
      },
    },
  },
  server: { port: 5173 },
});
