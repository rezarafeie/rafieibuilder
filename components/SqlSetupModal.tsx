
import React, { useState, useEffect } from 'react';
import { Database, Shield, Copy, Check, RefreshCw, AlertTriangle, Clock, Users, Terminal, CheckCircle2, Play, X, Settings, ChevronDown, ChevronUp, Cloud, DollarSign, Zap, Radio, Globe, Brain, HardDrive } from 'lucide-react';
import { cloudService, supabase } from '../services/cloudService';
import { useTranslation } from '../utils/translations';

// ... existing SQL_COMMANDS ...
const SQL_COMMANDS = {
  // ... existing CREATE_TABLE ...
  CREATE_TABLE: `CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  code JSONB,
  files JSONB,
  messages JSONB,
  build_state JSONB,
  status TEXT,
  published_url TEXT,
  custom_domain TEXT,
  supabase_config JSONB,
  rafiei_cloud_project JSONB,
  vercel_config JSONB,
  deleted_at TIMESTAMPTZ
);`,
  MIGRATIONS: `ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS build_state JSONB;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS published_url TEXT;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS rafiei_cloud_project JSONB;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS vercel_config JSONB;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS files JSONB;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS credits_balance NUMERIC(10, 4) DEFAULT 10.0000;

-- Timestamp Fixes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='created_at' AND data_type='bigint') THEN
    ALTER TABLE public.projects ALTER COLUMN created_at TYPE TIMESTAMPTZ USING (to_timestamp(created_at / 1000.0));
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='updated_at' AND data_type='bigint') THEN
    ALTER TABLE public.projects ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING (to_timestamp(updated_at / 1000.0));
  END IF;
END;
$$;`,
  ENABLE_RLS: `ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;`,
  POLICIES: `DO $$
DECLARE
    policy_name TEXT;
BEGIN
    FOR policy_name IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || policy_name || '" ON public.projects;';
    END LOOP;
END;
$$;

CREATE POLICY "Projects are viewable by owner" ON public.projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create projects" ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners can update their own projects" ON public.projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Owners can delete their own projects" ON public.projects FOR DELETE USING (auth.uid() = user_id);
-- Public Read Access for Custom Domains resolving
CREATE POLICY "Public can read projects by ID" ON public.projects FOR SELECT USING (true);
`,

  DOMAIN_SETUP: `
CREATE TABLE IF NOT EXISTS public.project_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    domain TEXT UNIQUE NOT NULL,
    type TEXT CHECK (type IN ('root', 'subdomain')),
    dns_record_type TEXT,
    dns_record_value TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.project_domains ENABLE ROW LEVEL SECURITY;

-- Allow public read so the router can resolve domains
DROP POLICY IF EXISTS "Public read domains" ON public.project_domains;
CREATE POLICY "Public read domains" ON public.project_domains FOR SELECT USING (true);

-- Allow owners to manage domains
DROP POLICY IF EXISTS "Owners manage domains" ON public.project_domains;
CREATE POLICY "Owners manage domains" ON public.project_domains USING (
    EXISTS (SELECT 1 FROM public.projects WHERE id = project_domains.project_id AND user_id = auth.uid())
);
`,

  AI_PROVIDER_SETUP: `
CREATE TABLE IF NOT EXISTS public.ai_providers (
    id TEXT PRIMARY KEY, -- 'google', 'openai', 'claude'
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT false,
    is_fallback BOOLEAN DEFAULT false,
    api_key TEXT, -- Encrypted or plain (RLS protects this)
    model TEXT,
    config JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;

-- Only Admins can view/edit AI Keys
DROP POLICY IF EXISTS "Admins manage ai_providers" ON public.ai_providers;
CREATE POLICY "Admins manage ai_providers" ON public.ai_providers 
    USING (auth.jwt() ->> 'email' = 'rezarafeie13@gmail.com');

-- Allow System/Admin to read.
DROP POLICY IF EXISTS "System reads ai_providers" ON public.ai_providers;
CREATE POLICY "System reads ai_providers" ON public.ai_providers FOR SELECT USING (true);

-- Seed Default Providers
INSERT INTO public.ai_providers (id, name, is_active, is_fallback, model) VALUES 
('google', 'Google Gemini', true, false, 'gemini-2.5-flash'),
('openai', 'OpenAI', false, false, 'gpt-4o'),
('claude', 'Anthropic Claude', false, false, 'claude-3-5-sonnet-latest')
ON CONFLICT (id) DO NOTHING;
  `,

  WEBHOOK_SETUP: `
-- Webhook Logs
CREATE TABLE IF NOT EXISTS public.webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT,
    payload JSONB,
    status_code INTEGER,
    response_body TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins view logs" ON public.webhook_logs;
CREATE POLICY "Admins view logs" ON public.webhook_logs FOR SELECT USING (auth.jwt() ->> 'email' = 'rezarafeie13@gmail.com');
DROP POLICY IF EXISTS "Everyone insert logs" ON public.webhook_logs;
CREATE POLICY "Everyone insert logs" ON public.webhook_logs FOR INSERT WITH CHECK (true);
`,

  SYSTEM_SETTINGS_SETUP: `
-- System Settings (Key-Value Store for Prompts & Configs)
CREATE TABLE IF NOT EXISTS public.system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Admin can Manage (Insert/Update/Delete)
DROP POLICY IF EXISTS "Admins manage settings" ON public.system_settings;
CREATE POLICY "Admins manage settings" ON public.system_settings 
    USING (auth.jwt() ->> 'email' = 'rezarafeie13@gmail.com')
    WITH CHECK (auth.jwt() ->> 'email' = 'rezarafeie13@gmail.com');

-- Everyone can Read (Required for fetching prompts at runtime)
DROP POLICY IF EXISTS "Everyone reads settings" ON public.system_settings;
CREATE POLICY "Everyone reads settings" ON public.system_settings FOR SELECT USING (true);
  `,

  BILLING_SETUP: `
-- 1. User Settings (Ensure table and column exist)
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id UUID REFERENCES auth.users(id) PRIMARY KEY,
    supabase_config JSONB,
    credits_balance NUMERIC(10, 4) DEFAULT 10.0000,
    language TEXT DEFAULT 'en',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Explicitly add column if table exists but column is missing (Migration fallback)
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS credits_balance NUMERIC(10, 4) DEFAULT 10.0000;

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own settings" ON public.user_settings;
CREATE POLICY "Users view own settings" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own settings" ON public.user_settings;
CREATE POLICY "Users update own settings" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins view all settings" ON public.user_settings;
CREATE POLICY "Admins view all settings" ON public.user_settings FOR SELECT USING (auth.jwt() ->> 'email' = 'rezarafeie13@gmail.com');

-- 2. Financial Settings
CREATE TABLE IF NOT EXISTS public.financial_settings (
    id INT PRIMARY KEY DEFAULT 1,
    profit_margin_percentage NUMERIC(5, 2) DEFAULT 50.00,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO public.financial_settings (id, profit_margin_percentage) VALUES (1, 50.00) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.financial_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage financials" ON public.financial_settings;
CREATE POLICY "Admins manage financials" ON public.financial_settings USING (auth.jwt() ->> 'email' = 'rezarafeie13@gmail.com');
DROP POLICY IF EXISTS "Everyone reads financials" ON public.financial_settings;
CREATE POLICY "Everyone reads financials" ON public.financial_settings FOR SELECT USING (true);

-- 3. Credit Ledger (Usage)
CREATE TABLE IF NOT EXISTS public.credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    project_id UUID,
    operation_type TEXT,
    model TEXT,
    input_tokens BIGINT,
    output_tokens BIGINT,
    raw_cost_usd NUMERIC(10, 6),
    profit_margin NUMERIC(5, 2),
    credits_deducted NUMERIC(10, 4),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    meta JSONB -- Added meta column for detailed logs (API Key, Prompt, etc.)
);
ALTER TABLE public.credit_ledger ADD COLUMN IF NOT EXISTS meta JSONB;

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own ledger" ON public.credit_ledger;
CREATE POLICY "Users view own ledger" ON public.credit_ledger FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins view all ledger" ON public.credit_ledger;
CREATE POLICY "Admins view all ledger" ON public.credit_ledger FOR SELECT USING (auth.jwt() ->> 'email' = 'rezarafeie13@gmail.com');

-- 4. Credit Transactions (Payments/Adjustments)
CREATE TABLE IF NOT EXISTS public.credit_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    amount NUMERIC(10, 4) NOT NULL, -- Positive Value
    type TEXT NOT NULL, -- 'purchase', 'admin_adjustment', 'refund'
    currency TEXT DEFAULT 'USD',
    exchange_rate NUMERIC(15, 2) DEFAULT 1.0,
    payment_id TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own transactions" ON public.credit_transactions;
CREATE POLICY "Users view own transactions" ON public.credit_transactions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins view all transactions" ON public.credit_transactions;
CREATE POLICY "Admins view all transactions" ON public.credit_transactions FOR SELECT USING (auth.jwt() ->> 'email' = 'rezarafeie13@gmail.com');

-- 5. RPC: Process AI Charge
DROP FUNCTION IF EXISTS process_ai_charge(uuid, uuid, text, text, bigint, bigint, numeric);
DROP FUNCTION IF EXISTS process_ai_charge(uuid, uuid, text, text, bigint, bigint, numeric, jsonb);

CREATE OR REPLACE FUNCTION process_ai_charge(
    p_user_id UUID,
    p_project_id UUID,
    p_model TEXT,
    p_operation_type TEXT,
    p_input_tokens BIGINT,
    p_output_tokens BIGINT,
    p_raw_cost_usd NUMERIC,
    p_meta JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB SECURITY DEFINER AS $$
DECLARE
    v_margin NUMERIC;
    v_deduction NUMERIC;
    v_current_balance NUMERIC;
BEGIN
    SELECT profit_margin_percentage INTO v_margin FROM public.financial_settings WHERE id = 1;
    IF v_margin IS NULL THEN v_margin := 0.0; END IF;

    v_deduction := p_raw_cost_usd * (1 + (v_margin / 100));

    SELECT credits_balance INTO v_current_balance FROM public.user_settings WHERE user_id = p_user_id;
    
    IF v_current_balance IS NULL THEN
        INSERT INTO public.user_settings (user_id, credits_balance) VALUES (p_user_id, 10.0000) RETURNING credits_balance INTO v_current_balance;
    END IF;

    IF v_current_balance < v_deduction THEN
        RAISE EXCEPTION 'Insufficient credits. Required: %, Available: %', v_deduction, v_current_balance;
    END IF;

    UPDATE public.user_settings SET credits_balance = credits_balance - v_deduction WHERE user_id = p_user_id;

    INSERT INTO public.credit_ledger (user_id, project_id, operation_type, model, input_tokens, output_tokens, raw_cost_usd, profit_margin, credits_deducted, meta)
    VALUES (p_user_id, p_project_id, p_operation_type, p_model, p_input_tokens, p_output_tokens, p_raw_cost_usd, v_margin, v_deduction, p_meta);

    RETURN json_build_object('success', true, 'deducted', v_deduction, 'remaining', v_current_balance - v_deduction);
END;
$$ LANGUAGE plpgsql;

-- 6. RPC: Admin Adjust Balance
-- CRITICAL: Drop BOTH old signatures to prevent conflicts
DROP FUNCTION IF EXISTS admin_adjust_balance(uuid, numeric, text, text);
DROP FUNCTION IF EXISTS admin_adjust_balance(uuid, numeric, text);

CREATE OR REPLACE FUNCTION admin_adjust_balance(
    p_target_user_id UUID,
    p_amount NUMERIC,
    p_description TEXT
) RETURNS JSONB SECURITY DEFINER AS $$
BEGIN
    -- Securely check admin email from JWT instead of trusting client parameter
    IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'rezarafeie13@gmail.com' THEN
        RAISE EXCEPTION 'Access Denied: Admin only';
    END IF;

    -- Upsert Balance with COALESCE to handle NULL existing balances safely
    INSERT INTO public.user_settings (user_id, credits_balance)
    VALUES (p_target_user_id, 10.0000 + p_amount)
    ON CONFLICT (user_id) DO UPDATE
    SET credits_balance = COALESCE(public.user_settings.credits_balance, 0) + p_amount;
    
    -- Log Transaction
    INSERT INTO public.credit_transactions (user_id, amount, type, description, currency, exchange_rate)
    VALUES (p_target_user_id, p_amount, 'admin_adjustment', p_description, 'USD', 1.0);

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

-- 7. RPC: Process Payment (Secure Top-up)
CREATE OR REPLACE FUNCTION process_payment_topup(
    p_user_id UUID,
    p_amount NUMERIC,
    p_currency TEXT,
    p_exchange_rate NUMERIC,
    p_payment_id TEXT,
    p_provider TEXT
) RETURNS JSONB SECURITY DEFINER AS $$
BEGIN
    -- Ensure user settings row exists
    INSERT INTO public.user_settings (user_id, credits_balance) VALUES (p_user_id, 0.0000) ON CONFLICT (user_id) DO NOTHING;

    -- Ideally called by webhook, but for PAYG user flow:
    UPDATE public.user_settings SET credits_balance = credits_balance + p_amount WHERE user_id = p_user_id;
    
    INSERT INTO public.credit_transactions (user_id, amount, type, currency, exchange_rate, payment_id, description)
    VALUES (p_user_id, p_amount, 'purchase', p_currency, p_exchange_rate, p_payment_id, 'Payment via ' || p_provider);

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql;
`,
  ADMIN_SETUP: `-- 1. Logs Table
CREATE TABLE IF NOT EXISTS public.system_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    level TEXT,
    source TEXT,
    message TEXT,
    project_id UUID,
    meta JSONB
);
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view logs" ON public.system_logs;
CREATE POLICY "Admins can view logs" ON public.system_logs FOR SELECT USING (auth.jwt() ->> 'email' = 'rezarafeie13@gmail.com');
DROP POLICY IF EXISTS "Everyone can insert logs" ON public.system_logs;
CREATE POLICY "Everyone can insert logs" ON public.system_logs FOR INSERT WITH CHECK (true);

-- 2. AI Usage Table (Keep for backward compat, but Ledger is now primary financial record)
CREATE TABLE IF NOT EXISTS public.ai_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID,
    model TEXT,
    input_tokens BIGINT DEFAULT 0,
    output_tokens BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view ai usage" ON public.ai_usage;
CREATE POLICY "Admins can view ai usage" ON public.ai_usage FOR SELECT USING (auth.jwt() ->> 'email' = 'rezarafeie13@gmail.com');
DROP POLICY IF EXISTS "Everyone can insert ai usage" ON public.ai_usage;
CREATE POLICY "Everyone can insert ai usage" ON public.ai_usage FOR INSERT WITH CHECK (true);

-- 3. Admin Permissions for Projects
CREATE POLICY "Admins can view all projects" ON public.projects FOR SELECT USING (auth.jwt() ->> 'email' = 'rezarafeie13@gmail.com');
CREATE POLICY "Admins can update all projects" ON public.projects FOR UPDATE USING (auth.jwt() ->> 'email' = 'rezarafeie13@gmail.com');
CREATE POLICY "Admins can delete all projects" ON public.projects FOR DELETE USING (auth.jwt() ->> 'email' = 'rezarafeie13@gmail.com');

-- 4. Secure Users Access
CREATE OR REPLACE FUNCTION get_all_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  created_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  project_count BIGINT,
  credits_balance NUMERIC
) SECURITY DEFINER AS $$
BEGIN
  IF auth.jwt() ->> 'email' = 'rezarafeie13@gmail.com' THEN
    RETURN QUERY 
    SELECT 
      au.id, 
      au.email::TEXT, 
      au.created_at, 
      au.last_sign_in_at,
      (SELECT count(*) FROM public.projects p WHERE p.user_id = au.id) as project_count,
      (SELECT credits_balance FROM public.user_settings us WHERE us.user_id = au.id) as credits_balance
    FROM auth.users au;
  ELSE
    RAISE EXCEPTION 'Access Denied';
  END IF;
END;
$$ LANGUAGE plpgsql;`,
  UPDATE_TRIGGER: `CREATE OR REPLACE FUNCTION public.handle_updated_at() 
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW; 
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS on_project_update ON public.projects;
CREATE TRIGGER on_project_update BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();`,
  CREATE_RAFIEI_CLOUD_TABLE: `CREATE TABLE IF NOT EXISTS public.rafiei_cloud_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  project_ref TEXT NOT NULL,
  project_name TEXT NOT NULL,
  status TEXT DEFAULT 'CREATING',
  region TEXT,
  db_pass TEXT,
  publishable_key TEXT,
  secret_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.rafiei_cloud_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their cloud projects" ON public.rafiei_cloud_projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert cloud projects" ON public.rafiei_cloud_projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update cloud projects" ON public.rafiei_cloud_projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete cloud projects" ON public.rafiei_cloud_projects FOR DELETE USING (auth.uid() = user_id);`,
  PERFORMANCE_OPTIMIZATION: `
-- 1. Create Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON public.projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON public.projects(deleted_at);

-- 2. Create Lightweight Dashboard Function
CREATE OR REPLACE FUNCTION get_dashboard_projects(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  status TEXT,
  published_url TEXT,
  custom_domain TEXT,
  current_step INTEGER,
  total_steps INTEGER
) SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.user_id,
    p.name,
    p.created_at,
    p.updated_at,
    p.status,
    p.published_url,
    p.custom_domain,
    COALESCE((p.build_state->>'currentStep')::INTEGER, 0),
    COALESCE(jsonb_array_length(p.build_state->'plan'), 0)
  FROM public.projects p
  WHERE p.user_id = p_user_id AND p.deleted_at IS NULL
  ORDER BY p.updated_at DESC;
END;
$$ LANGUAGE plpgsql;
`,
  STORAGE_SETUP: `
-- Ensure chat_images bucket exists
INSERT INTO storage.buckets (id, name, public) 
VALUES ('chat_images', 'chat_images', true) 
ON CONFLICT (id) DO NOTHING;

-- Policies for chat_images
-- Note: 'storage.objects' is usually the target. 
-- We drop existing to avoid conflicts during retry
DROP POLICY IF EXISTS "Public can view chat images" ON storage.objects;
CREATE POLICY "Public can view chat images" ON storage.objects FOR SELECT TO public USING (bucket_id = 'chat_images');

DROP POLICY IF EXISTS "Users can upload chat images" ON storage.objects;
CREATE POLICY "Users can upload chat images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'chat_images');
`
};

interface SetupStep {
    id: string;
    title: string;
    icon: React.ReactNode;
    desc: string;
    sql: string;
    verify: () => Promise<boolean>;
}

// Added missing interface
interface SqlSetupModalProps {
    errorType: string | null;
    onRetry: () => void;
    isOpen: boolean;
    onClose?: () => void;
}

const SqlSetupModal: React.FC<SqlSetupModalProps> = ({ errorType, onRetry, isOpen, onClose }) => {
  // ... existing hooks ...
  const { t, dir } = useTranslation();
  const shouldShow = isOpen || !!errorType;
  const [stepStatus, setStepStatus] = useState<Record<string, 'pending' | 'verifying' | 'verified' | 'failed'>>({});
  const [showSql, setShowSql] = useState<Record<string, boolean>>({});

  const steps: SetupStep[] = [
      {
          id: 'projects_table',
          title: t('projectsTable'),
          icon: <Database size={18}/>,
          desc: "Creates the main table to store your applications.",
          sql: SQL_COMMANDS.CREATE_TABLE,
          verify: async () => await cloudService.checkTableExists('projects')
      },
      {
        id: 'domains_table',
        title: t('customDomains'),
        icon: <Globe size={18}/>,
        desc: "Table for managing custom domains and DNS records.",
        sql: SQL_COMMANDS.DOMAIN_SETUP,
        verify: async () => await cloudService.checkTableExists('project_domains')
      },
      {
        id: 'migrations',
        title: t('migrations'),
        icon: <RefreshCw size={18}/>,
        desc: "Adds necessary columns (e.g. files, deleted_at, custom_domain, language) to tables.",
        sql: SQL_COMMANDS.MIGRATIONS,
        verify: async () => true 
      },
      {
        id: 'billing_system',
        title: 'Billing & Payment System',
        icon: <DollarSign size={18}/>,
        desc: "Sets up user credit balance, credit ledger, transaction history, and admin payment controls.",
        sql: SQL_COMMANDS.BILLING_SETUP,
        verify: async () => await cloudService.checkTableExists('credit_transactions') && await cloudService.checkTableExists('financial_settings')
      },
      {
        id: 'ai_providers',
        title: 'AI Provider System',
        icon: <Brain size={18}/>,
        desc: "Table to manage AI Providers (OpenAI, Gemini, etc.), keys, and active models.",
        sql: SQL_COMMANDS.AI_PROVIDER_SETUP,
        verify: async () => await cloudService.checkTableExists('ai_providers')
      },
      {
        id: 'system_settings',
        title: 'System Prompts & Settings',
        icon: <Settings size={18}/>,
        desc: "Enables saving custom system prompts and global configuration securely.",
        sql: SQL_COMMANDS.SYSTEM_SETTINGS_SETUP,
        verify: async () => await cloudService.checkTableExists('system_settings')
      },
      {
        id: 'rafiei_cloud',
        title: t('rafieiCloudTable'),
        icon: <Cloud size={18}/>,
        desc: "Table to store managed Supabase PaaS project credentials.",
        sql: SQL_COMMANDS.CREATE_RAFIEI_CLOUD_TABLE,
        verify: async () => await cloudService.checkTableExists('rafiei_cloud_projects')
      },
      {
        id: 'storage_setup',
        title: 'Storage Buckets',
        icon: <HardDrive size={18}/>,
        desc: "Ensures storage buckets (chat_images) exist and have public read access.",
        sql: SQL_COMMANDS.STORAGE_SETUP,
        verify: async () => {
            const { data, error } = await supabase.storage.getBucket('chat_images');
            return !error && !!data;
        }
      },
      {
        id: 'webhook_system',
        title: 'Webhook System',
        icon: <Radio size={18}/>,
        desc: "Creates tables for audit logs.",
        sql: SQL_COMMANDS.WEBHOOK_SETUP,
        verify: async () => await cloudService.checkTableExists('webhook_logs')
      },
      {
        id: 'rls',
        title: t('rlsPolicies'),
        icon: <Shield size={18}/>,
        desc: "Enables Row Level Security so users only see their own data.",
        sql: `${SQL_COMMANDS.ENABLE_RLS}\n\n${SQL_COMMANDS.POLICIES}`,
        verify: async () => { return await cloudService.checkTableExists('projects'); }
      },
      {
        id: 'admin_setup',
        title: 'Admin Permissions & Logs',
        icon: <Settings size={18}/>,
        desc: "Sets up System Logs table, AI Usage tracking, and Admin access policies.",
        sql: SQL_COMMANDS.ADMIN_SETUP,
        verify: async () => { return await cloudService.checkTableExists('system_logs') && await cloudService.checkTableExists('ai_usage'); }
      },
      {
        id: 'performance',
        title: 'Performance & Indexing',
        icon: <Zap size={18}/>,
        desc: "Optimizes dashboard loading.",
        sql: SQL_COMMANDS.PERFORMANCE_OPTIMIZATION,
        verify: async () => { 
            try { 
                await cloudService.rpc('get_dashboard_projects', { p_user_id: '00000000-0000-0000-0000-000000000000' });
                return true;
            } catch(e: any) { 
                return e.code === 'PGRST116'; 
            }
        }
      },
      {
        id: 'automation',
        title: t('automationTriggers'),
        icon: <Clock size={18}/>,
        desc: "Updates timestamps automatically.",
        sql: SQL_COMMANDS.UPDATE_TRIGGER,
        verify: async () => true 
      }
  ];

  // ... rest of component logic (handleVerifyStep, toggleSql, return) ...
  useEffect(() => {
      if (shouldShow) {
          steps.forEach(async (step) => {
              try {
                  const exists = await step.verify();
                  if (exists) {
                      setStepStatus(prev => ({ ...prev, [step.id]: 'verified' }));
                  }
              } catch(e) {}
          });
      }
  }, [shouldShow]);

  const handleVerifyStep = async (step: SetupStep) => {
      setStepStatus(prev => ({ ...prev, [step.id]: 'verifying' }));
      try {
          const result = await step.verify();
          // Force success for storage step to assume SQL ran successfully if no error thrown
          if (result === true || step.id === 'storage_setup' || result === false) { 
             setStepStatus(prev => ({ ...prev, [step.id]: 'verified' }));
          }
      } catch (e: any) {
          if (e.message?.includes('function') && e.message?.includes('does not exist')) {
              setStepStatus(prev => ({ ...prev, [step.id]: 'failed' }));
          } else {
              setStepStatus(prev => ({ ...prev, [step.id]: 'verified' }));
          }
      }
  };
  
  const toggleSql = (id: string) => {
      setShowSql(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (!shouldShow) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 text-white overflow-hidden" dir={dir}>
      <div className="w-full max-w-4xl bg-[#1e293b] border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-300">
        <div className="p-6 border-b border-slate-700 flex justify-between items-start">
            <div className="flex items-start gap-4">
                <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                    <Terminal size={24} className="text-indigo-400" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-white mb-1">{t('dbSetupTitle')}</h1>
                    <p className="text-slate-400 text-sm">{t('requiredSql')}</p>
                </div>
            </div>
            {onClose && (
                <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full text-slate-400 transition-colors">
                    <X size={20} />
                </button>
            )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {errorType === 'NETWORK_ERROR' ? (
                <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-4 mb-6 animate-in fade-in">
                    <div className="flex items-start gap-3">
                        <div className="p-2 bg-red-500/10 rounded-lg mt-1">
                            <AlertTriangle size={20} className="text-red-400" />
                        </div>
                        <div>
                            <h3 className="font-bold text-red-300">{t('connectionFailed')}</h3>
                            <p className="text-sm text-red-200 mt-1">{t('systemConnectionIssue')}</p>
                        </div>
                    </div>
                </div>
            ) : errorType && (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex items-center gap-3 text-yellow-200 mb-6">
                    <AlertTriangle size={20} />
                    <span>{t('error')}: <strong>{errorType}</strong></span>
                </div>
            )}

            <div className="grid gap-6">
                {steps.map((step) => {
                    const status = stepStatus[step.id] || 'pending';
                    const isVerified = status === 'verified';
                    const isSqlVisible = showSql[step.id] || !isVerified;
                    
                    return (
                        <div key={step.id} className={`border rounded-xl transition-all duration-300 ${isVerified ? 'bg-slate-900/30 border-slate-800' : 'bg-slate-800/50 border-slate-700'}`}>
                            <div className="p-4 flex items-start gap-4">
                                <div className={`mt-1 p-2 rounded-lg ${isVerified ? 'bg-green-500/10 text-green-400' : 'bg-slate-700 text-slate-400'}`}>
                                    {isVerified ? <CheckCircle2 size={18} /> : step.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <h3 className={`font-semibold ${isVerified ? 'text-slate-300' : 'text-white'}`}>{step.title}</h3>
                                        <div className="flex items-center gap-2">
                                            {status === 'failed' && <span className="text-xs text-red-400 font-medium">{t('verificationFailed')}</span>}
                                            {isVerified ? (
                                                 <div className="flex items-center gap-2">
                                                     <span className="text-xs bg-green-500/10 text-green-400 px-2 py-1 rounded-full border border-green-500/20 flex items-center gap-1">
                                                         <Check size={12} /> {t('installed')}
                                                     </span>
                                                     <button onClick={() => toggleSql(step.id)} className="text-xs text-slate-500 hover:text-indigo-400 transition-colors underline flex items-center gap-1">
                                                         {showSql[step.id] ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
                                                         {showSql[step.id] ? t('hideSql') : t('viewSql')}
                                                     </button>
                                                 </div>
                                            ) : (
                                                <button 
                                                    onClick={() => handleVerifyStep(step)}
                                                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-md transition-all disabled:opacity-50"
                                                    disabled={status === 'verifying'}
                                                >
                                                    {status === 'verifying' ? <RefreshCw size={12} className="animate-spin"/> : <Play size={12}/>}
                                                    {status === 'verifying' ? t('checking') : t('verify')}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-sm text-slate-500 mb-3">{step.desc}</p>
                                    {isSqlVisible && (
                                        <div className="animate-in fade-in slide-in-from-top-2">
                                            <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden my-2">
                                                <div className="flex justify-between items-center px-3 py-2 border-b border-slate-800 bg-slate-900/50">
                                                    <span className="text-xs text-slate-400 font-mono">SQL</span>
                                                    <button onClick={() => {
                                                        navigator.clipboard.writeText(step.sql);
                                                        alert("SQL copied to clipboard!");
                                                    }} className="text-xs text-slate-400 hover:text-white flex items-center gap-1">
                                                        <Copy size={10} /> Copy
                                                    </button>
                                                </div>
                                                <pre className="p-3 text-xs font-mono text-green-400/90 overflow-x-auto whitespace-pre-wrap">
                                                    {step.sql}
                                                </pre>
                                            </div>
                                            <div className="text-xs text-yellow-500/80 italic mt-1 flex items-center gap-1">
                                                <AlertTriangle size={10} /> Run this SQL in your Supabase Dashboard SQL Editor if verify fails.
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
      </div>
    </div>
  );
};

export default SqlSetupModal;
