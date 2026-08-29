"use client";

import gsap from "gsap";
import {
  AudioLines,
  CheckSquare,
  FileText,
  FileType2,
  Hash,
  Image as ImageIcon,
  Inbox,
  MousePointer2,
  Search,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";

import { cn } from "@/lib/utils";

export type AuthShowcaseVariant = "login" | "register";

const LOGIN_BULLETS = [
  { icon: Search, text: "Busque como você lembra — a IA entende o contexto" },
  { icon: Sparkles, text: "Notas se conectam sozinhas enquanto você trabalha" },
  { icon: Zap, text: "Tudo sincronizado, em qualquer dispositivo" },
];

const REGISTER_BULLETS = [
  { icon: Inbox, text: "Capture tudo — texto, áudio, PDFs e ideias" },
  { icon: Sparkles, text: "A IA classifica e organiza por você" },
  { icon: Search, text: "Encontre qualquer coisa em segundos" },
];

const SIDEBAR_ITEMS = [
  { icon: Inbox, label: "Entrada", active: true },
  { icon: FileText, label: "Notas", active: false },
  { icon: CheckSquare, label: "Tarefas", active: false },
  { icon: Hash, label: "Tags", active: false },
];

const LOGIN_NOTES = [
  {
    icon: FileText,
    title: "Ideias para o projeto de verão",
    preview: "Brainstorm de funcionalidades e referências…",
    tag: { label: "Ideias", bg: "bg-tag-1", text: "text-tag-1-foreground" },
  },
  {
    icon: CheckSquare,
    title: "Revisar proposta até sexta",
    preview: "Enviar versão final para o cliente…",
    tag: { label: "Tarefas", bg: "bg-tag-4", text: "text-tag-4-foreground" },
  },
  {
    icon: AudioLines,
    title: "Áudio da reunião de planejamento",
    preview: "Transcrição pronta, 3 pontos de ação…",
    tag: { label: "Reuniões", bg: "bg-tag-3", text: "text-tag-3-foreground" },
  },
];

// Índice da nota que o cursor "abre e lê" na cena de login.
const FEATURED_NOTE_INDEX = 2;

const REGISTER_ITEMS = [
  {
    icon: FileText,
    name: "ideia-solta.txt",
    tag: { label: "Ideias", bg: "bg-tag-1", text: "text-tag-1-foreground" },
    left: "4%",
  },
  {
    icon: AudioLines,
    name: "reuniao.m4a",
    tag: { label: "Reuniões", bg: "bg-tag-3", text: "text-tag-3-foreground" },
    left: "28%",
  },
  {
    icon: ImageIcon,
    name: "quadro.png",
    tag: { label: "Referências", bg: "bg-tag-4", text: "text-tag-4-foreground" },
    left: "52%",
  },
  {
    icon: FileType2,
    name: "artigo.pdf",
    tag: { label: "Leitura", bg: "bg-tag-6", text: "text-tag-6-foreground" },
    left: "74%",
  },
];

// Preview animado do produto no painel lateral das páginas de autenticação.
// Cada variante conta uma história diferente em loop: no login, um cursor
// busca e lê uma nota; no registro, o usuário arrasta arquivos e a IA tagueia.
interface AuthShowcaseProps {
  variant: AuthShowcaseVariant;
}

export function AuthShowcase({ variant }: AuthShowcaseProps) {
  const bullets = variant === "login" ? LOGIN_BULLETS : REGISTER_BULLETS;

  return (
    <div className="flex w-full max-w-md flex-col gap-8">
      {variant === "login" ? <LoginScene /> : <RegisterScene />}

      <ul className="flex flex-col gap-4 px-1">
        {bullets.map((item) => (
          <li key={item.text} className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-foreground">
              <item.icon className="size-4" />
            </div>
            <p className="text-sm text-muted-foreground">{item.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FakeCursor({
  cursorRef,
}: {
  cursorRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={cursorRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-20 opacity-0 will-change-transform"
    >
      <MousePointer2 className="size-4 fill-foreground stroke-background drop-shadow-md" />
    </div>
  );
}

// Cena do login: o cursor busca "áudio da reunião", abre a nota e lê o
// resumo da IA — "seu segundo cérebro em ação".
function LoginScene() {
  const rootRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const placeholderRef = useRef<HTMLSpanElement>(null);
  const typedRef = useRef<HTMLSpanElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const readBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      const container = rootRef.current;
      const cursor = cursorRef.current;
      const searchEl = searchRef.current;
      const noteEl = noteRef.current;
      if (!container || !cursor || !searchEl || !noteEl) return;

      function pointIn(el: HTMLElement, yOffset: number) {
        const containerRect = container!.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left - containerRect.left + rect.width / 2,
          y: rect.top - containerRect.top + yOffset,
        };
      }

      const searchPoint = pointIn(searchEl, searchEl.offsetHeight / 2);
      // Miramos no cabeçalho da nota: ele não se move quando o detalhe expande.
      const notePoint = pointIn(noteEl, 18);
      const readY = notePoint.y + 46;
      const query = "áudio da reunião";

      const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.4, delay: 0.8 });

      tl.set(cursor, {
        x: container.clientWidth - 48,
        y: container.clientHeight - 28,
        autoAlpha: 0,
        scale: 1,
      })
        .to(cursor, { autoAlpha: 1, duration: 0.3 })
        // 1. Vai até a busca e digita.
        .to(cursor, {
          x: searchPoint.x,
          y: searchPoint.y,
          duration: 0.7,
          ease: "power2.inOut",
        })
        .to(cursor, { scale: 0.8, duration: 0.09, yoyo: true, repeat: 1 })
        .call(() => {
          if (placeholderRef.current) {
            placeholderRef.current.style.display = "none";
          }
        });

      query.split("").forEach((_, index) => {
        tl.call(
          () => {
            if (typedRef.current) {
              typedRef.current.textContent = query.slice(0, index + 1);
            }
          },
          [],
          "+=0.05"
        );
      });

      tl.to(
        cursor,
        { x: notePoint.x, y: notePoint.y, duration: 0.7, ease: "power2.inOut" },
        "+=0.35"
      )
        .to(cursor, { scale: 0.8, duration: 0.09, yoyo: true, repeat: 1 })
        // 2. Abre a nota (o detalhe expande).
        .call(() => noteEl.classList.add("ring-2", "ring-accent/50"))
        .to(detailRef.current, {
          height: "auto",
          opacity: 1,
          duration: 0.4,
          ease: "power2.out",
        })
        // 3. "Lê" o resumo: barra de progresso + cursor passeando pela linha.
        .to(readBarRef.current, {
          scaleX: 1,
          duration: 1.2,
          ease: "power1.inOut",
        })
        .to(
          cursor,
          { x: notePoint.x - 52, y: readY, duration: 0.45, ease: "power1.inOut" },
          "<"
        )
        .to(cursor, {
          x: notePoint.x + 56,
          y: readY,
          duration: 1.0,
          ease: "power1.inOut",
        })
        // 4. Fecha tudo para o loop recomeçar.
        .to(
          detailRef.current,
          { height: 0, opacity: 0, duration: 0.3, ease: "power2.in" },
          "+=0.5"
        )
        .call(() => noteEl.classList.remove("ring-2", "ring-accent/50"))
        .to(cursor, { autoAlpha: 0, duration: 0.3 }, "<")
        .call(() => {
          if (typedRef.current) typedRef.current.textContent = "";
          if (placeholderRef.current) placeholderRef.current.style.display = "";
          if (readBarRef.current) gsap.set(readBarRef.current, { scaleX: 0 });
        });
    }, rootRef);

    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={rootRef}
      className="relative overflow-hidden rounded-2xl border border-border bg-background shadow-xl shadow-foreground/5"
    >
      <FakeCursor cursorRef={cursorRef} />

      {/* Barra de título fake com a busca que o cursor usa */}
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
        <span className="size-2.5 rounded-full bg-tertiary" />
        <span className="size-2.5 rounded-full bg-tertiary" />
        <span className="size-2.5 rounded-full bg-tertiary" />
        <div
          ref={searchRef}
          className="ml-3 flex h-6 flex-1 items-center gap-2 rounded-md bg-secondary px-2.5 text-xs text-subtle-foreground"
        >
          <Search className="size-3 shrink-0" />
          <span ref={placeholderRef}>Buscar em tudo…</span>
          <span ref={typedRef} className="text-foreground" />
          <span className="h-3 w-px animate-pulse bg-subtle-foreground" />
        </div>
      </div>

      <div className="flex">
        {/* Sidebar mini */}
        <div className="flex w-32 shrink-0 flex-col gap-0.5 border-r border-border p-3">
          {SIDEBAR_ITEMS.map((item) => (
            <div
              key={item.label}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs",
                item.active
                  ? "bg-tertiary font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </div>
          ))}
        </div>

        {/* Lista de notas */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          {LOGIN_NOTES.map((note, index) => (
            <div
              key={note.title}
              ref={index === FEATURED_NOTE_INDEX ? noteRef : undefined}
              className="rounded-xl border border-border bg-secondary/50 p-3 transition-shadow"
            >
              <div className="flex items-center gap-2">
                <note.icon className="size-3.5 shrink-0 text-subtle-foreground" />
                <p className="truncate text-xs font-medium text-foreground">
                  {note.title}
                </p>
              </div>
              <p className="mt-1 truncate pl-5.5 text-[11px] text-muted-foreground">
                {note.preview}
              </p>
              <span
                className={cn(
                  "mt-2 ml-5.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
                  note.tag.bg,
                  note.tag.text
                )}
              >
                {note.tag.label}
              </span>

              {index === FEATURED_NOTE_INDEX && (
                <div ref={detailRef} className="h-0 overflow-hidden opacity-0">
                  <p className="mt-2 pl-5.5 text-[11px] leading-relaxed text-muted-foreground">
                    Resumo da IA: orçamento aprovado, entrega dia 12 e 3 pontos
                    de ação distribuídos no time.
                  </p>
                  <div className="mt-2 ml-5.5 h-1 w-2/3 overflow-hidden rounded-full bg-border">
                    <div
                      ref={readBarRef}
                      className="h-full w-full origin-left scale-x-0 rounded-full bg-accent"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Card da IA organizando */}
          <div className="mt-1 flex items-center gap-3 rounded-xl border border-border bg-tertiary/60 p-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground">
                IA organizando…
              </p>
              <div className="mt-1.5 flex flex-col gap-1">
                <div className="h-1.5 w-full animate-pulse rounded-full bg-border" />
                <div className="h-1.5 w-2/3 animate-pulse rounded-full bg-border [animation-delay:150ms]" />
              </div>
            </div>
          </div>
          <p className="pl-1 text-[11px] text-muted-foreground">
            3 notas organizadas em &ldquo;Ideias&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}

// Cena do registro: arquivos flutuam, o cursor arrasta cada um para a
// Entrada e a IA devolve a nota já tagueada — "jogue tudo, a IA organiza".
function RegisterScene() {
  const rootRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Versão estática: notas já organizadas, sem cursor.
      slotRefs.current.forEach((el) => el?.classList.remove("opacity-0"));
      return;
    }

    const ctx = gsap.context(() => {
      const container = rootRef.current;
      const cursor = cursorRef.current;
      const dropEl = dropRef.current;
      const items = itemRefs.current.filter(
        (el): el is HTMLDivElement => el !== null
      );
      const slots = slotRefs.current.filter(
        (el): el is HTMLDivElement => el !== null
      );
      if (!container || !cursor || !dropEl || items.length === 0) return;

      // Medimos tudo antes de qualquer transform do GSAP.
      const containerRect = container.getBoundingClientRect();
      function centerOf(el: HTMLElement) {
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left - containerRect.left + rect.width / 2,
          y: rect.top - containerRect.top + rect.height / 2,
        };
      }
      const dropPoint = centerOf(dropEl);
      const itemPoints = items.map(centerOf);

      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.9, delay: 0.8 });

      tl.set(cursor, {
        x: container.clientWidth / 2,
        y: container.clientHeight - 24,
        autoAlpha: 0,
        scale: 1,
      });
      items.forEach((item) =>
        tl.set(item, { x: 0, y: 0, scale: 0.7, autoAlpha: 0 })
      );

      items.forEach((item, index) => {
        const slot = slots[index];
        const home = itemPoints[index];

        tl.to(cursor, { autoAlpha: 1, duration: 0.25 })
          .to(item, {
            autoAlpha: 1,
            scale: 1,
            duration: 0.3,
            ease: "back.out(1.6)",
          })
          // Pega o arquivo…
          .to(cursor, { x: home.x, y: home.y, duration: 0.5, ease: "power2.inOut" })
          .to(cursor, { scale: 0.8, duration: 0.09, yoyo: true, repeat: 1 })
          .to(item, { scale: 0.9, duration: 0.12 })
          // …arrasta até a Entrada…
          .call(() => dropEl.classList.add("border-accent", "bg-tertiary"))
          .to(cursor, {
            x: dropPoint.x,
            y: dropPoint.y,
            duration: 0.7,
            ease: "power2.inOut",
          })
          .to(
            item,
            {
              x: dropPoint.x - home.x,
              y: dropPoint.y - home.y,
              duration: 0.7,
              ease: "power2.inOut",
            },
            "<"
          )
          // …e solta: a IA devolve a nota organizada.
          .call(() => dropEl.classList.remove("border-accent", "bg-tertiary"))
          .to(cursor, { scale: 0.8, duration: 0.09, yoyo: true, repeat: 1 })
          .to(item, {
            autoAlpha: 0,
            scale: 0.4,
            duration: 0.25,
            ease: "power2.in",
          });

        if (slot) {
          tl.fromTo(
            slot,
            { autoAlpha: 0, y: 10 },
            { autoAlpha: 1, y: 0, duration: 0.35, ease: "power2.out" }
          );
        }
        tl.to({}, { duration: 0.25 });
      });

      // Pausa para admirar o resultado, limpa e recomeça o loop.
      tl.to({}, { duration: 1.6 })
        .to(slots, {
          autoAlpha: 0,
          y: -8,
          duration: 0.3,
          stagger: 0.06,
          ease: "power2.in",
        })
        .to(cursor, { autoAlpha: 0, duration: 0.3 }, "<");
    }, rootRef);

    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={rootRef}
      className="relative overflow-hidden rounded-2xl border border-border bg-background shadow-xl shadow-foreground/5"
    >
      <FakeCursor cursorRef={cursorRef} />

      {/* Arquivos flutuando, esperando para serem jogados */}
      {REGISTER_ITEMS.map((item, index) => (
        <div
          key={item.name}
          ref={(el) => {
            itemRefs.current[index] = el;
          }}
          style={{ left: item.left }}
          className="absolute top-14 z-10 flex w-24 items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-2 opacity-0 shadow-md shadow-foreground/5"
        >
          <item.icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-[10px] font-medium text-foreground">
            {item.name}
          </span>
        </div>
      ))}

      {/* Barra de título fake */}
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
        <span className="size-2.5 rounded-full bg-tertiary" />
        <span className="size-2.5 rounded-full bg-tertiary" />
        <span className="size-2.5 rounded-full bg-tertiary" />
        <span className="ml-3 text-xs text-subtle-foreground">
          Entrada — jogue qualquer coisa
        </span>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {/* Zona de drop */}
        <div
          ref={dropRef}
          className="flex h-28 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-tertiary/40 transition-colors"
        >
          <Upload className="size-5 text-subtle-foreground" />
          <p className="text-xs text-muted-foreground">
            Solte aqui — a IA organiza por você
          </p>
        </div>

        <p className="mt-1 text-[11px] font-medium tracking-wide text-subtle-foreground uppercase">
          Organizadas agora
        </p>

        {/* Slots que a IA preenche a cada arquivo processado */}
        {REGISTER_ITEMS.map((item, index) => (
          <div
            key={item.name}
            ref={(el) => {
              slotRefs.current[index] = el;
            }}
            className="flex items-center gap-2.5 rounded-lg border border-border bg-secondary/50 px-3 py-2 opacity-0"
          >
            <item.icon className="size-3.5 shrink-0 text-subtle-foreground" />
            <p className="min-w-0 flex-1 truncate text-xs text-foreground">
              {item.name}
            </p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                item.tag.bg,
                item.tag.text
              )}
            >
              {item.tag.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
