// Чистая логика вердикта Audio Guard: «набор лейблов AudioSet → категория эфира».
// Вынесена из analyzeAudio, чтобы пороги, решающие «реклама или музыка», were тестируемы
// без загрузки моделей. Модельная часть (инференс, определение языка) осталась в audio-guard.ts.

export type Label = { label: string; score: number };

export const MUSIC_PATTERNS = [/^Music$/i, /musical instrument/i, /independent music/i];
export const SPEECH_PATTERNS = [/speech/i, /conversation/i, /narration/i, /monologue/i, /newscast/i];
export const VOCAL_PATTERNS = [/singing/i, /^Song$/i, /choir/i, /vocal music/i, /chant/i];

// Пороги решения. Меняя их, меняешь чувствительность к рекламе — поэтому они под тестами.
export const TALK_SPEECH_MIN = 0.08;
export const TALK_SPEECH_OVER_VOCALS = 1.5;
export const LANGUAGE_CHECK_VOCALS_MIN = 0.012;
export const BLOCKED_LANGUAGE_CONFIDENCE_MIN = 0.25;
export const MUSIC_MIN = 0.25;

export type LabelSummary = { music: number; speech: number; vocals: number };

function sumLabels(labels: Label[], tests: RegExp[]) {
  return labels.reduce((sum, item) => (tests.some(test => test.test(item.label)) ? sum + item.score : sum), 0);
}

export function summariseLabels(labels: Label[]): LabelSummary {
  return {
    music: sumLabels(labels, MUSIC_PATTERNS),
    speech: sumLabels(labels, SPEECH_PATTERNS),
    vocals: sumLabels(labels, VOCAL_PATTERNS),
  };
}

/** Речь/реклама: речи заметно больше, чем пения. */
export function isTalk({ speech, vocals }: LabelSummary): boolean {
  return speech >= TALK_SPEECH_MIN && speech >= vocals * TALK_SPEECH_OVER_VOCALS;
}

/** Есть ли смысл тратить whisper на определение языка вокала. */
export function needsLanguageCheck(blockedLanguage: string, vocals: number): boolean {
  return /^(ru|rus|russian)(-|$)/i.test(blockedLanguage) && vocals >= LANGUAGE_CHECK_VOCALS_MIN;
}

export function isBlockedVocal(detected: { language: string; confidence: number }): boolean {
  return detected.language === 'ru' && detected.confidence >= BLOCKED_LANGUAGE_CONFIDENCE_MIN;
}

export function musicCategory({ music, vocals }: LabelSummary): 'music' | 'unknown' {
  return music + vocals >= MUSIC_MIN ? 'music' : 'unknown';
}

export const talkConfidence = (speech: number) => Math.min(0.99, speech * 2.5);
export const vocalConfidence = (vocals: number) => Math.min(0.95, 0.55 + vocals * 3);
export const musicConfidence = ({ music, vocals }: LabelSummary) => Math.min(0.99, Math.max(music, vocals));
