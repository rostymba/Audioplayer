import { NextRequest, NextResponse } from 'next/server';
import { analyzeAudio, audioGuardStatus, sampleRadio, warmAudioGuard } from '@/lib/audio-guard';
import { resolveStationStream } from '@/lib/radio-resolver';
import { appendDiag } from '@/lib/diag-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let activeAnalysis = false;

export async function GET(request: NextRequest) {
  const stationId = request.nextUrl.searchParams.get('stationId')?.trim().toLowerCase();
  const blockedLanguage = request.nextUrl.searchParams.get('blockedLanguage')?.trim().toLowerCase() ?? '';
  const status = audioGuardStatus();
  if (!stationId) {
    if (!status.ready && !status.loading) void warmAudioGuard().catch(() => {});
    return NextResponse.json({ status: audioGuardStatus() });
  }
  if (!/^(?:soma:[a-z0-9]{1,32}|rp:[0-3]|[a-f0-9-]{8,64})$/.test(stationId)) {
    return NextResponse.json({ error: 'Invalid station id' }, { status: 400 });
  }
  if (!status.ready) {
    if (!status.loading) void warmAudioGuard().catch(() => {});
    return NextResponse.json({ status: 'warming', model: audioGuardStatus() }, { status: 202 });
  }
  if (activeAnalysis) return NextResponse.json({ status: 'busy' }, { status: 202 });
  activeAnalysis = true;
  try {
    const stream = await resolveStationStream(stationId);
    if (!stream) return NextResponse.json({ error: 'Station stream not found' }, { status: 404 });
    const audio = await sampleRadio(stream, 10);
    const verdict = await analyzeAudio(audio, blockedLanguage);
    appendDiag('guard.verdict', { stationId, blockedLanguage, category: verdict.category,
      speech: verdict.speech, vocals: verdict.vocals, music: verdict.music,
      language: verdict.detectedLanguage,
      labels: verdict.labels?.slice(0, 5).map(label => `${label.label}:${label.score.toFixed(3)}`) });
    return NextResponse.json({ status: 'ready', verdict });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to analyse the live air' }, { status: 502 });
  } finally { activeAnalysis = false; }
}
