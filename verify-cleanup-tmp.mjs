import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const tables = [
  "profiles",
  "workspaces",
  "notes",
  "tags",
  "note_tags",
  "attachments",
  "ai_jobs",
  "notifications",
  "error_reports",
  "workspace_windows",
  "workspace_connections",
  "audit_logs",
];

console.log("=== Contagem por tabela ===");
for (const t of tables) {
  const { rows } = await client.query(`select count(*)::int n from ${t}`);
  console.log(`${t}: ${rows[0].n}`);
}

console.log("\n=== auth.users ===");
const { rows: users } = await client.query(
  `select id, email from auth.users order by created_at asc`
);
console.log(users);

console.log("\n=== Linhas orfãs (user_id fora de auth.users) ===");
const withUserId = [
  "workspaces",
  "notes",
  "tags",
  "attachments",
  "ai_jobs",
  "notifications",
  "error_reports",
  "workspace_windows",
  "workspace_connections",
];
for (const t of withUserId) {
  const { rows } = await client.query(
    `select count(*)::int n from ${t} where user_id is not null and user_id not in (select id from auth.users)`
  );
  if (rows[0].n > 0) console.log(`ORFÃOS em ${t}: ${rows[0].n}`);
}

console.log("\n=== audit_logs com user_id nulo (esperado após cascade SET NULL) ===");
const { rows: nullAudit } = await client.query(
  `select count(*)::int n from audit_logs where user_id is null`
);
console.log(nullAudit[0].n);

client.end();

console.log("\n=== Supabase Storage ===");
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const { data: buckets, error: bucketsErr } = await admin.storage.listBuckets();
if (bucketsErr) {
  console.error("Erro ao listar buckets:", bucketsErr.message);
} else {
  for (const b of buckets) {
    const { data: files, error } = await admin.storage.from(b.name).list("", {
      limit: 1000,
    });
    if (error) {
      console.log(`- bucket ${b.name}: erro ao listar (${error.message})`);
      continue;
    }
    console.log(`- bucket ${b.name}: ${files.length} itens na raiz`);
    for (const f of files) {
      console.log(`   ${f.name}`);
    }
  }
}
