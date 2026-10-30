import fs from 'node:fs';
import ts from 'typescript';

/**
 * Transpiles one dependency-free TypeScript source (type-only imports are
 * erased) and imports it, so node tests can exercise pure modules directly.
 */
export async function loadTs(relativeToTests) {
  const source = fs.readFileSync(new URL(relativeToTests, new URL('../../', import.meta.url)), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
