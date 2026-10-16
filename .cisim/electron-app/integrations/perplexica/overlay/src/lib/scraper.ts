import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { fetchPublic } from './utils/publicFetch';

// Reuse Readability with a bounded, DNS-pinned HTTP transport. There is no
// second browser installation or unsandboxed script execution in the runtime.
// Rendered-page extraction remains in HayDevBrowser's concrete WebView bridge.
class Scraper {
  static async scrape(url: string): Promise<{ content: string; title: string }> {
    const response = await fetchPublic(url);
    if (response.contentType.startsWith('text/plain')) {
      if (!response.text.trim()) throw Error('EXTRACT_EMPTY');
      return { content: response.text.slice(0, 200000), title: response.finalUrl };
    }
    const dom = new JSDOM(response.text, { url: response.finalUrl });
    try {
      const extracted = new Readability(dom.window.document).parse();
      const text = extracted?.textContent?.trim();
      if (!text) throw Error('EXTRACT_EMPTY_OR_SCRIPT_REQUIRED');
      const title = extracted?.title || dom.window.document.title || response.finalUrl;
      const content = text.slice(0, 200000);
      return { title, content: `# ${title} - ${response.finalUrl}\n${content}${text.length > content.length ? '\n[PARTIAL: content limit reached]' : ''}` };
    } finally { dom.window.close(); }
  }
}
export default Scraper;
