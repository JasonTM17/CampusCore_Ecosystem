import fs from 'node:fs';
import path from 'node:path';

/** Key inventory for object-literal locales and optionally typed const/let maps. */
export function localeKeys(source, locale) {
  const m = source.match(new RegExp(`(?:["']?${locale}["']?\\s*:|(?:const|let)\\s+${locale}(?:\\s*:[^=;]+)?\\s*=)\\s*\\{`));
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') depth -= 1;
    i += 1;
  }
  const body = source.slice(start, i - 1);
  return new Set([...body.matchAll(/\n\s*['"]?([a-zA-Z0-9_.-]+)['"]?\s*:/g)].map((k) => k[1]));
}

function extractPlaceholders(str) {
  const set = new Set();
  for (const m of str.matchAll(/(?:\$)?\{([a-zA-Z0-9_]+)\}/g)) {
    set.add(m[1]);
  }
  return set;
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '/' && src[i + 1] === '/') {
      const nextNewline = src.indexOf('\n', i);
      i = nextNewline === -1 ? n : nextNewline + 1;
      continue;
    }

    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      let j = i + 1;
      let val = '';
      while (j < n) {
        if (src[j] === '\\') {
          val += src[j + 1] ?? '';
          j += 2;
        } else if (src[j] === q) {
          j++;
          break;
        } else {
          val += src[j];
          j++;
        }
      }
      tokens.push({ type: 'STRING', value: val, raw: src.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    if (src.startsWith('...', i)) {
      tokens.push({ type: 'PUNCT', value: '...', start: i, end: i + 3 });
      i += 3;
      continue;
    }
    if (src.startsWith('=>', i)) {
      tokens.push({ type: 'PUNCT', value: '=>', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if ('{}(),:;='.includes(ch)) {
      tokens.push({ type: 'PUNCT', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === '[') {
      tokens.push({ type: 'PUNCT', value: '[', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ']') {
      tokens.push({ type: 'PUNCT', value: ']', start: i, end: i + 1 });
      i++;
      continue;
    }

    if (/[a-zA-Z0-9_$-]/.test(ch)) {
      let j = i;
      while (j < n && /[a-zA-Z0-9_$-]/.test(src[j])) {
        j++;
      }
      tokens.push({ type: 'IDENT', value: src.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    tokens.push({ type: 'OTHER', value: ch, start: i, end: i + 1 });
    i++;
  }

  return tokens;
}

function parseCatalogObject(tokens, startIndex, scope = {}) {
  let idx = startIndex + 1;
  const catalog = new Map();

  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (!tok || tok.value === '}') {
      idx++;
      break;
    }

    if (tok.value === ',') {
      idx++;
      continue;
    }

    if (tok.value === '...') {
      idx++;
      const identTok = tokens[idx];
      if (identTok && (identTok.type === 'IDENT' || identTok.type === 'STRING')) {
        const spreadName = identTok.value;
        const spreadObj = scope[spreadName];
        if (spreadObj instanceof Map) {
          for (const [k, v] of spreadObj.entries()) {
            catalog.set(k, new Set(v));
          }
        }
        idx++;
      }
      continue;
    }

    if (tok.type === 'IDENT' || tok.type === 'STRING') {
      const propKey = tok.value;
      idx++;

      if (tokens[idx]?.value === ':') {
        idx++;

        const valTok = tokens[idx];
        if (!valTok) break;

        if (valTok.value === '{') {
          const { catalog: childCatalog, nextIndex } = parseCatalogObject(tokens, idx, scope);
          for (const [childKey, childPlaceholders] of childCatalog.entries()) {
            catalog.set(`${propKey}.${childKey}`, childPlaceholders);
          }
          idx = nextIndex;
        } else if (valTok.type === 'STRING') {
          catalog.set(propKey, extractPlaceholders(valTok.value));
          idx++;
        } else if (valTok.value === '[') {
          let depth = 1;
          idx++;
          while (idx < tokens.length && depth > 0) {
            if (tokens[idx].value === '[') depth++;
            else if (tokens[idx].value === ']') depth--;
            idx++;
          }
          catalog.set(propKey, new Set());
        } else if (valTok.type === 'IDENT') {
          const refName = valTok.value;
          idx++;
          if (tokens[idx]?.value === '=>') {
            idx++;
            const phs = new Set();
            while (idx < tokens.length && tokens[idx].value !== ',' && tokens[idx].value !== '}') {
              if (tokens[idx].type === 'STRING') {
                for (const p of extractPlaceholders(tokens[idx].value)) phs.add(p);
              }
              idx++;
            }
            catalog.set(propKey, phs);
          } else if (scope[refName] instanceof Map) {
            for (const [childKey, childPlaceholders] of scope[refName].entries()) {
              catalog.set(`${propKey}.${childKey}`, new Set(childPlaceholders));
            }
          } else {
            catalog.set(propKey, new Set());
          }
        } else if (valTok.value === '(') {
          let parenDepth = 1;
          idx++;
          while (idx < tokens.length && parenDepth > 0) {
            if (tokens[idx].value === '(') parenDepth++;
            else if (tokens[idx].value === ')') parenDepth--;
            idx++;
          }
          if (tokens[idx]?.value === '=>') {
            idx++;
            const phs = new Set();
            while (idx < tokens.length && tokens[idx].value !== ',' && tokens[idx].value !== '}') {
              if (tokens[idx].type === 'STRING') {
                for (const p of extractPlaceholders(tokens[idx].value)) phs.add(p);
              }
              idx++;
            }
            catalog.set(propKey, phs);
          } else {
            catalog.set(propKey, new Set());
          }
        } else {
          idx++;
          catalog.set(propKey, new Set());
        }
      } else if (tokens[idx]?.value === ',' || tokens[idx]?.value === '}') {
        const refName = propKey;
        if (scope[refName] instanceof Map) {
          catalog.set(propKey, scope[refName]);
        }
      } else {
        idx++;
      }
    } else {
      idx++;
    }
  }

  return { catalog, nextIndex: idx };
}

function resolveModuleSource(importSpecifier, options = {}) {
  const sources = options.sources;
  if (sources) {
    const candidates = [
      importSpecifier,
      `${importSpecifier}.ts`,
      `${importSpecifier}.js`,
      importSpecifier.replace(/^\.\//, ''),
      `${importSpecifier.replace(/^\.\//, '')}.ts`,
      path.basename(importSpecifier),
      `${path.basename(importSpecifier)}.ts`,
    ];
    for (const c of candidates) {
      if (sources instanceof Map && sources.has(c)) {
        return { name: c, content: sources.get(c) };
      }
      if (typeof sources === 'object' && sources[c] !== undefined) {
        return { name: c, content: sources[c] };
      }
    }
  }

  const baseDir = options.baseDir || (options.name ? path.dirname(options.name) : process.cwd());
  let targetPath = importSpecifier;
  if (importSpecifier.startsWith('@/')) {
    targetPath = path.join(process.cwd(), 'frontend', 'src', importSpecifier.slice(2));
  } else if (importSpecifier.startsWith('.')) {
    targetPath = path.resolve(baseDir, importSpecifier);
  }

  const diskCandidates = [
    targetPath,
    `${targetPath}.ts`,
    `${targetPath}.tsx`,
    `${targetPath}.js`,
  ];
  for (const c of diskCandidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return { name: c, content: fs.readFileSync(c, 'utf8') };
    }
  }

  return null;
}

function parseFileDeclarations(source, options = {}, visited = new Set()) {
  const tokens = tokenize(source);
  const scope = {};
  const declarations = [];

  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].type === 'IDENT' && tokens[i].value === 'import') {
      let j = i + 1;
      let importedNames = [];
      let specifier = null;

      while (j < tokens.length && tokens[j].value !== ';') {
        if (tokens[j].type === 'IDENT' && tokens[j].value === 'from') {
          j++;
          if (tokens[j]?.type === 'STRING') {
            specifier = tokens[j].value;
          }
          break;
        }
        if (tokens[j].type === 'IDENT' && tokens[j].value !== 'type') {
          importedNames.push(tokens[j].value);
        }
        j++;
      }

      if (specifier && importedNames.length > 0) {
        const mod = resolveModuleSource(specifier, options);
        if (mod && !visited.has(mod.name)) {
          visited.add(mod.name);
          const importedDecls = parseFileDeclarations(mod.content, { ...options, name: mod.name }, visited);
          for (const decl of importedDecls) {
            scope[decl.name] = decl.catalog;
          }
        }
      }
      i = j + 1;
      continue;
    }

    if (tokens[i].type === 'IDENT' && (tokens[i].value === 'const' || tokens[i].value === 'let' || tokens[i].value === 'var')) {
      i++;
      if (tokens[i]?.type === 'IDENT') {
        const varName = tokens[i].value;
        i++;

        if (tokens[i]?.value === ':') {
          i++;
          while (i < tokens.length && tokens[i].value !== '=') {
            i++;
          }
        }

        if (tokens[i]?.value === '=') {
          i++;
          if (tokens[i]?.value === '{') {
            const { catalog, nextIndex } = parseCatalogObject(tokens, i, scope);
            scope[varName] = catalog;
            declarations.push({ name: varName, catalog });
            i = nextIndex;
            continue;
          }
        }
      }
    }

    i++;
  }

  return declarations;
}

export function localeCatalogPairs(source, options = {}) {
  const decls = parseFileDeclarations(source, options);
  const pairs = [];
  const declMap = new Map();
  for (const d of decls) declMap.set(d.name, d.catalog);

  if (declMap.has('en') && declMap.has('vi')) {
    pairs.push({
      name: options.name || 'messages',
      en: declMap.get('en'),
      vi: declMap.get('vi'),
    });
    return pairs;
  }

  const enNames = [...declMap.keys()].filter((k) => k.endsWith('En') || k.endsWith('_en') || k.toLowerCase().endsWith('en'));
  for (const enName of enNames) {
    const base = enName.replace(/(_?en)$/i, '');
    const viCandidates = [
      `${base}Vi`,
      `${base}_vi`,
      `${base}vi`,
    ];
    for (const viName of viCandidates) {
      if (declMap.has(viName)) {
        pairs.push({
          name: options.name || base,
          en: declMap.get(enName),
          vi: declMap.get(viName),
        });
        break;
      }
    }
  }
  if (pairs.length > 0) return pairs;

  for (const [name, cat] of declMap.entries()) {
    const enKeys = [...cat.keys()].filter((k) => k.startsWith('en.'));
    const viKeys = [...cat.keys()].filter((k) => k.startsWith('vi.'));
    if (enKeys.length > 0 && viKeys.length > 0) {
      const enMap = new Map();
      const viMap = new Map();
      for (const k of enKeys) enMap.set(k.slice(3), cat.get(k));
      for (const k of viKeys) viMap.set(k.slice(3), cat.get(k));
      pairs.push({
        name: options.name || name,
        en: enMap,
        vi: viMap,
      });
    }
  }

  return pairs;
}

export function compareLocaleCatalogs(vi, en) {
  const errors = [];
  const viKeys = new Set(vi.keys());
  const enKeys = new Set(en.keys());

  for (const k of enKeys) {
    if (!viKeys.has(k)) {
      errors.push(`Missing key in vi: ${k}`);
    }
  }

  for (const k of viKeys) {
    if (!enKeys.has(k)) {
      errors.push(`Extra key in vi (missing in en): ${k}`);
    }
  }

  for (const k of enKeys) {
    if (viKeys.has(k)) {
      const enPlaceholders = [...(en.get(k) || [])].sort();
      const viPlaceholders = [...(vi.get(k) || [])].sort();
      if (enPlaceholders.join(',') !== viPlaceholders.join(',')) {
        errors.push(
          `Placeholder mismatch for ${k}: vi has [${viPlaceholders.join(', ')}], en has [${enPlaceholders.join(', ')}]`
        );
      }
    }
  }

  return errors;
}
