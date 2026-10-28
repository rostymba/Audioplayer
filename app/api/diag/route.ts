import { NextRequest, NextResponse } from 'next/server';
import { appendDiag } from '@/lib/diag-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Канал клиентской диагностики: браузерный trace() живёт в памяти вкладки и наружу не виден.
// Клиент шлёт сюда ключевые события плеера, они ложатся в .diag/radio.log рядом с серверными.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { event?: string; data?: Record<string, unknown> } | null;
  const event = typeof body?.event === 'string' ? body.event.slice(0, 64) : 'client.unknown';
  appendDiag(event, { ...(body?.data ?? {}), from: 'client' });
  return NextResponse.json({ ok: true });
}
