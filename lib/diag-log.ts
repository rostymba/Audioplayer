import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Серверная диагностика в файл: браузерный trace() живёт в памяти вкладки, а логи dev-сервера
// в терминале — ни то, ни другое не читается со стороны. JSONL в .diag/radio.log читается легко.
// На Vercel файловая система только для чтения, писать можно лишь во временную папку.
const DIR = path.join(process.env.VERCEL ? os.tmpdir() : process.cwd(), '.diag');
const FILE = path.join(DIR, 'radio.log');

export function appendDiag(event: string, data: Record<string, unknown> = {}) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + '\n');
  } catch {
    // Диагностика — best-effort, она не должна ронять запрос.
  }
}
