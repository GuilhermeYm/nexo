"use client";

import { FolderPlus, LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { FOLDER_NAME_MAX, type FolderItem } from "@/lib/folders/types";

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? "Não deu para criar a pasta.";
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (folder: FolderItem) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function close() {
    if (busy) return;
    setName("");
    setError(null);
    onOpenChange(false);
  }

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError(response ? await readError(response) : "Sem conexão.");
      return;
    }
    const body = (await response.json()) as { folder: FolderItem };
    onCreated(body.folder);
    close();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={() => {
        if (open) close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/45"
    >
      <form
        className="p-5 sm:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className="flex items-start gap-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <FolderPlus className="size-[18px]" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold">Nova pasta</h2>
            <p id={descriptionId} className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Crie um lugar para reunir notas relacionadas. Você poderá mover ou retirar notas quando quiser.
            </p>
          </div>
        </div>

        <label className="mt-5 block text-sm font-medium" htmlFor={`${titleId}-name`}>
          Nome da pasta
        </label>
        <Input
          ref={inputRef}
          id={`${titleId}-name`}
          value={name}
          maxLength={FOLDER_NAME_MAX}
          placeholder="Ex.: Pesquisa, Viagem, Projeto novo"
          onChange={(event) => setName(event.target.value)}
          className="mt-2"
        />
        {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={busy} onClick={close} className="min-h-10 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60">
            Cancelar
          </button>
          <button type="submit" disabled={busy || !name.trim()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-45">
            {busy && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {busy ? "Criando…" : "Criar pasta"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
