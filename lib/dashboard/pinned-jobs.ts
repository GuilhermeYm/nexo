/**
 * Quais tarefas ficam fixadas no painel Tarefas — a regra, num lugar só.
 *
 * O servidor (`listAiJobs`) e o painel (`tasks-panel.tsx`) precisam concordar
 * sobre isto; duas cópias da regra divergiriam na primeira mudança. Este
 * arquivo não importa nada de servidor, para o painel poder usá-lo.
 *
 * Fixada = pede algo e ainda não aconteceu. Não disputa espaço com o
 * histórico (`JOBS_LIMIT`) e nunca cai da lista porque tarefas mais novas
 * chegaram:
 *
 *  - `insufficient_credits` — parada por teto, espera uma decisão.
 *  - `summarize` em `queued` — a leitura de uma nota que a pessoa escreveu e
 *    a IA ainda não leu (a aba fechou, ou ela ainda está escrevendo). Sai da
 *    faixa sozinha quando a leitura começa.
 */
export function isPinnedJob(job: { kind: string; status: string }): boolean {
  return (
    job.status === "insufficient_credits" ||
    (job.kind === "summarize" && job.status === "queued")
  );
}
