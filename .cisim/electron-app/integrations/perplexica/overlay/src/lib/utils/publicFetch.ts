import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';

export function publicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export function publicURL(raw: string): URL {
  if (raw.length > 8192 || /[\\\s]/.test(raw)) throw Error('FETCH_URL_REJECTED');
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port))) throw Error('FETCH_URL_REJECTED');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const authority = raw.match(/^https?:\/\/([^/?#]+)/i)?.[1] ?? '';
  const rawHost = authority.startsWith('[') ? authority.slice(1, authority.indexOf(']')) : authority.split(':')[0];
  if (isIP(host) && (!publicAddress(host) || (isIP(host) === 4 && rawHost !== host))) throw Error('FETCH_ADDRESS_REJECTED');
  if (!host.includes('.') && !isIP(host)) throw Error('FETCH_ADDRESS_REJECTED');
  url.hash = ''; return url;
}

// The returned lookup closes over the checked answer and never calls DNS.
export async function pinnedLookup(host: string, signal?: AbortSignal): Promise<LookupFunction> {
  signal?.throwIfAborted();
  const resolution = isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : lookup(host, { all: true, verbatim: true });
  const entries = signal ? await new Promise<Awaited<typeof resolution>>((resolve, reject) => {
    const abort = () => reject(Error('FETCH_TIMEOUT'));
    signal.addEventListener('abort', abort, {once:true});
    resolution.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  }) : await resolution;
  signal?.throwIfAborted();
  if (!entries.length || entries.some(e => !publicAddress(e.address))) throw Error('FETCH_ADDRESS_REJECTED');
  const selected = entries[0];
  return ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    if (_host.replace(/^\[|\]$/g, '') !== host) { callback(Error('FETCH_UNPINNED_HOST')); return; }
    if (options.all) callback(null, [selected]); else callback(null, selected.address, selected.family);
  }) as LookupFunction;
}

type Response = { status: number; location?: string; contentType: string; text: string };
async function request(url: URL, signal: AbortSignal): Promise<Response> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const lookup = await pinnedLookup(host, signal);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).get(url, {
      lookup, agent: false, signal, timeout: 10000,
      headers: { 'Accept': 'text/html,text/plain;q=0.8', 'Accept-Encoding': 'identity', 'User-Agent': 'HayDevBrowser-Research/0.1' },
    }, res => {
      const status = res.statusCode ?? 0;
      if ([301,302,303,307,308].includes(status)) {
        const location = res.headers.location; res.destroy();
        resolve({status, location, contentType: '', text: ''}); return;
      }
      if (status < 200 || status >= 300) { res.destroy(); reject(Error(`FETCH_HTTP_${status}`)); return; }
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
        res.destroy(); reject(Error('FETCH_ENCODING_UNSUPPORTED')); return;
      }
      const contentType = String(res.headers['content-type'] || '');
      if (!/^(text\/(html|plain)|application\/xhtml\+xml)(;|$)/i.test(contentType)) {
        res.destroy(); reject(Error('FETCH_CONTENT_TYPE_UNSUPPORTED')); return;
      }
      let size = 0; const chunks: Buffer[] = [];
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { res.destroy(Error('FETCH_BODY_TOO_LARGE')); return; }
        chunks.push(Buffer.from(chunk));
      });
      res.on('end', () => resolve({status, contentType, text: Buffer.concat(chunks).toString('utf8')}));
      res.on('error', reject);
      res.on('aborted', () => reject(Error('FETCH_READ_INTERRUPTED')));
    });
    req.on('timeout', () => req.destroy(Error('FETCH_TIMEOUT')));
    req.on('error', () => reject(Error(signal.aborted ? 'FETCH_TIMEOUT' : 'FETCH_NETWORK_ERROR')));
  });
}
export async function fetchPublic(raw: string): Promise<Response & { finalUrl: string }> {
  const signal = AbortSignal.timeout(20000); let url = publicURL(raw);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await request(url, signal);
    if (![301,302,303,307,308].includes(response.status)) return { ...response, finalUrl: url.href };
    if (!response.location || redirects === 5) throw Error('FETCH_REDIRECT_LIMIT');
    // A redirect never reuses the previous connection, address set or authority.
    url = publicURL(new URL(response.location, url).href);
  }
  throw Error('FETCH_REDIRECT_LIMIT');
}
