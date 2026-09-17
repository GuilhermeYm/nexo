# Nexo

Um organizador pessoal que aceita o material como ele chega — um PDF, um
áudio, uma ideia meio formada às duas da manhã — e devolve organizado. A IA
faz a primeira classificação; a lousa é onde você reorganiza do seu jeito,
com janelas que se arrastam e flechas entre elas.

> Aplicação em desenvolvimento. Este README descreve o que já está de pé.

> **Auto-hospedado.** Não existe uma Nexo hospedada por terceiros: cada
> pessoa sobe a própria instância, com o próprio projeto Supabase e as
> próprias chaves de IA. Ninguém além de você (e dos serviços que você mesmo
> escolheu configurar) vê os seus dados.

## O que existe hoje

| Rota | O que faz |
|---|---|
| `/` | A página de venda. |
| `/login`, `/registro` | Autenticação pelo Supabase Auth. |
| `/dashboard` | Busca, envio de arquivo, o feed de tarefas da IA e as notas recentes. |
| `/workspace/[id]` | A lousa: pan, zoom, janelas, post-its, anexos e ligações. |
| `/nota/[id]` | O editor de texto rico (TipTap sobre ProseMirror). |
| `/dashboard/tags` | As tags e o que está marcado com cada uma. |

**Capturar** — solte um PDF, um `.docx`, um `.txt` ou um áudio na barra do
dashboard. O texto é extraído no servidor e classificado: título, resumo,
tipo e tags. Cada classificação vira uma linha no painel "Tarefas".

**Organizar** — a lousa de um workspace é uma superfície navegável com
janelas em cima. Notas, post-its, caixas de texto e o próprio arquivo (PDF
página a página, áudio com controles) se arrastam, redimensionam, empilham e
recolhem. Flechas ligam um elemento a outro. A borracha tira em lote — sem
tirar nada da sua conta —, e desfaz.

**Encontrar** — busca full-text em português com `tsvector`, tags, e o painel
de recentes.

## Como rodar

Requer [Bun](https://bun.sh) e uma conta no [Supabase](https://supabase.com)
(o plano gratuito serve).

1. **Crie um projeto no Supabase** — anote a URL, a `anon key` e a
   `service_role key` (Project Settings → API), e a connection string do
   Postgres (Project Settings → Database → Connection string → modo
   "Session").
2. **Preencha o `.env`**:
   ```bash
   cp .env.example .env      # e edite com os valores do passo anterior
   ```
3. **Aplique as migrations**, na ordem, contra o seu próprio banco:
   ```bash
   for f in drizzle/*.sql; do
     node --env-file=.env scripts/apply-migration.mjs "$f"
   done
   ```
   Elas são idempotentes — rodar de novo não duplica nada.
4. **(Opcional) gere uma chave da [Groq](https://console.groq.com/keys)** para
   a classificação automática de documentos. Sem ela, e sem `OPENAI_API_KEY`,
   o upload continua funcionando: entra um classificador determinístico, sem
   custo, no lugar da IA.
5. **Instale e rode:**
   ```bash
   bun install
   bun dev
   ```

Faltar uma variável obrigatória (as do Supabase e a `DATABASE_URL`) não
quebra em algum lugar fundo e sem explicação — a aplicação recusa lançando
uma mensagem que diz exatamente qual variável falta e onde preenchê-la.

### Variáveis de ambiente

| Variável | Obrigatória? | Para quê |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Sim | Endereço do seu projeto Supabase. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sim | Chave pública. O que protege os dados é a RLS, não ela. |
| `DATABASE_URL` | Sim | Conexão Postgres do Drizzle — o mesmo projeto Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Só para os roteiros `bun run shots:*` | Ignora RLS; a aplicação em si nunca lê esta chave. |
| `GROQ_API_KEY` / `GROQ_MODEL` | Não | Classificação por IA. Tem precedência sobre a OpenAI. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Não | Classificação por IA, se não houver chave da Groq. |
| `NEXT_PUBLIC_STRIPE_CHECKOUT_MONTHLY` / `_YEARLY` | Não | Payment Links do Stripe. Sem eles, o CTA leva ao registro. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Não | Rate limiting distribuído. Sem elas, cai num limitador em memória (ok para uma instância só). |

Sem nenhuma das duas chaves de IA (Groq/OpenAI), a aplicação inteira continua
de pé — só a classificação automática vira um stub.

## Verificação

Os roteiros de ponta a ponta **usam** a aplicação com sessão real e conferem
o resultado no banco. Cada um cria o usuário pelo service role, entra pela
interface e apaga o usuário no fim (`-- --keep` mantém).

```bash
bun run shots:dash      # dashboard
bun run shots:board     # a lousa: criar, arrastar, redimensionar, recarregar
bun run shots:links     # ligações entre elementos
bun run shots:eraser    # a borracha e o desfazer
bun run shots:upload    # upload + classificação por IA
bun run shots:file      # anexo como janela (PDF)
bun run shots:tags      # tags
bun run shots           # só capturas de tela, claro e escuro, desktop e mobile
```

As imagens vão para `.impeccable/review/`, fora do git.

## Como isto está construído

Next.js 16 (App Router), TypeScript estrito, Tailwind v4 com OriginUI,
Drizzle sobre Postgres, Supabase para autenticação, storage e Realtime.

Três decisões explicam quase todo o resto:

- **A separação entre contas mora no banco, não na aplicação.** Toda tabela
  tem Row Level Security; as chaves estrangeiras são compostas com o
  `user_id`, então uma linha que aponte para o conteúdo de outra pessoa é
  recusada pelo Postgres, não por um `if`.
- **Postgres é a fonte da verdade; o Realtime é só o sino.** Quando algo muda
  em qualquer dispositivo, o cliente rebusca a rota em vez de aplicar o
  payload do evento — cada resposta é um retrato inteiro, não um remendo.
- **Nada é escrito durante um gesto.** Arrastar uma janela roda em estado
  local a 60fps; meio segundo depois de soltar, sai uma escrita só.

O `AGENTS.md` guarda o porquê de cada decisão não óbvia, incluindo as
alternativas descartadas. Vale ler antes de assumir que algo é bug — pode ser
escolha documentada.

## Privacidade

O conteúdo é seu, e fica na sua própria instância — no seu projeto Supabase,
com as suas chaves. Ninguém além de você opera um servidor central que veja
os seus dados. A única coisa que sai da sua instância é a classificação
automática, quando configurada: o nome e o texto extraído do arquivo — sem
nada que identifique a sua conta — vão para o provedor de IA que **você**
escolheu (Groq ou OpenAI), sob os termos dele.

> A página `/privacidade` do produto ainda descreve um serviço hospedado
> centralmente ("a Nexo" como controladora dos dados). Ela existe da época em
> que este projeto era pensado como um serviço hospedado por terceiros, e
> ainda não foi revista para o modelo auto-hospedado — trate-a como
> desatualizada até lá.

## Licença

Ver [LICENSE](LICENSE).
