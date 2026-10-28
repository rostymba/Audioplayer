import { NextRequest } from 'next/server';
import { resolveStationStream } from '@/lib/radio-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Personal-demo relay: Chrome's direct requests are rejected by these streams.
// Accept catalog IDs only, never caller-supplied upstream URLs. Do not store audio.
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('stationId') ?? '';
  if (!/^soma:[a-z0-9]{1,32}$/.test(id)) return new Response(null, { status: 400 });
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
    controller.abort();
  };
  try {
    const url = await resolveStationStream(id);
    if (!url) { cleanup(); return new Response(null, { status: 404 }); }
    timer = setTimeout(abort, 6000);
    const upstream = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!upstream.ok || !upstream.body || !upstream.headers.get('content-type')?.startsWith('audio/')) {
      cleanup(); return new Response(null, { status: 502 });
    }
    const reader = upstream.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(output) {
        timer = setTimeout(abort, 15000);
        try {
          const { done, value } = await reader.read();
          if (done) { output.close(); cleanup(); }
          else output.enqueue(value);
        } catch (error) { output.error(error); cleanup(); }
        finally { clearTimeout(timer); }
      },
      async cancel() { cleanup(); await reader.cancel().catch(() => {}); },
    });
    return new Response(body, { headers: { 'Content-Type': upstream.headers.get('content-type')!,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { cleanup(); return new Response(null, { status: 502 }); }
}
