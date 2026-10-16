import { describe, it, expect, vi } from 'vitest';
const dns = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: dns }));
import { publicAddress, publicURL, pinnedLookup } from '@/lib/utils/publicFetch';
import { proxy } from '../.cache/perplexica/src/proxy';
import { NextRequest } from '../.cache/perplexica/node_modules/next/server';

describe('bundled runtime network boundary', () => {
  it('rejects private, metadata, mapped IPv6 and noncanonical addresses', () => {
    for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','100.100.100.200','0.0.0.0','192.168.1.1','::1','fe80::1','fc00::1','::ffff:127.0.0.1','2001:db8::1']) expect(publicAddress(address),address).toBe(false);
    for(const url of ['http://2130706433','http://0177.0.0.1','http://0x7f000001','http://user:pass@example.com','file:///c:/data','http://[::1]','http://[::ffff:127.0.0.1]','http://8.8.8.8:123']) expect(()=>publicURL(url),url).toThrow();
    expect(publicAddress('8.8.8.8')).toBe(true);expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('pins the checked DNS answer and rejects mixed public/private answers', async () => {
    dns.mockResolvedValueOnce([{address:'8.8.8.8',family:4}]).mockResolvedValueOnce([{address:'127.0.0.1',family:4}]);
    const callback = await pinnedLookup('public.example');
    const got = await new Promise(resolve => (callback as unknown as Function)('public.example',{all:true},(error:unknown,value:unknown)=>resolve(error||value)));
    expect(got).toEqual([{address:'8.8.8.8',family:4}]);expect(dns).toHaveBeenCalledTimes(1);
    await expect(pinnedLookup('public.example')).rejects.toThrow('FETCH_ADDRESS_REJECTED');
    dns.mockResolvedValueOnce([{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]);
    await expect(pinnedLookup('public.example')).rejects.toThrow('FETCH_ADDRESS_REJECTED');
  });
  it('blocks cross-origin and DNS-rebinding API callers before handlers', () => {
    const req=(headers:Record<string,string>)=>new NextRequest('http://127.0.0.1:3000/api/providers',{headers:{host:'127.0.0.1:3000',...headers}});
    expect(proxy(req({origin:'https://attacker.example'})).status).toBe(403);
    expect(proxy(req({origin:'null'})).status).toBe(403);
    expect(proxy(req({host:'attacker.example:3000'})).status).toBe(403);
    expect(proxy(req({'sec-fetch-site':'cross-site'})).status).toBe(403);
    const allowed=proxy(req({origin:'http://pab.search'}));expect(allowed.status).toBe(200);expect(allowed.headers.get('access-control-allow-origin')).toBe('http://pab.search');
    expect(proxy(req({})).status).toBe(200);
  });
  it('ends the caller deadline even when OS DNS has not settled', async () => {
    let finish!: (v: unknown) => void;
    dns.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = pinnedLookup('pending.example', controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('FETCH_TIMEOUT');
    finish([{address:'8.8.8.8',family:4}]);
  });
});
