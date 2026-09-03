-- ============================================================================
-- TravelExpense Supabase Database Schema
-- Run this script in your Supabase Dashboard -> SQL Editor
-- ============================================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'user',
    verified BOOLEAN DEFAULT TRUE,
    picture TEXT,
    password_hash TEXT,
    last_active TIMESTAMPTZ,
    whatsapp TEXT DEFAULT '',
    whatsapp_verified BOOLEAN DEFAULT FALSE,
    phone TEXT DEFAULT '',
    telegram_chat_id TEXT DEFAULT '',
    telegram_username TEXT DEFAULT '',
    telegram_verified BOOLEAN DEFAULT FALSE,
    payment_bill_url TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);

-- 2. EXPENSES TABLE
CREATE TABLE IF NOT EXISTS public.expenses (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    location TEXT,
    notes TEXT,
    total NUMERIC(12, 2) DEFAULT 0.00,
    entries JSONB DEFAULT '[]'::jsonb,
    receipts JSONB DEFAULT '[]'::jsonb,
    payment_status TEXT DEFAULT 'pending',
    payment_bill_url TEXT,
    settled_at TIMESTAMPTZ,
    source TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for filtering expenses by user, date, and status
CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON public.expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_payment_status ON public.expenses(payment_status);

-- 3. INVITES TABLE
CREATE TABLE IF NOT EXISTS public.invites (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT,
    role TEXT DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- 4. DELETED USERS TABLE (BLACKLIST)
CREATE TABLE IF NOT EXISTS public.deleted_users (
    id TEXT PRIMARY KEY,
    deleted_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. WHATSAPP AUTH SESSION TABLE
CREATE TABLE IF NOT EXISTS public.whatsapp_auth (
    key TEXT PRIMARY KEY,
    value JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Row Level Security (RLS) & Grant Policies
-- Enables public API access using Supabase Service Role Key / Anon Key
-- ============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deleted_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_auth ENABLE ROW LEVEL SECURITY;

-- Allow unrestricted service and anon access for API backend operations
DROP POLICY IF EXISTS "Allow service all access on users" ON public.users;
CREATE POLICY "Allow service all access on users" ON public.users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service all access on expenses" ON public.expenses;
CREATE POLICY "Allow service all access on expenses" ON public.expenses FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service all access on invites" ON public.invites;
CREATE POLICY "Allow service all access on invites" ON public.invites FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service all access on deleted_users" ON public.deleted_users;
CREATE POLICY "Allow service all access on deleted_users" ON public.deleted_users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service all access on whatsapp_auth" ON public.whatsapp_auth;
CREATE POLICY "Allow service all access on whatsapp_auth" ON public.whatsapp_auth FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON public.users TO anon, authenticated, service_role;
GRANT ALL ON public.expenses TO anon, authenticated, service_role;
GRANT ALL ON public.invites TO anon, authenticated, service_role;
GRANT ALL ON public.deleted_users TO anon, authenticated, service_role;
GRANT ALL ON public.whatsapp_auth TO anon, authenticated, service_role;
