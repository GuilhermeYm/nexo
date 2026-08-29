"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Entrega ao socket de Realtime o token do usuário, antes de assinar.
 *
 * **Por que isto precisa existir.** O Realtime do Supabase aplica a RLS por
 * conexão: cada evento só é entregue a quem a política deixaria ler aquela
 * linha. Se o socket subir autenticado apenas com a chave anônima,
 * `auth.uid()` é nulo, `USING (auth.uid() = user_id)` não casa com nada — e o
 * cliente fica **inscrito com sucesso e sem receber evento algum**. É o pior
 * formato de falha possível: nada quebra, nada avisa, e a sincronização entre
 * dispositivos simplesmente não acontece.
 *
 * O `supabase-js` liga o token ao socket quando o estado de autenticação
 * muda, mas o canal costuma assinar antes disso: a sessão vem dos cookies e
 * chega um instante depois da montagem do efeito. Este `await` fecha essa
 * corrida — daí em diante o próprio cliente mantém o token atualizado.
 *
 * Chamado sem argumento de propósito: assim o token sai do cliente de
 * autenticação, que renova sozinho quando está para expirar, em vez de a
 * gente congelar um valor lido uma única vez.
 */
export async function authorizeRealtime(
  supabase: SupabaseClient
): Promise<void> {
  try {
    await supabase.realtime.setAuth();
  } catch (error) {
    // Sem token o painel continua funcionando — só deixa de ser avisado e
    // passa a depender da revalidação ao voltar para a aba.
    console.error("[REALTIME] Não foi possível autenticar o socket.", {
      error: error instanceof Error ? error.message : "Unknown",
      timestamp: new Date().toISOString(),
    });
  }
}
