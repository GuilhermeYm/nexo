import { LoadingScreen } from "@/components/ui/loading-screen";

/**
 * Loading da Entrada.
 *
 * Aparece ao navegar para a página de notificações enquanto o servidor busca
 * a lista de mensagens.
 */
export default function EntradaLoading() {
  return <LoadingScreen message="Abrindo a entrada…" />;
}
