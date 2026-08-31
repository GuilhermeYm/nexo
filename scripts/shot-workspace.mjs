/**
 * Teste de ponta a ponta da lousa, com sessão real.
 *
 *   bun run shots:board            # exercita e fotografa
 *   bun run shots:board -- --keep  # não apaga o usuário de teste no fim
 *
 * Não é só captura de tela: o roteiro **usa** a lousa como uma pessoa usaria
 * — cria nota, post-it e caixa de texto, traz uma nota da conta, arrasta e
 * redimensiona — e depois **recarrega a página para conferir que tudo voltou
 * no lugar**. Essa última parte é o ponto: ela é a prova de que o arranjo foi
 * para o Postgres, e não ficou só na memória do navegador.
 *
 * Mesmo contrato do shot-dashboard: cria o usuário pelo service role, entra
 * pela interface (o caminho real, não um cookie forjado) e apaga o usuário no
 * fim — o `ON DELETE CASCADE` de `auth.users` leva junto workspaces, notas e
 * janelas.
 *
 * Precisa de SUPABASE_SERVICE_ROLE_KEY e DATABASE_URL: roda com
 * `node --env-file=.env`.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync } from "node:fs";
import pg from "pg";
import { chromium } from "playwright-core";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

const OUT = ".impeccable/review/board";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const EMAIL = `qa-board-${Date.now()}@nexo.test`;
const PASSWORD = "SenhaDeTesteForte!2026";
const HIDE_DEV_BADGE = "nextjs-portal{display:none !important}";

/** Notas que a lousa vai poder trazer da conta. */
const NOTES = [
  ["Reunião de alinhamento — squad Nexo", "Decidido: o classificador passa a escolher workspace.", "meeting", "ai"],
  ["Contrato de prestação — Acme", "Vigência de 12 meses, renovação automática, aviso prévio de 30 dias.", "document", "ai"],
  ["Ideia: busca por proximidade de tag", "Se duas notas dividem 3+ tags, a Nexo podia sugerir ligação entre elas.", "idea", "user"],
  ["Comprar cabo HDMI 2.1", "Para o monitor novo. Verificar se aguenta 4K a 120Hz.", "task", "user"],
];

function findChrome() {
  const found =
    (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)
      ? process.env.CHROME_PATH
      : null) ?? CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new Error("Chrome não encontrado. Defina CHROME_PATH.");
  return found;
}

async function seedNotes(sql, userId) {
  const { rows } = await sql.query(
    "select id from workspaces where user_id = $1 order by is_default desc limit 1",
    [userId]
  );
  const workspaceId = rows[0]?.id ?? null;

  for (const [title, content, type, source] of NOTES) {
    await sql.query(
      `insert into notes (user_id, workspace_id, title, content, type, source)
       values ($1, $2, $3, $4, $5::note_type, $6::note_source)`,
      [userId, workspaceId, title, content, type, source]
    );
  }

  return workspaceId;
}

/**
 * Espera a janela nova receber o foco de verdade.
 *
 * Um tempo fixo aqui mascararia justamente o defeito que este roteiro achou:
 * enquanto o campo não recebe o cursor, o botão da barra continua focado, e a
 * barra de espaço do texto seguinte o aciona de novo.
 */
async function waitForEditorFocus(page) {
  await page.waitForFunction(
    () =>
      ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "") ||
      document.activeElement?.isContentEditable === true,
    null,
    { timeout: 15_000 }
  );
}

async function setTheme(page, theme) {
  await page.evaluate((value) => {
    try {
      localStorage.setItem("nexo-theme", value);
    } catch {}
    document.documentElement.setAttribute("data-theme", value);
  }, theme);
  await page.waitForTimeout(350);
}

/** Geometria de cada janela, lida do DOM. É com ela que a conferência é feita. */
async function readLayout(page) {
  return page.$$eval("article[class*='group/window']", (nodes) =>
    nodes.map((node) => ({
      title: node.querySelector("header span")?.textContent?.trim() ?? "",
      left: Math.round(parseFloat(node.style.left) || 0),
      top: Math.round(parseFloat(node.style.top) || 0),
      width: Math.round(parseFloat(node.style.width) || 0),
    }))
  );
}

async function dragBy(page, handle, dx, dy) {
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Em passos: um salto único não produz os `pointermove` intermediários que
  // o arraste real produz, e mascararia bug de acumulação de delta.
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(
      box.x + box.width / 2 + (dx * step) / 10,
      box.y + box.height / 2 + (dy * step) / 10
    );
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function main() {
  mkdirSync(OUT, { recursive: true });

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
  const results = [];

  function check(label, ok, detail = "") {
    results.push(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) problems.push(label);
  }

  try {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: "Guilherme Moura" },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log("usuário de teste:", userId);

    browser = await chromium.launch({ executablePath: findChrome() });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "pt-BR",
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      // Impresso na hora, não só no resumo: um erro de runtime desmonta a
      // árvore e todo passo seguinte falha por um motivo que não é o dele.
      console.log("PAGEERROR:", error.message);
      problems.push(`pageerror: ${error.message}`);
    });

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 20_000 });

    // A raiz não deve mostrar a página de venda para quem já tem sessão.
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    check(
      "logado, a raiz leva ao dashboard",
      page.url().replace(/\/$/, "").endsWith("/dashboard"),
      page.url()
    );

    const workspaceId = await seedNotes(sql, userId);

    // ---- entrar na lousa pela navegação, como a pessoa entraria ----
    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(800);
    await page.click('a[href^="/workspace/"]');
    await page.waitForURL("**/workspace/**", { timeout: 20_000 });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(900);
    check(
      "dashboard leva à lousa pelo link do workspace",
      page.url().includes(`/workspace/${workspaceId}`)
    );

    console.log("→ lousa vazia");
    await setTheme(page, "light");
    await page.screenshot({ path: `${OUT}/empty-light.png` });
    await setTheme(page, "dark");
    await page.screenshot({ path: `${OUT}/empty-dark.png` });
    await setTheme(page, "light");

    // ---- criar ----
    await page.click('button[title^="Nova nota"]');
    await waitForEditorFocus(page);
    await page.keyboard.type("Plano da semana");
    await page.keyboard.press("Tab");
    await page.keyboard.type(
      "Fechar a lousa, ligar o Stripe e responder as seis perguntas que sobraram do FAQ."
    );
    await page.waitForTimeout(400);

    await page.click('button[title^="Post-it"]');
    await waitForEditorFocus(page);
    await page.keyboard.type("Confirmar os preços antes de publicar");
    await page.waitForTimeout(300);

    await page.click('button[title^="Caixa de texto"]');
    await waitForEditorFocus(page);
    await page.keyboard.type("rascunho — não é nota");
    await page.waitForTimeout(300);

    check("três janelas criadas", (await readLayout(page)).length === 3);

    // ---- trazer da conta ----
    await page.click('button[title^="Trazer da conta"]');
    await page.waitForSelector("aside[aria-label='Trazer da conta'] li button");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/picker-light.png` });
    const pickerCount = await page.$$eval(
      "aside[aria-label='Trazer da conta'] li button",
      (nodes) => nodes.length
    );
    check("painel lista as notas da conta", pickerCount === NOTES.length, `${pickerCount} notas`);

    await page.click("aside[aria-label='Trazer da conta'] li button");
    // Espera a janela aparecer, não um tempo fixo: a criação passa por uma
    // ida ao servidor, e cronometrá-la só produz falha intermitente.
    const opened = await page
      .waitForFunction(
        () =>
          document.querySelectorAll("article[class*='group/window']").length === 4,
        null,
        { timeout: 15_000 }
      )
      .then(() => true)
      .catch(() => false);
    check("nota da conta abriu na lousa", opened);

    // A mesma nota não pode abrir duas vezes: o índice único recusa.
    // A rota e a interface são conferidas separadamente: com o filtro no
    // cliente, a lista poderia parecer certa mesmo com a consulta errada.
    const fromApi = await page.evaluate(async (id) => {
      const response = await fetch(`/api/workspaces/${id}/notes`, {
        cache: "no-store",
      });
      const body = await response.json();
      return body.notes.length;
    }, workspaceId);
    check(
      "a rota exclui a nota já aberta",
      fromApi === NOTES.length - 1,
      `${fromApi} de ${NOTES.length}`
    );

    await page.click('button[title^="Trazer da conta"]');
    await page.waitForSelector("aside[aria-label='Trazer da conta'] li button");
    await page.waitForTimeout(400);
    const remaining = await page.$$eval(
      "aside[aria-label='Trazer da conta'] li button",
      (nodes) => nodes.length
    );
    check(
      "o painel não oferece a nota já aberta",
      remaining === NOTES.length - 1,
      `${remaining} restantes`
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // ---- arrastar e redimensionar ----
    console.log("janelas antes do arraste:", (await readLayout(page)).length);
    const handles = await page.$$('button[aria-label^="Mover "]');
    // A última em ordem de DOM é a de maior z-index: é a que o ponteiro
    // alcança de fato quando as janelas se sobrepõem.
    const top = handles.length - 1;
    const before = await readLayout(page);
    await dragBy(page, handles[top], 260, 150);
    const afterDrag = await readLayout(page);
    const dx = afterDrag[top].left - before[top].left;
    const dy = afterDrag[top].top - before[top].top;
    // O encaixe pode aproximar em até meio passo para cada lado, então a
    // asserção é "andou o que pedi, e parou no grid" — não um delta exato.
    const moved =
      Math.abs(dx - 260) <= 4 &&
      Math.abs(dy - 150) <= 4 &&
      afterDrag[top].left % 8 === 0 &&
      afterDrag[top].top % 8 === 0;
    check(
      "arraste move a janela e encaixa no grid de 8px",
      moved,
      `Δ ${dx}, ${dy} → (${afterDrag[top].left}, ${afterDrag[top].top})`
    );

    const grips = await page.$$('button[aria-label^="Redimensionar "]');
    const grip = grips[top];
    if (grip) {
      const widthBefore = (await readLayout(page))[top].width;
      await dragBy(page, grip, 120, 60);
      const widthAfter = (await readLayout(page))[top].width;
      check(
        "redimensionar muda a largura",
        widthAfter > widthBefore,
        `${widthBefore} → ${widthAfter}`
      );
    }

    // ---- menu do botão direito no fundo ----
    const beforeMenu = (await readLayout(page)).length;
    await page.mouse.click(240, 700, { button: "right" });
    await page.waitForSelector("[role='menu']", { timeout: 5000 });
    await page.screenshot({ path: `${OUT}/menu-fundo-light.png` });
    await page.click("[role='menu'] [role='menuitem']:has-text('Post-it aqui')");
    await waitForEditorFocus(page);
    check(
      "menu do fundo cria onde o ponteiro estava",
      (await readLayout(page)).length === beforeMenu + 1
    );

    // ---- menu do botão direito numa janela, com exclusão em dois passos ----
    const noteHandle = await page.$(
      'button[aria-label^="Mover Comprar cabo HDMI"]'
    );
    const noteBox = await noteHandle.boundingBox();
    await page.mouse.click(noteBox.x + 40, noteBox.y + 4, { button: "right" });
    await page.waitForSelector("[role='menu']", { timeout: 5000 });
    await page.screenshot({ path: `${OUT}/menu-janela-light.png` });

    const beforeDelete = (await readLayout(page)).length;
    // Primeiro clique arma; o item troca de rótulo e não apaga nada.
    await page.click("[role='menu'] [role='menuitem']:has-text('Excluir a nota')");
    await page.waitForTimeout(250);
    check(
      "o primeiro clique em excluir só arma, não apaga",
      (await readLayout(page)).length === beforeDelete
    );
    await page.click("[role='menu'] [role='menuitem']:has-text('Excluir para valer')");
    await page.waitForTimeout(1200);
    check(
      "o segundo clique exclui a nota",
      (await readLayout(page)).length === beforeDelete - 1
    );

    const { rows: gone } = await sql.query(
      "select status from notes where user_id = $1 and title = 'Comprar cabo HDMI 2.1'",
      [userId]
    );
    check(
      "a nota excluída fica marcada como deleted, não some do banco",
      gone[0]?.status === "deleted",
      gone[0]?.status ?? "sumiu"
    );

    // ---- renomear o workspace pelo cabeçalho da lousa ----
    await page.click("header h1", { button: "right" });
    await page.waitForSelector("[role='menu']", { timeout: 5000 });
    await page.click(
      "[role='menu'] [role='menuitem']:has-text('Renomear o workspace')"
    );
    await page.waitForTimeout(400);
    await page.fill("input[aria-label='Nome do workspace']", "Lousa renomeada");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);

    const { rows: named } = await sql.query(
      "select name from workspaces where id = $1",
      [workspaceId]
    );
    check(
      "renomear pelo cabeçalho grava no banco",
      named[0]?.name === "Lousa renomeada",
      named[0]?.name ?? "sumiu"
    );
    check(
      "o cabeçalho passa a mostrar o nome novo",
      (await page.textContent("header h1")).includes("Lousa renomeada")
    );

    // ---- zoom: da lousa, não do navegador ----
    //
    // Três defeitos moravam aqui, e os três são invisíveis numa captura de
    // tela: Ctrl+roda ampliava a página junto com a lousa (o ouvinte do React
    // é passivo, e `preventDefault` num ouvinte passivo não faz nada), um
    // giro de mouse jogava o zoom no mínimo de uma vez, e rolar dentro de uma
    // janela arrastava o plano inteiro.
    const zoomPercent = () =>
      page.$eval('button[title^="Voltar a 100%"]', (node) =>
        parseInt(node.textContent, 10)
      );
    const planeTransform = () =>
      page.$eval("div[style*='translate3d']", (node) => node.style.transform);

    await page.keyboard.press("Control+Digit0");
    await page.waitForTimeout(250);
    check("Ctrl 0 devolve a lousa a 100%", (await zoomPercent()) === 100);

    await page.mouse.move(700, 500);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 100);
    await page.keyboard.up("Control");
    await page.waitForTimeout(250);
    const afterWheel = await zoomPercent();
    check(
      "um giro de roda tira um passo, não desce ao mínimo",
      afterWheel < 100 && afterWheel > 60,
      `100% → ${afterWheel}%`
    );

    // O evento precisa sair cancelado, senão o navegador amplia a página
    // junto e os dois zooms brigam.
    const prevented = await page.evaluate(() => {
      const frame = document.querySelector("div[class*='cursor-grab']");
      const event = new WheelEvent("wheel", {
        deltaY: 100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        clientX: 700,
        clientY: 500,
      });
      frame.dispatchEvent(event);
      return event.defaultPrevented;
    });
    check("Ctrl+roda cancela o evento (o navegador não amplia junto)", prevented);

    const beforeStep = await zoomPercent();
    await page.keyboard.press("Control+Minus");
    await page.waitForTimeout(250);
    const smaller = await zoomPercent();
    check("Ctrl − diminui o zoom da lousa", smaller < beforeStep, `${beforeStep}% → ${smaller}%`);

    await page.keyboard.press("Control+Equal");
    await page.waitForTimeout(250);
    check("Ctrl + aumenta o zoom da lousa", (await zoomPercent()) > smaller);

    await page.keyboard.press("Control+Digit0");
    await page.waitForTimeout(250);
    check("Ctrl 0 volta a 100%", (await zoomPercent()) === 100);

    const beforeScroll = await planeTransform();
    const field = await (await page.$("textarea")).boundingBox();
    await page.mouse.move(field.x + field.width / 2, field.y + field.height / 2);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(250);
    check("roda dentro da janela não arrasta a lousa", (await planeTransform()) === beforeScroll);

    // Um ponto do fundo de verdade: com meia dúzia de janelas espalhadas,
    // chutar uma coordenada acerta uma delas mais vezes do que parece.
    const empty = await page.evaluate(() => {
      for (let y = 780; y > 220; y -= 40) {
        for (let x = 60; x < 900; x += 60) {
          const node = document.elementFromPoint(x, y);
          if (node && !node.closest("[data-board-window]")) return { x, y };
        }
      }
      return null;
    });
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(250);
    check("roda no fundo desloca o plano", (await planeTransform()) !== beforeScroll);
    await page.keyboard.press("Control+Digit0");
    await page.waitForTimeout(250);

    // ---- o painel fecha por todos os caminhos ----
    //
    // Ele cobre a lousa inteira; se travar aberto, não sobra tela para
    // trabalhar. São três saídas, e nenhuma pode ser a única.
    const pickerOpen = () =>
      page.$eval("aside[aria-label='Trazer da conta']", (node) =>
        node.hasAttribute("inert") === false
      );

    // A moldura da lousa não pode rolar — nem por programa.
    //
    // Com o painel fechado ele fica encostado 384px para fora da moldura, e
    // `overflow: hidden` teria criado ali um contêiner rolável invisível.
    // Focar a busca do painel enquanto ele ainda entra (300ms de transição)
    // fazia o navegador rolar essa moldura para trazer o campo à vista —
    // medido, 147px —, e a lousa inteira aparecia deslocada, com folga do
    // lado direito. `overflow: clip` não cria contêiner rolável nenhum.
    const rolagem = await page.evaluate(() => {
      const frame = document.querySelector("div.relative.min-h-0.flex-1");
      frame.scrollLeft = 400;
      frame.scrollTop = 400;
      frame.scrollTo({ left: 400, top: 400 });
      return { x: frame.scrollLeft, y: frame.scrollTop };
    });
    check(
      "a moldura da lousa não rola nem quando mandam rolar",
      rolagem.x === 0 && rolagem.y === 0,
      JSON.stringify(rolagem)
    );

    await page.click('button[title^="Trazer da conta"]');
    // De propósito no meio da transição: é ali que o campo focado ainda está
    // fora da tela e o navegador tentaria trazê-lo à força.
    await page.waitForTimeout(80);
    const meioDaEntrada = await page.evaluate(
      () => document.querySelector("div.relative.min-h-0.flex-1").scrollLeft
    );
    check(
      "focar a busca não arrasta a lousa enquanto o painel entra",
      meioDaEntrada === 0,
      `scrollLeft=${meioDaEntrada}`
    );
    await page.waitForTimeout(1200);
    await page.click('button[title^="Trazer da conta"]');
    await page.waitForTimeout(700);
    check("e o painel volta a sair inteiro", (await pickerOpen()) === false);

    // A resposta é atrasada de propósito, e o alvo é a aba Arquivos.
    //
    // Duas razões. Cronometrar o Supabase real só produziria falha
    // intermitente, que é pior que não ter teste. E o texto de carregamento
    // só aparece quando **não há nada de antes para mostrar** — a aba Notas
    // já foi carregada lá em cima e mantém a lista de pé de propósito,
    // esmaecida, enquanto a busca seguinte não volta.
    let slowOnce = true;
    await page.route("**/api/workspaces/*/attachments*", async (route) => {
      if (slowOnce) {
        slowOnce = false;
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      await route.continue();
    });

    await page.click('button[title^="Trazer da conta"]');
    await page.waitForTimeout(600);
    await page.click("aside[aria-label='Trazer da conta'] button:has-text('Arquivos')");
    await page.waitForTimeout(300);
    const early = await page.$eval(
      "aside[aria-label='Trazer da conta']",
      (node) => node.innerText
    );
    check(
      "o painel avisa que está buscando enquanto a resposta não chega",
      /Buscando/.test(early),
      early.split("\n").filter(Boolean).pop()
    );

    // A faixa da barra de rolagem tem de estar reservada.
    //
    // A conferência é do estilo computado, e não da posição da lista, porque
    // o Chrome headless usa barras **sobrepostas**, que não ocupam espaço
    // nenhum — foi exatamente por isso que este defeito passou batido aqui
    // enquanto aparecia no Windows. Para vê-lo com os olhos:
    // `--disable-features=OverlayScrollbar` no launch.
    const gutter = await page.$eval(
      "aside[aria-label='Trazer da conta'] div.overflow-y-auto",
      (node) => getComputedStyle(node).scrollbarGutter
    );
    check(
      "a faixa da barra de rolagem fica reservada (a lista não pula ao carregar)",
      gutter === "stable",
      gutter
    );

    await page.waitForTimeout(1000);

    // O mesmo botão que abriu tem de fechar: é o primeiro lugar em que a
    // pessoa clica para sair, e não fazer nada ali se parece, na tela, com um
    // painel travado.
    await page.click('button[title^="Trazer da conta"]');
    await page.waitForTimeout(700);
    check(
      "o botão da barra fecha o painel que ele abriu",
      (await pickerOpen()) === false
    );

    await page.click('button[title^="Trazer da conta"]');
    await page.waitForTimeout(900);
    await page.click('aside[aria-label="Trazer da conta"] button[title^="Fechar o painel"]');
    await page.waitForTimeout(500);
    check("o X fecha o painel, inclusive na aba Arquivos", (await pickerOpen()) === false);

    await page.click('button[title^="Trazer da conta"]');
    await page.waitForTimeout(700);
    await page.mouse.click(300, 500);
    await page.waitForTimeout(500);
    check("clicar fora fecha o painel", (await pickerOpen()) === false);


    // ---- a prova: recarregar e conferir que o arranjo voltou ----
    const layoutBeforeReload = await readLayout(page);
    // Espera passar o debounce de escrita antes de recarregar.
    await page.waitForTimeout(1400);
    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(1400);
    const layoutAfterReload = await readLayout(page);

    check(
      "todas as janelas sobrevivem ao recarregamento",
      layoutAfterReload.length === layoutBeforeReload.length,
      `${layoutBeforeReload.length} → ${layoutAfterReload.length}`
    );
    const samePositions =
      JSON.stringify([...layoutBeforeReload].sort(byLeft)) ===
      JSON.stringify([...layoutAfterReload].sort(byLeft));
    check("posições e tamanhos voltam iguais (persistiu no Postgres)", samePositions);

    const persisted = await sql.query(
      "select kind, count(*)::int as total from workspace_windows where user_id = $1 group by kind order by kind",
      [userId]
    );
    check(
      "as linhas estão no banco",
      persisted.rows.reduce((sum, row) => sum + row.total, 0) === 4,
      persisted.rows.map((row) => `${row.kind}:${row.total}`).join(" ")
    );

    console.log("→ lousa preenchida");
    await page.screenshot({ path: `${OUT}/full-light.png` });
    await setTheme(page, "dark");
    await page.screenshot({ path: `${OUT}/full-dark.png` });
    await setTheme(page, "light");

    // ---- zoom ----
    await page.click('button[title^="Diminuir zoom"]');
    await page.click('button[title^="Diminuir zoom"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/zoomed-out-light.png` });
    await page.click('button[title="Enquadrar tudo"]');
    await page.waitForTimeout(400);

    // ---- celular ----
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: "pt-BR",
      storageState: await context.storageState(),
    });
    const mobilePage = await mobile.newPage();
    // O storageState copia o localStorage do desktop, o que aqui seria
    // mentira: outro aparelho não herda o enquadramento. Limpar a chave faz
    // o celular chegar como chegaria de verdade — e é justamente o caso que
    // o enquadramento automático existe para cobrir.
    await mobilePage.goto(`${BASE}/dashboard`, {
      waitUntil: "domcontentloaded",
    });
    await mobilePage.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("nexo-board-viewport:")) localStorage.removeItem(key);
      }
    });
    await mobilePage.goto(`${BASE}/workspace/${workspaceId}`, {
      waitUntil: "networkidle",
    });
    await mobilePage.addStyleTag({ content: HIDE_DEV_BADGE });
    await mobilePage.waitForTimeout(1400);
    // Janelas dentro da tela é o que prova o enquadramento automático.
    const visibleOnPhone = await mobilePage.evaluate(() => {
      const view = { w: innerWidth, h: innerHeight };
      return [
        ...document.querySelectorAll("article[class*='group/window']"),
      ].filter((node) => {
        const box = node.getBoundingClientRect();
        return (
          box.right > 0 && box.left < view.w && box.bottom > 0 && box.top < view.h
        );
      }).length;
    });
    const onBoard = (await readLayout(page)).length;
    check(
      "no celular a lousa se enquadra sozinha",
      visibleOnPhone === onBoard,
      `${visibleOnPhone} de ${onBoard} janelas na tela`
    );
    await mobilePage.screenshot({ path: `${OUT}/mobile-light.png` });
    await mobilePage.click('button[title^="Trazer da conta"]');
    await mobilePage.waitForTimeout(700);
    await mobilePage.screenshot({ path: `${OUT}/mobile-picker.png` });

    // ---- Recentes: menu de contexto e editor ----
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector('button:has-text("Contrato de prestação")');

    await page.click('button:has-text("Contrato de prestação")', {
      button: "right",
    });
    await page.waitForSelector("[role='menu']", { timeout: 5000 });
    await page.screenshot({ path: `${OUT}/menu-recentes-light.png` });

    // O submenu de workspaces precisa listar os workspaces da pessoa.
    await page.hover("[role='menu'] [role='menuitem']:has-text('Abrir no workspace')");
    await page.waitForTimeout(500);
    const submenuItems = await page.$$eval(
      "[role='menu'] [role='menuitem']",
      (nodes) => nodes.map((node) => node.textContent?.trim() ?? "")
    );
    // "Lousa renomeada" e não "Pessoal": o submenu ler o nome novo é a prova
    // de que o renomeio atravessou a aplicação, e não ficou parado no
    // cabeçalho onde foi feito.
    check(
      "o submenu lista os workspaces da conta, com o nome novo",
      submenuItems.some((text) => text.includes("Lousa renomeada")),
      submenuItems.filter(Boolean).join(" | ").slice(0, 70)
    );
    await page.screenshot({ path: `${OUT}/menu-recentes-submenu.png` });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // ---- abrir no editor ----
    await page.click('button:has-text("Contrato de prestação")', {
      button: "right",
    });
    await page.waitForSelector("[role='menu']", { timeout: 5000 });
    await page.click("[role='menu'] [role='menuitem']:has-text('Abrir no editor')");
    await page.waitForURL("**/nota/**", { timeout: 20_000 });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(".tiptap", { timeout: 20_000 });
    check("o menu de Recentes abre o editor", page.url().includes("/nota/"));

    // O editor precisa abrir com o texto que já existia — a nota veio da
    // semente, sem `content_rich`, e foi montada a partir do texto puro.
    const loaded = await page.$eval(".tiptap", (node) => node.textContent ?? "");
    check(
      "nota sem documento abre a partir do texto puro",
      loaded.includes("Vigência de 12 meses"),
      loaded.slice(0, 48)
    );

    await page.click(".tiptap");
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" Anotado no editor rico.");
    await page.waitForSelector("text=Salvo", { timeout: 20_000 });
    await page.screenshot({ path: `${OUT}/editor-light.png` });
    await setTheme(page, "dark");
    await page.screenshot({ path: `${OUT}/editor-dark.png` });
    await setTheme(page, "light");

    // A prova da arquitetura: o documento foi salvo E o texto puro foi
    // derivado dele no servidor — é o que mantém a busca honesta.
    const { rows: saved } = await sql.query(
      "select content, content_rich is not null as has_rich from notes where user_id = $1 and title = 'Contrato de prestação — Acme'",
      [userId]
    );
    check(
      "o editor grava o documento rico",
      saved[0]?.has_rich === true
    );
    check(
      "e o servidor deriva o texto puro dele",
      typeof saved[0]?.content === "string" &&
        saved[0].content.includes("Anotado no editor rico.") &&
        !saved[0].content.includes("<") &&
        !saved[0].content.includes('"type"'),
      (saved[0]?.content ?? "").slice(-42)
    );

    // ---- abrir no workspace pelo menu de Recentes ----
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.click('button:has-text("Ideia: busca por proximidade")', {
      button: "right",
    });
    await page.waitForSelector("[role='menu']", { timeout: 5000 });
    await page.hover("[role='menu'] [role='menuitem']:has-text('Abrir no workspace')");
    await page.waitForTimeout(500);
    await page.click(
      "[role='menu'] [role='menuitem']:has-text('Lousa renomeada')"
    );
    await page.waitForURL("**/workspace/**", { timeout: 20_000 });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(1600);

    check(
      "abrir no workspace leva para a lousa apontando a janela",
      page.url().includes("focus="),
      page.url().split("?")[1] ?? "sem parâmetro"
    );

    // Enquadrada quer dizer visível: o teste confere isso, não a URL.
    const focusedVisible = await page.evaluate(() => {
      const view = { w: innerWidth, h: innerHeight };
      return [
        ...document.querySelectorAll("article[class*='group/window']"),
      ].some((node) => {
        const box = node.getBoundingClientRect();
        return (
          box.right > 0 &&
          box.left < view.w &&
          box.bottom > 0 &&
          box.top < view.h &&
          (node.textContent ?? "").includes("proximidade")
        );
      });
    });
    check("e a janela apontada chega dentro da tela", focusedVisible);

    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(600);

    // ---- exclusão de workspace ----
    // O plano Gratuito tem um workspace só, e apagar o único é recusado de
    // propósito. Para exercitar a exclusão é preciso ter dois.
    await sql.query("update profiles set plan = 'pro' where id = $1", [userId]);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.evaluate(() =>
      fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Descartável" }),
      })
    );
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForTimeout(900);

    const rowsBefore = await page.$$eval(
      'aside a[href^="/workspace/"], nav[aria-label="Rodapé"] a[href^="/workspace/"], a[href^="/workspace/"]',
      (nodes) => nodes.length
    );

    const row = await page.$('a[href^="/workspace/"]:has-text("Descartável")');
    const rowBox = await row.boundingBox();
    await page.mouse.click(rowBox.x + 40, rowBox.y + rowBox.height / 2, {
      button: "right",
    });
    await page.waitForSelector("[role='menu']", { timeout: 5000 });
    await page.screenshot({ path: `${OUT}/menu-workspace-light.png` });
    await page.click("[role='menu'] [role='menuitem']:has-text('Excluir workspace')");
    await page.waitForTimeout(200);
    await page.click("[role='menu'] [role='menuitem']:has-text('Excluir para valer')");
    await page.waitForTimeout(1500);

    const rowsAfter = await page.$$eval('a[href^="/workspace/"]', (nodes) => nodes.length);
    check(
      "o workspace some da interface depois de excluído",
      rowsAfter < rowsBefore,
      `${rowsBefore} → ${rowsAfter}`
    );

    const { rows: leftovers } = await sql.query(
      "select count(*)::int as total from workspaces where user_id = $1",
      [userId]
    );
    check("e some do banco", leftovers[0].total === 1, `${leftovers[0].total} restante`);

    const { rows: survivors } = await sql.query(
      "select count(*)::int as total from notes where user_id = $1 and status <> 'deleted'",
      [userId]
    );
    check(
      "as notas sobrevivem à exclusão do workspace",
      survivors[0].total >= 3,
      `${survivors[0].total} notas`
    );

    console.log(`\n${results.join("\n")}`);
    const consoleProblems = [...new Set(problems.filter((p) => p.includes(":")))];
    console.log(
      consoleProblems.length
        ? `\nErros de console:\n  ${consoleProblems.join("\n  ")}`
        : "\nNenhum erro de console."
    );
    console.log(`\nImagens em ${OUT}`);
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

function byLeft(a, b) {
  return a.left - b.left || a.top - b.top;
}

await main();
