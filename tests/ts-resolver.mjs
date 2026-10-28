// Резолвер только для юнит-тестов: Node в ESM требует расширения, а в проекте импорты
// внутри lib/ идут без них (их резолвит Turbopack). Также поддерживаем алиас "@/".
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js'];

function firstExisting(base) {
  if (path.extname(base) && existsSync(base)) return base;
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(candidate)) return candidate;
  }
  for (const extension of EXTENSIONS) {
    const candidate = path.join(base, 'index' + extension);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let base = null;
  if (specifier.startsWith('@/')) {
    base = path.join(ROOT, specifier.slice(2));
  } else if (specifier.startsWith('.') && !path.extname(specifier)) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (base) {
    const resolved = firstExisting(base);
    if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
  }
  return nextResolve(specifier, context);
}
