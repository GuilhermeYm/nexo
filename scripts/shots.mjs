/**
 * Captura de tela para revisão visual, sem depender de extensão de navegador.
 *
 * Dirige o Chrome que já está instalado na máquina (playwright-core não baixa
 * navegador nenhum). Para cada combinação de viewport e tema, rola a página
 * inteira uma vez — para os ScrollTriggers do GSAP dispararem e as animações
 * terminarem —, volta ao topo e só então fotografa.
 *
 *   bun run shots
 *   bun run shots -- --url http://localhost:3000/dashboard --out .impeccable/review/dash
 *   bun run shots -- --sizes desktop --themes dark --reduced-motion
 *
 * As imagens vão para .impeccable/review/ com o nome
 * <alvo>--<viewport>-<tema>.png.
 */
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright-core";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
};

/**
 * Recortes que valem uma foto própria, além da página inteira. `label` vira o
 * nome do arquivo; `selector` é resolvido pelo Playwright e simplesmente
 * ignorado quando não existe na página.
 */
const TARGETS = [
  { label: "hero", selector: "main > section:first-child" },
  { label: "features", selector: "#features" },
  {
    label: "workspaces-visual",
    selector: 'article:has(h3:text-is("Workspaces separados"))',
  },
  { label: "synapse-map", selector: "#como-funciona" },
  { label: "planos", selector: "#planos" },
  { label: "faq", selector: "#faq" },
  { label: "footer", selector: "footer" },
];

function parseArgs(argv) {
  const args = {
    url: "http://localhost:3000/",
    out: ".impeccable/review",
    sizes: ["desktop", "mobile"],
    themes: ["light", "dark"],
    reducedMotion: false,
    clean: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url") args.url = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--sizes") args.sizes = argv[++i].split(",");
    else if (arg === "--themes") args.themes = argv[++i].split(",");
    else if (arg === "--reduced-motion") args.reducedMotion = true;
    else if (arg === "--clean") args.clean = true;
  }

  return args;
}

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

/**
 * Rola a página inteira em passos de meia tela, espera, e volta ao topo. Sem
 * isso, tudo que entra por ScrollTrigger aparece no estado inicial (invisível)
 * ou pela metade.
 */
async function settleAnimations(page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.5);
    const total = document.body.scrollHeight;

    for (let y = 0; y < total; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 220));
    }

    window.scrollTo(0, total);
    await new Promise((resolve) => setTimeout(resolve, 700));
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  // Um respiro extra para os timelines que começam com delay.
  await page.waitForTimeout(1200);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.out);

  if (args.clean && existsSync(outDir)) {
    await rm(outDir, { recursive: true });
  }
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: findChrome() });
  const problems = [];

  try {
    for (const size of args.sizes) {
      const viewport = VIEWPORTS[size];
      if (!viewport) throw new Error(`Viewport desconhecido: ${size}`);

      for (const theme of args.themes) {
        const context = await browser.newContext({
          ...viewport,
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: theme === "dark" ? "dark" : "light",
          reducedMotion: args.reducedMotion ? "reduce" : "no-preference",
          locale: "pt-BR",
        });

        // Roda antes de qualquer script da página — inclusive do script de tema
        // inline em app/layout.tsx, que é justamente quem lê esta chave.
        await context.addInitScript((value) => {
          try {
            localStorage.setItem("nexo-theme", value);
          } catch {}
        }, theme);

        const page = await context.newPage();
        page.on("console", (message) => {
          if (message.type() === "error") {
            problems.push(`[${size}/${theme}] console: ${message.text()}`);
          }
        });
        page.on("pageerror", (error) => {
          problems.push(`[${size}/${theme}] pageerror: ${error.message}`);
        });

        await page.goto(args.url, { waitUntil: "networkidle" });

        // O indicador do Next em desenvolvimento é um botão fixo no canto —
        // não existe em produção e só suja a foto.
        await page.addStyleTag({
          content: "nextjs-portal{display:none !important}",
        });

        await settleAnimations(page);

        const suffix = `${size}-${theme}${args.reducedMotion ? "-reduced" : ""}`;

        await page.screenshot({
          path: path.join(outDir, `page--${suffix}.png`),
          fullPage: true,
        });

        // A navbar é fixa: nas fotos de recorte ela é composta por cima da
        // seção e come o título. Sai de cena durante os recortes.
        await page.addStyleTag({
          content: "header{visibility:hidden !important}",
        });

        for (const target of TARGETS) {
          const locator = page.locator(target.selector).first();
          if ((await locator.count()) === 0) continue;

          await locator.scrollIntoViewIfNeeded();
          await page.waitForTimeout(400);
          await locator.screenshot({
            path: path.join(outDir, `${target.label}--${suffix}.png`),
          });
        }

        console.log(`✓ ${suffix}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (problems.length > 0) {
    console.log("\nErros de console durante a captura:");
    for (const problem of [...new Set(problems)]) console.log(`  ${problem}`);
  } else {
    console.log("\nNenhum erro de console durante a captura.");
  }

  console.log(`\nImagens em ${outDir}`);
}

await main();
