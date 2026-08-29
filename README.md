# Nexo

Um organizador pessoal que aceita o material como ele chega — um PDF, um
áudio, uma ideia meio formada às duas da manhã — e devolve organizado. A IA
faz a primeira classificação; a lousa é onde você reorganiza do seu jeito,
com janelas que se arrastam e flechas entre elas.

> Aplicação em desenvolvimento. Este README descreve o que já está de pé.

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

Requer [Bun](https://bun.sh) e um projeto no [Supabase](https://supabase.com).

```bash
bun install
cp .env.example .env      # preencha as chaves
bun dev
```

As migrations ficam em `drizzle/`, numeradas, e são idempotentes:

```bash
node --env-file=.env scripts/apply-migration.mjs drizzle/0001_initial_schema.sql
# ... e assim por diante, na ordem
```

### Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Endereço do projeto Supabase. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública. O que protege os dados é a RLS, não ela. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Só no servidor.** Ignora RLS. |
| `DATABASE_URL` | Conexão Postgres do Drizzle. |
| `GROQ_API_KEY` | Classificação por IA. Sem ela, entra um stub determinístico e o upload não quebra. |
| `GROQ_MODEL` | Opcional (`openai/gpt-oss-120b` por padrão). |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Rate limiting distribuído. Sem elas, cai num limitador em memória. |

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

O conteúdo é seu. A Nexo não treina modelos com ele, não vende dados e não
faz publicidade direcionada. A classificação automática envia o nome e o
texto extraído do arquivo — sem nada que identifique a sua conta — para a
Groq, que o processa sob os termos dela. A página `/privacidade` descreve
exatamente o que sai daqui e o que não sai.

## Licença

Ver [LICENSE](LICENSE).
