import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { isBlockedVocal, isTalk, musicCategory, musicConfidence, needsLanguageCheck,
  summariseLabels, talkConfidence, vocalConfidence, type Label } from './audio-guard-verdict';

type Pipeline = (audio: Float32Array, options?: Record<string, unknown>) => Promise<unknown>;
type WhisperPipeline = Pipeline & { processor: (audio: Float32Array) => Promise<Record<string, unknown>>; model: {
  generation_config: { decoder_start_token_id: number; lang_to_id: Record<string, number> };
  (inputs: Record<string, unknown>): Promise<{ logits: { data: ArrayLike<number> } }>;
} };

export type AudioGuardVerdict = {
  category: 'music' | 'talk' | 'russian-vocal' | 'unknown';
  confidence: number;
  speech: number;
  vocals: number;
  music: number;
  transcript?: string;
  detectedLanguage?: string;
  languageConfidence?: number;
  labels: Label[];
};

let classifier: Pipeline | null = null;
let transcriber: WhisperPipeline | null = null;
let TensorConstructor: (new (type: string, data: bigint[], dims: number[]) => unknown) | null = null;
let loadError: string | null = null;
let loading: Promise<void> | null = null;

export function audioGuardStatus() {
  return { ready: Boolean(classifier && transcriber), loading: Boolean(loading && !classifier), error: loadError };
}

export function warmAudioGuard() {
  if (classifier && transcriber) return Promise.resolve();
  if (loading) return loading;
  loadError = null;
  loading = (async () => {
    const transformers = await import('@huggingface/transformers');
    TensorConstructor = transformers.Tensor as unknown as typeof TensorConstructor;
    // На Vercel кеш моделей живёт во временной папке инстанса: остальная ФС только для чтения.
    transformers.env.cacheDir = path.join(process.env.VERCEL ? os.tmpdir() : process.cwd(), '.cache', 'audio-guard');
    const [audioClassifier, speechRecognizer] = await Promise.all([
      transformers.pipeline('audio-classification', 'Xenova/ast-finetuned-audioset-10-10-0.4593', { dtype: 'q8' }),
      transformers.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', { dtype: 'q8' }),
    ]);
    classifier = audioClassifier as unknown as Pipeline;
    transcriber = speechRecognizer as unknown as WhisperPipeline;
  })().catch(error => {
    loadError = error instanceof Error ? error.message : String(error);
    loading = null;
    throw error;
  });
  return loading;
}

export async function sampleRadio(url: string, seconds = 10): Promise<Float32Array> {
  const executable = ffmpegPath;
  if (!executable) throw new Error('Local audio decoder is unavailable');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', url,
      '-t', String(seconds), '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1']);
    const chunks: Buffer[] = [];
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), (seconds + 12) * 1000);
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-1000); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timeout);
      const buffer = Buffer.concat(chunks);
      if (code !== 0 || buffer.length < 16000 * 4 * 2) {
        reject(new Error(stderr.trim() || 'Could not capture a sample of the air'));
        return;
      }
      const bytes = Uint8Array.from(buffer.subarray(0, buffer.length - (buffer.length % 4)));
      resolve(new Float32Array(bytes.buffer));
    });
  });
}

async function detectLanguage(audio: Float32Array) {
  if (!transcriber || !TensorConstructor) return { language: '', confidence: 0 };
  const inputs = await transcriber.processor(audio);
  const start = transcriber.model.generation_config.decoder_start_token_id;
  const decoder_input_ids = new TensorConstructor('int64', [BigInt(start)], [1, 1]);
  const output = await transcriber.model({ ...inputs, decoder_input_ids });
  const logits = output.logits.data;
  const candidates = Object.entries(transcriber.model.generation_config.lang_to_id)
    .map(([token, id]) => ({ language: token.slice(2, -2), logit: Number(logits[id]) }));
  const max = Math.max(...candidates.map(candidate => candidate.logit));
  const weighted = candidates.map(candidate => ({ ...candidate, weight: Math.exp(candidate.logit - max) }));
  const total = weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
  const best = weighted.sort((a, b) => b.weight - a.weight)[0];
  return { language: best?.language ?? '', confidence: best ? best.weight / total : 0 };
}

export async function analyzeAudio(audio: Float32Array, blockedLanguage = ''): Promise<AudioGuardVerdict> {
  if (!classifier || !transcriber) throw new Error('Audio Guard is still loading');
  const labels = await classifier(audio, { top_k: 40 }) as Label[];
  const summary = summariseLabels(labels);
  const { music, speech, vocals } = summary;

  if (isTalk(summary)) {
    return { category: 'talk', confidence: talkConfidence(speech), speech, vocals, music, labels: labels.slice(0, 12) };
  }

  let transcript = '';
  if (needsLanguageCheck(blockedLanguage, vocals)) {
    const detected = await detectLanguage(audio);
    if (isBlockedVocal(detected)) {
      const result = await transcriber(audio, { language: 'russian', task: 'transcribe', return_timestamps: false }) as { text?: string };
      transcript = result.text?.trim() ?? '';
      return { category: 'russian-vocal', confidence: vocalConfidence(vocals), speech, vocals, music,
        transcript: transcript.slice(0, 180), detectedLanguage: detected.language, languageConfidence: detected.confidence,
        labels: labels.slice(0, 12) };
    }
    return { category: musicCategory(summary), confidence: musicConfidence(summary),
      speech, vocals, music, detectedLanguage: detected.language, languageConfidence: detected.confidence, labels: labels.slice(0, 12) };
  }

  return { category: musicCategory(summary), confidence: musicConfidence(summary), speech, vocals, music,
    ...(transcript ? { transcript: transcript.slice(0, 180) } : {}), labels: labels.slice(0, 12) };
}

export type ScreenResult = { stationId: string; verdict: AudioGuardVerdict | null; error?: string };

/**
 * Стартовый скрининг (вариант B): проверяем до 3 кандидатов ДО первого включения.
 * Сэмплы качаются ПАРАЛЛЕЛЬНО — это I/O по живому потоку, поэтому три станции стоят по
 * времени столько же, сколько одна. Инференс идёт по приоритету с ранним выходом:
 * как только нашли чистую волну, остальные не считаем.
 */
export async function screenStations(
  candidates: { id: string; url: string }[],
  blockedLanguage = '',
  seconds = 4,
): Promise<{ cleanId: string | null; results: ScreenResult[] }> {
  if (!classifier || !transcriber) throw new Error('Audio Guard is still loading');

  const samples = await Promise.all(candidates.map(async candidate => {
    try {
      return { candidate, audio: await sampleRadio(candidate.url, seconds) as Float32Array | undefined, error: undefined as string | undefined };
    } catch (error) {
      return { candidate, audio: undefined, error: error instanceof Error ? error.message : 'sample failed' };
    }
  }));

  const results: ScreenResult[] = [];
  let cleanId: string | null = null;
  for (const entry of samples) {
    if (!entry.audio) { results.push({ stationId: entry.candidate.id, verdict: null, error: entry.error }); continue; }
    if (cleanId) { results.push({ stationId: entry.candidate.id, verdict: null, error: 'skipped' }); continue; }
    try {
      const verdict = await analyzeAudio(entry.audio, blockedLanguage);
      results.push({ stationId: entry.candidate.id, verdict });
      if (verdict.category !== 'talk' && verdict.category !== 'russian-vocal') cleanId = entry.candidate.id;
    } catch (error) {
      results.push({ stationId: entry.candidate.id, verdict: null, error: error instanceof Error ? error.message : 'analyze failed' });
    }
  }
  return { cleanId, results };
}
