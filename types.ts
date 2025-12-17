
export interface AIDebugLog {
  id: string;
  timestamp: number;
  stepKey: string;
  model: string;
  systemInstruction: string;
  prompt: string;
  response: string;
}

export interface GeneratedCode {
  html: string;
  javascript: string;
  css: string;
  explanation: string;
}

export interface Phase {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped' | 'retrying';
  retryCount: number;
  type: 'skeleton' | 'ui' | 'logic' | 'backend'; // Prioritization
  durationMs?: number;
}

export interface BuildAudit {
  score: number; // 0-100
  passed: boolean;
  issues: {
    severity: 'critical' | 'warning';
    message: string;
    component?: string;
  }[];
  previewHealth: 'healthy' | 'blank' | 'error';
  routesDetected: string[];
}

export interface BuildState {
  plan: string[]; // Legacy support
  phases: Phase[]; // Primary Source of Truth now
  currentPhaseIndex: number;
  currentStep: number;
  lastCompletedStep: number;
  error: string | null;
  audit?: BuildAudit;
  startTime?: number;
  totalSteps?: number;
  completedSteps?: number;
  logs?: string[]; // Granular process logs
}

export interface ProjectFile {
  path: string;
  content: string;
  type: 'file' | 'folder';
  language?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  timestamp: number;
  images?: string[];
  type?: 'user_input' | 'assistant_response' | 'build_plan' | 'build_phase' | 'build_status' | 'build_error' | 'action_required' | 'final_summary';
  status?: 'pending' | 'working' | 'completed' | 'failed'; 
  icon?: string; 
  planData?: { title: string, status: 'pending' | 'active' | 'completed' | 'failed' }[];
  currentStepProgress?: { current: number; total: number; stepName: string; };
  details?: string;
  isExpandable?: boolean;
  requiresAction?: string;
  executionTimeMs?: number;
  creditsUsed?: number;
  providerUsed?: string;
  modelUsed?: string;
  aiInteractions?: AIDebugLog[]; // Added for detailed trace visibility
}

export interface RafieiCloudProject {
  id: string;
  userId: string;
  projectRef: string;
  projectName: string;
  status: string;
  region: string;
  dbPassword?: string;
  publishableKey?: string;
  secretKey?: string;
  createdAt: number;
}

export interface VercelConfig {
  projectId: string;
  projectName: string;
  productionUrl?: string; // stable {slug}.built.bnets.co
  latestDeploymentId?: string;
  latestDeploymentUrl?: string; // the vercel.app url
  targetDomain?: string; // custom domain if set
  lastDeployedAt: number;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  code: GeneratedCode;
  files?: ProjectFile[];
  messages: Message[];
  status: 'idle' | 'generating' | 'failed';
  buildState: BuildState | null;
  publishedUrl?: string;
  customDomain?: string;
  supabaseConfig?: {
    url: string;
    key: string;
  };
  rafieiCloudProject?: RafieiCloudProject;
  vercelConfig?: VercelConfig;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  credits_balance: number;
  isAdmin?: boolean;
  created_at?: string;
  last_sign_in_at?: string;
  project_count?: number;
}

export interface Domain {
  id: string;
  domainName: string;
  projectId: string;
  type: 'root' | 'subdomain';
  dnsRecordType: 'A' | 'CNAME' | 'ALIAS';
  dnsRecordValue: string;
  status: 'verified' | 'pending' | 'error';
  updatedAt: number;
}

export interface Suggestion {
  title: string;
  prompt: string;
}

export interface SystemLog {
  id: string;
  timestamp: number;
  level: 'info' | 'warning' | 'error' | 'critical';
  source: string;
  message: string;
  projectId?: string;
  meta?: any;
}

export interface CreditLedgerEntry {
  id: string;
  userId: string;
  projectId?: string;
  operationType: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  rawCostUsd: number;
  profitMargin: number;
  creditsDeducted: number;
  createdAt: number;
  meta?: any; // Stores detailed logs, prompts, and provider details
}

export interface CreditTransaction {
  id: string;
  userId: string;
  amount: number;
  type: string;
  currency: string;
  exchangeRate: number;
  paymentId?: string;
  description?: string;
  createdAt: number;
}

export interface FinancialStats {
  totalRevenueCredits: number;
  totalCostUsd: number;
  netProfitUsd: number;
  totalCreditsPurchased: number;
  currentMargin: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequestCount: number;
}

export interface AdminMetric {
  label: string;
  value: string | number;
  status: 'good' | 'warning' | 'critical';
}

export interface ExchangeRateData {
    price: string;
    updated_at: string;
}

export interface WebhookLog {
    id: string;
    event_type: string;
    payload: any;
    status_code: number;
    response_body: string;
    created_at: number;
}

export type ViewMode = 'preview' | 'code';

// AI Provider Types
export type AIProviderId = 'google' | 'openai' | 'claude';

export interface AIProviderConfig {
    id: AIProviderId;
    name: string;
    isActive: boolean;
    isFallback: boolean;
    apiKey?: string; // Only used when sending to API, hidden in UI
    model: string;
    updatedAt: number;
}

export interface AIUsageResult {
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    provider: AIProviderId;
    model: string;
}

// --- NEW ARCHITECTURE TYPES ---

export interface DecisionJSON {
  project_analysis: {
    summary: string;
    complexity: 'low' | 'medium' | 'high';
  };
  narrative_summary: string; // Added this property
  backend_detection: {
    needs_backend: boolean;
    required_backend_features: string[];
  };
  delivery_strategy: {
    frontend_first_milestone: {
      goal: string;
    };
  };
  flow_plan: {
    phases: {
      phase: string;
      outputs: string[];
      condition?: string;
    }[];
  };
}

export interface DesignSpecJSON {
  design_language: any;
  pages: { route: string; name: string; sections: string[] }[];
  navigation: any;
}

export interface FilePlanJSON {
  file_structure: { path: string; purpose: string }[];
  build_order: string[];
}

export interface FileChange {
  path: string;
  action: 'create' | 'update' | 'delete';
  content: string;
}

export interface QAJSON {
  status: 'pass' | 'fail';
  issues: { type: string; message: string; file: string; hint: string }[];
  patches?: FileChange[];
}
