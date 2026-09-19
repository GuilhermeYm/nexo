# Política de segurança

O Nexo é auto-hospedado: cada pessoa roda a própria instância, com o próprio
projeto Supabase e as próprias chaves. Isso muda o que "reportar uma
vulnerabilidade" quer dizer aqui — dá pra separar em duas categorias.

## O que reportar aqui

Falhas no **código** do Nexo que, se exploradas, comprometeriam qualquer
instância rodando esse código — não só a sua. Por exemplo: um jeito de
burlar a RLS e ler dados de outro usuário dentro da mesma instância, uma
rota que aceita `user_id` vindo do corpo da requisição em vez de tirar da
sessão (`auth.uid()`), XSS persistente, um upload que escapa da whitelist de
tipo de arquivo, uma URL assinada que vaza mais do que deveria. Essas afetam
todo mundo que subir o projeto, e merecem ser corrigidas antes de virarem um
Issue público.

## O que não é isso aqui

- **Configuração da sua própria instância** — uma `service_role key`
  vazada, um `.env` commitado, um bucket do Storage deixado público: é um
  problema de quem administra aquela instância, não um bug neste
  repositório. Exceção: se você chegou lá porque o próprio projeto induz
  esse erro (uma instrução do README, um valor padrão inseguro), aí é bug
  daqui — reporte.
- **Dúvidas de configuração** e bugs sem impacto de segurança seguem pelo
  caminho normal: [Discussions](https://github.com/GuilhermeYm/nexo/discussions)
  para dúvidas, [Issues](https://github.com/GuilhermeYm/nexo/issues/new/choose)
  para bugs.

## Como reportar

Não abra um Issue público para uma vulnerabilidade real — isso avisa quem
quiser explorá-la antes de existir correção. Use um destes dois canais:

1. **[Relato privado pelo GitHub](https://github.com/GuilhermeYm/nexo/security/advisories/new)**
   (preferido) — fica visível só entre você e o mantenedor até sair uma
   correção.
2. **E-mail:** [strickkdesign@proton.me](mailto:strickkdesign@proton.me).

Inclua o que puder: o que foi encontrado, como reproduzir, e o impacto — o
que alguém consegue fazer explorando isso.

## O que esperar

Isto é um projeto pessoal, não uma empresa com SLA — não há recompensa
financeira, e o tempo de resposta depende de quando o mantenedor consegue
olhar. Você recebe confirmação de que o relato chegou e, se quiser, crédito
quando a correção sair.

## Versões cobertas

Só a branch `main`. Não existem releases versionadas ainda — quem sobe a
própria instância deve acompanhar `main`.
