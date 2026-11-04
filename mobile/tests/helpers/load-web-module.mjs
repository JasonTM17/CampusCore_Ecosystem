import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const LOCAL_IMPORT = /(from\s+['"])([^'"]+)(['"])/g;

/**
 * Transpiles a frontend source together with its local imports (relative and
 * `@/` aliases) into `outDir`, rewriting each specifier to the emitted file.
 * Node tests that compare a mobile port with a web module must load the real
 * web dependency graph, including the i18n message modules it reads.
 */
export function createWebModuleLoader(srcRoot, outDir) {
  const emitted = new Map();

  const resolveSource = (specifier, fromFile) => {
    let base;
    if (specifier.startsWith('@/')) base = path.join(srcRoot, specifier.slice(2));
    else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier);
    else return undefined;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    throw new Error(`Cannot resolve ${specifier} from ${fromFile}`);
  };

  const outputPath = (sourceFile) => path.join(
    outDir,
    path.relative(srcRoot, sourceFile).replace(/\\/g, '/').replace(/\.tsx?$/, '.mjs'),
  );

  const compile = (sourceFile) => {
    if (emitted.has(sourceFile)) return emitted.get(sourceFile);
    const outFile = outputPath(sourceFile);
    emitted.set(sourceFile, outFile);
    const { outputText } = ts.transpileModule(fs.readFileSync(sourceFile, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: sourceFile,
    });
    const rewritten = outputText.replace(LOCAL_IMPORT, (match, before, specifier, after) => {
      const dependency = resolveSource(specifier, sourceFile);
      if (!dependency) return match;
      const dependencyFile = compile(dependency);
      let relative = path.relative(path.dirname(outFile), dependencyFile).replace(/\\/g, '/');
      if (!relative.startsWith('.')) relative = `./${relative}`;
      return `${before}${relative}${after}`;
    });
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, rewritten);
    return outFile;
  };

  return (sourceFile) => compile(sourceFile);
}
