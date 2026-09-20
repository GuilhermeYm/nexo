"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

// Ctrl + Shift + D leva de volta ao Dashboard, em qualquer página da
// aplicação. Mesma cautela do atalho do trilho (Ctrl + Shift + B, em
// dashboard-shell.tsx): um diálogo aberto controla o próprio foco e não deve
// deixar o atalho alcançar a página por baixo.
export function DashboardShortcut() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (
        event.code !== "KeyD" ||
        !event.ctrlKey ||
        !event.shiftKey ||
        event.altKey ||
        event.metaKey ||
        document.querySelector("dialog[open]")
      ) {
        return;
      }

      event.preventDefault();
      if (pathname !== "/dashboard") router.push("/dashboard");
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [router, pathname]);

  return null;
}
