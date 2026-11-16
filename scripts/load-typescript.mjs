import ts from 'typescript';
import { readFile } from 'node:fs/promises';

// Build tools run on Node 20 as well; do not rely on native TypeScript loading or package mode.
export async function loadTypeScript(url) {
  const source = await readFile(url, 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputText).toString('base64')}`);
}
