import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App.tsx'
import { SessionContext, useSupabaseSession } from './auth/useSession.ts'
import './i18n.ts'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

function Root() {
  const session = useSupabaseSession()
  const userId = session === undefined ? undefined : (session?.user.id ?? null)
  const previousUserId = useRef(userId)
  // After signing out or switching account, nobody may see the previous user's cached data. Only on an
  // actual change: clearing during the first load would drop the queries that just started.
  useEffect(() => {
    if (previousUserId.current !== undefined && previousUserId.current !== userId) queryClient.clear()
    previousUserId.current = userId
  }, [userId])
  return (
    <SessionContext value={session}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </SessionContext>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
