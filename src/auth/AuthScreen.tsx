import { useState, type FormEvent, type ReactNode } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { PeekLogoBadge } from '@/components/ui/PeekLogo'
import { TextInput } from '@/components/ui/TextInput'
import { beginSignIn } from './estivaId'

/**
 * The unauthenticated surface (Phase 3): sign-in / sign-up as a plain
 * page-level form column — badge mark, big left-aligned heading, full-width
 * primary action (user's design reference, 2026-07-09). Email + password
 * only (ruling 2026-07-08); sign-up collects full name and signs straight
 * in — email verification + password reset are deferred until an email
 * service exists (decision 2026-07-09; OTP flows in git history, 737a9fb).
 */
type Mode = 'signIn' | 'signUp'

/** Convex Auth error → what the person should read. */
function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (/InvalidSecret|InvalidAccountId|Invalid credentials/i.test(raw)) return 'Incorrect email or password.'
  if (/already exists/i.test(raw)) return 'An account with this email already exists — sign in instead.'
  if (/Invalid password/i.test(raw)) return 'Password must be at least 8 characters.'
  return 'Something went wrong — please try again.'
}

/** Page-level form column per the design reference: badge mark above a
 *  left-aligned heading, fields, full-width primary action — no card chrome,
 *  straight on the canvas. */
function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center p-6">
      <div className="w-[400px] max-w-full flex flex-col">
        <PeekLogoBadge size={40} />
        <h1 className="text-h1 text-text-primary mt-8">{title}</h1>
        <div className="mt-10">{children}</div>
      </div>
    </div>
  )
}

export function AuthScreen() {
  const { signIn } = useAuthActions()
  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const isSignUp = mode === 'signUp'

  const switchMode = () => {
    setMode(isSignUp ? 'signIn' : 'signUp')
    setError(null)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (pending) return
    setError(null)
    setPending(true)
    void (async () => {
      try {
        await signIn('password', isSignUp ? { email, password, name, flow: 'signUp' } : { email, password, flow: 'signIn' })
        // Success: the AuthGate's <Authenticated> takes over from here.
      } catch (err) {
        setError(friendlyError(err))
      } finally {
        setPending(false)
      }
    })()
  }

  return (
    <AuthCard title={isSignUp ? 'Sign up' : 'Sign in'}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {isSignUp && (
          <Field label="Full name" required>
            <TextInput
              autoFocus
              autoComplete="name"
              placeholder="Ada Lovelace"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        )}
        <Field label="Email" required>
          <TextInput
            autoFocus={!isSignUp}
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" required>
          <TextInput
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            placeholder={isSignUp ? 'At least 8 characters' : '••••••••'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <p className="text-caption text-error-default">{error}</p>}
        <Button
          variant="primary"
          className="w-full h-10"
          disabled={pending || !email || !password || (isSignUp && !name)}
          type="submit"
        >
          {isSignUp ? 'Sign up' : 'Sign in'}
        </Button>
        <div className="flex justify-center">
          {/* Text-only action reuses the Button primitive (muted = the
              system's text button), per design review 2026-07-09. */}
          <Button variant="muted" size="small" type="button" onClick={switchMode}>
            {isSignUp ? 'Have an account? Sign in' : 'No account? Sign up'}
          </Button>
        </div>

        {/* The way in to the identity service (PEEK-104), and the only one: with
            no token yet the app mounts ConvexAuthProvider, so without this
            button there is no path to ever obtaining one. It leaves the page
            entirely — the session that authorises it is a SameSite=Lax cookie on
            the identity origin, which rides top-level navigations and nothing
            else. Sits alongside password sign-in rather than replacing it, until
            PEEK-41 deletes Convex Auth. */}
        <div className="flex items-center gap-3 pt-2">
          <span className="h-px flex-1 bg-border-default" />
          <span className="text-caption text-text-muted">or</span>
          <span className="h-px flex-1 bg-border-default" />
        </div>
        <Button
          variant="outlined"
          className="w-full h-10"
          type="button"
          disabled={pending}
          onClick={() => void beginSignIn('/')}
        >
          Sign in with Estiva ID
        </Button>
      </form>
    </AuthCard>
  )
}
