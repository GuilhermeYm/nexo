import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitResult =
  | { success: true }
  | { success: false; retryAfterSeconds: number };

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

// ---------------------------------------------------------------------------
// Backend distribuído (Upstash Redis) — ativo quando as envs estão definidas.
// Em produção multi-instância é o único que funciona; em dev local sem Redis
// cai no limiter em memória abaixo.
// ---------------------------------------------------------------------------

const upstashEnabled = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

let redis: Redis | null = null;

// Um Ratelimit por (limit, windowMs): a instância é stateless (só config),
// o estado mora no Redis.
const limiters = new Map<string, Ratelimit>();

function getUpstashLimiter(limit: number, windowMs: number): Ratelimit {
  if (!redis) redis = Redis.fromEnv();
  const cacheKey = `${limit}:${windowMs}`;
  let limiter = limiters.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
      prefix: "ratelimit",
    });
    limiters.set(cacheKey, limiter);
  }
  return limiter;
}

// ---------------------------------------------------------------------------
// Fallback em memória (janela fixa) — dev local / instância única.
// ---------------------------------------------------------------------------

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

const MAX_BUCKETS = 10_000;

function rateLimitInMemory(options: RateLimitOptions): RateLimitResult {
  const { key, limit, windowMs } = options;
  const now = Date.now();

  // Limpeza oportunista para não vazar memória.
  if (buckets.size > MAX_BUCKETS) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true };
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    return {
      success: false,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  return { success: true };
}

/**
 * Consome um token do bucket. Usa Upstash (sliding window) quando
 * UPSTASH_REDIS_REST_URL/TOKEN estão definidas; senão, memória (janela fixa).
 * Se o Redis falhar, cai para o limiter em memória em vez de derrubar a rota.
 */
export async function rateLimit(
  options: RateLimitOptions
): Promise<RateLimitResult> {
  if (!upstashEnabled) {
    return rateLimitInMemory(options);
  }

  try {
    const result = await getUpstashLimiter(
      options.limit,
      options.windowMs
    ).limit(options.key);
    if (result.success) return { success: true };
    return {
      success: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((result.reset - Date.now()) / 1000)
      ),
    };
  } catch (error) {
    console.error("[RATE_LIMIT] Upstash falhou, usando fallback em memória", {
      error: error instanceof Error ? error.message : "Unknown",
      timestamp: new Date().toISOString(),
    });
    return rateLimitInMemory(options);
  }
}

/**
 * Devolve os tokens consumidos do bucket (ex.: login bem-sucedido não deve
 * contar contra o limite de tentativas).
 */
export async function resetRateLimit(options: RateLimitOptions): Promise<void> {
  if (!upstashEnabled) {
    buckets.delete(options.key);
    return;
  }

  try {
    await getUpstashLimiter(
      options.limit,
      options.windowMs
    ).resetUsedTokens(options.key);
  } catch (error) {
    console.error("[RATE_LIMIT] Falha ao resetar bucket no Upstash", {
      error: error instanceof Error ? error.message : "Unknown",
      timestamp: new Date().toISOString(),
    });
    // Se o rateLimit() caiu no fallback em memória, o contador está aqui —
    // o reset precisa limpar os dois lugares.
    buckets.delete(options.key);
  }
}
