/**
 * Captura do seletor de atalhos (NavigationPalette) com sessão real.
 *
 *   node --env-file=.env scripts/shot-palette.mjs --out .impeccable/review/palette/antes
 *   node --env-file=.env scripts/shot-palette.mjs --out .impeccable/review/palette/depois
 *   node --env-file=.env scripts/shot-palette.mjs --keep   # não apaga o usuário
 *
 * O `scripts/shots.mjs` padrão não serve aqui por dois motivos: o dashboard
 * exige sessão (ele só alcançaria a tela de login) e o seletor só abre por
 * atalho (Alt+N / Alt+W) dentro de um <dialog>. Este roteiro cria um usuário
 * de teste pelo service role, entra pela interface — o caminho real, não um
 * cookie forjado —, abre os dois seletores em cada viewport/tema e fotografa
 * cada estado:
 *
 *   páginas, busca sem resultado, primeira opção em foco de teclado,
 *   e workspaces em loading, pronto, com busca vazia, lista vazia e erro.
 *
 * Os estados de workspaces vêm de verdade do componente: interceptamos
 * `GET /api/workspaces` (atraso, corpo vazio, 500) — é exatamente o que o
 * fetching de `navigation-palette.tsx` recebe em cada caso.
 *
 * Além das fotos, em toda abertura de "páginas" lê os estilos computados do
 * input em foco (outline, borda, aparência, ring do wrapper) e confirma se o
 * componente traz o opt-out `data-focus-ring="container"` — grava
 * `diagnostico.json` no diretório de saída: a "borda no focus" fica registrada
 * por medida, não por olho nu. E, logo antes de cada foto, audita a viewport
 * (scale, innerWidth, scrollWidth, rect do diálogo): foi o que mostrou que o
 * recorte mobile vinha do overflow da página atrás, não do componente.
 *
 * Precisa de SUPABASE_SERVICE_ROLE_KEY e DATABASE_URL, então roda com
 * `node --env-file=.env`. A chave nunca sai daqui: é script de terminal, não
 * código da aplicação. Apaga o usuário no fim (o CASCADE leva workspaces).
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import pg from "pg";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/sbin/chromium",
];

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
};

const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const HIDE_DEV_BADGE = "nextjs-portal{display:none !important}";
const EMAIL = `qa-palette-${Date.now()}@nexo.test`;
const PASSWORD = "SenhaDeTesteForte!2026";

const args = process.argv.slice(2);
const OUT = (() => {
  const index = args.indexOf("--out");
  return index >= 0 ? args[index + 1] : ".impeccable/review/palette";
})();
const KEEP = args.includes("--keep");

function findChrome() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      "Chrome não encontrado. Defina CHROME_PATH com o caminho do executável."
    );
  }
  return found;
}

/** Troca o tema no vivo, como o `shot-dashboard.mjs` faz. */
async function setTheme(page, theme) {
  await page.evaluate((value) => {
    try {
      localStorage.setItem("nexo-theme", value);
    } catch {}
    document.documentElement.setAttribute("data-theme", value);
  }, theme);
  await page.waitForTimeout(400);
}

/**
 * Lê o estado da viewport e do diálogo no momento exato da captura. Nas
 * rodadas mobile o recorte das fotos não batia com medições feitas fora daqui;
 * logar junto da foto é o que decide se o estado anômalo existe ou não.
 */
async function auditarViewport(page, size, name) {
  const estado = await page.evaluate(() => {
    const dialog = document.querySelector("dialog[open]");
    const r = dialog?.getBoundingClientRect();
    return {
      scale: window.visualViewport?.scale ?? null,
      offsetLeft: window.visualViewport?.offsetLeft ?? null,
      innerWidth: window.innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      dialog: r
        ? { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right) }
        : null,
    };
  });
  console.log(
    `    [audit ${size}/${name}] scale=${estado.scale} offsetLeft=${estado.offsetLeft} ` +
      `inner=${estado.innerWidth} scrollW=${estado.docScrollWidth} dialog=${JSON.stringify(estado.dialog)}`
  );
}

async function shot(page, outDir, name, size, theme) {
  await auditarViewport(page, size, name);
  await page.screenshot({ path: path.join(outDir, `${name}--${size}-${theme}.png`) });
  console.log(`  ✓ ${name}--${size}-${theme}`);
}

async function openPalette(page, key) {
  await page.keyboard.press(`Alt+${key}`);
  await page.waitForSelector("dialog[open]", { timeout: 5000 });
  // O foco no input acontece num requestAnimationFrame; a lista de workspaces
  // resolve junto. Respiro para os dois estados assentarem.
  await page.waitForTimeout(500);
}

async function closePalette(page) {
  await page.keyboard.press("Escape");
  try {
    await page.waitForSelector("dialog[open]", { state: "detached", timeout: 1500 });
  } catch {
    // Esc dentro de `input[type=search]` com texto: o Chrome consome a primeira
    // para limpar o campo e só a segunda fecha o <dialog>. Nativo do navegador,
    // não do componente — registra e fecha do mesmo jeito.
    console.log("  ℹ Esc com texto no campo: a primeira só limpa o campo (nativo do Chrome)");
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog[open]", { state: "detached", timeout: 5000 });
  }
  await page.waitForTimeout(200);
}

/**
 * Mede, no input em foco, o que o navegador realmente desenhou: outline,
 * borda, aparência e o ring do wrapper. Só lê — o opt-out
 * `data-focus-ring="container"` agora vem do próprio componente; mexer no
 * atributo daqui apagaria a correção do DOM vivo (React não re-aplica sem
 * re-render) e contaminaria as fotos seguintes.
 */
async function diagnose(page) {
  return page.evaluate(() => {
    const input = document.querySelector("dialog[open] input[type='search']");
    if (!input) return { erro: "input não encontrado" };

    const read = () => {
      const cs = getComputedStyle(input);
      return {
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outlineColor: cs.outlineColor,
        outlineOffset: cs.outlineOffset,
        borderTop: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
        appearance: cs.appearance,
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow,
      };
    };

    const wrapper = input.parentElement;
    return {
      inputFocado: document.activeElement === input,
      matchesFocusVisible: input.matches(":focus-visible"),
      temOptOut: input.getAttribute("data-focus-ring") === "container",
      antes: read(),
      wrapperBoxShadow: wrapper ? getComputedStyle(wrapper).boxShadow : null,
    };
  });
}

/** O que o navegador desenhou no item em foco de teclado (outline × ring). */
async function diagnoseFocusedOption(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLButtonElement)) return { erro: "foco não está em botão" };
    const cs = getComputedStyle(el);
    return {
      texto: el.textContent?.trim(),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineOffset: cs.outlineOffset,
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow,
      backgroundColor: cs.backgroundColor,
    };
  });
}

async function main() {
  const outDir = path.resolve(OUT);
  mkdirSync(outDir, { recursive: true });

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const sql = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await sql.connect();

  let userId = null;
  let browser = null;
  const problems = [];
  const diagnostico = [];

  try {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: "Revisão Paleta" },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log("usuário de teste:", userId);

    // Duas workspaces além da "Pessoal" que o trigger de signup cria, para a
    // lista pronta ter o que observar: espaçamento, truncamento e ordem.
    await sql.query("insert into workspaces (user_id, name) values ($1, $2), ($1, $3)", [
      userId,
      "Estudos",
      "Trabalho de campo",
    ]);

    browser = await chromium.launch({ executablePath: findChrome() });
    const problemsConsole = problems;

    // A sessão nasce no desktop (pela interface, o caminho real) e o mobile
    // reentra com o mesmo storageState — como no shot-dashboard.
    let storageState = null;

    for (const size of Object.keys(VIEWPORTS)) {
      const viewport = VIEWPORTS[size];
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
        isMobile: viewport.isMobile ?? false,
        locale: "pt-BR",
        ...(storageState ? { storageState } : {}),
      });

      const page = await context.newPage();
      page.on("console", (message) => {
        if (message.type() === "error") {
          problemsConsole.push(`[${size}] console: ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => {
        problemsConsole.push(`[${size}] pageerror: ${error.message}`);
      });

      if (!storageState) {
        await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
        await page.addStyleTag({ content: HIDE_DEV_BADGE });
        await page.fill('input[type="email"]', EMAIL);
        await page.fill('input[type="password"]', PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForURL("**/dashboard", { timeout: 20_000 });
        storageState = await context.storageState();
      } else {
        await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
      }
      await page.addStyleTag({ content: HIDE_DEV_BADGE });
      await page.waitForTimeout(1500);

      for (const theme of ["light", "dark"]) {
        await setTheme(page, theme);
        console.log(`\n→ ${size}/${theme}`);

        // ---- Alt+N: páginas ----
        await openPalette(page, "N");
        diagnostico.push({ size, theme, paleta: "paginas", ...(await diagnose(page)) });
        await shot(page, outDir, "paginas", size, theme);

        // Foco de teclado na primeira opção: o anel do item × outline global.
        await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(250);
        diagnostico.push({
          size,
          theme,
          paleta: "paginas",
          foco: "primeira-opcao",
          ...(await diagnoseFocusedOption(page)),
        });
        await shot(page, outDir, "paginas-opcao", size, theme);

        await page.keyboard.press("ArrowUp");
        await page.fill("dialog[open] input[type='search']", "zzz");
        await page.waitForTimeout(300);
        await shot(page, outDir, "paginas-busca-vazia", size, theme);
        await closePalette(page);

        // ---- Alt+W: workspaces, cinco estados ----
        // Loading: a rota responde, mas só depois da foto. Espera a lista
        // pronta antes de fechar, para não abortar o fetch no meio.
        await page.route("**/api/workspaces", async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 4000));
          await route.continue().catch(() => {});
        });
        await openPalette(page, "W");
        await shot(page, outDir, "workspaces-loading", size, theme);
        await page.waitForSelector("dialog[open] button >> text=Pessoal", {
          timeout: 10_000,
        }).catch(() => {});
        await page.unroute("**/api/workspaces");
        await page.waitForTimeout(300);
        await shot(page, outDir, "workspaces-pronto", size, theme);

        await page.fill("dialog[open] input[type='search']", "zzz");
        await page.waitForTimeout(300);
        await shot(page, outDir, "workspaces-busca-vazia", size, theme);
        await closePalette(page);

        // Lista vazia.
        await page.route("**/api/workspaces", (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ workspaces: [] }),
          })
        );
        await openPalette(page, "W");
        await shot(page, outDir, "workspaces-vazio", size, theme);
        await closePalette(page);
        await page.unroute("**/api/workspaces");

        // Erro: 500. O navegador loga o 500 no console de propósito — é o
        // estado sendo fotografado, não um defeito da rodada.
        await page.route("**/api/workspaces", (route) =>
          route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Erro ao carregar workspaces." }),
          })
        );
        await openPalette(page, "W");
        await shot(page, outDir, "workspaces-erro", size, theme);
        await closePalette(page);
        await page.unroute("**/api/workspaces");
      }

      await context.close();
    }

    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      path.join(outDir, "diagnostico.json"),
      JSON.stringify(diagnostico, null, 2)
    );
    console.log("\nDiagnóstico (input em foco):");
    for (const row of diagnostico.filter((r) => r.paleta === "paginas" && !r.foco)) {
      console.log(
        `  ${row.size}/${row.theme}: outline=${row.antes?.outlineStyle} ${row.antes?.outlineWidth} offset=${row.antes?.outlineOffset} | ` +
          `opt-out=${row.temOptOut} | focusVisible=${row.matchesFocusVisible} | ` +
          `wrapper=${row.wrapperBoxShadow?.slice(0, 60)}…`
      );
    }

    // O 500 e o abort do loading são o próprio estado fotografado.
    const esperados = /status of 500|ERR_ABORTED|Failed to load resource/;
    const inesperados = [...new Set(problems)].filter((p) => !esperados.test(p));
    console.log(
      inesperados.length
        ? `\nProblemas de console:\n  ${inesperados.join("\n  ")}`
        : "\nNenhum problema de console inesperado."
    );
    console.log(`\nImagens em ${outDir}`);
  } finally {
    await browser?.close();
    if (userId && !KEEP) {
      await admin.auth.admin.deleteUser(userId);
      console.log("usuário de teste apagado:", userId);
    } else if (userId) {
      console.log("usuário de teste MANTIDO:", EMAIL, "/", PASSWORD);
    }
    await sql.end();
  }
}

await main();
