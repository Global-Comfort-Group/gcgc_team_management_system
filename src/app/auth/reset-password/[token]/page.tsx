'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle2, Loader2, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface Target {
  email: string
  name: string | null
}

export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()

  const [target, setTarget] = useState<Target | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!params?.token) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/auth/reset-password/${params.token}`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setLoadError(data.error ?? 'Could not load reset link')
        } else {
          setTarget(data.target)
          setExpiresAt(data.expiresAt)
        }
      } catch {
        if (!cancelled) setLoadError('Network error loading reset link')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [params?.token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    if (password !== confirm) {
      setSubmitError('Passwords do not match')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/auth/reset-password/${params.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSubmitError(data.error ?? 'Could not reset password')
      } else {
        setDone(true)
        setTimeout(() => router.push('/auth/signin'), 2500)
      }
    } catch {
      setSubmitError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading reset link…
        </div>
      </div>
    )
  }

  if (loadError || !target) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              Reset link unavailable
            </CardTitle>
            <CardDescription>{loadError ?? 'This link is no longer valid.'}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/auth/signin">
              <Button variant="outline" className="w-full">Go to sign in</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
              Password updated
            </CardTitle>
            <CardDescription>Redirecting you to sign in…</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            Set a new password for your account. The link expires {expiresAt ? new Date(expiresAt).toLocaleString() : 'soon'}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 flex items-center gap-2 text-sm">
            <Mail className="h-4 w-4 text-slate-400" />
            <span className="font-medium text-slate-900">{target.email}</span>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="password"
                  type={show ? 'text' : 'password'}
                  className="pl-9 pr-9"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShow(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                At least 6 characters with one uppercase letter, one lowercase letter, and a number.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm new password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="confirm"
                  type={showConfirm ? 'text' : 'password'}
                  className="pl-9 pr-9"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {submitError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Updating…</>
              ) : (
                'Reset password'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
