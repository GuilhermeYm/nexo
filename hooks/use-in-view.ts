"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Observa se o elemento está visível na viewport.
 *
 * A página tem várias animações em loop rodando ao mesmo tempo; sem esse
 * gate todas continuariam consumindo CPU fora da tela.
 */
export function useInView<T extends HTMLElement>(rootMargin = "0px") {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin, threshold: 0.15 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Preferência de sistema por menos movimento, reavaliada se o usuário mudar. */
export function usePrefersReducedMotion() {
  // No servidor assume "não reduzido" para o HTML bater com o primeiro paint.
  return useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotion,
    () => false
  );
}
