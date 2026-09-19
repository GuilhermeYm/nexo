import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";
import { z } from "zod";

import type { FolderItem } from "@/lib/folders/types";
import {
  NOTE_LIST_PAGE_SIZE,
  type NoteListOptions,
  type NoteListResult,
} from "@/lib/notes/list";

const CACHE_TTL_SECONDS = 45;
const VERSION_TTL_SECONDS = 7 * 24 * 60 * 60;
// v2: os itens ganharam `folder` (0026); v3: `summary`. O formato antigo não
// serve mais.
const CACHE_PREFIX = "notes-cache:v3";

const noteListResultSchema = z.object({
  notes: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      excerpt: z.string().nullable(),
      summary: z.string().nullable(),
      type: z.string(),
      source: z.string(),
      workspaceName: z.string().nullable(),
      folder: z
        .object({
          id: z.string().uuid(),
          name: z.string(),
          source: z.enum(["user", "ai"]),
        })
        .nullable(),
      updatedAt: z.union([z.string(), z.date()]),
      createdAt: z.union([z.string(), z.date()]),
      tags: z.array(
        z.object({
          id: z.string().uuid(),
          name: z.string(),
          color: z.string().nullable(),
        })
      ),
    })
  ),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(48),
  hasMore: z.boolean(),
});

export type NoteListCacheRead = {
  value: NoteListResult | null;
  /** A versão lida antes da query impede que uma resposta velha ressuscite. */
  version: string | null;
};

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }

  redis ??= Redis.fromEnv();
  return redis;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 32);
}

function userScope(userId: string): string {
  // O UUID da conta não precisa ficar legível no painel ou nos logs do Redis.
  return digest(userId);
}

function versionKey(userId: string): string {
  return `${CACHE_PREFIX}:version:${userScope(userId)}`;
}

function resultKey(
  userId: string,
  version: string,
  options: NoteListOptions
): string {
  const canonicalOptions = JSON.stringify({
    query: options.query?.trim() ?? "",
    source: options.source ?? "all",
    type: options.type ?? "all",
    sort: options.sort ?? "updated",
    folder: options.folder ?? "all",
    page: Math.max(1, options.page ?? 1),
    pageSize: Math.min(48, Math.max(1, options.pageSize ?? NOTE_LIST_PAGE_SIZE)),
  });

  return `${CACHE_PREFIX}:list:${userScope(userId)}:${version}:${digest(canonicalOptions)}`;
}

/**
 * Lê somente o resumo paginado. Conteúdo rico e credenciais nunca entram no
 * cache. Qualquer falha do provedor vira cache miss e mantém o banco como
 * fonte da verdade.
 */
export async function readNoteListCache(
  userId: string,
  options: NoteListOptions
): Promise<NoteListCacheRead> {
  // Cada termo digitado criaria uma chave de baixíssimo reaproveitamento.
  // Busca continua direta no PostgreSQL: menos comandos, menos dados no Redis
  // e nenhuma retenção, ainda que breve, do texto pesquisado pela pessoa.
  if (options.query?.trim()) return { value: null, version: null };

  const client = getRedis();
  if (!client) return { value: null, version: null };

  try {
    const version = (await client.get<string>(versionKey(userId))) ?? "0";
    const cached = await client.get<unknown>(resultKey(userId, version, options));
    if (cached === null) return { value: null, version };

    const parsed = noteListResultSchema.safeParse(cached);
    return { value: parsed.success ? parsed.data : null, version };
  } catch (error) {
    logCacheFailure("read", error);
    return { value: null, version: null };
  }
}

export async function writeNoteListCache(
  userId: string,
  options: NoteListOptions,
  version: string | null,
  value: NoteListResult
): Promise<void> {
  if (options.query?.trim()) return;

  const client = getRedis();
  if (!client || version === null) return;

  try {
    await client.set(resultKey(userId, version, options), value, {
      ex: CACHE_TTL_SECONDS,
    });
  } catch (error) {
    logCacheFailure("write", error);
  }
}

const folderListSchema = z.array(
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    source: z.enum(["user", "ai"]),
    noteCount: z.number().int().nonnegative(),
  })
);

function folderListKey(userId: string, version: string): string {
  return `${CACHE_PREFIX}:folders:${userScope(userId)}:${version}`;
}

/**
 * As pastas com as contagens, no mesmo namespace das listas de notas.
 *
 * Não tem invalidação própria, e é de propósito: toda escrita que muda uma
 * pasta ou a contagem dela — criar, renomear, apagar pasta, mover nota,
 * excluir nota, a organização da IA — já chama `invalidateNoteListCache`,
 * porque a lista de notas também mostra a pasta de cada uma. Uma versão só
 * para as duas coisas significa que elas nunca discordam entre si: não existe
 * uma janela em que o trilho conta 3 notas numa pasta e Notas lista 2.
 */
export async function readFolderListCache(userId: string): Promise<{
  value: FolderItem[] | null;
  version: string | null;
}> {
  const client = getRedis();
  if (!client) return { value: null, version: null };

  try {
    const version = (await client.get<string>(versionKey(userId))) ?? "0";
    const cached = await client.get<unknown>(folderListKey(userId, version));
    if (cached === null) return { value: null, version };

    const parsed = folderListSchema.safeParse(cached);
    return { value: parsed.success ? parsed.data : null, version };
  } catch (error) {
    logCacheFailure("read-folders", error);
    return { value: null, version: null };
  }
}

export async function writeFolderListCache(
  userId: string,
  version: string | null,
  value: FolderItem[]
): Promise<void> {
  const client = getRedis();
  if (!client || version === null) return;

  try {
    await client.set(folderListKey(userId, version), value, { ex: CACHE_TTL_SECONDS });
  } catch (error) {
    logCacheFailure("write-folders", error);
  }
}

/**
 * Muda o namespace depois de uma escrita. As entradas anteriores deixam de
 * ser alcançáveis imediatamente e expiram sozinhas, sem SCAN/DEL em massa.
 */
export async function invalidateNoteListCache(userId: string): Promise<void> {
  const client = getRedis();
  if (!client) return;

  try {
    // Um SET com expiração custa um comando. Um contador seguido de EXPIRE
    // custaria dois sem melhorar o isolamento: um token aleatório também
    // torna impossível reutilizar o namespace anterior.
    await client.set(versionKey(userId), randomUUID(), {
      ex: VERSION_TTL_SECONDS,
    });
  } catch (error) {
    // Cache é uma otimização: a escrita principal já terminou e não pode
    // falhar por indisponibilidade do Redis.
    logCacheFailure("invalidate", error);
  }
}

function logCacheFailure(operation: string, error: unknown): void {
  console.error("[NOTES_CACHE] Redis indisponível; usando PostgreSQL", {
    operation,
    error: error instanceof Error ? error.message : "Unknown",
    timestamp: new Date().toISOString(),
  });
}
