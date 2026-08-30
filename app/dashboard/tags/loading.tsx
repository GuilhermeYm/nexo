import { LoadingScreen } from "@/components/ui/loading-screen";

/**
 * Loading da página de tags.
 *
 * Aparece ao navegar para as tags enquanto o servidor agrupa o uso de cada
 * marcação.
 */
export default function TagsLoading() {
  return <LoadingScreen message="Organizando as tags…" />;
}
