import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import '../i18n.ts'
import { Home } from './Home.tsx'

const noop = () => {}

describe('Home', () => {
  it('shows translated text and a value computed by @course-setter/core', () => {
    const html = renderToString(<Home auth={{ status: 'loading' }} onSignIn={noop} onSignOut={noop} />)
    expect(html).toContain('Course setter')
    expect(html).toContain('66.7 mm')
    expect(html).toContain('Checking sign-in')
  })

  it('offers Google sign-in when signed out', () => {
    const html = renderToString(<Home auth={{ status: 'signedOut' }} onSignIn={noop} onSignOut={noop} />)
    expect(html).toContain('Sign in with Google')
    expect(html).not.toContain('Sign out')
  })

  it('shows the name and a sign-out button when signed in', () => {
    const html = renderToString(<Home auth={{ status: 'signedIn', name: 'Ada' }} onSignIn={noop} onSignOut={noop} />)
    expect(html).toContain('Signed in as Ada.')
    expect(html).toContain('Sign out')
    expect(html).not.toContain('Sign in with Google')
  })
})
