import { describe, expect, it } from "vitest";
import {
  pcm16,
  audioSamples,
  base64,
  unbase64,
  responseAudio,
} from "../src/renderer/src/poker-live-protocol";
describe("Gemini Live media framing", () => {
  it("encodes signed little-endian PCM and clips samples", () => {
    const bytes = pcm16(new Float32Array([-2, -1, 0, 1, 2]));
    expect([...new Uint8Array(bytes)]).toEqual([
      0, 128, 0, 128, 0, 0, 255, 127, 255, 127,
    ]);
    const encoded = base64(bytes);
    expect([...new Uint8Array(unbase64(encoded))]).toEqual([
      ...new Uint8Array(bytes),
    ]);
    expect(audioSamples(bytes)[0]).toBe(-1);
    expect(() => audioSamples(new ArrayBuffer(3))).toThrow(
      "INVALID_PCM16_LENGTH",
    );
  });
  it("processes every simultaneous audio part and skips non-audio parts", () => {
    const event = {
      serverContent: {
        outputTranscription: { text: "spoken" },
        modelTurn: {
          parts: [
            { text: "text" },
            { inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAAA" } },
            { inlineData: { mimeType: "image/jpeg", data: "image" } },
            { inlineData: { mimeType: "audio/pcm;rate=16000", data: "BBBB" } },
          ],
        },
      },
    };
    expect(responseAudio(event)).toEqual([
      { rate: 24000, data: "AAAA" },
      { rate: 16000, data: "BBBB" },
    ]);
  });
});
