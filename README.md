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

## Peça ajuda ao Claude

Subir a própria instância envolve criar um projeto no Supabase, preencher um
`.env` e aplicar migrations — nada complicado, mas é passo a passo. Se
preferir ser guiado em vez de seguir a seção "Como rodar" sozinho, o link
abaixo abre uma conversa nova no Claude já com o repositório e o pedido de
ajuda escritos:

[**💬 Configurar o Nexo com o Claude**](https://claude.ai/new?q=Quero%20usar%20o%20Nexo%20%28https%3A%2F%2Fgithub.com%2FGuilhermeYm%2Fnexo%29%2C%20um%20organizador%20pessoal%20auto-hospedado%20f[...]

[**💬 Configurar o Nexo com o ChatGPT**](https://chatgpt.com/?q=Quero%20usar%20o%20Nexo%20%28https%3A%2F%2Fgithub.com%2FGuilhermeYm%2Fnexo%29%2C%20um%20organizador%20pessoal%20auto-hospedado%20f[...]

Isso não é integração nenhuma com o produto — são apenas links para o Claude
e o [ChatGPT](https://chatgpt.com) com a caixa de mensagem pré-preenchida
(parâmetro `?q=`). Requer uma conta no assistente escolhido. Se preferir, o
mesmo prompt funciona colado manualmente em qualquer assistente, ou você segue
a seção **Como rodar** abaixo sem nenhum deles.

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
