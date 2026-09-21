/**
 * Teste de ponta a ponta das ligações, com sessão real.
 *
 *   bun run shots:links            # exercita e fotografa
 *   bun run shots:links -- --keep  # não apaga o usuário de teste no fim
 *
 * O que ele prova, e que uma captura de tela sozinha não provaria:
 *
 *   - dois toques criam a flecha, e ela vai para o Postgres;
 *   - o destino vira a origem seguinte — a corrente custa um toque por elo;
 *   - a flecha é desenhada de fato, e continua lá depois de recarregar;
 *   - o botão direito nela remove só ela;
 *   - a borracha encosta na flecha e o Desfazer a traz de volta;
 *   - fechar uma janela leva as flechas dela junto, por cascade;
 *   - a flecha curva: o par `bend_t`/`bend_offset` vai inteiro para o banco,
 *     a alça para onde o ponteiro soltou, o arraste sai em poucos PATCH (e
 *     não um por quadro, que estouraria o teto da rota), arrastar além da
 *     ponta não produz `NaN` no traço, e "Reta" zera o par.
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

const OUT = ".impeccable/review/links";
const BASE = process.env.NEXO_BASE_URL ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
const EMAIL = `qa-links-${Date.now()}@nexo.test`;
const PASSWORD = "SenhaDeTesteForte!2026";
const HIDE_DEV_BADGE = "nextjs-portal{display:none !important}";

const WINDOW = "article[class*='group/window']";
/** As flechas, pelo atributo que só elas têm. */
const ARROWS = "[data-connection]";

const NOTES = [
  ["Pesquisa de campo", "Entrevistas com doze pessoas.", "document"],
  ["Hipótese central", "As pessoas guardam antes de organizar.", "idea"],
  ["Próximo passo", "Prototipar a lousa com ligações.", "task"],
];

function findChrome() {
  const found =
    (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)
      ? process.env.CHROME_PATH
      : null) ?? CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new Error("Chrome não encontrado. Defina CHROME_PATH.");
  return found;
}

async function seed(sql, userId) {
  const { rows } = await sql.query(
    "select id from workspaces where user_id = $1 order by is_default desc limit 1",
    [userId]
  );
  const workspaceId = rows[0].id;

  const noteIds = [];
  for (const [title, content, type] of NOTES) {
    const { rows: created } = await sql.query(
      `insert into notes (user_id, workspace_id, title, content, type, source)
       values ($1, $2, $3, $4, $5::note_type, 'user') returning id`,
      [userId, workspaceId, title, content, type]
    );
    noteIds.push(created[0].id);
  }

  return { workspaceId, noteIds };
}

async function countLinks(sql, userId) {
  const { rows } = await sql.query(
    "select count(*)::int as total from workspace_connections where user_id = $1",
    [userId]
  );
  return rows[0].total;
}

/** Espera o banco chegar na contagem esperada, em vez de dormir um tempo fixo. */
async function waitForLinks(sql, userId, expected, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let total = await countLinks(sql, userId);
  while (total !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    total = await countLinks(sql, userId);
  }
  return total;
}

/** Onde cada janela está na tela, para mirar os toques. */
async function readBoxes(page) {
  return page.$$eval(WINDOW, (nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return {
        title: node.querySelector("header span")?.textContent?.trim() ?? "",
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      };
    })
  );
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

    const { workspaceId, noteIds } = await seed(sql, userId);

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
      console.log("PAGEERROR:", error.message);
      problems.push(`pageerror: ${error.message}`);
    });

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 20000 });

    // Três janelas em linha, longe umas das outras: a flecha precisa de
    // espaço entre as bordas para sobrar traço clicável.
    // Do dashboard, e não da própria lousa: a lousa guarda o enquadramento
    // deste dispositivo, e visitá-la uma vez com ela vazia faria a chegada
    // seguinte herdar aquele enquadramento em vez de enquadrar as janelas.
    await page.evaluate(
      async ([id, ids]) => {
        for (const [index, noteId] of ids.entries()) {
          await fetch(`/api/workspaces/${id}/windows`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "note",
              noteId,
              x: 80 + index * 440,
              y: 120,
              width: 260,
              height: 200,
            }),
          });
        }
      },
      [workspaceId, noteIds]
    );

    await page.goto(`${BASE}/workspace/${workspaceId}`, {
      waitUntil: "networkidle",
    });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(WINDOW, { timeout: 20000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/01-sem-ligacoes-light.png` });

    // ---- a ferramenta de ligação ----
    await page.click('button[title^="Ligar"]');
    await page.waitForTimeout(300);
    check(
      "a barra avisa por onde começar",
      await page.isVisible("text=Escolha de onde a flecha deve sair.")
    );

    const boxes = await readBoxes(page);
    const pesquisa = boxes.find((box) => box.title.includes("Pesquisa"));
    const hipotese = boxes.find((box) => box.title.includes("Hipótese"));
    const passo = boxes.find((box) => box.title.includes("Próximo"));
    if (!pesquisa || !hipotese || !passo) {
      throw new Error(`janelas: ${boxes.map((b) => b.title).join(" | ")}`);
    }

    await page.mouse.click(pesquisa.x, pesquisa.y);
    await page.waitForTimeout(300);
    check(
      "escolhida a origem, a barra pede o destino",
      await page.isVisible("text=De “Pesquisa de campo” para onde?")
    );
    // A ponta solta segue o ponteiro enquanto o destino não vem.
    await page.mouse.move((pesquisa.x + hipotese.x) / 2, pesquisa.y - 60);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/02-ligando-light.png` });

    await page.mouse.click(hipotese.x, hipotese.y);
    check(
      "dois toques criam a ligação",
      (await waitForLinks(sql, userId, 1)) === 1
    );

    // O destino virou a origem: mais um toque, mais um elo.
    //
    // Esperar a **barra**, e não só o banco. O Postgres vê o INSERT antes de
    // a resposta chegar ao navegador, e nesse intervalo `linkingPending`
    // ainda é verdadeiro: o toque seguinte é engolido de propósito ("só
    // encadeia depois da confirmação"). Quem mira pelo banco clica cedo
    // demais, perde o elo e acusa o produto de um defeito que é do roteiro.
    await page
      .waitForSelector("text=De “Hipótese central” para onde?", {
        timeout: 10000,
      })
      .catch(() => null);
    await page.mouse.click(passo.x, passo.y);
    await page.waitForTimeout(2000);
    check(
      "o destino vira a origem seguinte (corrente)",
      (await waitForLinks(sql, userId, 2)) === 2
    );

    const { rows: chain } = await sql.query(
      `select w1.z_index as a, w2.z_index as b
         from workspace_connections c
         join workspace_windows w1 on w1.id = c.from_window_id
         join workspace_windows w2 on w2.id = c.to_window_id
        where c.user_id = $1`,
      [userId]
    );
    check("as duas ligações têm origem e destino distintos", chain.length === 2);

    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    const drawn = await page.$$eval(ARROWS, (nodes) => nodes.length);
    check("as flechas são desenhadas de fato", drawn === 2, `${drawn} desenhadas`);
    await page.screenshot({ path: `${OUT}/03-ligadas-light.png` });

    // ---- sobrevive ao recarregamento: veio do Postgres, não da memória ----
    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(WINDOW, { timeout: 20000 });
    await page.waitForTimeout(1000);
    check(
      "e continuam desenhadas depois de recarregar",
      (await page.$$eval(ARROWS, (nodes) => nodes.length)) === 2
    );

    // ---- a folga entre a flecha e a moldura da janela ----
    //
    // Encostada, a flecha vira parte da moldura: o olho lê um retângulo com
    // um espeto, não duas coisas ligadas. A conta é a distância de cada ponta
    // do traço ao retângulo mais próximo, em pixels de tela.
    const gaps = await page.evaluate(() => {
      const group = document.querySelector("[data-connection]");
      if (!group) return null;
      const box = group.getBoundingClientRect();
      const rects = [
        ...document.querySelectorAll("article[class*='group/window']"),
      ].map((node) => node.getBoundingClientRect());

      const ends = [
        { x: box.left, y: box.top + box.height / 2 },
        { x: box.right, y: box.top + box.height / 2 },
      ];

      return ends.map((point) =>
        Math.min(
          ...rects.map((rect) => {
            const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
            const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
            return Math.hypot(dx, dy);
          })
        )
      );
    });
    check(
      "a flecha para antes de encostar na janela",
      Boolean(gaps) && gaps.every((gap) => gap >= 6 && gap <= 30),
      gaps ? gaps.map((gap) => Math.round(gap)).join(" / ") : "sem flecha"
    );

    // ---- o par recíproco não fica uma flecha em cima da outra ----
    const windowIds = await page.evaluate(
      async (id) => {
        const response = await fetch(`/api/workspaces/${id}/windows`, {
          cache: "no-store",
        });
        const body = await response.json();
        return body.connections.map((c) => [c.fromWindowId, c.toWindowId]);
      },
      workspaceId
    );
    const [firstPair] = windowIds;
    await page.evaluate(
      async ([id, from, to]) => {
        await fetch(`/api/workspaces/${id}/connections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // A de volta: B → A. É outra linha de propósito.
          body: JSON.stringify({ fromWindowId: to, toWindowId: from }),
        });
      },
      [workspaceId, firstPair[0], firstPair[1]]
    );
    await page.waitForTimeout(1500);

    const traces = await page.$$eval("[data-connection]", (nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return `${Math.round(box.top)}:${Math.round(box.height)}`;
      })
    );
    check(
      "A→B e B→A são desenhadas separadas",
      traces.length === 3 && new Set(traces).size === traces.length,
      traces.join(" | ")
    );
    await page.screenshot({ path: `${OUT}/04-par-reciproco-light.png` });

    // Desfeita a de volta: o resto do roteiro conta com duas flechas.
    await page.evaluate(
      async ([id, from, to]) => {
        const response = await fetch(`/api/workspaces/${id}/windows`, {
          cache: "no-store",
        });
        const body = await response.json();
        const back = body.connections.find(
          (c) => c.fromWindowId === to && c.toWindowId === from
        );
        await fetch(`/api/workspaces/${id}/connections`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [back.id] }),
        });
      },
      [workspaceId, firstPair[0], firstPair[1]]
    );
    await page.waitForTimeout(1500);

    // ---- o rótulo ----

    /**
     * Escolhe um item no menu da flecha, repetindo se preciso.
     *
     * O menu do Radix anima ao abrir, e o item pode ser remontado entre o
     * `waitForSelector` e o clique: o Playwright vê "element was detached
     * from the DOM" e **o roteiro inteiro morre**, num ponto que não tem
     * nada a ver com o que ele está provando. Aconteceu em duas de cinco
     * rodadas. Reabrir custa um segundo; uma rodada perdida custa três
     * minutos e um diagnóstico errado.
     */
    async function clickMenuItem(at, item, done, tries = 3) {
      for (let attempt = 1; attempt <= tries; attempt++) {
        // Deixa a animação de abertura terminar antes de mirar.
        await page.waitForTimeout(400);
        try {
          await page.click(
            `[role='menu'] [role='menuitem']:has-text('${item}')`,
            { timeout: 5000 }
          );
        } catch {
          // De propósito sem `continue`: o Playwright desiste de um item que
          // foi remontado **depois** de o clique valer. Quem decide se deu
          // certo é o efeito, logo abaixo — repetir por causa do erro
          // clicaria no item duas vezes e desfaria o que já tinha dado certo.
        }

        for (let wait = 0; wait < 20; wait++) {
          if (await done()) return true;
          await page.waitForTimeout(200);
        }

        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
        await page.mouse.click(at.x, at.y, { button: "right" });
        await page
          .waitForSelector("[role='menu']", { timeout: 5000 })
          .catch(() => null);
      }
      return false;
    }
    const between = {
      x: (pesquisa.x + hipotese.x) / 2,
      y: (pesquisa.y + hipotese.y) / 2,
    };
    await page.mouse.click(between.x, between.y, { button: "right" });
    await page.waitForSelector("[role='menu']", { timeout: 5000 });
    check(
      "o menu da flecha oferece escrever nela",
      await page.isVisible("[role='menu'] :text('Escrever na ligação')")
    );
    check(
      "e o item do menu abre o campo de texto",
      await clickMenuItem(between, "Escrever na ligação", () =>
        page.isVisible("input[aria-label='Texto da ligação']")
      )
    );
    await page.waitForSelector("input[aria-label='Texto da ligação']", {
      timeout: 5000,
    });
    await page.fill("input[aria-label='Texto da ligação']", "sustenta");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);

    const { rows: labelled } = await sql.query(
      "select label from workspace_connections where user_id = $1 and label is not null",
      [userId]
    );
    check(
      "o texto escrito na flecha vai para o banco",
      labelled.length === 1 && labelled[0].label === "sustenta",
      labelled.map((row) => row.label).join(", ") || "nenhum"
    );

    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(WINDOW, { timeout: 20000 });
    await page.waitForTimeout(1000);
    check(
      "e continua na tela depois de recarregar",
      await page.isVisible("button:has-text('sustenta')")
    );
    await page.screenshot({ path: `${OUT}/05-com-rotulo-light.png` });

    // ---- o inspetor da ligação ----
    //
    // Clicar no traço (ao lado do texto, não nele) abre o inspetor; o que se
    // escolhe ali precisa chegar ao Postgres, ser desenhado e voltar no
    // recarregamento e no "Desfazer".
    const PANEL = "aside[data-connection-panel]";
    const onTrace = { x: between.x - 48, y: between.y };
    await page.mouse.click(onTrace.x, onTrace.y);
    await page.waitForSelector(PANEL, { timeout: 5000 }).catch(() => null);
    check("clicar no traço abre o inspetor da ligação", await page.isVisible(PANEL));

    await page.fill(`${PANEL} #connection-label`, "sustenta a hipótese");
    await page.click(`${PANEL} button[aria-label='Cor 3']`);
    await page.click(`${PANEL} button:has-text('Tracejado')`);
    await page.click(`${PANEL} button:has-text('Grossa')`);
    await page.click(`${PANEL} button:has-text('Nos dois lados')`);

    async function readStyled() {
      const { rows } = await sql.query(
        `select label, tone, stroke, weight, heads from workspace_connections
          where user_id = $1 and tone is not null`,
        [userId]
      );
      return rows;
    }
    let styled = await readStyled();
    for (let tries = 0; tries < 40; tries++) {
      const row = styled[0];
      if (
        row?.label === "sustenta a hipótese" &&
        row.stroke === "dashed" &&
        row.weight === "bold" &&
        row.heads === "both"
      ) {
        break;
      }
      await page.waitForTimeout(250);
      styled = await readStyled();
    }
    const expectedStyle = (rows) =>
      rows.length === 1 &&
      rows[0].label === "sustenta a hipótese" &&
      rows[0].tone === "3" &&
      rows[0].stroke === "dashed" &&
      rows[0].weight === "bold" &&
      rows[0].heads === "both";
    check(
      "texto, cor, traço, espessura e pontas vão para o banco",
      expectedStyle(styled),
      JSON.stringify(styled)
    );

    /** O desenho da flecha com cor: classe, tracejado e quantas pontas. */
    async function readDrawnStyle() {
      return page.evaluate(() => {
        const group = [...document.querySelectorAll("[data-connection]")].find(
          (node) => node.getAttribute("class")?.includes("tag-3")
        );
        if (!group) return null;
        const paths = [...group.querySelectorAll(":scope > path:not([aria-hidden])")];
        return {
          dashed: paths.some((path) => path.getAttribute("stroke-dasharray")),
          // Faixa de acerto + traço + duas pontas (o halo da seleção fica de fora).
          paths: paths.length,
        };
      });
    }
    const drawnStyle = await readDrawnStyle();
    check(
      "e a flecha é desenhada com eles",
      drawnStyle?.dashed === true && drawnStyle.paths === 4,
      JSON.stringify(drawnStyle)
    );
    await page.screenshot({ path: `${OUT}/05b-inspetor-light.png` });

    // ---- a flecha curva ----
    //
    // O que este bloco prova, e que a captura de tela ao lado não prova:
    //
    //   - "Curva" grava o formato e o par `bend_t`/`bend_offset` **juntos** —
    //     meio par derruba o CHECK do banco e mata o PATCH com um 500;
    //   - o traço vira mesmo uma curva (`Q`), e não uma reta com outro nome;
    //   - a alça só existe na flecha curvada **e** selecionada;
    //   - arrastar a alça grava o novo par, e a alça para exatamente onde o
    //     ponteiro soltou — é a prova de que `bendFromPoint` e `bendPointOf`
    //     são inversas na tela, não só no papel;
    //   - **o arraste sai como um punhado de PATCH, não um por quadro.** A
    //     rota tem teto de 600 edições por hora: sem o debounce, dois
    //     segundos de arraste a 60fps consomem a cota do dia e a pessoa
    //     começa a tomar 429 no meio do gesto. É a única coisa aqui que
    //     falha em produção e não na tela de quem programou;
    //   - arrastar a alça para **além da ponta** não quebra nada: `bend_t`
    //     fica na faixa desenhável e o traço continua um caminho válido. Uma
    //     quadrática está presa nas duas pontas, e pedir que ela passe longe
    //     bem em cima da âncora mandaria o ponto de controle para o infinito
    //     — um `NaN` no `d` faz o SVG descartar o caminho inteiro em
    //     silêncio, sem um erro sequer no console;
    //   - "Reta" zera o par inteiro, e não só o formato.
    const SHAPE = `${PANEL} [role='group'][aria-label='Formato']`;
    /** A alça: o único círculo dentro de uma flecha. */
    const HANDLE = "[data-connection] circle";
    /** O texto da flecha seleciona a ligação, como clicar no traço — e é
        onde mirar depois que a curva tirou o traço de debaixo do ponteiro. */
    const CHIP = "button:has-text('sustenta a hipótese')";

    async function readBend() {
      const { rows } = await sql.query(
        `select shape, bend_t, bend_offset from workspace_connections
          where user_id = $1 and tone is not null`,
        [userId]
      );
      return rows[0] ?? null;
    }

    /** Espera o banco chegar no estado esperado, em vez de dormir um tempo
        fixo — o PATCH da alça sai depois de uma pausa, não na hora. */
    async function waitForBend(predicate, timeout = 10000) {
      const deadline = Date.now() + timeout;
      let row = await readBend();
      while (!predicate(row) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        row = await readBend();
      }
      return row;
    }

    /** Espera o traço chegar ao formato esperado.
     *
     * O banco confirma antes do cliente: quem lê o `d` assim que a linha
     * mudou no Postgres pega o desenho um render atrás — a resposta do PATCH
     * ainda estava a caminho. Não é lentidão do produto, é a ordem natural
     * das duas pontas. */
    async function waitForPath(predicate, timeout = 6000) {
      const deadline = Date.now() + timeout;
      let d = await readPath();
      while (!predicate(d) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        d = await readPath();
      }
      return d;
    }

    /** O `d` do traço desta flecha, como o navegador o tem. */
    async function readPath() {
      return page.evaluate(() => {
        const group = [...document.querySelectorAll("[data-connection]")].find(
          (node) => node.getAttribute("class")?.includes("tag-3")
        );
        return group?.querySelector("path")?.getAttribute("d") ?? null;
      });
    }

    /**
     * O quanto o ponto de controle do traço sai da reta entre as pontas, com
     * sinal — lido do `d` que o navegador tem, sem passar por nada nosso.
     *
     * Reimplementar a conta aqui é de propósito: uma checagem que chamasse
     * `bendControlOf` passaria feliz se `bendControlOf` estivesse errada.
     */
    function controlOffsetOf(d) {
      const parsed = d?.match(
        /^M ([-\d.e+]+) ([-\d.e+]+) Q ([-\d.e+]+) ([-\d.e+]+) ([-\d.e+]+) ([-\d.e+]+)$/
      );
      if (!parsed) return null;
      const [x1, y1, cx, cy, x2, y2] = parsed.slice(1).map(Number);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const span = Math.hypot(dx, dy);
      if (span === 0) return null;
      // Projeção na perpendicular à reta — o giro de 90° é (x, y) → (-y, x).
      return ((cx - x1) * -dy + (cy - y1) * dx) / span;
    }

    async function handleAt() {
      return page.$eval(HANDLE, (node) => {
        const box = node.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      });
    }

    /**
     * Arrasta a alça até um ponto, em passos, como um dedo faria.
     *
     * Repete uma vez se a alça não saiu do lugar: entre ler a posição dela e
     * apertar o ponteiro cabe um render, e um `pointerdown` que cai a dois
     * pixels do círculo não pega nada — o roteiro seguiria e acusaria a
     * geometria de um erro que foi da mira.
     */
    async function dragHandle(to, steps = 24, tries = 2) {
      let from = null;
      for (let attempt = 1; attempt <= tries; attempt++) {
        // Deixa o desenho assentar antes de mirar.
        await page.waitForTimeout(300);
        from = await handleAt();
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        for (let step = 1; step <= steps; step++) {
          await page.mouse.move(
            from.x + ((to.x - from.x) * step) / steps,
            from.y + ((to.y - from.y) * step) / steps
          );
          await page.waitForTimeout(16);
        }
        await page.mouse.up();
        await page.waitForTimeout(300);

        const landed = await handleAt();
        if (Math.hypot(landed.x - from.x, landed.y - from.y) > 2) break;
      }
      return from;
    }

    // Só dá para provar o debounce contando o que sai pela rede.
    let patches = 0;
    let refused = 0;
    const PATCH_PATH = /\/connections\/[0-9a-f-]+$/i;
    page.on("request", (request) => {
      if (
        request.method() === "PATCH" &&
        PATCH_PATH.test(new URL(request.url()).pathname)
      ) {
        patches++;
      }
    });
    page.on("response", (response) => {
      if (
        response.status() >= 400 &&
        PATCH_PATH.test(new URL(response.url()).pathname)
      ) {
        refused++;
      }
    });

    check("a flecha nasce reta", (await readBend())?.shape === "straight");

    await page.click(`${SHAPE} button:has-text('Curva')`);
    const curved = await waitForBend(
      (row) => row?.shape === "curved" && row.bend_t !== null
    );
    check(
      "“Curva” grava o formato e a barriga inicial, os dois campos juntos",
      curved?.shape === "curved" &&
        curved.bend_t !== null &&
        curved.bend_offset !== null,
      JSON.stringify(curved)
    );
    const curvedPath = await waitForPath((d) => d?.includes(" Q ") === true);
    check(
      "e o traço vira uma curva de verdade (Q, não L)",
      curvedPath?.includes(" Q ") === true,
      curvedPath ?? "sem traço"
    );
    check(
      "a alça aparece na flecha curvada e selecionada",
      (await page.$$(HANDLE)).length === 1
    );
    await page.screenshot({ path: `${OUT}/05c-curva-light.png` });

    // ---- o arraste ----
    const origin = await handleAt();
    const target = { x: origin.x + 40, y: origin.y - 110 };
    patches = 0;
    await dragHandle(target);

    const dragged = await waitForBend(
      (row) =>
        row != null &&
        curved != null &&
        Math.abs(row.bend_offset - curved.bend_offset) > 8
    );
    check(
      "arrastar a alça grava o novo par",
      dragged != null &&
        dragged.shape === "curved" &&
        dragged.bend_t !== null &&
        dragged.bend_offset !== null,
      JSON.stringify(dragged)
    );

    const landed = await handleAt();
    check(
      "e a alça fica exatamente onde o ponteiro soltou",
      Math.hypot(landed.x - target.x, landed.y - target.y) < 6,
      `${Math.round(landed.x)},${Math.round(landed.y)} vs ${Math.round(
        target.x
      )},${Math.round(target.y)}`
    );

    // A pausa do debounce já passou (o `waitForBend` acima esperou o banco);
    // esta sobra é para um PATCH atrasado aparecer na conta em vez de passar
    // batido e o roteiro dar por certo um debounce que não existe.
    await page.waitForTimeout(1500);
    check(
      "o arraste sai em poucos PATCH, não um por quadro",
      patches >= 1 && patches <= 4,
      `${patches} PATCH em 24 quadros de arraste`
    );
    check("e nenhum deles é recusado", refused === 0, `${refused} recusado(s)`);

    // ---- veio do Postgres, não da memória ----
    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(WINDOW, { timeout: 20000 });
    await page.waitForTimeout(1000);
    const reloadedPath = await waitForPath((d) => d?.includes(" Q ") === true);
    check(
      "a curva continua curva depois de recarregar",
      reloadedPath?.includes(" Q ") === true,
      reloadedPath ?? "sem traço"
    );
    check(
      "e a alça não fica boiando na flecha que ninguém selecionou",
      (await page.$$(HANDLE)).length === 0
    );

    // ---- arrastar para além da ponta ----
    //
    // Uma quadrática está presa nas duas pontas. `bend_t` é preso à faixa
    // desenhável antes de qualquer conta; sem isso o ponto de controle vai
    // para o infinito e o traço some da tela sem um erro no console.
    await page.click(CHIP);
    await page.waitForSelector(PANEL, { timeout: 5000 }).catch(() => null);
    await page.waitForSelector(HANDLE, { timeout: 5000 }).catch(() => null);
    check(
      "clicar no texto seleciona a ligação e traz a alça de volta",
      (await page.$$(HANDLE)).length === 1
    );

    refused = 0;
    // Bem além da janela de destino, no prolongamento do traço.
    await dragHandle({ x: passo.x + 600, y: passo.y });
    await page.waitForTimeout(1500);

    const stretched = await readBend();
    check(
      "arrastar além da ponta não escapa da faixa desenhável",
      stretched != null &&
        stretched.bend_t >= 0 &&
        stretched.bend_t <= 1 &&
        Math.abs(stretched.bend_offset) <= 20000,
      JSON.stringify(stretched)
    );
    const stretchedPath = await readPath();
    check(
      "e o traço continua um caminho válido (sem NaN no d)",
      typeof stretchedPath === "string" &&
        stretchedPath.includes(" Q ") &&
        !/NaN|Infinity/.test(stretchedPath),
      stretchedPath ?? "sem traço"
    );
    check(
      "e o banco não recusou nenhum desses PATCH",
      refused === 0,
      `${refused} recusado(s)`
    );

    // ---- de volta à reta ----
    await page.click(`${SHAPE} button:has-text('Reta')`);
    const straightened = await waitForBend(
      (row) => row?.shape === "straight" && row.bend_t === null
    );
    check(
      "“Reta” desfaz a curva e zera o par inteiro, não só o formato",
      straightened?.shape === "straight" &&
        straightened.bend_t === null &&
        straightened.bend_offset === null,
      JSON.stringify(straightened)
    );
    const straightPath = await waitForPath((d) => d?.includes(" L ") === true);
    check(
      "e o traço volta a ser uma reta (L)",
      straightPath?.includes(" L ") === true,
      straightPath ?? "sem traço"
    );

    // ---- a curva de novo, depois de um arraste ----
    //
    // O caso que já quebrou uma vez: a alça arrastada ficava guardada no
    // componente e **sombreava as props para sempre**. A pessoa arrastava,
    // clicava "Reta", clicava "Curva" — o banco gravava a barriga padrão,
    // e a tela desenhava a posição velha do arraste. O botão parecia não
    // ter feito nada.
    //
    // A consequência pior era invisível: `updateConnection` é otimista e
    // devolve os campos quando o PATCH falha, mas a devolução não chegava à
    // tela, porque o estado local ganhava. Um PATCH recusado deixava a
    // pessoa olhando uma curva que não estava no banco.
    //
    // Por isso a conferência não é "tem um Q": é **o desenho contra a
    // linha do Postgres**. Só isso separa as duas.
    await page.click(`${SHAPE} button:has-text('Curva')`);
    const recurved = await waitForBend(
      (row) => row?.shape === "curved" && row.bend_t !== null
    );
    const recurvedPath = await waitForPath(
      (d) => controlOffsetOf(d) !== null && Math.abs(controlOffsetOf(d)) > 1
    );
    const drawnOffset = controlOffsetOf(recurvedPath);
    check(
      "“Curva” depois de um arraste volta à barriga padrão, e não à posição arrastada",
      recurved != null &&
        drawnOffset != null &&
        // Numa quadrática o controle fica ao dobro da distância da barriga:
        // a curva passa a meio caminho dele. É essa razão que amarra o
        // traço desenhado ao `bend_offset` gravado.
        Math.abs(drawnOffset - 2 * recurved.bend_offset) < 2,
      `desenhado ${drawnOffset?.toFixed(1)} para bend_offset ${
        recurved?.bend_offset
      } (esperado ${2 * (recurved?.bend_offset ?? 0)})`
    );

    // De volta à reta, que é como o resto do roteiro conta encontrar a flecha.
    await page.click(`${SHAPE} button:has-text('Reta')`);
    await waitForBend((row) => row?.shape === "straight" && row.bend_t === null);
    await waitForPath((d) => d?.includes(" L ") === true);

    const { rows: halfPairs } = await sql.query(
      `select count(*)::int as total from workspace_connections
        where user_id = $1 and (bend_t is null) <> (bend_offset is null)`,
      [userId]
    );
    check(
      "nenhuma ligação ficou com meio par",
      halfPairs[0].total === 0,
      `${halfPairs[0].total} com meio par`
    );

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check("Esc fecha o inspetor", !(await page.isVisible(PANEL)));

    await page.reload({ waitUntil: "networkidle" });
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.waitForSelector(WINDOW, { timeout: 20000 });
    await page.waitForTimeout(1000);
    const afterReload = await readDrawnStyle();
    check(
      "a aparência continua depois de recarregar",
      afterReload?.dashed === true && afterReload.paths === 4 &&
        (await page.isVisible("button:has-text('sustenta a hipótese')")),
      JSON.stringify(afterReload)
    );

    // Delete com a flecha selecionada apaga — e o Desfazer devolve tudo.
    await page.mouse.click(onTrace.x, onTrace.y);
    await page.waitForSelector(PANEL, { timeout: 5000 }).catch(() => null);
    await page.keyboard.press("Delete");
    check(
      "Delete apaga a flecha selecionada",
      (await waitForLinks(sql, userId, 1)) === 1
    );
    await page.click('button:has-text("Desfazer")');
    check(
      "e o Desfazer a traz com texto e aparência",
      (await waitForLinks(sql, userId, 2)) === 2 &&
        expectedStyle(await readStyled()),
      JSON.stringify(await readStyled())
    );
    await page.waitForTimeout(800);

    // ---- botão direito na flecha ----
    await page.mouse.click(between.x, between.y, { button: "right" });
    await page.waitForSelector("[role='menu']", { timeout: 5000 });
    check(
      "o botão direito na flecha abre o menu dela",
      await page.isVisible("[role='menu'] :text('Remover a ligação')")
    );

    await clickMenuItem(
      between,
      "Remover a ligação",
      async () => (await countLinks(sql, userId)) === 1
    );
    check(
      "e remove só ela",
      (await waitForLinks(sql, userId, 1)) === 1
    );

    // ---- a borracha encosta na flecha ----
    const remaining = {
      x: (hipotese.x + passo.x) / 2,
      y: (hipotese.y + passo.y) / 2,
    };
    await page.click('button[title^="Borracha"]');
    await page.waitForTimeout(300);
    await page.mouse.move(remaining.x - 40, remaining.y);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/06-borracha-na-flecha-light.png` });

    await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(remaining.x - 40 + (80 * step) / 12, remaining.y);
    }
    await page.mouse.up();
    check(
      "a borracha apaga a flecha que encostou",
      (await waitForLinks(sql, userId, 0)) === 0
    );

    await page.click('button:has-text("Desfazer")');
    check(
      "e o Desfazer traz a flecha de volta",
      (await waitForLinks(sql, userId, 1)) === 1
    );

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // ---- fechar a janela leva a flecha junto ----
    const { rows: before } = await sql.query(
      "select count(*)::int as total from workspace_windows where user_id = $1",
      [userId]
    );
    await page.click(`${WINDOW}:has-text("Hipótese") button[title^="Fechar"]`);
    check(
      "fechar uma ponta leva a flecha junto (cascade)",
      (await waitForLinks(sql, userId, 0)) === 0,
      `${before[0].total} janelas antes`
    );

    const { rows: notesAlive } = await sql.query(
      "select count(*)::int as total from notes where user_id = $1 and status <> 'deleted'",
      [userId]
    );
    check(
      "e a nota continua na conta",
      notesAlive[0].total === NOTES.length,
      `${notesAlive[0].total} notas`
    );

    await page.evaluate(() => {
      try {
        localStorage.setItem("nexo-theme", "dark");
      } catch {}
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/07-escuro.png` });

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

await main();
