import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const outputRoot = fileURLToPath(new URL('../out/', import.meta.url));
const workerPath = path.join(outputRoot, 'sw.js');
const origin = 'https://invoice.example';
type RequestInput = RequestInfo | URL;
type Network = (input: RequestInput) => Promise<Response>;

function requestUrl(input: RequestInput): string {
  return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin).href;
}

class WorkerRequest extends Request {
  constructor(input: RequestInput, init?: RequestInit) {
    super(typeof input === 'string' ? new URL(input, origin) : input, init);
  }
}

class MemoryCache {
  entries = new Map<string, Response>();
  constructor(private network: Network) {}
  async match(input: RequestInput) { return this.entries.get(requestUrl(input))?.clone(); }
  async put(input: RequestInput, response: Response) { this.entries.set(requestUrl(input), response.clone()); }
  async addAll(requests: Request[]) {
    for (const request of requests) {
      const response = await this.network(request);
      if (!response.ok) throw new Error(`Could not precache ${request.url}`);
      await this.put(request, response);
    }
  }
}

async function outputFiles(directory: string, relative = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await outputFiles(path.join(directory, entry.name), name));
    else if (entry.isFile() && name !== 'sw.js' && !name.endsWith('.map')) files.push(name);
  }
  return files.sort();
}

async function createWorker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const stores = new Map<string, MemoryCache>();
  const requests: string[] = [];
  const flags = { skippedWaiting: false, claimed: false };
  let network: Network = async input => {
    const pathname = decodeURIComponent(new URL(requestUrl(input)).pathname);
    const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
    return new Response(await readFile(path.join(outputRoot, filename)));
  };
  const fetchMock: Network = async input => {
    requests.push(requestUrl(input));
    return network(input);
  };
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new MemoryCache(fetchMock));
      return stores.get(name)!;
    },
    async keys() { return [...stores.keys()]; },
    async delete(name: string) { return stores.delete(name); },
  };
  const context = createContext({
    self: {
      location: { origin },
      addEventListener(name: string, listener: (event: unknown) => void) { handlers.set(name, listener); },
      async skipWaiting() { flags.skippedWaiting = true; },
      clients: { async claim() { flags.claimed = true; } },
    },
    caches,
    fetch: fetchMock,
    Request: WorkerRequest,
    Response,
    URL,
    Set,
  });
  runInContext(await readFile(workerPath, 'utf8'), context, { filename: 'generated-sw.js' });

  async function lifecycle(name: 'install' | 'activate') {
    let work: Promise<unknown> | undefined;
    const handler = handlers.get(name);
    assert.ok(handler, `${name} listener exists`);
    handler({ waitUntil(value: Promise<unknown>) { work = value; } });
    assert.ok(work, `${name} keeps the event alive`);
    await work;
  }

  return {
    caches,
    stores,
    requests,
    flags,
    install: () => lifecycle('install'),
    activate: () => lifecycle('activate'),
    setNetwork(next: Network) { network = next; },
    async fetch(request: Request): Promise<{ handled: boolean; response?: Response }> {
      let result: Promise<Response> | undefined;
      handlers.get('fetch')?.({ request, respondWith(value: Promise<Response>) { result = value; } });
      return result ? { handled: true, response: await result } : { handled: false };
    },
  };
}

function navigation(url: string): Request {
  const request = new Request(new URL(url, origin));
  // Browsers create navigate-mode requests; Node's constructor cannot request it.
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  return request;
}

test('generated production service worker', {
  skip: !existsSync(workerPath) && 'Run npm run build to generate the production PWA output.',
}, async t => {
  await t.test('precache contains essential files and every exported chunk and font', async () => {
    const worker = await createWorker();
    await worker.install();
    assert.equal(worker.flags.skippedWaiting, true);
    const keys = await worker.caches.keys();
    assert.equal(keys.length, 1);
    assert.match(keys[0], /^seladevs-invoice-[a-f0-9]{20}$/);
    const cached = worker.stores.get(keys[0])!.entries;
    for (const url of ['/', '/manifest.webmanifest', '/brand/seladevs-logo.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png']) {
      assert.ok(cached.has(new URL(url, origin).href), `${url} is precached`);
    }
    const files = await outputFiles(outputRoot);
    assert.ok(files.some(file => file.startsWith('_next/static/') && file.endsWith('.js')), 'production JavaScript exists');
    assert.ok(files.some(file => file.endsWith('.css')), 'production CSS exists');
    assert.ok(files.some(file => file.endsWith('.woff2')), 'local fonts exist');
    for (const file of files) {
      const url = new URL(`/${file.split('/').map(encodeURIComponent).join('/')}`, origin).href;
      assert.ok(cached.has(url), `${file} is available offline immediately after installation`);
    }
    assert.ok([...cached.keys()].every(url => new URL(url).origin === origin));
  });

  await t.test('offline navigation falls back to the app shell and precached scripts need no network', async () => {
    const worker = await createWorker();
    await worker.install();
    worker.setNetwork(async () => { throw new Error('Offline'); });
    const result = await worker.fetch(navigation('/an-uncached-page'));
    assert.equal(result.handled, true);
    assert.equal(await result.response!.text(), await readFile(path.join(outputRoot, 'index.html'), 'utf8'));
    const script = (await outputFiles(outputRoot)).find(file => file.startsWith('_next/static/') && file.endsWith('.js'))!;
    const before = worker.requests.length;
    const asset = await worker.fetch(new Request(new URL(`/${script}`, origin)));
    assert.equal(await asset.response!.text(), await readFile(path.join(outputRoot, script), 'utf8'));
    assert.equal(worker.requests.length, before, 'cached script bypasses a failing network');
  });

  await t.test('navigation uses fresh network content and retains it for an offline reload', async () => {
    const worker = await createWorker();
    await worker.install();
    worker.setNetwork(async () => new Response('<html>Fresh app shell</html>'));
    const online = await worker.fetch(navigation('/'));
    assert.equal(await online.response!.text(), '<html>Fresh app shell</html>');
    worker.setNetwork(async () => { throw new Error('Offline'); });
    const offline = await worker.fetch(navigation('/'));
    assert.equal(await offline.response!.text(), '<html>Fresh app shell</html>');
  });

  await t.test('uncached same-origin static requests fill the cache; external and non-GET requests are ignored', async () => {
    const worker = await createWorker();
    await worker.install();
    worker.setNetwork(async () => new Response('new-static-chunk'));
    const request = new Request(`${origin}/_next/static/later-loaded.js`);
    assert.equal(await (await worker.fetch(request)).response!.text(), 'new-static-chunk');
    worker.setNetwork(async () => { throw new Error('Offline'); });
    assert.equal(await (await worker.fetch(request)).response!.text(), 'new-static-chunk');
    const before = worker.requests.length;
    assert.deepEqual(await worker.fetch(new Request('https://external.example/_next/static/script.js')), { handled: false });
    assert.deepEqual(await worker.fetch(new Request(`${origin}/_next/static/post.js`, { method: 'POST', body: 'data' })), { handled: false });
    assert.equal(worker.requests.length, before, 'ignored requests are left to the browser');
  });

  await t.test('activation removes only older Seladevs caches', async () => {
    const worker = await createWorker();
    await worker.install();
    const [current] = await worker.caches.keys();
    await worker.caches.open('seladevs-invoice-old-version');
    await worker.caches.open('unrelated-app-cache');
    await worker.activate();
    assert.equal(worker.flags.claimed, true);
    assert.deepEqual((await worker.caches.keys()).sort(), [current, 'unrelated-app-cache'].sort());
  });
});
