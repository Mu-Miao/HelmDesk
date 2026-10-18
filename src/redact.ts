const sensitive = /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|client[_-]?secret|password|authorization|api[_-]?key|credentials?|cookies?|auth[_-]?code)$/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) ? '[REDACTED]' : redact(item)]));
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(/\bBearer\s+[\w.+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-|qoder_pat_)[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/((?:access_token|refresh_token|id_token|api[_-]?key|client_secret|password|authorization|code|state)\s*[=:]\s*["']?)[^\s&"',}]+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s<>"']+/g, (raw) => {
      try {
        const url = new URL(raw);
        if (url.username || url.password) { url.username = 'REDACTED'; url.password = ''; }
        for (const key of url.searchParams.keys()) if (sensitive.test(key) || /^(code|state)$/i.test(key)) url.searchParams.set(key, 'REDACTED');
        if (/login|oauth|authorize|callback/i.test(url.pathname)) { url.search = ''; url.hash = ''; }
        return url.toString();
      } catch { return '[invalid URL]'; }
    });
}

export function safeJson(value: unknown): string { return JSON.stringify(redact(value)); }
export function errorText(error: unknown): string { return String(redact(error instanceof Error ? error.message : String(error))); }
