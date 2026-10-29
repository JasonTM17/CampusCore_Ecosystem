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
