'use client'

import { useEffect, useState } from 'react'
import { Key, Plus, Trash2, Copy, Check, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { format } from 'date-fns'

interface ApiTokenRow {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
}

export function ApiTokensCard() {
  const { toast } = useToast()
  const [tokens, setTokens] = useState<ApiTokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showForm, setShowForm] = useState(false)
  // The freshly-created raw token, shown once. Cleared when dismissed.
  const [revealed, setRevealed] = useState<{ name: string; token: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = async () => {
    try {
      const res = await fetch('/api/settings/api-tokens')
      if (res.ok) {
        const data = await res.json()
        setTokens(data.tokens || [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/settings/api-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast({ title: 'Failed to create token', description: err.error, variant: 'destructive' })
        return
      }
      const data = await res.json()
      setRevealed({ name: data.name, token: data.token })
      setNewName('')
      setShowForm(false)
      await load()
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (id: string, name: string) => {
    const res = await fetch(`/api/settings/api-tokens/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast({ title: 'Token revoked', description: `"${name}" can no longer be used.` })
      await load()
    } else {
      toast({ title: 'Failed to revoke token', variant: 'destructive' })
    }
  }

  const copyToken = () => {
    if (!revealed) return
    navigator.clipboard.writeText(revealed.token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="border border-slate-200 rounded-xl shadow-sm">
      <CardHeader className="pb-3 border-b border-slate-100">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <div className="p-2 bg-slate-100 rounded-lg">
            <Key className="h-4 w-4 text-slate-600" />
          </div>
          API Tokens
        </CardTitle>
        <CardDescription>
          Personal tokens for the public task API. Give one to an agent/LLM to create tasks on your behalf.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {/* One-time reveal of a freshly created token */}
        {revealed && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-800 text-sm font-medium">
              <AlertCircle className="h-4 w-4" />
              Copy your token now — you won&apos;t be able to see it again.
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-white border border-amber-200 px-3 py-2 text-xs text-slate-800">
                {revealed.token}
              </code>
              <Button size="sm" variant="outline" onClick={copyToken}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>
              Done
            </Button>
          </div>
        )}

        {/* Existing tokens */}
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-slate-500">No tokens yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{t.name}</p>
                  <p className="text-xs text-slate-500">
                    Created {format(new Date(t.createdAt), 'MMM d, yyyy')}
                    {t.lastUsedAt
                      ? ` · Last used ${format(new Date(t.lastUsedAt), 'MMM d, yyyy')}`
                      : ' · Never used'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={() => handleRevoke(t.id, t.name)}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* Create form */}
        {showForm ? (
          <div className="flex items-center gap-2">
            <Input
              placeholder="Token name (e.g. my-agent)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <Button size="sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? 'Creating…' : 'Generate'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setNewName('') }}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Generate token
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
