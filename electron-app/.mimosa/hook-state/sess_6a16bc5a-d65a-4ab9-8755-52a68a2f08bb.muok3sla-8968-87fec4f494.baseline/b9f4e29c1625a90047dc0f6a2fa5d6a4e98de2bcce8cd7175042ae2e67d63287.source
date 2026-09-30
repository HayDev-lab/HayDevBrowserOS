import { describe, it, expect, beforeEach } from 'vitest';
import {
  DownloadStateManager,
  generateDownloadId,
  type DownloadEvent,
} from '../src/main/browser/pure/download-state-machine';
import { makeIdGen, makeClock } from './_helpers';

function setup() {
  // Use the same id format but deterministic.
  const idGen = makeIdGen('dl');
  const sm = new DownloadStateManager(idGen);
  const clock = makeClock(1_000_000);
  return { sm, idGen, clock };
}

function started(
  id: string,
  overrides: Partial<
    Extract<DownloadEvent, { type: 'started' }>
  > = {}
): Extract<DownloadEvent, { type: 'started' }> {
  return {
    type: 'started',
    id,
    url: 'https://example.com/file.zip',
    filename: 'file.zip',
    totalBytes: 1000,
    startTime: 1_000_000,
    savePath: '/downloads/file.zip',
    mimeType: 'application/zip',
    tabId: 'tab_1',
    ...overrides,
  };
}

describe('DownloadStateManager / started', () => {
  it('creates a pending entry on started event', () => {
    const { sm } = setup();
    const item = sm.apply(started('dl_1'));
    expect(item).not.toBeNull();
    expect(item!.state).toBe('pending');
    expect(item!.receivedBytes).toBe(0);
    expect(item!.totalBytes).toBe(1000);
    expect(item!.filename).toBe('file.zip');
  });

  it('rejects duplicate started event for the same id', () => {
    const { sm } = setup();
    sm.apply(started('dl_1'));
    const second = sm.apply(started('dl_1'));
    expect(second).toBeNull();
    expect(sm.list().length).toBe(1);
  });
});

describe('DownloadStateManager / progress', () => {
  it('transitions pending → progressing on first progress', () => {
    const { sm } = setup();
    sm.apply(started('dl_1'));
    const item = sm.apply({ type: 'progress', id: 'dl_1', receivedBytes: 100 });
    expect(item!.state).toBe('progressing');
    expect(item!.receivedBytes).toBe(100);
  });

  it('updates totalBytes when progress provides a larger value', () => {
    const { sm } = setup();
    sm.apply(started('dl_1', { totalBytes: 0 }));
    const item = sm.apply({
      type: 'progress',
      id: 'dl_1',
      receivedBytes: 50,
      totalBytes: 500,
    });
    expect(item!.totalBytes).toBe(500);
  });

  it('never decreases receivedBytes (out-of-order events are ignored)', () => {
    const { sm } = setup();
    sm.apply(started('dl_1'));
    sm.apply({ type: 'progress', id: 'dl_1', receivedBytes: 500 });
    const item = sm.apply({ type: 'progress', id: 'dl_1', receivedBytes: 100 });
    expect(item!.receivedBytes).toBe(500);
  });

  it('rejects progress for unknown id', () => {
    const { sm } = setup();
    const item = sm.apply({ type: 'progress', id: 'unknown', receivedBytes: 1 });
    expect(item).toBeNull();
  });

  it('rejects progress after terminal state', () => {
    const { sm } = setup();
    sm.apply(started('dl_1'));
    sm.apply({ type: 'completed', id: 'dl_1', endTime: 2_000_000 });
    const item = sm.apply({ type: 'progress', id: 'dl_1', receivedBytes: 500 });
    expect(item).toBeNull();
  });
});

describe('DownloadStateManager / terminal states', () => {
  it('handles completed transition', () => {
    const { sm } = setup();
    sm.apply(started('dl_1'));
    const item = sm.apply({ type: 'completed', id: 'dl_1', endTime: 2_000_000 });
    expect(item!.state).toBe('completed');
    expect(item!.endTime).toBe(2_000_000);
  });

  it('marks receivedBytes as totalBytes if final value was missing', () => {
    const { sm } = setup();
    sm.apply(started('dl_1', { totalBytes: 1000 }));
    // No progress event ever fired.
    const item = sm.apply({ type: 'completed', id: 'dl_1', endTime: 2_000_000 });
    expect(item!.receivedBytes).toBe(1000);
  });

  it('handles cancelled transition', () => {
    const { sm } = setup();
    sm.apply(started('dl_1'));
    const item = sm.apply({ type: 'cancelled', id: 'dl_1', endTime: 2_000_000 });
    expect(item!.state).toBe('cancelled');
  });

  it('handles interrupted transition with error message', () => {
    const { sm } = setup();
    sm.apply(started('dl_1'));
    const item = sm.apply({
      type: 'interrupted',
      id: 'dl_1',
      endTime: 2_000_000,
      error: 'network_down',
    });
    expect(item!.state).toBe('interrupted');
    expect(item!.error).toBe('network_down');
  });

  it('rejects terminal event for unknown id', () => {
    const { sm } = setup();
    expect(
      sm.apply({ type: 'completed', id: 'unknown', endTime: 0 })
    ).toBeNull();
    expect(
      sm.apply({ type: 'cancelled', id: 'unknown', endTime: 0 })
    ).toBeNull();
    expect(
      sm.apply({ type: 'interrupted', id: 'unknown', endTime: 0, error: 'x' })
    ).toBeNull();
  });

  it('rejects terminal event after terminal state', () => {
    const { sm } = setup();
    sm.apply(started('dl_1'));
    sm.apply({ type: 'completed', id: 'dl_1', endTime: 2_000_000 });
    expect(
      sm.apply({ type: 'cancelled', id: 'dl_1', endTime: 3_000_000 })
    ).toBeNull();
  });
});

describe('DownloadStateManager / removed', () => {
  it('removes the entry from the list', () => {
    const { sm } = setup();
    sm.apply(started('dl_1'));
    const removed = sm.apply({ type: 'removed', id: 'dl_1' });
    expect(removed).not.toBeNull();
    expect(sm.list().length).toBe(0);
  });

  it('returns null for unknown id', () => {
    const { sm } = setup();
    expect(sm.apply({ type: 'removed', id: 'unknown' })).toBeNull();
  });
});

describe('DownloadStateManager / queries', () => {
  it('list preserves insertion order', () => {
    const { sm } = setup();
    sm.apply(started('dl_1'));
    sm.apply(started('dl_2'));
    sm.apply(started('dl_3'));
    const ids = sm.list().map((d) => d.id);
    expect(ids).toEqual(['dl_1', 'dl_2', 'dl_3']);
  });

  it('active() returns only non-terminal downloads', () => {
    const { sm } = setup();
    sm.apply(started('dl_1'));
    sm.apply(started('dl_2'));
    sm.apply({ type: 'completed', id: 'dl_2', endTime: 2_000_000 });
    sm.apply(started('dl_3'));
    sm.apply({ type: 'cancelled', id: 'dl_3', endTime: 3_000_000 });
    const active = sm.active();
    expect(active.map((d) => d.id)).toEqual(['dl_1']);
  });

  it('finished() returns only terminal downloads', () => {
    const { sm } = setup();
    sm.apply(started('dl_1'));
    sm.apply(started('dl_2'));
    sm.apply({ type: 'completed', id: 'dl_2', endTime: 2_000_000 });
    const finished = sm.finished();
    expect(finished.map((d) => d.id)).toEqual(['dl_2']);
  });

  it('get() returns a single download by id', () => {
    const { sm } = setup();
    sm.apply(started('dl_1'));
    expect(sm.get('dl_1')).not.toBeNull();
    expect(sm.get('unknown')).toBeNull();
  });
});

describe('DownloadStateManager / clear', () => {
  it('clears all entries', () => {
    const { sm } = setup();
    sm.apply(started('dl_1'));
    sm.apply(started('dl_2'));
    sm.clear();
    expect(sm.list().length).toBe(0);
  });
});

describe('DownloadStateManager / limit enforcement', () => {
  it('drops oldest entries beyond the configured limit', () => {
    const sm = new DownloadStateManager(makeIdGen('dl'), 3);
    sm.apply(started('dl_1'));
    sm.apply(started('dl_2'));
    sm.apply(started('dl_3'));
    sm.apply(started('dl_4'));
    const ids = sm.list().map((d) => d.id);
    expect(ids).toEqual(['dl_2', 'dl_3', 'dl_4']);
  });
});

describe('DownloadStateManager / generateDownloadId', () => {
  it('produces unique ids across rapid calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateDownloadId());
    }
    // Should be 1000 unique ids. (Date.now + counter makes this reliable.)
    expect(ids.size).toBe(1000);
  });
});
