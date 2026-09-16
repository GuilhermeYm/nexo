"use client";

import { AlertTriangle, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  subject?: string;
  confirmLabel: string;
  busyLabel: string;
  busy?: boolean;
  error?: ReactNode;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/**
 * Confirmação para ações destrutivas que precisam interromper o fluxo.
 *
 * O `<dialog>` nativo coloca a superfície no top layer, prende o foco e
 * devolve-o ao botão que abriu a confirmação. O foco inicial fica em
 * "Cancelar": pressionar Enter por reflexo nunca confirma uma exclusão.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  subject,
  confirmLabel,
  busyLabel,
  busy = false,
  error,
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function close() {
    if (!busy) onOpenChange(false);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={busy}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={() => {
        if (open) onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/45"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-error/10 text-error">
            <AlertTriangle className="size-[18px]" aria-hidden="true" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              {title}
            </h2>
            <div
              id={descriptionId}
              className="mt-1.5 text-sm leading-relaxed text-muted-foreground"
            >
              {description}
            </div>
          </div>
        </div>

        {subject && (
          <p className="mt-4 line-clamp-2 rounded-xl bg-secondary px-3.5 py-3 text-sm font-medium leading-snug text-foreground">
            {subject}
          </p>
        )}

        {error && (
          <div
            className="mt-4 rounded-xl bg-error/10 px-3.5 py-3 text-sm text-error"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            autoFocus
            disabled={busy}
            onClick={close}
            className="min-h-10 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-error px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-error/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-wait disabled:opacity-60 dark:text-background"
          >
            {busy && (
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
