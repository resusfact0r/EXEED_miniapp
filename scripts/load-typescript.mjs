import ts from 'typescript';
import { readFile } from 'node:fs/promises';

// Keep the same shared catalog modules in Node 20, browser builds and tests.
const compiled = new Map();
async function moduleUrl(url, parents = new Set()) {
  if (parents.has(url.href)) throw new Error(`Circular build-tool import: ${url.href}`);
  if (compiled.has(url.href)) return compiled.get(url.href);
  const pending = (async () => {
    const source = await readFile(url, 'utf8');
    let output;
    if (url.pathname.endsWith('.json')) output = `export default ${JSON.stringify(JSON.parse(source))};`;
    else {
      output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
      const ast = ts.createSourceFile(url.pathname, output, ts.ScriptTarget.ES2020, true);
      const edits = [];
      for (const node of ast.statements) {
        if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
        const specifier = node.moduleSpecifier.text;
        if (!specifier.startsWith('.')) continue;
        const dependency = new URL(/\.[a-z]+$/i.test(specifier) ? specifier : `${specifier}.ts`, url);
        const resolved = await moduleUrl(dependency, new Set([...parents, url.href]));
        edits.push({ start: node.moduleSpecifier.getStart(ast), end: node.moduleSpecifier.end, value: JSON.stringify(resolved) });
      }
      for (const edit of edits.reverse()) output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
    }
    return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
  })();
  compiled.set(url.href, pending);
  try { return await pending; } catch (error) { compiled.delete(url.href); throw error; }
}

export async function loadTypeScript(url) { return import(await moduleUrl(url)); }
