import { LoadingScreen } from "@/components/ui/loading-screen";

/**
 * Loading das configurações.
 *
 * Aparece ao abrir a tela de configurações enquanto o servidor busca o
 * perfil e o resumo de uso da conta.
 */
export default function ConfiguracoesLoading() {
  return <LoadingScreen message="Carregando as configurações…" />;
}
