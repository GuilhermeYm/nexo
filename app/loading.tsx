import { LoadingScreen } from "@/components/ui/loading-screen";

/**
 * Fallback de carregamento global.
 *
 * Cobre qualquer rota filha de `app/layout.tsx` que não tenha seu próprio
 * `loading.tsx`, garantindo que o usuário nunca veja uma tela em branco
 * enquanto o servidor prepara a resposta.
 */
export default function RootLoading() {
  return <LoadingScreen message="Carregando a Nexo…" />;
}
