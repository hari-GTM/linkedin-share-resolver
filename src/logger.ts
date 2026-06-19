// Tiny structured JSON logger. No dependencies, Cloud Run friendly
// (Cloud Logging parses single-line JSON on stdout/stderr).

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): Level {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return (['debug', 'info', 'warn', 'error'] as Level[]).includes(raw as Level)
    ? (raw as Level)
    : 'info';
}

/**
 * Keys whose values must never be logged. The logger strips them defensively
 * so cookies/tokens cannot leak even if accidentally passed in a context object.
 */
const REDACT_KEYS = new Set([
  'cookie',
  'cookies',
  'linkedin_cookies',
  'set-cookie',
  'authorization',
  'x-api-key',
  'apikey',
  'api_key',
  'token',
  'password',
  'secret',
]);

function sanitize(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = sanitize(v);
    }
  }
  return out;
}

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[currentLevel()]) return;
  const record = {
    severity: level.toUpperCase(),
    time: new Date().toISOString(),
    message,
    ...(context ? (sanitize(context) as Record<string, unknown>) : {}),
  };
  const line = JSON.stringify(record);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
};
