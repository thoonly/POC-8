#!/usr/bin/env node
/**
 * Project rules from CLAUDE.md that a machine can check. Run: npm run check
 *  1. no hex / rgb / hsl colors outside src/styles/tokens.css
 *  2. no fetch to a model API and no hardcoded Claude model ids outside src/lib/ai/server/
 *  3. every ai.json / ai.chat / ai.search / complete call has `label:` and `tier:`
 *  4. no maxTokens under 2000
 * A deliberate exception: put `// check-ignore: <reason>` on the line above.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const norm = (p) => relative(ROOT, p).split(sep).join("/");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const problems = [];
const report = (file, line, msg) => problems.push(`${norm(file)}:${line}  ${msg}`);
const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;
const ignored = (lines, line) => /check-ignore:/.test(lines[line - 2] || "");

/** Text of the balanced (...) that starts at the "(" at index `open`. */
function callArgs(text, open) {
  let depth = 0, inStr = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

for (const file of walk(SRC)) {
  const f = norm(file);
  if (!/\.(ts|tsx|css)$/.test(f)) continue;
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const isTest = /\.test\.ts$/.test(f);

  // 1. colors
  if (f !== "src/styles/tokens.css") {
    // #rgb, #rgba, #rrggbb, #rrggbbaa (not part of a word, an entity like &#8217;, or a path/anchor)
    // and rgb()/rgba()/hsl()/hsla(). A false positive such as "#123" in copy: add check-ignore.
    const re = /(?<![\w&/])#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{3})\b|\b(?:rgba?|hsla?)\(/g;
    let m;
    while ((m = re.exec(text))) {
      const line = lineOf(text, m.index);
      const src = lines[line - 1];
      if (/^\s*(\/\/|\*|\/\*)/.test(src) || ignored(lines, line)) continue;
      report(file, line, `literal color "${m[0]}": use a var(--c-…) token`);
    }
  }

  if (isTest || !/\.(ts|tsx)$/.test(f)) continue;
  const inServerAi = f.startsWith("src/lib/ai/server/");

  // 2. model APIs and model ids
  if (!inServerAi) {
    for (const [re, msg] of [
      [/https:\/\/(api\.anthropic\.com|openrouter\.ai|api\.tavily\.com)/g, "model/search API URL outside src/lib/ai/server/"],
      [/["'`]claude-(?:opus|sonnet|haiku|fable)-[\w.-]+["'`]|anthropic\/claude-[\w.-]+/g, "hardcoded model id: pass a tier"],
    ]) {
      let m;
      while ((m = re.exec(text))) {
        const line = lineOf(text, m.index);
        if (!/^\s*(\/\/|\*)/.test(lines[line - 1]) && !ignored(lines, line)) report(file, line, msg);
      }
    }
  }

  // 3 + 4. calls through the client
  if (f === "src/lib/ai/client.ts") continue;
  if (/from\s+["'](?:@\/lib\/ai\/client|\.{1,2}\/(?:\.\.\/)*(?:ai\/)?client)["']/.test(text)) {
    const re = /(?<![\w.])(?:ai\.)?(json|chat|search|complete)\s*(?:<[^>()]*>)?\(/g;
    let m;
    while ((m = re.exec(text))) {
      const open = m.index + m[0].length - 1;
      const line = lineOf(text, m.index);
      if (ignored(lines, line)) continue;
      const args = callArgs(text, open);
      if (!/\blabel\s*:/.test(args)) report(file, line, `${m[1]}(): missing label ("<screen>:<task>")`);
      if (!/\btier\s*:/.test(args)) report(file, line, `${m[1]}(): missing tier ("small" | "large")`);
      const mt = /\bmaxTokens\s*:\s*(\d[\d_]*)/.exec(args);
      if (mt && Number(mt[1].replace(/_/g, "")) < 2000) report(file, line, `maxTokens ${mt[1]} is under 2000: a low ceiling cuts answers off`);
    }
  }
}

if (problems.length) {
  console.error(`check: ${problems.length} problem(s)\n` + problems.map((p) => "  " + p).join("\n"));
  process.exit(1);
}
console.log("check: ok (tokens, model-API boundary, label + tier on every AI call)");
