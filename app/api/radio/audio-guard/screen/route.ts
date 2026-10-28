import { NextRequest, NextResponse } from 'next/server';
import { audioGuardStatus, screenStations, warmAudioGuard } from '@/lib/audio-guard';
import { resolveStationStream } from '@/lib/radio-resolver';
import { appendDiag } from '@/lib/diag-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Одно скрининг-задание за раз: открывается одна книга, а инференс упирается в CPU.
let screening = false;

const STATION_ID = /^(?:soma:[a-z0-9]{1,32}|rp:[0-3]|[a-f0-9-]{8,64})$/;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    { stationIds?: string[]; blockedLanguage?: string; seconds?: number } | null;

  const requested = (body?.stationIds ?? []).map(id => String(id).trim().toLowerCase());
  const ids = requested.filter(id => STATION_ID.test(id)).slice(0, 3);
  const rejected = requested.filter(id => !STATION_ID.test(id));
  if (!ids.length) {
    appendDiag('screen.no-valid-ids', { requested, rejected });
    return NextResponse.json({ error: 'No valid station ids' }, { status: 400 });
  }
  if (rejected.length) appendDiag('screen.ids-rejected', { rejected });

  const status = audioGuardStatus();
  if (!status.ready) {
    // Модель ещё грузится — греем и отвечаем сразу, клиент стартует без задержки.
    if (!status.loading) void warmAudioGuard().catch(() => {});
    appendDiag('screen.warming', { ids, model: status });
    return NextResponse.json({ status: 'warming', cleanId: null }, { status: 202 });
  }
  if (screening) {
    appendDiag('screen.busy', { ids });
    return NextResponse.json({ status: 'busy', cleanId: null }, { status: 202 });
  }

  screening = true;
  try {
    const resolved = (await Promise.all(ids.map(async id => {
      const url = await resolveStationStream(id);
      return url ? { id, url: String(url) } : null;
    }))).filter((entry): entry is { id: string; url: string } => Boolean(entry));

    if (!resolved.length) {
      appendDiag('screen.no-streams', { ids });
      return NextResponse.json({ error: 'Station streams not found' }, { status: 404 });
    }

    const seconds = Math.min(6, Math.max(3, Number(body?.seconds) || 4));
    const startedAt = Date.now();
    const result = await screenStations(resolved, body?.blockedLanguage ?? '', seconds);

    // Если чистой волны нет — не отдаём вслепую первую: выбираем наименее «речевую».
    const scored = result.results.filter(entry => entry.verdict);
    const bestId = result.cleanId ?? scored
      .slice()
      .sort((a, b) => (a.verdict!.speech - b.verdict!.speech))[0]?.stationId ?? null;

    appendDiag('screen.done', {
      ms: Date.now() - startedAt, seconds, blockedLanguage: body?.blockedLanguage ?? '',
      cleanId: result.cleanId, bestId,
      results: result.results.map(entry => ({
        stationId: entry.stationId, error: entry.error,
        category: entry.verdict?.category, speech: entry.verdict?.speech,
        vocals: entry.verdict?.vocals, music: entry.verdict?.music,
        language: entry.verdict?.detectedLanguage,
        labels: entry.verdict?.labels?.slice(0, 5).map(label => `${label.label}:${label.score.toFixed(3)}`),
      })),
    });
    return NextResponse.json({ status: 'ready', ...result, bestId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to screen the live air' }, { status: 502 });
  } finally {
    screening = false;
  }
}
