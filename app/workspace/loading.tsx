import { LoadingScreen } from "@/components/ui/loading-screen";

/**
 * Loading da lousa.
 *
 * Aparece ao trocar de workspace ou abrir um workspace diretamente,
 * enquanto o servidor valida o dono e carrega janelas e ligações.
 */
export default function WorkspaceLoading() {
  return <LoadingScreen message="Carregando a lousa…" />;
}
