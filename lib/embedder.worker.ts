/* eslint-disable @typescript-eslint/no-explicit-any */
// Web Worker с локальной эмбеддинг-моделью (transformers.js). Держит тяжёлый инференс вне
// главного потока, чтобы вкладка не висла. Специфайер модуля — переменная: tsc не требует
// установленный пакет, Turbopack резолвит его после `npm install @huggingface/transformers`.

const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
let extractorPromise: Promise<any> | null = null;

async function getExtractor(): Promise<any> {
  if (!extractorPromise) {
    const moduleName = '@huggingface/transformers';
    const lib: any = await import(moduleName);
    extractorPromise = lib.pipeline('feature-extraction', MODEL);
  }
  return extractorPromise;
}

self.onmessage = async (event: MessageEvent) => {
  const { id, texts } = event.data as { id: number; texts: string[] };
  try {
    const extract = await getExtractor();
    const output = await extract(texts, { pooling: 'mean', normalize: true });
    const [rows, cols] = output.dims as [number, number];
    const vectors: number[][] = [];
    for (let r = 0; r < rows; r += 1) {
      vectors.push(Array.from(output.data.slice(r * cols, (r + 1) * cols)) as number[]);
    }
    (self as unknown as Worker).postMessage({ id, vectors });
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: String(error) });
  }
};

export {};
