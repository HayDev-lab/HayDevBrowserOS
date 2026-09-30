/**
 * Quick actions — domain-scoped one-click prompts for the agent.
 *
 * When the active tab matches a domain, the agent rail offers ready-made
 * prompts (Comet-style "Summarize video" / "Find discounts"). Pure data +
 * matching; no Electron imports.
 */

export interface QuickAction {
  id: string;
  /** Short chip label shown in the rail. */
  label: string;
  /** Full prompt sent to the agent on click. */
  prompt: string;
}

interface QuickActionRule {
  /** Hostname suffix match (subdomains included), lowercased. */
  hostSuffix: string;
  /** Optional path prefix required for the action to apply. */
  pathPrefix?: string;
  actions: QuickAction[];
}

const RULES: readonly QuickActionRule[] = [
  {
    hostSuffix: 'youtube.com',
    pathPrefix: '/watch',
    actions: [
      {
        id: 'yt-chapters',
        label: 'Summarize video',
        prompt:
          'Summarize the video in the active tab: split it into chapters with timestamps; for each chapter give a title and a 1-2 sentence summary. Use the page content. Keep the whole answer under 200 words.',
      },
    ],
  },
  {
    hostSuffix: 'youtube.com',
    actions: [
      {
        id: 'yt-channel',
        label: 'What is this channel about?',
        prompt:
          'Read the active tab and explain briefly what this YouTube channel is about, based on its visible titles and description.',
      },
    ],
  },
  {
    hostSuffix: 'amazon.com',
    actions: shoppingActions(),
  },
  {
    hostSuffix: 'ebay.com',
    actions: shoppingActions(),
  },
  {
    hostSuffix: 'etsy.com',
    actions: shoppingActions(),
  },
  {
    hostSuffix: 'wildberries.ru',
    actions: shoppingActions(),
  },
  {
    hostSuffix: 'ozon.ru',
    actions: shoppingActions(),
  },
  {
    hostSuffix: 'github.com',
    actions: [
      {
        id: 'gh-explain',
        label: 'Explain this repo',
        prompt:
          'Read the active tab (a GitHub repository page) and explain in plain language what this project does, its main technologies, and how to get started.',
      },
    ],
  },
  {
    hostSuffix: 'wikipedia.org',
    actions: [
      {
        id: 'wiki-tldr',
        label: 'TL;DR',
        prompt:
          'Read the active Wikipedia article and produce a 5-bullet TL;DR of the key facts.',
      },
    ],
  },
];

function shoppingActions(): QuickAction[] {
  return [
    {
      id: 'shop-reviews',
      label: 'Find reviews',
      prompt:
        'This looks like a product page. Search the web for reviews of this product and summarize what buyers say — pros, cons, and common complaints. Cite sources.',
    },
    {
      id: 'shop-discount',
      label: 'Find discounts',
      prompt:
        'This looks like a product page. Search the web for discounts, coupons or a better price for this product. Report the best options with links. Cite sources.',
    },
  ];
}

/**
 * Quick actions available for the given URL (empty array when the domain
 * has none). Matching: hostname suffix + optional path prefix.
 */
export function getQuickActionsForUrl(url: string): QuickAction[] {
  if (typeof url !== 'string' || url.length === 0) return [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return [];
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname + parsed.search;
  const out: QuickAction[] = [];
  for (const rule of RULES) {
    const hostMatches =
      host === rule.hostSuffix || host.endsWith('.' + rule.hostSuffix);
    if (!hostMatches) continue;
    if (rule.pathPrefix && !path.startsWith(rule.pathPrefix)) continue;
    out.push(...rule.actions);
  }
  // Cap the chips — the rail is narrow.
  return out.slice(0, 3);
}
