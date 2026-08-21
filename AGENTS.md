<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


# AGENTS.md

## Visão Geral do Projeto 
Esse é uma aplicação fullstack com Next.js, usando TypeScript como linguagem de programação, e na estilização o Tailwind com OriginUI. Além disso, vamos fazer a API na pasta app da aplicação usando como banco de dados o supabase, e usaremos o Drizzle como ORM na nossa aplicação, no lugar do Prisma. Por fim, use o bun como gerenciador de pacotes.

## Comandos Principais
- Iniciar a aplicação: `bun dev`
- Instalar as dependências: `bun install`.

## Estilo de código
- Use TypeScript em modo `strict`.
- Prefira funções nomeadas em vez de arrow functions em Server Components e API Routes (melhor para stack traces).
- Use `async/await` em vez de `.then()`.
- Nomeie variáveis em português ou inglês? **Inglês** para todo o código (padrão da indústria), comentários podem ser em português.

## Estrutura do projeto 
- `/components/` -> components Reacts, criados por nós e pelos módulos. 
- `/hooks/` -> hooks customizados
- `/context/` -> contexts customizados
- `/app/[nome_page]` -> eu fiz desse jeito o diretório, porque você vai criar as páginas das nossas aplicações dentro da pasta `app`, colocando o nome da nossa nova página como nome da pasta. 
- `/lib` -> Aqui vai ficar os utilitários e helpers.
- `/app/api/` -> Aqui vai ser a pasta da nossa API. 

por enquanto só isso. 

## Commits e PRs 
- Formato do título do PR: `[feature|fix|chore] descrição curta`
- Mensagens de commit no padrão Conventional Commits
- Nunca faça commit de arquivos `.env` ou secrets


## Banco de dados
Vamos usar o supabase, antes de tudo eu configurei ele para facilitar o seu trabalho e também para eu ter um maior controle de tudo. 

---

# 🔒 SEGURANÇA — REGRAS OBRIGATÓRIAS

> **Regra de ouro:** Nunca confie no cliente. Valide tudo no servidor. Suponha que todo input é malicioso.

---

## 1. Autenticação & Autorização (Supabase Auth)

```typescript
// ❌ NUNCA faça isso
const { data } = await supabase.from("users").select("*") // sem verificar auth

// ✅ SEMPRE valide a sessão no servidor
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"

export async function GET(request: Request) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    return new Response("Unauthorized", { status: 401 })
  }

  // Só então prossiga com a operação
}
```

**Regras obrigatórias:**
- Use **Row Level Security (RLS)** em TODAS as tabelas do Supabase. Sem exceção.
- Nunca exponha a `service_role_key` no frontend. Use apenas no servidor.
- Valide `user_id` em toda operação — não confie no `user_id` enviado pelo cliente.
- Use `supabase.auth.getUser()` em vez de `getSession()` quando precisar de garantia extra (valida o JWT no servidor).
- Implemente rate limiting nas API routes (use `lru-cache` ou `@upstash/ratelimit`).

---

## 2. API Routes (App Router) — Validação & Sanitização

```typescript
// ✅ Valide TODO o input com Zod (ou similar)
import { z } from "zod"

const createPostSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(10000),
  // ❌ NUNCA aceite user_id do body
})

export async function POST(request: Request) {
  const body = await request.json()
  const validated = createPostSchema.parse(body) // lança erro se inválido

  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return new Response("Unauthorized", { status: 401 })

  // Use o user.id do token, NUNCA do body
  await db.insert(posts).values({
    title: validated.title,
    content: validated.content,
    userId: user.id, // ✅ do auth, não do input
  })
}
```

**Regras obrigatórias:**
- Use **Zod** para validar TODO input de API (body, query params, headers).
- Nunca aceite IDs de usuário, roles ou permissões do cliente — sempre derive do token de sessão.
- Retorne erros genéricos para o cliente (`"Internal server error"`) e logue detalhes no servidor.
- Use `try/catch` em todas as operações de banco e retorne 500 sem expor detalhes do erro.
- Desative CORS desnecessário. Se precisar, seja explícito nos origins permitidos.

---

## 3. Drizzle ORM — SQL Injection & Queries Seguras

```typescript
// ❌ NUNCA concatene strings em queries
const result = await db.execute(`SELECT * FROM users WHERE email = '${email}'`)

// ✅ SEMPRE use parametrização do Drizzle
const result = await db.select().from(users).where(eq(users.email, email))

// ❌ NUNCA passe objetos inteiros do cliente para insert/update
await db.insert(users).values(req.body) // perigoso!

// ✅ SEMPRE especifique campos explicitamente
await db.insert(users).values({
  email: validated.email,
  name: validated.name,
  // role: NUNCA aceite do cliente
})
```

**Regras obrigatórias:**
- Nunca use `db.execute()` com strings concatenadas. Sempre use a API tipada do Drizzle.
- Nunca passe o `req.body` inteiro para insert/update. Especifique cada campo.
- Use `returning()` com cuidado — nunca retorne campos sensíveis (password hash, tokens) sem necessidade.
- Configure `strict` mode do TypeScript e use tipos do Drizzle para evitar campos inesperados.

---

## 4. Row Level Security (RLS) no Supabase

```sql
-- ✅ Habilite RLS em TODAS as tabelas
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- ✅ Política: usuários só veem seus próprios posts
CREATE POLICY "Users can only view their own posts"
ON posts FOR SELECT
USING (auth.uid() = user_id);

-- ✅ Política: só permite insert se o user_id bate com o auth.uid
CREATE POLICY "Users can only insert their own posts"
ON posts FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- ✅ Política: update/delete apenas do dono
CREATE POLICY "Users can only update their own posts"
ON posts FOR UPDATE
USING (auth.uid() = user_id);

-- ❌ NUNCA crie políticas sem USING/WITH CHECK
-- ❌ NUNCA use TRUE como condição (permite tudo)
```

**Regras obrigatórias:**
- TODAS as tabelas devem ter RLS habilitado. Verifique com: `\d+` no SQL Editor.
- Nunca use `USING (true)` ou `WITH CHECK (true)` — isso desabilita a proteção.
- Teste as políticas com diferentes usuários antes de deploy.
- Use `security definer` em functions com cuidado — elas ignoram RLS.

---

## 5. Dados Sensíveis & Ambiente

```typescript
// ❌ NUNCA commite secrets
// .env.local
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_ANON_KEY=eyJ... // pública, ok para frontend
SUPABASE_SERVICE_ROLE_KEY=eyJ... // 🔒 SERVIDOR APENAS

// ✅ Use variáveis de ambiente corretamente
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // só no servidor
  { auth: { persistSession: false } }
)
```

**Regras obrigatórias:**
- `.env.local` no `.gitignore`. Nunca commite.
- `SUPABASE_SERVICE_ROLE_KEY` só em Server Components e API Routes.
- Nunca logue tokens, senhas ou dados de cartão.
- Use HTTPS em produção (HSTS headers).
- Rotacione secrets periodicamente.

---

## 6. Client Components — O que NUNCA fazer

```typescript
// ❌ NUNCA exponha service_role ou queries diretas no cliente
const supabase = createClient(url, serviceRoleKey) // CRIME!

// ❌ NUNCA armazene tokens em localStorage (vulnerável a XSS)
localStorage.setItem("token", token)

// ✅ Use o client seguro do Next.js
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
const supabase = createClientComponentClient()
```

**Regras obrigatórias:**
- Client Components só usam `anon_key` e RLS protege o acesso.
- Nunca armazene session em `localStorage` — use cookies httpOnly (o helper já faz isso).
- Sanitize qualquer HTML renderizado (use DOMPurify se necessário).
- Nunca use `dangerouslySetInnerHTML` com conteúdo do usuário.

---

## 7. Headers & Configurações de Segurança

```typescript
// next.config.js
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://*.supabase.co; connect-src 'self' https://*.supabase.co;",
          },
        ],
      },
    ]
  },
}
```

---

## 8. Upload de Arquivos (Supabase Storage)

```typescript
// ✅ Valide tipo e tamanho antes do upload
const allowedTypes = ["image/jpeg", "image/png", "image/webp"]
const maxSize = 5 * 1024 * 1024 // 5MB

if (!allowedTypes.includes(file.type) || file.size > maxSize) {
  return new Response("Invalid file", { status: 400 })
}

// ✅ Use buckets privados com RLS, gere signed URLs
const { data, error } = await supabase.storage
  .from("avatars")
  .upload(`${user.id}/${Date.now()}-${file.name}`, file, {
    contentType: file.type,
    upsert: false,
  })
```

**Regras obrigatórias:**
- Nunca aceite `application/javascript`, `text/html` ou executáveis.
- Valide MIME type pelo conteúdo do arquivo, não só pela extensão.
- Use buckets privados e gere signed URLs com expiração.
- Limite tamanho de upload no servidor E no cliente.
- Renomeie arquivos — nunca use o nome original do usuário.

---

## 9. Server Actions (`use server`)

```typescript
// ✅ SEMPRE use "use server" com autenticação
"use server"

import { createServerActionClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"
import { z } from "zod"

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100),
  bio: z.string().max(500),
})

export async function updateProfile(formData: FormData) {
  const supabase = createServerActionClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error("Unauthorized")

  const raw = Object.fromEntries(formData.entries())
  const validated = updateProfileSchema.parse(raw)

  // Sempre filtre pelo user.id do auth
  await db.update(profiles)
    .set({ name: validated.name, bio: validated.bio })
    .where(eq(profiles.userId, user.id))
}
```

**Regras obrigatórias:**
- Toda Server Action DEVE verificar autenticação antes de qualquer operação.
- Nunca aceite `userId` do `formData` — sempre use `auth.getUser()`.
- Valide input com Zod antes de tocar no banco.
- Nunca retorne dados sensíveis em Server Actions (elas retornam para o cliente).
- Use `revalidatePath` com cuidado — não exponha paths internos.

---

## 10. Proteção contra CSRF

```typescript
// ✅ Next.js App Router já protege API Routes de CSRF por padrão
// (same-origin policy + cookies httpOnly)

// ✅ Para formulários, use Server Actions (protegidas automaticamente)
// ou inclua um token CSRF em forms tradicionais

// ✅ Para API Routes que aceitam requests de terceiros, valide Origin/Referer
export async function POST(request: Request) {
  const origin = request.headers.get("origin")
  const allowedOrigins = ["https://seusite.com", "https://app.seusite.com"]

  if (!origin || !allowedOrigins.includes(origin)) {
    return new Response("Invalid origin", { status: 403 })
  }

  // prossiga...
}
```

**Regras obrigatórias:**
- Prefira Server Actions para mutações — elas têm proteção CSRF nativa.
- API Routes devem validar `Origin` e `Referer` se aceitarem requests externos.
- Nunca use `GET` para operações de escrita (mutações devem ser `POST/PUT/DELETE`).
- Marque cookies de sessão com `SameSite=Lax` ou `SameSite=Strict`.

---

## 11. Auditoria de Logs (Audit Trail)

```typescript
// ✅ Registre ações críticas em tabela de auditoria
// migration: create table audit_logs (id, user_id, action, table_name, record_id, old_data, new_data, ip_address, user_agent, created_at)

async function auditLog(
  action: "CREATE" | "UPDATE" | "DELETE",
  tableName: string,
  recordId: string,
  oldData?: Record<string, unknown>,
  newData?: Record<string, unknown>
) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()

  await db.insert(auditLogs).values({
    userId: user?.id ?? null,
    action,
    tableName,
    recordId,
    oldData,
    newData,
    ipAddress: headers().get("x-forwarded-for") ?? "unknown",
    userAgent: headers().get("user-agent") ?? "unknown",
  })
}

// Uso:
await db.update(posts).set({ title: "Novo" }).where(eq(posts.id, id))
await auditLog("UPDATE", "posts", id, { title: "Antigo" }, { title: "Novo" })
```

**Regras obrigatórias:**
- Registre toda ação de `UPDATE` e `DELETE` em dados sensíveis.
- Armazene `old_data` e `new_data` para permitir rollback investigativo.
- Inclua `ip_address` e `user_agent` para rastreamento.
- A tabela de audit deve ter RLS — apenas admins podem ler.
- Nunca logue senhas, tokens ou dados de cartão no audit.

---

## 12. Criptografia de Dados PII (Personally Identifiable Information)

```typescript
// ✅ Use criptografia para campos sensíveis antes de salvar no banco
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto"

const ALGORITHM = "aes-256-gcm"
const KEY = scryptSync(process.env.ENCRYPTION_KEY!, "salt", 32)

export function encrypt(text: string): { encrypted: string; authTag: string; iv: string } {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)
  let encrypted = cipher.update(text, "utf8", "hex")
  encrypted += cipher.final("hex")
  const authTag = cipher.getAuthTag().toString("hex")

  return { encrypted, authTag, iv: iv.toString("hex") }
}

export function decrypt(encrypted: string, authTag: string, iv: string): string {
  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(iv, "hex"))
  decipher.setAuthTag(Buffer.from(authTag, "hex"))
  let decrypted = decipher.update(encrypted, "hex", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}

// Uso no banco:
const { encrypted, authTag, iv } = encrypt(cpfDoUsuario)
await db.insert(users).values({
  email: user.email, // não precisa criptografar (usado para login)
  cpfEncrypted: encrypted,
  cpfAuthTag: authTag,
  cpfIv: iv,
})
```

**Regras obrigatórias:**
- Criptografe: CPF, RG, endereço completo, dados bancários, telefone (se LGPD/GDPR exigir).
- Não criptografe campos usados para busca/indexação (ex: email) — use hashing para isso.
- Use **AES-256-GCM** (autenticado) em vez de AES-CBC.
- A `ENCRYPTION_KEY` deve ter 32 bytes e estar em `.env.local`.
- Nunca armazene a chave de criptografia no banco de dados.
- Para dados que precisam de busca (ex: CPF), use **hashing com salt** (bcrypt/argon2) para lookup e criptografia para recuperação.

---

## 13. Tratamento de Erros — Nunca Exponha Internals

```typescript
// ❌ NUNCA faça isso
catch (error) {
  return Response.json({ error: error.message, stack: error.stack }) // EXPÕE TUDO!
}

// ✅ SEMPRE retorne genérico, logue no servidor
catch (error) {
  console.error("[API_ERROR]", {
    endpoint: "/api/posts",
    userId: user?.id,
    error: error instanceof Error ? error.message : "Unknown",
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString(),
  })

  return new Response("Internal server error", { status: 500 })
}
```

**Regras obrigatórias:**
- Erros de validação (Zod) podem retornar 400 com mensagem clara.
- Erros de banco/servidor retornam 500 com mensagem genérica.
- Logue sempre no servidor: endpoint, userId, timestamp, stack trace.
- Use um serviço de log (Sentry, LogRocket) em produção.

---

## 🚨 Problemas Comuns & Como Evitar

| # | Problema | Impacto | Solução |
|---|----------|---------|---------|
| 1 | **RLS desabilitado** em tabelas | Qualquer um com `anon_key` lê/escreve tudo | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` em TODAS as tabelas |
| 2 | **`service_role_key` no frontend** | Acesso total ao banco, bypass total de RLS | Use apenas em Server Components/API Routes, nunca em Client Components |
| 3 | **SQL Injection via `db.execute()`** | Vazamento de dados, deleção em massa | Sempre use API tipada do Drizzle (`eq()`, `like()`, etc.) |
| 4 | **Mass Assignment** — passar `req.body` inteiro para insert | Usuário pode setar `role: "admin"`, `isVerified: true` | Especifique campos explicitamente, use Zod para filtrar |
| 5 | **IDOR** — acessar `/api/posts/123` de outro usuário | Vazamento de dados de outros usuários | Sempre filtre por `user_id = auth.uid()` no servidor |
| 6 | **XSS via `dangerouslySetInnerHTML`** | Execução de scripts maliciosos, roubo de cookies | Use DOMPurify, ou melhor, evite renderizar HTML do usuário |
| 7 | **Falta de rate limiting** em API routes | Brute force, DoS | Implemente rate limiting (@upstash/ratelimit, lru-cache) |
| 8 | **Expor stack traces** em erros de API | Informações para atacantes (versões, paths) | Retorne mensagens genéricas, logue detalhes no servidor |
| 9 | **Upload sem validação de tipo** | Upload de shells PHP/JS, XSS via SVG | Whitelist de MIME types, validação de conteúdo, buckets privados |
| 10 | **JWT no localStorage** | Roubo via XSS | Use cookies httpOnly (o `auth-helpers-nextjs` já faz isso) |
| 11 | **CORS aberto** (`*`) | CSRF, ataques de origens maliciosas | Especifique origins permitidos |
| 12 | **Políticas RLS com `true`** | RLS habilitado mas inútil | Nunca use `USING (true)` — sempre valide `auth.uid()` |
| 13 | **Não validar input do usuário** | Injeção de dados, crashes | Zod em TODOS os endpoints |
| 14 | **Não usar HTTPS em produção** | Man-in-the-middle, roubo de credenciais | Force HTTPS, use HSTS |
| 15 | **Funções Supabase com `security definer`** sem cuidado | Bypass de RLS | Use `security invoker` por padrão, `definer` apenas quando necessário |
| 16 | **Server Action sem auth** | Qualquer um pode chamar e modificar dados | Sempre chame `auth.getUser()` no início da action |
| 17 | **Não auditar ações críticas** | Impossível investigar vazamentos/fraudes | Tabela `audit_logs` para UPDATE/DELETE em dados sensíveis |
| 18 | **PII em texto plano no banco** | Multa LGPD/GDPR, vazamento em massa | Criptografe CPF, endereço, dados bancários com AES-256-GCM |
| 19 | **GET para mutações** | CSRF via link/iframe | Use POST/PUT/DELETE para escrita |
| 20 | **Sem rate limit no login** | Brute force de senhas | Limite tentativas de login (ex: 5 tentativas / 15 minutos) |

---

## ✅ Checklist de Segurança (antes de cada commit)

- [ ] Todas as tabelas novas têm RLS habilitado?
- [ ] Nenhum secret (service_role, API keys) foi exposto no frontend?
- [ ] Todo input de API está validado com Zod?
- [ ] Nenhuma query usa string concatenada (SQL injection)?
- [ ] O `user_id` vem do token de auth, nunca do body/params?
- [ ] Erros retornam mensagens genéricas (não expõem detalhes internos)?
- [ ] Uploads validam tipo e tamanho?
- [ ] Nenhum `dangerouslySetInnerHTML` com conteúdo do usuário?
- [ ] Headers de segurança estão configurados no `next.config.js`?
- [ ] Server Actions verificam autenticação no início?
- [ ] Dados PII estão criptografados antes de ir pro banco?
- [ ] Ações de UPDATE/DELETE em dados sensíveis geram audit log?
- [ ] Rate limiting está implementado em auth e API críticas?

