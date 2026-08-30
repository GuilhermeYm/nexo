import { LoadingScreen } from "@/components/ui/loading-screen";

/**
 * Loading do dashboard.
 *
 * Aparece no carregamento inicial e em navegações de/para o dashboard,
 * enquanto o servidor busca perfil, workspaces, tarefas e notas recentes.
 */
export default function DashboardLoading() {
  return <LoadingScreen message="Abrindo o dashboard…" />;
}
