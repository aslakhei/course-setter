import { signInWithGoogle, signOut, useDisplayName, useSession } from './auth/useSession.ts'
import { type AuthState, Home } from './components/Home.tsx'

export function App() {
  const session = useSession()
  const displayName = useDisplayName(session)

  const auth: AuthState =
    session === undefined
      ? { status: 'loading' }
      : session === null
        ? { status: 'signedOut' }
        : { status: 'signedIn', name: displayName ?? session.user.email ?? '' }

  return <Home auth={auth} onSignIn={() => void signInWithGoogle()} onSignOut={() => void signOut()} />
}
