import { createLowlight } from "lowlight";

import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * A instância do lowlight que o `CodeBlockLowlight` usa em todas as três telas.
 *
 * **Conjunto curado, não o `common`.** Desde que a janela de nota da lousa
 * virou TipTap, esse realce entra no bundle da lousa — e o `common` do
 * highlight.js são ~37 gramáticas. Estas quinze cobrem o que se cola num
 * caderno de produto sem carregar Perl e Fortran junto. Uma linguagem fora da
 * lista não quebra nada: o bloco fica sem cor, como texto puro.
 */
export const lowlight = createLowlight();

lowlight.register({
  bash,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  markdown,
  plaintext,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
});

// Apelidos comuns — o que a pessoa digita na etiqueta do bloco.
lowlight.registerAlias({
  bash: ["sh", "shell", "zsh"],
  javascript: ["js", "jsx", "node"],
  typescript: ["ts", "tsx"],
  markdown: ["md"],
  xml: ["html", "xhtml", "svg"],
  plaintext: ["text", "txt"],
});
