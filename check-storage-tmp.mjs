import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MY_ID = "88d0b3d9-06c6-4ff3-ae17-1267b8abe3fb";

const { data: folders } = await admin.storage.from("files").list("", { limit: 1000 });

let totalOrphanFiles = 0;
for (const f of folders) {
  if (f.id === null) {
    // é uma "pasta" (prefixo), não um objeto de arquivo
    const { data: inner, error } = await admin.storage.from("files").list(f.name, {
      limit: 1000,
    });
    const count = inner?.length ?? 0;
    const mine = f.name === MY_ID;
    if (!mine) totalOrphanFiles += count;
    console.log(`${mine ? "[SEU]" : "[ORFÃ]"} ${f.name}: ${count} arquivo(s)`);
  } else {
    console.log(`(arquivo solto na raiz) ${f.name}`);
  }
}
console.log(`\nTotal de arquivos órfãos: ${totalOrphanFiles}`);
