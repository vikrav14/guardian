const ADMIN_KEY_STORAGE = 'guardian_admin_key';
const API_BASE = import.meta.env.VITE_GATEWAY_URL || '';

export function getAdminKey(): string {
  return localStorage.getItem(ADMIN_KEY_STORAGE) || '';
}

export function setAdminKey(key: string) {
  localStorage.setItem(ADMIN_KEY_STORAGE, key);
}

function authHeaders(): HeadersInit {
  const key = getAdminKey();
  return key ? { 'X-Admin-Key': key } : {};
}

export async function fetchMetrics() {
  const res = await fetch(`${API_BASE}/ops/metrics`, { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Metrics failed (${res.status})`);
  }
  return res.json();
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
  const res = await fetch(`${API_BASE}/ops/cost-estimate?${q}`, { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Cost estimate failed (${res.status})`);
  }
  return res.json();
}
