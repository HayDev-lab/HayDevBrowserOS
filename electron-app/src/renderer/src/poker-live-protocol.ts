/** Pure wire/media helpers; no credentials, provider calls or DOM access. */
export function pcm16(input: Float32Array): ArrayBuffer {
  const bytes = new ArrayBuffer(input.length * 2);
  const view = new DataView(bytes);
  for (let i = 0; i < input.length; i++) {
    const x = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, Math.round(x * (x < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
export function audioSamples(bytes: ArrayBuffer): Float32Array<ArrayBuffer> {
  if (bytes.byteLength % 2) throw new Error("INVALID_PCM16_LENGTH");
  const view = new DataView(bytes);
  const samples = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < samples.length; i++)
    samples[i] = view.getInt16(i * 2, true) / 32768;
  return samples;
}
export function base64(bytes: ArrayBuffer): string {
  const values = new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < values.length; i += 8192)
    out += String.fromCharCode(...values.subarray(i, i + 8192));
  return btoa(out);
}
export function unbase64(encoded: string): ArrayBuffer {
  const raw = atob(encoded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
}
export interface LiveEvent {
  setupComplete?: object;
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  goAway?: object;
  toolCallCancellation?: { ids?: string[] };
  toolCall?: {
    functionCalls?: Array<{
      id?: string;
      name: string;
      args?: Record<string, unknown>;
    }>;
  };
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
        inlineData?: { mimeType?: string; data?: string };
      }>;
    };
  };
}
export function responseAudio(
  event: LiveEvent,
): Array<{ data: string; rate: number }> {
  const out = [];
  for (const p of event.serverContent?.modelTurn?.parts ?? []) {
    const d = p.inlineData;
    if (!d?.data || !d.mimeType?.startsWith("audio/pcm")) continue;
    const rate = Number(/rate=(\d+)/.exec(d.mimeType)?.[1] ?? 24000);
    if (rate < 8000 || rate > 96000) throw new Error("INVALID_AUDIO_RATE");
    out.push({ data: d.data, rate });
  }
  return out;
}
