import { createHash, randomBytes } from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

// Raw tokens are prefixed so they're easy to spot in logs/agents and to
// distinguish from other secrets. Only the SHA-256 hash is ever stored.
export const API_TOKEN_PREFIX = 'gcgc_'

/** Generate a new random raw API token (shown to the user exactly once). */
export function generateRawToken(): string {
  return API_TOKEN_PREFIX + randomBytes(32).toString('base64url')
}

/** SHA-256 hex of a raw token. Deterministic — used for storage and lookup. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export interface ApiTokenUser {
  id: string
  name: string | null
  email: string
  role: string
}

export interface ApiTokenAuth {
  tokenId: string
  user: ApiTokenUser
}

/** Extract the raw bearer token from an Authorization header, or null. */
export function extractBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  const raw = match?.[1]?.trim()
  if (!raw || !raw.startsWith(API_TOKEN_PREFIX)) return null
  return raw
}

/**
 * Authenticate a request by its `Authorization: Bearer <token>` header.
 * Returns the owning user (active only) or null when the token is missing,
 * malformed, unknown, revoked, or belongs to a deactivated user.
 * Best-effort updates `lastUsedAt` on success.
 */
export async function authenticateApiToken(
  request: NextRequest
): Promise<ApiTokenAuth | null> {
  const raw = extractBearerToken(request)
  if (!raw) return null

  const tokenHash = hashToken(raw)
  const token = await prisma.apiToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      revokedAt: true,
      user: {
        select: { id: true, name: true, email: true, role: true, isActive: true },
      },
    },
  })

  if (!token || token.revokedAt || !token.user.isActive) return null

  // Fire-and-forget: don't block the request on the write, and never fail it.
  prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {})

  const { isActive, ...user } = token.user
  return { tokenId: token.id, user }
}
