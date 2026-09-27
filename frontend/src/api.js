// Thin client for the ReleaseGuard API (proxied by Vite at /api in dev).
// On a deployed (vercel.app) origin, talk to the local backend directly;
// VITE_API_BASE can override it.
const BASE = (
  import.meta.env.VITE_API_BASE ||
  (typeof location !== 'undefined' && location.hostname.endsWith('.vercel.app')
    ? 'http://localhost:4000'
    : '')
).replace(/\/$/, '');

async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

export const api = {
  health: () => fetch(`${BASE}/api/health`).then(json),
  presets: () => fetch(`${BASE}/api/presets`).then(json),
  reviews: () => fetch(`${BASE}/api/reviews`).then(json),

  submit: (payload) =>
    fetch(`${BASE}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(json),

  getReview: (id) => fetch(`${BASE}/api/reviews/${id}`).then(json),

  getReport: async (id) => {
    const res = await fetch(`${BASE}/api/reviews/${id}/report`);
    if (res.status === 409) return null; // report not ready yet
    return json(res);
  },
};

/** Poll a review until it reaches a terminal state. */
export function pollReview(id, onUpdate, { intervalMs = 900 } = {}) {
  let stopped = false;
  const timer = setInterval(async () => {
    if (stopped) return;
    try {
      const review = await api.getReview(id);
      onUpdate(review);
      if (review.status === 'done' || review.status === 'failed') {
        clearInterval(timer);
        if (review.status === 'done') {
          const report = await api.getReport(id).catch(() => null);
          if (report && !stopped) onUpdate({ ...review, report });
        }
      }
    } catch {
      /* transient network error — keep polling */
    }
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
