const ADMIN_KEY_STORAGE = 'guardian_admin_key';
const API_BASE = import.meta.env.VITE_GATEWAY_URL || '';

export function getAdminKey(): string {
  return localStorage.getItem(ADMIN_KEY_STORAGE) || '';
}

export function setAdminKey(key: string) {
  localStorage.setItem(ADMIN_KEY_STORAGE, key);
}

export function getAuthToken(): string {
  return localStorage.getItem('guardian_auth_token') || '';
}

export function setAuthToken(token: string) {
  localStorage.setItem('guardian_auth_token', token);
}

export function clearAuthToken() {
  localStorage.removeItem('guardian_auth_token');
}

function authHeaders(): HeadersInit {
  const token = getAuthToken();
  if (token) return { Authorization: `Bearer ${token}` };
  const key = getAdminKey();
  return key ? { 'X-Admin-Key': key } : {};
}

async function fetchOps<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  } catch {
    const hint = API_BASE
      ? `Check that the gateway is running at ${API_BASE}.`
      : 'Start the gateway in another terminal: cd gateway && npm start (listens on port 9001).';
    throw new Error(`Cannot reach ops API (${path}). ${hint}`);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function fetchMetrics() {
  return fetchOps('/ops/metrics');
}

export type CostEstimate = {
  currency: string;
  users: number;
  totalMur: number;
  totalMurPerUser: number;
  breakdown: Record<string, number>;
  volumes: Record<string, number>;
  assumptions: Record<string, unknown>;
};

export type CostSensitivity = {
  baseline: CostEstimate;
  scenarios: Array<{
    key: string;
    label: string;
    totalMur: number;
    deltaMur: number;
    breakdown: Record<string, number>;
  }>;
};

export async function fetchCostEstimate(params: {
  users: number;
  gpsIntervalSec: number;
  historyOn: boolean;
  journeyCompression: boolean;
  whatsappPct: number;
  aiNarrationOn: boolean;
}): Promise<CostEstimate> {
  const q = new URLSearchParams({
    users: String(params.users),
    gpsIntervalSec: String(params.gpsIntervalSec),
    historyOn: String(params.historyOn),
    journeyCompression: String(params.journeyCompression),
    whatsappPct: String(params.whatsappPct),
    aiNarrationOn: String(params.aiNarrationOn),
  });
  return fetchOps(`/ops/cost-estimate?${q}`);
}

export async function fetchCostSensitivity(params: {
  users: number;
  gpsIntervalSec: number;
  historyOn: boolean;
  journeyCompression: boolean;
  whatsappPct: number;
  aiNarrationOn: boolean;
}): Promise<CostSensitivity> {
  const q = new URLSearchParams({
    users: String(params.users),
    gpsIntervalSec: String(params.gpsIntervalSec),
    historyOn: String(params.historyOn),
    journeyCompression: String(params.journeyCompression),
    whatsappPct: String(params.whatsappPct),
    aiNarrationOn: String(params.aiNarrationOn),
    sensitivity: 'true',
  });
  return fetchOps(`/ops/cost-estimate?${q}`);
}

export type FinanceSnapshot = {
  currency: string;
  pricing: { deviceSaleMur: number; subscriptionAnnualMur: number; subscriptionMonthlyMur: number };
  revenue: { todayMur: number; monthMur: number };
  cloud: { todayMur: number; projectedMonthMur: number };
  grossMargin: { monthMur: number; monthPct: number };
  profitVsCost: {
    revenueMur: number;
    costMur: number;
    profitMur: number;
    marginPct: number;
  };
  burnRate: { budgetMur: number; usedMur: number; forecastMur: number; usedPct: number };
  costBreakdown: Record<string, number>;
};

export async function fetchFinance(params?: {
  users?: number;
  devicesSoldToday?: number;
  devicesSoldMonth?: number;
  subscriptionsSoldToday?: number;
  subscriptionsSoldMonth?: number;
  budget?: number;
}): Promise<FinanceSnapshot> {
  const q = new URLSearchParams();
  if (params?.users) q.set('users', String(params.users));
  if (params?.devicesSoldToday != null) q.set('devicesSoldToday', String(params.devicesSoldToday));
  if (params?.devicesSoldMonth != null) q.set('devicesSoldMonth', String(params.devicesSoldMonth));
  if (params?.subscriptionsSoldToday != null) q.set('subscriptionsSoldToday', String(params.subscriptionsSoldToday));
  if (params?.subscriptionsSoldMonth != null) q.set('subscriptionsSoldMonth', String(params.subscriptionsSoldMonth));
  if (params?.budget != null) q.set('budget', String(params.budget));
  return fetchOps(`/ops/finance?${q}`);
}

export type FleetSnapshot = {
  updatedAt: string;
  fleet: {
    totalDevices: number;
    devicesOnline: number;
    devicesOffline: number;
    devicesOnlineTcp: number;
    avgBatteryPercent: number;
    gpsQualityPct: number;
    batterySampleSize?: number;
    gpsSampleSize?: number;
    source?: string;
  };
};

export async function fetchFleet(): Promise<FleetSnapshot> {
  return fetchOps('/ops/fleet');
}

export type GrowthProjection = {
  currency: string;
  users: number;
  revenue: { deviceSalesMur: number; subscriptionMur: number; totalMur: number };
  costs: { deviceCogsMur: number; cloudMur: number; supportMarketingMur: number; totalMur: number };
  grossMarginMur: number;
  grossMarginPct: number;
  netProfitMur: number;
  breakEvenUsers: number | null;
  projectedUsers12Mo: number;
  cloudBreakdown: Record<string, number>;
};

export async function fetchGrowth(params: {
  users: number;
  growthRate: number;
  churn: number;
  deviceCost: number;
  salePrice: number;
  subscription: number;
  supportCost: number;
  gpsIntervalSec: number;
  historyOn: boolean;
  journeyCompression: boolean;
  whatsappPct: number;
  aiNarrationOn: boolean;
}): Promise<GrowthProjection> {
  const q = new URLSearchParams({
    users: String(params.users),
    growthRate: String(params.growthRate),
    churn: String(params.churn),
    deviceCost: String(params.deviceCost),
    salePrice: String(params.salePrice),
    subscription: String(params.subscription),
    supportCost: String(params.supportCost),
    gpsIntervalSec: String(params.gpsIntervalSec),
    historyOn: String(params.historyOn),
    journeyCompression: String(params.journeyCompression),
    whatsappPct: String(params.whatsappPct),
    aiNarrationOn: String(params.aiNarrationOn),
  });
  return fetchOps(`/ops/growth?${q}`);
}

export type AiStats = {
  updatedAt: string;
  aiRequests: number;
  aiTokensIn: number;
  aiTokensOut: number;
  avgLatencyMs: number;
  estimatedCostTodayMur: number;
  recommendations: Array<{
    id: string;
    title: string;
    savingsMur: number;
    impact: string;
    description: string;
  }>;
  quality: { correct: number; manualOverrides: number; falsePositives: number };
  recentDecisions: Array<{
    id: string;
    timestamp: string;
    toolsUsed: string[];
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    callerPhone: string;
  }>;
};

export async function fetchAiStats(): Promise<AiStats> {
  return fetchOps('/ops/ai-stats');
}

export type ApiMonitoringRow = {
  service: string;
  requests: number;
  costMur: number;
};

export function mur(n: number | undefined | null) {
  if (n == null || Number.isNaN(n)) return '—';
  return `Rs ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
