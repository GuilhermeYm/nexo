"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Conexões lentas / Economia de dados expõem saveData; o tipo não é padrão.
interface NetworkInformation {
  saveData?: boolean;
}

function shouldPlayVideo(): boolean {
  if (typeof window === "undefined") return false;

  // Movimento reduzido: o vídeo é decorativo, então simplesmente não roda.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }

  // O arquivo tem ~7 MB. Não vale gastar isso em tela pequena nem em
  // Economia de dados — o gradiente sozinho já sustenta o hero.
  if (window.matchMedia("(max-width: 767px)").matches) return false;

  const connection = (navigator as Navigator & { connection?: NetworkInformation })
    .connection;
  if (connection?.saveData) return false;

  return true;
}

const MEDIA_QUERIES = [
  "(prefers-reduced-motion: reduce)",
  "(max-width: 767px)",
];

// Reavalia quando o usuário redimensiona a janela ou troca a preferência de
// movimento no sistema, sem precisar de um efeito para sincronizar estado.
function subscribeToEnvironment(onChange: () => void) {
  const lists = MEDIA_QUERIES.map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}

export function HeroVideoBackground() {
  // No servidor o snapshot é sempre `false`, então o HTML inicial nunca traz o
  // <video> e a hidratação bate. O vídeo entra logo depois, com fade.
  const enabled = useSyncExternalStore(
    subscribeToEnvironment,
    shouldPlayVideo,
    () => false
  );
  const [loaded, setLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Pausa o vídeo quando a aba perde o foco: não faz sentido decodificar
  // 1904x1088 em segundo plano.
  useEffect(() => {
    if (!enabled) return;

    function handleVisibility() {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden) {
        video.pause();
      } else {
        void video.play().catch(() => {
          // Autoplay bloqueado pelo navegador: o gradiente segue como fundo.
        });
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [enabled]);

  return (
    <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
      {/* Base sólida: garante que nunca há flash preto antes do vídeo pintar. */}
      <div className="absolute inset-0 bg-background" />

      {/*
        Sangria vertical de 15%: o parallax desloca o vídeo no scroll e sem
        essa folga a borda inferior apareceria.

        Esse wrapper fica sempre no DOM, mesmo quando `enabled` é falso — só o
        <video> é condicional. `enabled` só vira `true` numa re-render depois
        da hidratação (useSyncExternalStore usa o snapshot do servidor no
        primeiro paint do cliente), e o hero-section.tsx monta o timeline de
        parallax no primeiro efeito, ou seja antes dessa segunda render. Se o
        wrapper também fosse condicional, o seletor `[data-parallax='video']`
        não encontraria nada nesse instante e o GSAP acusava "target not
        found" no console. Mantendo o wrapper fixo, o alvo do parallax sempre
        existe — o vídeo só aparece dentro dele quando estiver pronto.
      */}
      <div
        data-parallax="video"
        className="absolute inset-x-0 -bottom-[15%] -top-[15%]"
      >
        {enabled && (
          <video
            ref={videoRef}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            onCanPlay={() => setLoaded(true)}
            className="size-full object-cover transition-opacity duration-1000 ease-out"
            style={{
              opacity: loaded ? "var(--nx-hero-video-opacity)" : 0,
              filter: "var(--nx-hero-video-filter)",
            }}
          >
            <source src="/video/video_hero.mp4" type="video/mp4" />
          </video>
        )}
      </div>

      {/* Scrim vertical: acalma o topo (navbar) e dissolve o vídeo na
          seção seguinte, sem cortar a imagem com uma linha dura. */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background/45 to-background" />

      {/* Scrim radial atrás do texto: mantém o contraste da headline
          independente do que estiver acontecendo no vídeo. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 32%, var(--nx-bg-primary) 0%, color-mix(in srgb, var(--nx-bg-primary) 70%, transparent) 45%, transparent 75%)",
        }}
      />

      {/* Vinheta: fecha as bordas e dá profundidade. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 80% at 50% 50%, transparent 40%, color-mix(in srgb, var(--nx-bg-primary) 85%, transparent) 100%)",
        }}
      />
    </div>
  );
}
