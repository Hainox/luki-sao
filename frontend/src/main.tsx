import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import toast, { Toaster } from 'react-hot-toast'
import { RefreshCw } from 'lucide-react'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'

// registerType: 'prompt' (vite.config.ts): новый service worker ждёт клика
// «Обновить». Тихо применять его нельзя: регистрация одна на весь origin, и
// skipWaiting из фоновой вкладки перезагрузил бы и ту, где сейчас
// загружается фото (так уже терялись фото в журнале обходов).
let updateSW: (reloadPage?: boolean) => Promise<void> = async () => {}

updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    toast(
      (t) => (
        <div className="flex items-center gap-3">
          <span>Доступна новая версия приложения</span>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(t.id)
              void updateSW(true)
            }}
            className="btn-primary min-h-10 shrink-0 px-3 text-sm"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Обновить
          </button>
        </div>
      ),
      { id: 'sw-update', duration: Infinity },
    )
  },
  onRegisteredSW(_url, registration) {
    if (registration) setInterval(() => registration.update(), 60 * 60 * 1000)
  },
  onRegisterError(error) {
    console.error('Ошибка регистрации service worker', error)
  },
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-center"
          toastOptions={{
            style: { borderRadius: '12px', background: '#0f172a', color: '#fff', fontSize: '15px', maxWidth: '380px' },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
