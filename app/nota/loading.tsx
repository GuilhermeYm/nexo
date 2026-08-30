import { LoadingScreen } from "@/components/ui/loading-screen";

/**
 * Loading do editor de nota.
 *
 * Aparece ao abrir uma nota (inclusive uma recém-criada a partir do
 * rascunho), enquanto o servidor busca o conteúdo e a lista de workspaces.
 */
export default function NotaLoading() {
  return <LoadingScreen message="Abrindo a nota…" />;
}
