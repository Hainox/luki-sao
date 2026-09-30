import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt', а не 'autoUpdate': новая версия применяется только по
      // кнопке «Обновить» (см. src/main.tsx), чтобы не перезагрузить
      // вкладку посреди загрузки фото в поле.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Люки САО',
        short_name: 'Люки САО',
        description: 'Журнал самоконтроля неудовлетворительных ОЛХ в районах САО',
        lang: 'ru',
        theme_color: '#1440B8',
        background_color: '#F4F6FB',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Иначе SPA-фолбэк перехватывает навигацию на /api/… и /uploads/…
        // (например, открытие фото в новой вкладке) и отдаёт index.html.
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        // Матчеры — функции по pathname: RegExp в Workbox сверяется с полным
        // URL (https://…), и шаблон с ^/api никогда бы не сработал.
        runtimeCaching: [
          {
            // Ответы API зависят от Authorization, а Workbox не включает
            // этот заголовок в ключ кэша — ответ одного сотрудника мог бы
            // достаться другому на общем телефоне.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            // Фото неизменяемы (имя — случайный UUID), превью можно смело
            // держать в кэше, чтобы журнал листался без повторных загрузок.
            urlPattern: ({ url }) => url.pathname.startsWith('/uploads/thumbs/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'thumbs',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
