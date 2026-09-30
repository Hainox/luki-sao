import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Layout from '@/components/Layout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import CardDetailPage from '@/pages/CardDetailPage'
import JournalPage from '@/pages/JournalPage'
import LoginPage from '@/pages/LoginPage'
import NewCardPage from '@/pages/NewCardPage'
import ReviewPage from '@/pages/ReviewPage'
import SummaryPage from '@/pages/SummaryPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequirePrefecture({ children }: { children: React.ReactNode }) {
  const isPrefecture = useAuthStore((s) => s.user?.is_prefecture)
  if (!isPrefecture) return <Navigate to="/" replace />
  return <>{children}</>
}

// При открытии приложения сверяем сессию с сервером: истёкший токен сразу
// ведёт на вход (а не на пустые экраны), а роль и район — всегда актуальные.
function useSyncUser() {
  const token = useAuthStore((s) => s.token)
  const setUser = useAuthStore((s) => s.setUser)
  const { data } = useQuery({ queryKey: ['me', token], queryFn: authApi.me, enabled: Boolean(token), staleTime: 0 })
  useEffect(() => {
    if (data) setUser(data)
  }, [data, setUser])
}

export default function App() {
  useSyncUser()
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<JournalPage />} />
          <Route path="cards/new" element={<NewCardPage />} />
          <Route path="cards/:id" element={<CardDetailPage />} />
          <Route
            path="review"
            element={
              <RequirePrefecture>
                <ReviewPage />
              </RequirePrefecture>
            }
          />
          <Route path="summary" element={<SummaryPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}
