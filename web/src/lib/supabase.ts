// web/src/lib/supabase.ts
// Supabase client helpers — server and browser variants.

import { createClient } from '@supabase/supabase-js'

// ── Types ──────────────────────────────────────────────────────────────────
export type Role = 'publisher' | 'advertiser'

export interface Profile {
  id: string
  role: Role
  created_at: string
}

export interface SlotRow {
  id: number
  slot_id: number
  publisher_id: string
  title: string
  description: string | null
  floor_price_eth: string
  created_at: string
}

// ── Supabase URL / Keys ────────────────────────────────────────────────────
// VITE_ prefixed vars are safe to expose to the browser (anon key only).
// SUPABASE_SERVICE_KEY is server-side only — never shipped to the browser.
function getEnv(key: string): string {
  // Works in both Vite/browser (import.meta.env) and server (process.env)
  const val =
    (typeof import.meta !== 'undefined' ? (import.meta.env as Record<string, string>)?.[key] : undefined) ??
    (typeof process !== 'undefined' ? process.env[key] : undefined)
  if (!val) throw new Error(`Missing env var: ${key}`)
  return val
}

// ── Browser client (uses anon key — respects RLS) ──────────────────────────
export function getSupabaseBrowserClient() {
  return createClient(
    getEnv('VITE_SUPABASE_URL'),
    getEnv('VITE_SUPABASE_ANON_KEY'),
  )
}

// ── Server client (uses service role key — bypasses RLS for admin ops) ─────
export function getSupabaseServerClient() {
  return createClient(
    getEnv('VITE_SUPABASE_URL'),
    getEnv('SUPABASE_SERVICE_KEY'),
  )
}
