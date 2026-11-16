// BYTE_PROXY_NO_SERVE=1 deno test -A supabase/functions/byte-proxy/index_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { checkTarget, clientIp, handle, hostAllowed, parseRange, pickFormat, RateLimiter, readBodyCapped, rpmFromEnv, upstreamHeaders } from './index.ts';

Deno.test('allowlist', () => {
  assert(hostAllowed('music.youtube.com'));
  assert(hostAllowed('rr3---sn-abc.googlevideo.com'));
  assert(hostAllowed('i.ytimg.com'));
  assert(hostAllowed('lh3.googleusercontent.com'));
  assert(!hostAllowed('googlevideo.com.evil.com'));
  assert(!hostAllowed('evilgooglevideo.com'));
  assert(!hostAllowed('storage.googleusercontent.com'));
  assert(!hostAllowed('example.com'));
  assert('error' in checkTarget('http://music.youtube.com/'));
  assert('error' in checkTarget('https://music.youtube.com:8443/'));
  assert('error' in checkTarget('https://user:pw@music.youtube.com/'));
  assert('url' in checkTarget('http://mobilecdn.kugou.com/api/v3/search'));
  assert('url' in checkTarget('https://lrclib.net/api/get?x=1'));
});

Deno.test('headers: app headers pass, cookies never', () => {
  const r = new Request('http://x/?u=1', {
    headers: { 'x-byte-h': JSON.stringify({ 'User-Agent': 'UA1', Cookie: 'a=b', 'X-Goog-Visitor-Id': 'v' }), range: 'bytes=0-9', cookie: 'c=d' },
  });
  const h = upstreamHeaders(r);
  assertEquals(h.get('user-agent'), 'UA1');
  assertEquals(h.get('x-goog-visitor-id'), 'v');
  assertEquals(h.get('range'), 'bytes=0-9');
  assertEquals(h.get('cookie'), null);
});

Deno.test('range parsing', () => {
  assertEquals(parseRange('bytes=0-', 100), { start: 0, end: 99 });
  assertEquals(parseRange('bytes=10-19', 100), { start: 10, end: 19 });
  assertEquals(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assertEquals(parseRange('bytes=90-500', 100), { start: 90, end: 99 });
  assertEquals(parseRange('bytes=200-', 100), null);
  assertEquals(parseRange(null, 100), null);
});

Deno.test('format pick', () => {
  const p = { streamingData: { adaptiveFormats: [
    { url: 'a', mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, contentLength: '10' },
    { url: 'b', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, contentLength: '20' },
    { url: 'c', mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 48000, contentLength: '30' },
    { url: 'v', mimeType: 'video/mp4', bitrate: 900000 },
  ] } };
  assertEquals(pickFormat(p, 'high', false)?.url, 'a');
  assertEquals(pickFormat(p, 'high', true)?.url, 'b');
  assertEquals(pickFormat(p, 'low', true)?.url, 'c');
});

Deno.test('rate limit', () => {
  const l = new RateLimiter(3, 1000);
  assert(l.allow('1', 0) && l.allow('1', 1) && l.allow('1', 2));
  assert(!l.allow('1', 3));
  assert(l.allow('2', 3));
  assert(l.allow('1', 1001));
});

Deno.test('refuses hosts off the list', async () => {
  const r = await handle(new Request('http://x/?u=' + encodeURIComponent('https://evil.example/'), { headers: { origin: 'https://byte-apurba.sites.tab.bot' } }));
  assertEquals(r.status, 403);
  assertEquals(r.headers.get('x-byte-proxy'), 'refused');
  assertEquals(r.headers.get('access-control-allow-origin'), 'https://byte-apurba.sites.tab.bot');
  await r.body?.cancel();
});

// A fake catalogue + audio server: proves resolve-and-stream in one call,
// ranges, and piecewise fetching (not that YouTube accepts a given server).
Deno.test('play: resolves, streams in pieces, honours Range', async () => {
  const SIZE = 9 * 1024 * 1024 + 123; // > 2 pieces
  const audio = new Uint8Array(SIZE);
  for (let i = 0; i < SIZE; i++) audio[i] = i % 251;
  const real = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (u.pathname === '/sw.js_data') return new Response('xx "CgtFAKEVISITOR1234" yy');
    if (u.pathname.endsWith('/player')) {
      const body = JSON.parse(String(init?.body));
      const ok = body.context.client.clientName === 'ANDROID_VR';
      return Response.json({
        playabilityStatus: { status: 'OK' },
        streamingData: { adaptiveFormats: [{ url: `https://rr1---sn-x.googlevideo.com/videoplayback?c=${body.context.client.clientName}&ok=${ok}`, mimeType: 'audio/webm; codecs="opus"', bitrate: 1, contentLength: String(SIZE) }] },
      });
    }
    if (u.hostname.endsWith('.googlevideo.com')) {
      seen.push(u.searchParams.get('range') ?? 'none');
      if (u.searchParams.get('ok') !== 'true') return new Response('', { status: 403 });
      const [a, b] = (u.searchParams.get('range') ?? `0-${SIZE - 1}`).split('-').map(Number);
      return new Response(audio.slice(a, b + 1), { status: 200 });
    }
    return new Response('?', { status: 404 });
  }) as typeof fetch;
  try {
    const r = await handle(new Request('http://x/?play=abcdefghijk', { headers: { range: 'bytes=100-' } }));
    assertEquals(r.status, 206);
    assertEquals(r.headers.get('content-range'), `bytes 100-${SIZE - 1}/${SIZE}`);
    assertEquals(r.headers.get('x-byte-proxy'), 'play;ANDROID_VR');
    const got = new Uint8Array(await r.arrayBuffer());
    assertEquals(got.length, SIZE - 100);
    assertEquals(got[0], 100 % 251);
    assertEquals(got[got.length - 1], (SIZE - 1) % 251);
    assert(seen.filter((x) => x !== '0-1').length >= 3, 'fetched in pieces: ' + seen.join(','));
    const r2 = await handle(new Request('http://x/?play=abcdefghijk', { headers: { range: 'bytes=0-9' } }));
    assertEquals([...new Uint8Array(await r2.arrayBuffer())], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const bad = await handle(new Request('http://x/?play=../../etc'));
    assertEquals(bad.status, 400);
    await bad.body?.cancel();
  } finally {
    globalThis.fetch = real;
  }
});

// Through a real Deno HTTP server: content-length + piecewise streaming + Range.
Deno.test('play over HTTP: a browser-style Range read gets the exact bytes', async () => {
  const SIZE = 5 * 1024 * 1024 + 7;
  const audio = new Uint8Array(SIZE).map((_, i) => i % 253);
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (u.hostname === '127.0.0.1') return real(input, init);
    if (u.pathname === '/sw.js_data') return new Response('');
    if (u.pathname.endsWith('/player')) {
      return Response.json({ playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: [{ url: 'https://rr2---sn-y.googlevideo.com/videoplayback?x=1', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 1, contentLength: String(SIZE) }] } });
    }
    const [a, b] = (u.searchParams.get('range') ?? '0-0').split('-').map(Number);
    return new Response(audio.slice(a, b + 1));
  }) as typeof fetch;
  const ac = new AbortController();
  const srv = Deno.serve({ port: 0, signal: ac.signal, onListen() {} }, handle);
  try {
    const port = (srv.addr as Deno.NetAddr).port;
    const r = await real(`http://127.0.0.1:${port}/?play=ZZZZZZZZZZZ&f=mp4`, { headers: { range: 'bytes=4194300-' } });
    assertEquals(r.status, 206);
    assertEquals(r.headers.get('content-type'), 'audio/mp4');
    assertEquals(Number(r.headers.get('content-length')), SIZE - 4194300);
    const got = new Uint8Array(await r.arrayBuffer());
    assertEquals(got.length, SIZE - 4194300);
    assertEquals(got[0], 4194300 % 253);
    assertEquals(got[got.length - 1], (SIZE - 1) % 253);
  } finally {
    globalThis.fetch = real;
    ac.abort();
    await srv.finished;
  }
});

Deno.test('rate limit key: the edge\'s address, not a header the caller can write', () => {
  const edge = new Request('http://x/', { headers: { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 203.0.113.9' } });
  assertEquals(clientIp(edge), '203.0.113.9');
  // no cf header: the LAST x-forwarded-for entry (added by the edge), never the first (written by the caller)
  const xf = new Request('http://x/', { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' } });
  assertEquals(clientIp(xf), '203.0.113.9');
});

Deno.test('a huge request body is refused (413)', async () => {
  const big = new Uint8Array(2 * 1024 * 1024 + 1);
  const r = await handle(new Request('http://x/?u=' + encodeURIComponent('https://lrclib.net/api/x'), { method: 'POST', body: big }));
  assertEquals(r.status, 413);
});


// ---------- 1.4.7 hardening ----------

Deno.test('chunked body without Content-Length is cut off while it streams', async () => {
  // 20 MB sent in 1 MB pieces, no Content-Length: the reader must stop after the cap
  let pulled = 0;
  const piece = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream<Uint8Array>({
    pull(ctl) {
      if (pulled >= 20) return ctl.close();
      pulled++;
      ctl.enqueue(piece);
    },
  });
  const r = await readBodyCapped(new Request('http://x/', { method: 'POST', body: stream }), 2 * 1024 * 1024);
  assertEquals(r, null);
  // the cap is 2 MB: at most the cap plus the one piece that crossed it
  assert(pulled <= 4, `read ${pulled} MB, expected the reader to stop near 2 MB`);
});

Deno.test('chunked body over the cap gets 413 through handle, reading only a little', async () => {
  let pulled = 0;
  const piece = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream<Uint8Array>({
    pull(ctl) {
      if (pulled >= 50) return ctl.close();
      pulled++;
      ctl.enqueue(piece);
    },
  });
  const res = await handle(new Request('http://x/?u=' + encodeURIComponent('https://lrclib.net/api/x'), { method: 'POST', body: stream }));
  assertEquals(res.status, 413);
  await res.body?.cancel();
  assert(pulled <= 4, `handle read ${pulled} MB before refusing`);
});

Deno.test('small body is read whole and passed on', async () => {
  const b = await readBodyCapped(new Request('http://x/', { method: 'POST', body: 'hello' }), 1024);
  assert(b !== null);
  assertEquals(new TextDecoder().decode(b!), 'hello');
  const empty = await readBodyCapped(new Request('http://x/', { method: 'POST' }), 1024);
  assertEquals(empty?.byteLength, 0);
});

/** Replaces fetch for one test: the first call answers with [first], the rest 200 OK. */
async function withFakeFetch(first: Response, run: (calls: { url: string; init: RequestInit }[]) => Promise<void>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (calls.length === 1) return first;
    return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

Deno.test('307 redirect keeps the POST method and body', async () => {
  await withFakeFetch(new Response(null, { status: 307, headers: { location: 'https://lrclib.net/api/y' } }), async (calls) => {
    const res = await handle(new Request('http://x/?u=' + encodeURIComponent('https://lrclib.net/api/x'), { method: 'POST', body: 'hello-body' }));
    assertEquals(res.status, 200);
    await res.text();
    assertEquals(calls.length, 2);
    assertEquals(calls[1].url, 'https://lrclib.net/api/y');
    assertEquals(calls[1].init.method, 'POST');
    assertEquals(new TextDecoder().decode(calls[1].init.body as Uint8Array), 'hello-body');
  });
});

Deno.test('301 redirect turns the request into a GET with no body', async () => {
  await withFakeFetch(new Response(null, { status: 301, headers: { location: 'https://lrclib.net/api/y' } }), async (calls) => {
    const res = await handle(new Request('http://x/?u=' + encodeURIComponent('https://lrclib.net/api/x'), { method: 'POST', body: 'hello-body' }));
    await res.text();
    assertEquals(calls[1].init.method, 'GET');
    assertEquals(calls[1].init.body, undefined);
  });
});

Deno.test('a redirect off the allowlist is not followed', async () => {
  await withFakeFetch(new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }), async (calls) => {
    const res = await handle(new Request('http://x/?u=' + encodeURIComponent('https://lrclib.net/api/x')));
    assertEquals(calls.length, 1);
    assertEquals(res.headers.get('x-byte-final-url'), 'https://evil.example/steal');
    await res.body?.cancel();
  });
});

Deno.test('BYTE_PROXY_RPM: a blank or bad value falls back to 300', () => {
  assertEquals(rpmFromEnv(undefined), 300);
  assertEquals(rpmFromEnv(''), 300);
  assertEquals(rpmFromEnv('abc'), 300);
  assertEquals(rpmFromEnv('0'), 300);
  assertEquals(rpmFromEnv('-5'), 300);
  assertEquals(rpmFromEnv('120.7'), 120);
  assertEquals(rpmFromEnv('600'), 600);
});
