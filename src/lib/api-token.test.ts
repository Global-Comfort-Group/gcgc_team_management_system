import { describe, it, expect } from 'vitest'
import {
  generateRawToken,
  hashToken,
  API_TOKEN_PREFIX,
} from './api-token'

describe('api-token helpers', () => {
  it('generates prefixed, unique raw tokens', () => {
    const a = generateRawToken()
    const b = generateRawToken()
    expect(a.startsWith(API_TOKEN_PREFIX)).toBe(true)
    expect(a).not.toEqual(b)
    // 32 random bytes base64url ≈ 43 chars, plus the prefix
    expect(a.length).toBeGreaterThan(40)
  })

  it('hashes deterministically and irreversibly', () => {
    const raw = generateRawToken()
    const h1 = hashToken(raw)
    const h2 = hashToken(raw)
    expect(h1).toEqual(h2) // deterministic — enables lookup
    expect(h1).toMatch(/^[a-f0-9]{64}$/) // sha-256 hex
    expect(h1).not.toContain(raw) // hash never contains the secret
  })

  it('produces different hashes for different tokens', () => {
    expect(hashToken(generateRawToken())).not.toEqual(hashToken(generateRawToken()))
  })
})
