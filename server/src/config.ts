export const config = {
  httpPort: Number(process.env.PORT ?? 8787),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  maxBodyBytes: 4 * 1024,
  idempotencyTtlMs: 24 * 60 * 60 * 1000,
  wsBaseUrl: process.env.WS_BASE_URL ?? 'ws://localhost:8787',
} as const;
