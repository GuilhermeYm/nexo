# Nexo

[![Versão do projeto](https://img.shields.io/badge/vers%C3%A3o-1.0.0-6d5dfc?style=for-the-badge)](https://github.com/GuilhermeYm/nexo)
[![Bun](https://img.shields.io/badge/Bun-1.4.0-f9f1e1?style=for-the-badge&logo=bun&logoColor=14151a)](https://bun.sh)

![Social preview do Nexo](https://repository-images.githubusercontent.com/1341119139/cc4cd801-bf94-4833-b2e5-6fafbd165ae4)

Um organizador pessoal que aceita o material como ele chega — um PDF, um
áudio, uma imagem, uma ideia meio formada às duas da manhã — e devolve
organizado. A IA faz a primeira classificação, lê o que você escreve e sugere
tags e pastas; a lousa é onde você reorganiza do seu jeito, com janelas que se
arrastam e flechas entre elas.

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

[![Claude](https://img.shields.io/badge/Claude-💬%20Configurar%20o%20Nexo-FF9F1C?style=for-the-badge&logo=anthropic&logoColor=white)](https://claude.ai/new?q=Quero%20usar%20o%20Nexo%20%28https%3A%2F%2Fgithub.com%2FGuilhermeYm%2Fnexo%29%2C%20um%20organizador%20pessoal%20auto-hospedado%20formado%20por%20um%20banco%20de%20notas%2C%20lousa%20visual%20e%20classifica%C3%A7%C3%A3o%20por%20IA%29.%20%20Quero%20configurar%20a%20minha%20inst%C3%A2ncia%20local%2C%20criar%20o%20projeto%20no%20Supabase%2C%20preencher%20o%20.env%2C%20aplicar%20as%20migrations%20e%20rodar%20o%20projeto%20localmente.)

[![ChatGPT](https://img.shields.io/badge/ChatGPT-💬%20Configurar%20o%20Nexo-10A37F?style=for-the-badge&logo=openai&logoColor=white)](https://chatgpt.com/?q=Quero%20usar%20o%20Nexo%20%28https%3A%2F%2Fgithub.com%2FGuilhermeYm%2Fnexo%29%2C%20um%20organizador%20pessoal%20auto-hospedado%20formado%20por%20um%20banco%20de%20notas%2C%20lousa%20visual%20e%20classifica%C3%A7%C3%A3o%20por%20IA%29.%20%20Quero%20configurar%20a%20minha%20inst%C3%A2ncia%20local%2C%20criar%20o%20projeto%20no%20Supabase%2C%20preencher%20o%20.env%2C%20aplicar%20as%20migrations%20e%20rodar%20o%20projeto%20localmente.)

</div>

Esses links não são integração com os produtos — são apenas atalhos para abrir
uma conversa nova já com o prompt de configuração preenchido. Requer uma conta
no assistente escolhido. Se preferir, o mesmo prompt funciona colado
manualmente em qualquer IA, ou você segue a seção **Como rodar** abaixo sem
nenhum deles.

## O que existe hoje

| Rota                  | O que faz |
| --------------------- | --------- |
| `/`                   | A landing pública — apresenta o projeto e leva ao repositório no GitHub, não a um cadastro. |
| `/login`, `/registro` | Autenticação pelo Supabase Auth. |
| `/dashboard`          | Busca, envio de arquivo, o feed de tarefas da IA e as notas recentes. |
| `/dashboard/entrada`  | Os avisos da Nexo e as tarefas da IA. |
| `/dashboard/agenda`   | A lista de tarefas do dia. |
| `/dashboard/notas`    | O acervo paginado de notas. |
| `/dashboard/arquivos` | O acervo de arquivos enviados. |
| `/dashboard/tags`     | Tags e modo grafo. |
| `/workspace/[id]`     | A lousa com janelas, anexos, pastas e ligações. |
| `/nota/[id]`          | O editor de texto rico com exportação em PDF. |

**Capturar** — solte um PDF, um `.docx`, um `.txt`, uma imagem ou um áudio na
barra do dashboard. PDFs e textos têm o conteúdo extraído; imagens são lidas
pela IA; áudios são transcritos em segundo plano quando uma chave de IA está
configurada.

**Organizar** — a lousa de um workspace é uma superfície navegável com janelas
em cima. Notas, post-its, caixas de texto e arquivos se arrastam,
redimensionam, empilham e recolhem. Flechas ligam um elemento a outro.

**Encontrar** — busca full-text em português com `tsvector`, tags, pastas e o
painel de recentes.

**Diagnosticar** — quando algo falha, você recebe um código curto e ditável
(`NX-XXXX-XXX`) que aponta para o erro real em "Meus erros", na sua conta.

## Como rodar

Requer [Bun](https://bun.sh) e uma conta no [Supabase](https://supabase.com).

1. **Clone o repositório:**

   ```bash
   git clone https://github.com/GuilhermeYm/nexo.git
   cd nexo
   ```
2. **Crie um projeto no Supabase** e preencha o `.env`:

   ```bash
   cp .env.example .env
   ```
3. **Aplique as migrations:**

   ```bash
   for f in drizzle/*.sql; do
     node --env-file=.env scripts/apply-migration.mjs "$f"
   done
   ```
4. **Instale e rode:**

   ```bash
   bun install
   bun dev
   ```

Acesse `http://localhost:3000`.

### Com Docker

```bash
docker build -t nexo .
docker run --env-file .env -p 3000:3000 nexo
```

## Como isto está construído

Next.js 16 (App Router), TypeScript estrito, Tailwind v4 com OriginUI, Drizzle
sobre Postgres, Supabase para autenticação, storage e Realtime, Bun como
gerenciador de pacotes.

## Privacidade

O conteúdo é seu e fica na sua própria instância — no seu projeto Supabase,
com as suas chaves. Quando a IA está configurada, o conteúdo vai ao provedor
que **você** escolheu (Groq ou OpenAI), sob os termos dele.

## Licença

Uso pessoal — não é uma licença open source padrão (tipo MIT ou Apache). Ver
[LICENSE](LICENSE) para o texto completo.
