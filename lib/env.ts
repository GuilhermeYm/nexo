/**
 * Mensagem de erro para variável de ambiente ausente.
 *
 * Cada usuário sobe a própria instância com as próprias chaves (Supabase,
 * banco, IA) — não existe mais um `.env` central que a gente controla. Sem
 * isto, faltar uma variável quebra fundo dentro de uma lib de terceiro
 * (`TypeError: Invalid URL` no supabase-js, uma conexão recusada no `pg`),
 * sem dizer qual variável preencher nem onde. As poucas leituras de
 * `process.env` que a aplicação precisa checam antes e lançam esta mensagem,
 * que aponta o nome exato e onde resolver.
 *
 * Não lê `process.env` sozinha — quem lê é a chamadora, porque uma variável
 * `NEXT_PUBLIC_*` só é substituída pelo bundler quando o acesso
 * `process.env.NOME` aparece por extenso no arquivo que roda no navegador.
 */
export function missingEnvError(...names: string[]): Error {
  const label =
    names.length > 1
      ? "Variáveis de ambiente ausentes"
      : "Variável de ambiente ausente";
  return new Error(
    `${label}: ${names.join(", ")}. Copie .env.example para .env (ou configure-as no seu host), preencha e reinicie o servidor — veja o README, seção "Como rodar".`
  );
}
