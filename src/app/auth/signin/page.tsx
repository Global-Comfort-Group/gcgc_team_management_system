'use client'

import { useState, useEffect, Suspense } from 'react'
import { signIn, getSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Space_Grotesk } from 'next/font/google'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Eye, EyeOff, Mail, Lock, AlertCircle, ArrowRight } from 'lucide-react'
import { isAllowedEmailDomain, ALLOWED_EMAIL_MESSAGE } from '@/lib/allowed-email-domains'

// Geometric display face for the brand headline/wordmark — a deliberate pair
// against the app's Inter body text. Loaded only on the auth screen.
const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'] })

// Field error type
interface FieldErrors {
  email?: string
  password?: string
}

/** Brand mark: a board-glyph tile + GCGC wordmark. `tone` adapts to its surface. */
function BrandLockup({ tone = 'light' }: { tone?: 'light' | 'onDark' }) {
  const onDark = tone === 'onDark'
  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-xl ${
          onDark ? 'bg-white/15 ring-1 ring-white/25' : 'bg-blue-600'
        }`}
        aria-hidden
      >
        {/* Two-column board glyph — ties the mark to what the product is */}
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="2" y="3" width="6" height="14" rx="1.5" fill="white" fillOpacity={onDark ? 0.95 : 1} />
          <rect x="12" y="3" width="6" height="9" rx="1.5" fill="white" fillOpacity={onDark ? 0.7 : 0.85} />
        </svg>
      </div>
      <span
        className={`${display.className} text-lg font-bold tracking-tight ${
          onDark ? 'text-white' : 'text-gray-900'
        }`}
      >
        GCGC
      </span>
    </div>
  )
}

function SignInForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/user/dashboard'
  const error_ = searchParams.get('error')

  useEffect(() => {
    if (error_) {
      setError('Invalid email or password. Please try again.')
    }
  }, [error_])

  // Validate a single field
  const validateField = (field: string, value: string): string | undefined => {
    switch (field) {
      case 'email':
        if (!value.trim()) return 'Email is required'
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(value)) return 'Please enter a valid email address'
        if (!isAllowedEmailDomain(value)) return ALLOWED_EMAIL_MESSAGE
        return undefined
      case 'password':
        if (!value) return 'Password is required'
        return undefined
      default:
        return undefined
    }
  }

  // Handle field blur
  const handleBlur = (field: string, value: string) => {
    setTouched(prev => ({ ...prev, [field]: true }))
    const error = validateField(field, value)
    setFieldErrors(prev => ({ ...prev, [field]: error }))
  }

  // Validate all fields
  const validateAllFields = (): boolean => {
    const errors: FieldErrors = {
      email: validateField('email', email),
      password: validateField('password', password)
    }
    setFieldErrors(errors)
    setTouched({ email: true, password: true })
    return !Object.values(errors).some(error => error !== undefined)
  }

  // Error message component
  const FieldError = ({ error }: { error?: string }) => {
    if (!error) return null
    return <p className="mt-1.5 text-sm text-red-600">{error}</p>
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validate all fields first
    if (!validateAllFields()) {
      return
    }

    setIsLoading(true)

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError('Invalid email or password. Please try again.')
        setIsLoading(false)
        return
      }

      // Check user role after successful signin
      const session = await getSession()
      if (session?.user) {
        // Redirect based on role
        if (session.user.role === 'ADMIN') {
          router.push('/admin/dashboard')
        } else if (session.user.role === 'LEADER') {
          router.push('/user/dashboard')
        } else {
          router.push('/user/dashboard')
        }
      } else {
        router.push(callbackUrl)
      }
    } catch (error) {
      setError('An error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <div className="light flex min-h-screen bg-white">
      {/* ───────── Branded hero (lg+) ───────── */}
      <aside className="relative hidden w-[44%] max-w-2xl flex-col justify-between overflow-hidden bg-gradient-to-br from-blue-950 via-blue-800 to-blue-600 p-12 lg:flex">
        {/* Signature: faint Kanban board motif — columns of task cards */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
          preserveAspectRatio="xMidYMid slice"
          viewBox="0 0 440 760"
        >
          {[40, 175, 310].map((x, col) => (
            <g key={col} opacity={0.07}>
              {[120, 230, 340, 450, 560].map((y, row) => (
                <rect
                  key={row}
                  x={x}
                  y={y + col * 28}
                  width="90"
                  height={row % 2 === 0 ? 70 : 52}
                  rx="10"
                  fill="white"
                />
              ))}
            </g>
          ))}
        </svg>
        {/* One disciplined accent glow */}
        <div className="pointer-events-none absolute -right-24 top-1/3 h-72 w-72 rounded-full bg-sky-400/25 blur-3xl" aria-hidden />

        <div className="relative">
          <BrandLockup tone="onDark" />
        </div>

        <div className="relative">
          <h1 className={`${display.className} max-w-md text-4xl font-bold leading-[1.1] tracking-tight text-white xl:text-5xl`}>
            Your team&apos;s work,
            <br />
            in one place.
          </h1>
          <p className="mt-5 max-w-sm text-base leading-relaxed text-blue-100/90">
            Plan tasks on shared boards, organize your teams, and keep everyone
            on the same calendar.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {['Tasks', 'Boards', 'Calendar'].map(tag => (
              <span
                key={tag}
                className="rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-medium text-blue-50 ring-1 ring-inset ring-white/15"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <p className="relative text-sm text-blue-200/70">
          GCGC Team Management System
        </p>
      </aside>

      {/* ───────── Form side ───────── */}
      <main className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          {/* Compact brand lockup — mobile only (hero is hidden) */}
          <div className="mb-8 flex justify-center lg:hidden">
            <BrandLockup tone="light" />
          </div>

          <div className="mb-8">
            <h2 className={`${display.className} text-3xl font-bold tracking-tight text-gray-900`}>
              Welcome back
            </h2>
            <p className="mt-2 text-[15px] text-gray-500">
              Sign in to your GCGC workspace.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div>
              <Label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-700">
                Email address
              </Label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Mail className="h-5 w-5 text-gray-400" />
                </div>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (fieldErrors.email) {
                      setFieldErrors(prev => ({ ...prev, email: undefined }))
                    }
                  }}
                  onBlur={() => handleBlur('email', email)}
                  className={`h-11 bg-white pl-10 text-gray-900 placeholder-gray-400 ${
                    touched.email && fieldErrors.email ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="you@company.com"
                />
              </div>
              {touched.email && <FieldError error={fieldErrors.email} />}
            </div>

            <div>
              <Label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-700">
                Password
              </Label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (fieldErrors.password) {
                      setFieldErrors(prev => ({ ...prev, password: undefined }))
                    }
                  }}
                  onBlur={() => handleBlur('password', password)}
                  className={`h-11 bg-white pl-10 pr-10 text-gray-900 placeholder-gray-400 ${
                    touched.password && fieldErrors.password ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center pr-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-gray-400 transition-colors hover:text-gray-600" />
                  ) : (
                    <Eye className="h-5 w-5 text-gray-400 transition-colors hover:text-gray-600" />
                  )}
                </button>
              </div>
              {touched.password && <FieldError error={fieldErrors.password} />}
            </div>

            {/* Sits directly above the sign-in button, where a user looks after
                a password fails, rather than beside the field label. */}
            <div className="flex justify-end">
              <a
                href="mailto:support@gcgc.com?subject=Password%20reset%20request"
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Forgot password?
              </a>
            </div>

            <Button
              type="submit"
              className="group h-11 w-full bg-blue-600 text-[15px] font-semibold shadow-sm transition-all hover:bg-blue-700 hover:shadow-md"
              disabled={isLoading}
            >
              {isLoading ? (
                <div className="flex items-center">
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                  Signing in…
                </div>
              ) : (
                <span className="flex items-center justify-center gap-1.5">
                  Sign in
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              )}
            </Button>
          </form>

          <div className="mt-8 border-t border-gray-100 pt-6 text-center text-sm text-gray-500">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="font-semibold text-blue-600 hover:text-blue-700">
              Register
            </Link>
            <span className="mx-2 text-gray-300">·</span>
            <a href="mailto:support@gcgc.com" className="font-medium text-gray-500 hover:text-gray-700">
              Contact support
            </a>
          </div>
        </div>
      </main>
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-white">
          <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
      }
    >
      <SignInForm />
    </Suspense>
  )
}
