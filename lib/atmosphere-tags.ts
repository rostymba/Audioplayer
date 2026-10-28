// Курируемый словарь атмосферных тегов (рычаги A и B).
// Каждый тег несёт:
//  - description: насыщенная RU+EN фраза, которую эмбеддер векторизует как «смысл» тега
//    (мультиязычно, потому что книги бывают на русском и английском);
//  - radioTags: реальные теги Radio Browser, которыми ищутся станции (лечит нестыковку словарей);
//  - dims: вклад тега в измерения атмосферы (0..1), усредняется по выбранным тегам.
// Это тот артефакт, который разводит «Гарри Поттера» и «Игру престолов» в разные наборы станций.

import type { AtmosphereDimensions } from './atmosphere-profile';

export type AtmosphereTagGroup = 'mood' | 'setting' | 'sonic';

export interface AtmosphereTag {
  key: string;
  label: string;              // UI label (English)
  group: AtmosphereTagGroup;
  description: string;        // RU + EN — вход для эмбеддинга
  radioTags: string[];        // реальные теги Radio Browser
  dims?: Partial<AtmosphereDimensions>;
}

export const ATMOSPHERE_TAGS: AtmosphereTag[] = [
  // --- mood ---
  { key: 'dark', label: 'Dark', group: 'mood',
    description: 'тёмная, тяжёлая, гнетущая, мрачная атмосфера; dark, heavy, ominous, brooding, grim',
    radioTags: ['dark ambient', 'dark', 'cinematic'],
    dims: { valence: 0.15, energy: 0.5, tension: 0.8 } },
  { key: 'melancholic', label: 'Melancholic', group: 'mood',
    description: 'меланхоличное, печальное, тоскливое, задумчивое; melancholic, sad, wistful, sombre',
    radioTags: ['neoclassical', 'ambient', 'piano'],
    dims: { valence: 0.3, energy: 0.3, tension: 0.4 } },
  { key: 'tense', label: 'Tense', group: 'mood',
    description: 'напряжённое, тревожное, саспенс, беспокойное; tense, suspenseful, anxious, uneasy',
    radioTags: ['soundtrack', 'cinematic', 'dark ambient'],
    dims: { valence: 0.35, energy: 0.6, tension: 0.85 } },
  { key: 'cozy', label: 'Cozy', group: 'mood',
    description: 'уютное, тёплое, спокойное, камерное, домашнее; cozy, warm, calm, intimate, gentle',
    radioTags: ['chillout', 'lounge', 'jazz'],
    dims: { valence: 0.8, energy: 0.3, tension: 0.2 } },
  { key: 'serene', label: 'Serene', group: 'mood',
    description: 'безмятежное, светлое, умиротворённое, созерцательное; serene, peaceful, tranquil, meditative',
    radioTags: ['ambient', 'relaxation', 'new age'],
    dims: { valence: 0.7, energy: 0.2, tension: 0.15 } },
  { key: 'epic', label: 'Epic', group: 'mood',
    description: 'эпичное, героическое, масштабное, торжественное; epic, heroic, grand, sweeping, monumental',
    radioTags: ['epic', 'soundtrack', 'orchestral'],
    dims: { valence: 0.6, energy: 0.85, tension: 0.6 } },
  { key: 'whimsical', label: 'Whimsical', group: 'mood',
    description: 'причудливое, игривое, волшебное, лёгкое, сказочное; whimsical, playful, magical, light, wondrous',
    radioTags: ['fantasy', 'soundtrack', 'folk'],
    dims: { valence: 0.75, energy: 0.55, tension: 0.3 } },
  { key: 'romantic', label: 'Romantic', group: 'mood',
    description: 'романтичное, нежное, чувственное, лиричное; romantic, tender, warm, lyrical',
    radioTags: ['classical', 'piano', 'jazz'],
    dims: { valence: 0.75, energy: 0.4, tension: 0.3 } },
  { key: 'eerie', label: 'Eerie', group: 'mood',
    description: 'жуткое, зловещее, потустороннее, тревожащее; eerie, uncanny, haunting, unsettling',
    radioTags: ['dark ambient', 'drone', 'experimental'],
    dims: { valence: 0.25, energy: 0.4, tension: 0.8 } },
  { key: 'hopeful', label: 'Hopeful', group: 'mood',
    description: 'светлое, вдохновляющее, обнадёживающее, подъёмное; hopeful, uplifting, bright, inspiring',
    radioTags: ['post-rock', 'ambient', 'cinematic'],
    dims: { valence: 0.8, energy: 0.6, tension: 0.35 } },

  // --- setting / genre ---
  { key: 'fantasy', label: 'Fantasy', group: 'setting',
    description: 'фэнтези, магия, средневековые миры, драконы, короли; fantasy, magic, medieval, mythical, kingdoms',
    radioTags: ['fantasy', 'celtic', 'medieval', 'soundtrack'],
    dims: { instrumental: 0.85, vocalTolerance: 0.3, era: 0.4 } },
  { key: 'space', label: 'Space / sci-fi', group: 'setting',
    description: 'космос, научная фантастика, звёзды, будущее, корабли; space, sci-fi, cosmic, futuristic, starship',
    radioTags: ['space', 'electronic', 'ambient'],
    dims: { instrumental: 0.9, vocalTolerance: 0.2, era: 0.9 } },
  { key: 'noir', label: 'Noir / detective', group: 'setting',
    description: 'детектив, нуар, городская тайна, преступление; noir, detective, mystery, crime, smoky city',
    radioTags: ['jazz', 'lounge', 'downtempo'],
    dims: { instrumental: 0.7, vocalTolerance: 0.4, era: 0.5 } },
  { key: 'historical', label: 'Historical', group: 'setting',
    description: 'историческое, старинное, классическое, эпоха; historical, period, old-world, courtly',
    radioTags: ['classical', 'baroque', 'instrumental'],
    dims: { instrumental: 0.9, vocalTolerance: 0.2, era: 0.2 } },
  { key: 'adventure', label: 'Adventure', group: 'setting',
    description: 'приключение, путешествие, дорога, движение вперёд; adventure, journey, quest, driving forward',
    radioTags: ['soundtrack', 'folk', 'world'],
    dims: { energy: 0.7, instrumental: 0.7, era: 0.5 } },
  { key: 'horror', label: 'Horror', group: 'setting',
    description: 'хоррор, ужас, страх, кошмар; horror, dread, terror, nightmare',
    radioTags: ['dark ambient', 'drone', 'horror'],
    dims: { valence: 0.15, tension: 0.9, instrumental: 0.9 } },
  { key: 'pastoral', label: 'Nature / pastoral', group: 'setting',
    description: 'природа, деревня, пастораль, поля, тишина; pastoral, nature, rural, countryside, folk',
    radioTags: ['folk', 'celtic', 'acoustic'],
    dims: { valence: 0.7, energy: 0.35, era: 0.35 } },

  // --- sonic texture ---
  { key: 'ambient', label: 'Ambient', group: 'sonic',
    description: 'эмбиент, атмосферный фон, дрон, безритмичное; ambient, atmospheric, drone, beatless',
    radioTags: ['ambient', 'drone'],
    dims: { instrumental: 0.95, vocalTolerance: 0.1 } },
  { key: 'cinematic', label: 'Cinematic', group: 'sonic',
    description: 'кинематографичное, саундтрек, оркестровое; cinematic, film score, orchestral, sweeping',
    radioTags: ['cinematic', 'soundtrack', 'orchestral'],
    dims: { instrumental: 0.9, vocalTolerance: 0.15 } },
  { key: 'piano', label: 'Piano', group: 'sonic',
    description: 'фортепиано, неоклассика, сольные клавиши; piano, neoclassical, solo keys, intimate',
    radioTags: ['piano', 'neoclassical'],
    dims: { instrumental: 0.95, vocalTolerance: 0.1 } },
  { key: 'jazz', label: 'Jazz', group: 'sonic',
    description: 'джаз, лаунж, свинг, дымный клуб; jazz, lounge, swing, smoky club',
    radioTags: ['jazz', 'lounge', 'swing'],
    dims: { instrumental: 0.6, vocalTolerance: 0.5 } },
  { key: 'electronic', label: 'Electronic', group: 'sonic',
    description: 'электроника, даунтемпо, синтезаторы; electronic, downtempo, synth, idm',
    radioTags: ['electronic', 'downtempo', 'idm'],
    dims: { instrumental: 0.8, vocalTolerance: 0.3, era: 0.9 } },
  { key: 'lofi', label: 'Lo-fi', group: 'sonic',
    description: 'lo-fi, чиллхоп, тёплый винтажный бит; lo-fi, chillhop, mellow beats',
    radioTags: ['lo-fi', 'chillout', 'chillhop'],
    dims: { valence: 0.6, energy: 0.35, instrumental: 0.7 } },
  { key: 'classical', label: 'Classical', group: 'sonic',
    description: 'классическая музыка, инструментальное, оркестр; classical, instrumental, orchestra, chamber',
    radioTags: ['classical', 'instrumental'],
    dims: { instrumental: 0.95, vocalTolerance: 0.15, era: 0.2 } },
  { key: 'folk', label: 'Folk', group: 'sonic',
    description: 'фолк, акустика, кельтское, народное; folk, acoustic, celtic, traditional',
    radioTags: ['folk', 'acoustic', 'celtic'],
    dims: { instrumental: 0.6, vocalTolerance: 0.5, era: 0.35 } },
];

export function tagByKey(key: string): AtmosphereTag | undefined {
  return ATMOSPHERE_TAGS.find((tag) => tag.key === key);
}
