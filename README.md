# Nexo

[![Versão do projeto](https://img.shields.io/badge/vers%C3%A3o-1.0.0-6d5dfc?style=for-the-badge)](https://github.com/GuilhermeYm/nexo)
[![Bun](https://img.shields.io/badge/Bun-1.4.0-f9f1e1?style=for-the-badge&logo=bun&logoColor=14151a)](https://bun.sh)

![Social preview do Nexo](https://repository-images.githubusercontent.com/1341119139/cc4cd801-bf94-4833-b2e5-6fafbd165ae4)

Um organizador pessoal que aceita o material como ele chega — um PDF, um
áudio, uma imagem, uma ideia meio formada às duas da manhã — e devolve
organizado. A IA faz a primeira classificação, lê o que você escreve e sugere
tags e pastas; a lousa é onde você reorganiza do seu jeito, com janelas que
se arrastam e flechas entre elas.

> Aplicação em desenvolvimento. Este README descreve o que já está de pé.

> **Auto-hospedado.** Não existe uma Nexo hospedada por terceiros: cada
> pessoa sobe a própria instância, com o próprio projeto Supabase e as
> próprias chaves de IA. Ninguém além de você (e dos serviços que você mesmo
> escolheu configurar) vê os seus dados.
>
> O login continua existindo de propósito, não por inércia: uma instância
> auto-hospedada raramente é de uma pessoa só — o cenário comum é alguém
> subir isto num servidor pessoal e disponibilizar para quem mora na casa,
> para a própria organização, ou simplesmente porque duas pessoas dividem o
> mesmo computador e cada uma quer a própria conta, sem ver o conteúdo da
> outra.

## Peça ajuda ao Claude ou ao ChatGPT

Subir a própria instância envolve criar um projeto no Supabase, preencher um
`.env` e aplicar migrations — nada complicado, mas é passo a passo. Se você
preferir ser guiado em vez de seguir a seção "Como rodar" sozinho, abra uma
conversa já com o contexto do repositório e do pedido de configuração pronto:

<div align="left">

[![Claude](https://img.shields.io/badge/Claude-💬%20Configurar%20o%20Nexo-FF9F1C?style=for-the-badge&logo=anthropic&logoColor=white)](https://claude.ai/new?q=Quero%20usar%20o%20Nexo%20%28https%3A%2F%2Fgithub.com%2FGuilhermeYm%2Fnexo%29%2C%20um%20organizador%20pessoal%20auto-hospedado%20formado%20por%20um%20banco%20de%20notas%2C%20lousa%20visual%20e%20classifica%C3%A7%C3%A3o%20por%20IA.%20Quero%20configurar%20a%20minha%20inst%C3%A2ncia%20local%2C%20criar%20o%20projeto%20no%20Supabase%2C%20preencher%20o%20.env%2C%20aplicar%20as%20migrations%20e%20rodar%20o%20projeto%20localmente.)

[![ChatGPT](https://img.shields.io/badge/ChatGPT-💬%20Configurar%20o%20Nexo-10A37F?style=for-the-badge&logo=openai&logoColor=white)](https://chatgpt.com/?q=Quero%20usar%20o%20Nexo%20%28https%3A%2F%2Fgithub.com%2FGuilhermeYm%2Fnexo%29%2C%20um%20organizador%20pessoal%20auto-hospedado%20formado%20por%20um%20banco%20de%20notas%2C%20lousa%20visual%20e%20classifica%C3%A7%C3%A3o%20por%20IA.%20Quero%20configurar%20a%20minha%20inst%C3%A2ncia%20local%2C%20criar%20o%20projeto%20no%20Supabase%2C%20preencher%20o%20.env%2C%20aplicar%20as%20migrations%20e%20rodar%20o%20projeto%20localmente.)

</div>

Esses links não são integração com os produtos — são apenas atalhos para abrir
uma conversa nova já com o prompt de configuração preenchido. Requer uma conta
no assistente escolhido. Se preferir, o mesmo prompt funciona colado
manualmente em qualquer IA, ou você segue a seção **Como rodar** abaixo sem
nenhum deles.

## O que existe hoje

| Rota                  | O que faz                                                                                                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                   | A landing pública — apresenta o projeto e leva ao repositório no GitHub, não a um cadastro.                                                                                                                                                                                                  |
| `/login`, `/registro` | Autenticação pelo Supabase Auth. Não é mais anunciada na landing (não há uma instância central para se cadastrar), mas continua funcionando de verdade — é o que quem sobe a própria instância para a família, os colegas de trabalho ou só um segundo usuário no mesmo computador vai usar. |
| `/dashboard`          | Busca, envio de arquivo, o feed de tarefas da IA e as notas recentes.                                                                                                                                                                                                                        |
| `/dashboard/entrada`  | Os avisos da Nexo: cada tarefa da IA que falhou ou terminou (com o link para o detalhe em Tarefas), o limite de leituras e os avisos da instância. Seleção para marcar como lida ou apagar em lote; o número de não lidas fica sobre o ícone no trilho.                                      |
| `/dashboard/agenda`   | A lista de tarefas do dia — uma nota especial, com fuso horário e contadores corretos.                                                                                                                                                                                                       |
| `/dashboard/notas`    | O acervo: inventário paginado de tudo que existe, com filtros, busca e prévia de leitura.                                                                                                                                                                                                    |
| `/dashboard/arquivos` | O acervo de arquivos enviados (PDF, áudio, imagem, `.docx`).                                                                                                                                                                                                                                 |
| `/dashboard/tags`     | As tags, o que está marcado com cada uma, e o modo grafo (notas e tags como rede).                                                                                                                                                                                                           |
| `/workspace/[id]`     | A lousa: pan, zoom, janelas, post-its, anexos, pastas e ligações.                                                                                                                                                                                                                            |
| `/nota/[id]`          | O editor de texto rico (TipTap sobre ProseMirror), com exportação em PDF.                                                                                                                                                                                                                    |

**Capturar** — solte um PDF, um `.docx`, um `.txt`, uma imagem ou um áudio na
barra do dashboard. PDFs e textos têm o conteúdo extraído; imagens são lidas
pela IA (descrição e texto que aparece nelas); áudios são transcritos em
segundo plano quando uma chave de IA está configurada. A partir do conteúdo,
a Nexo cria título, resumo, tipo e tags. Cada etapa aparece no painel
"Tarefas". Um `.docx` já pode ser guardado e baixado, mas sua extração de
texto ainda não está implementada.

**Organizar** — a lousa de um workspace é uma superfície navegável com
janelas em cima. Notas, post-its, caixas de texto e o próprio arquivo (PDF
página a página, imagem, áudio com controles) se arrastam, redimensionam,
empilham e recolhem. Flechas ligam um elemento a outro. A borracha tira em
lote — sem tirar nada da sua conta —, e desfaz.

**Ler e organizar sozinho** — além de classificar o que você envia, a Nexo lê
as notas que você mesmo escreve, sugere tags com procedência (dá para saber
quais vieram da IA) e propõe pastas para agrupar o que é parecido — tudo
pensado para gastar o mínimo de tokens possível (lote, releitura só de tags
quando o texto não mudou).

**Encontrar** — busca full-text em português com `tsvector`, tags, pastas e o
painel de recentes.

**Diagnosticar** — quando algo falha, você recebe um código curto e ditável
(`NX-XXXX-XXX`) que aponta para o erro real (mensagem, stack, contexto) em
"Meus erros", na sua conta. É um registro **local, na sua própria
instância** — não vai para o mantenedor do projeto nem para lugar nenhum
fora do seu banco. Serve pra você mesmo investigar, ou pra colar o detalhe
(não só o código) se for abrir um Issue.

## Como rodar

Requer [Bun](https://bun.sh) e uma conta no [Supabase](https://supabase.com)
(o plano gratuito serve).

1. **Clone o repositório:**

   ```bash
   git clone https://github.com/GuilhermeYm/nexo.git
   cd nexo
   ```

2. **Crie um projeto no Supabase** — anote a URL, a `anon key` e a
   `service_role key` (Project Settings → API), e a connection string do
   Postgres (Project Settings → Database → Connection string → modo
   "Session").
3. **Preencha o `.env`**:

   ```bash
   cp .env.example .env      # e edite com os valores do passo anterior
   ```

4. **Aplique as migrations**, na ordem, contra o seu próprio banco:

   ```bash
   for f in drizzle/*.sql; do
     node --env-file=.env scripts/apply-migration.mjs "$f"
   done
   ```

   Elas são idempotentes — rodar de novo não duplica nada.

5. **(Opcional) gere uma chave da [Groq](https://console.groq.com/keys)** para
   a classificação automática, a leitura de notas e imagens, e a transcrição
   de áudio. Sem ela, e sem `OPENAI_API_KEY`, o upload continua funcionando:
   documentos recebem um classificador determinístico e áudios ficam
   visivelmente aguardando a configuração da IA, sem alegar que foram
   analisados.
6. **Instale e rode:**

   ```bash
   bun install
   bun dev
   ```

7. Acesse `http://localhost:3000`, crie sua conta em `/registro` e comece a
   usar.

### Com Docker

Para construir e iniciar a versão de produção com Docker:

```bash
docker build -t nexo .
docker run --env-file .env -p 3000:3000 nexo
```

Depois, acesse `http://localhost:3000`. O container usa Bun `1.4.0` e recebe
as variáveis do `.env` somente em tempo de execução; o arquivo `.env` não é
copiado para a imagem.

Faltar uma variável obrigatória (as do Supabase e a `DATABASE_URL`) não
quebra em algum lugar fundo e sem explicação — a aplicação recusa lançando
uma mensagem que diz exatamente qual variável falta e onde preenchê-la.

### Variáveis de ambiente

| Variável                            | Obrigatória?                          | Para quê                                                                                           |
| ----------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`          | Sim                                   | Endereço do seu projeto Supabase.                                                                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`     | Sim                                   | Chave pública. O que protege os dados é a RLS, não ela.                                            |
| `DATABASE_URL`                      | Sim                                   | Conexão Postgres do Drizzle — o mesmo projeto Supabase.                                            |
| `SUPABASE_SERVICE_ROLE_KEY`         | Só para os roteiros `bun run shots:*` | Ignora RLS; a aplicação em si nunca lê esta chave.                                                 |
| `GROQ_API_KEY` / `GROQ_MODEL`       | Não                                   | Classificação por IA de documentos e imagens. Tem precedência sobre a OpenAI.                      |
| `GROQ_TRANSCRIPTION_MODEL`          | Não                                   | Modelo Groq de áudio; padrão `whisper-large-v3-turbo`. Usa a mesma chave Groq.                     |
| `GROQ_NOTE_MODEL`                   | Não                                   | Modelo Groq para a leitura das notas escritas por você (resumo + tags). Sem ela, usa `GROQ_MODEL`. |
| `OPENAI_API_KEY` / `OPENAI_MODEL`   | Não                                   | Classificação por IA, se não houver chave da Groq.                                                 |
| `OPENAI_TRANSCRIPTION_MODEL`        | Não                                   | Modelo OpenAI de áudio; padrão `gpt-4o-mini-transcribe`. Usa a mesma chave OpenAI.                 |
| `OPENAI_NOTE_MODEL`                 | Não                                   | Modelo OpenAI para a leitura das notas. Sem ela, usa `OPENAI_MODEL`.                               |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Não                                   | Rate limiting distribuído. Sem elas, cai num limitador em memória (ok para uma instância só).      |

Sem nenhuma das duas chaves de IA (Groq/OpenAI), a aplicação inteira continua
de pé — documentos usam um classificador determinístico, imagens e áudios
aguardam a configuração da chave para serem lidos/transcritos, e notas
escritas por você simplesmente não são lidas automaticamente.

## Tetos por usuário

Não existe plano, cobrança nem cota de armazenamento: o acervo é limitado
pela sua conta do Supabase, não por uma regra do código. Os tetos abaixo
existem por outros dois motivos — **gastar pouco com a IA** (a chave e a
conta são suas) e **não deixar um cliente adulterado virar abuso** contra a
sua própria instância. Todos valem **por conta**, então numa instância
compartilhada (família, colegas) cada pessoa tem os seus.

Os de "por hora" usam o Redis da Upstash quando `UPSTASH_REDIS_REST_*` está
definida; sem ela, ficam em memória e zeram quando o servidor reinicia. Bater
num deles devolve um aviso de "aguarde um pouco", nunca perda de dado.

**IA — é aqui que está o custo**

| O quê                                       | Teto                                                                 | Onde mudar                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Leituras automáticas da mesma nota          | 6 por dia (+3 a cada "Ler mesmo assim")                              | `MAX_RUNS_PER_DAY` em `lib/ai/note-reading.ts`, `EXTRA_READS_PER_RELEASE` em `lib/ai/preference-options.ts` |
| Leituras de notas, somando todas            | 60 por hora                                                          | `MAX_READS_PER_HOUR` em `lib/ai/note-reading.ts`                                                            |
| "Reler e organizar" (em Notas)              | 6 pedidos por hora, até 20 resumos por pedido                        | `app/api/ai/review/route.ts`, `SUMMARY_REFRESH_LIMIT`                                                       |
| Pastas criadas pela organização             | 5 por vez, 60 pastas por conta                                       | `lib/ai/organize-notes.ts`, `lib/folders/types.ts`                                                          |
| Tags que a IA põe numa nota                 | 2 novas por leitura, 5 no total (20 tags por nota, contando as suas) | `lib/ai/note-reading.ts`                                                                                    |
| Texto enviado para classificar um documento | 8.000 caracteres                                                     | `MAX_INPUT_CHARS` em `lib/ai/classify-document.ts`                                                          |

Quando uma nota chega ao teto diário, a Nexo avisa na Entrada (na hora, num
resumo às 23h ou nada — você escolhe em Configurações → IA).

**Arquivos e conteúdo**

| O quê                          | Teto                                         |
| ------------------------------ | -------------------------------------------- |
| Envio de arquivos              | 10 por hora, 25 MB cada                      |
| Apagar arquivos em lote        | 100 por vez                                  |
| Documento do editor (uma nota) | 200 mil caracteres, 1 MB                     |
| Notas criadas                  | 120 por hora                                 |
| Workspaces criados             | 20 por hora                                  |
| Uma lousa                      | 2.000 janelas, 2.000 ligações e 5.000 traços |

**Entrada**

| O quê                    | Teto                                                         |
| ------------------------ | ------------------------------------------------------------ |
| Notificações mostradas   | as 200 mais recentes (o resto fica no banco até você apagar) |
| Marcar ou apagar em lote | 200 por vez; apagar, 60 vezes por hora                       |

**Conta**

| O quê             | Teto                                                      |
| ----------------- | --------------------------------------------------------- |
| Login             | 5 tentativas a cada 15 min por IP e e-mail; 10 por e-mail |
| Registro          | 5 a cada 15 min por IP                                    |
| Recomeçar do zero | 5 por hora                                                |

Os demais (salvar nota, mover janela, buscar…) são tetos de ritmo altos o
bastante para ninguém bater usando a interface — cada rota declara o seu no
`rateLimit(...)` do começo do arquivo.

## Verificação

Os roteiros de ponta a ponta **usam** a aplicação com sessão real e conferem
o resultado no banco. Cada um cria o usuário pelo service role, entra pela
interface e apaga o usuário no fim (`-- --keep` mantém).

```bash
bun run shots            # só capturas de tela, claro e escuro, desktop e mobile
bun run shots:dash       # dashboard
bun run shots:board      # a lousa: criar, arrastar, redimensionar, recarregar
bun run shots:eraser     # a borracha e o desfazer
bun run shots:upload     # upload + classificação por IA
bun run shots:file       # anexo como janela (PDF)
bun run shots:tags       # tags
bun run shots:entrada    # notificações
bun run shots:erros      # o código de erro, o dedupe, o relato e a triagem
bun run shots:agenda     # a lista do dia, o fuso e os contadores
bun run shots:images     # imagem: upload, leitura pela IA, visualizador e lousa
bun run shots:busca      # a busca de notas e arquivos
bun run shots:pastas     # as pastas no trilho: os menus e as duas exclusões
```

As imagens vão para `.impeccable/review/`, fora do git.

## Como isto está construído

Next.js 16 (App Router), TypeScript estrito, Tailwind v4 com OriginUI,
Drizzle sobre Postgres, Supabase para autenticação, storage e Realtime, Bun
como gerenciador de pacotes.

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
os seus dados. Quando a IA está configurada, o texto extraído de documentos,
o conteúdo enviado para transcrição de áudio e as imagens enviadas para
leitura vão ao provedor que **você** escolheu (Groq ou OpenAI), sob os termos
dele; nenhum identificador de conta é enviado junto.

> A página `/privacidade` do produto já reflete o modelo auto-hospedado: quem
> sobe uma instância para outras pessoas usarem é quem responde pelos dados
> delas, não quem mantém este código. O e-mail de contato ali é um exemplo —
> troque pelo seu antes de publicar a sua instância para terceiros.

## Licença

Uso pessoal — não é uma licença open source padrão (tipo MIT ou Apache). Ver
[LICENSE](LICENSE) para o texto completo antes de redistribuir ou de subir
uma instância para terceiros.
