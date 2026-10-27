// Mic samples -> 16 kHz mono signed little-endian PCM, 32 ms packets.
class HayDevPCM16 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0);
    const source = inputs[0]?.[0];
    if (!source) return true;
    for (const sample of source) {
      this.sum += sample;
      this.count++;
      this.phase += 16000 / sampleRate;
      if (this.phase >= 1) {
        this.phase -= 1;
        const x = Math.max(-1, Math.min(1, this.sum / this.count));
        this.samples.push(Math.round(x * (x < 0 ? 32768 : 32767)));
        this.sum = 0;
        this.count = 0;
      }
      if (this.samples.length === 512) {
        const bytes = new ArrayBuffer(1024);
        const view = new DataView(bytes);
        for (let i = 0; i < 512; i++)
          view.setInt16(i * 2, this.samples[i], true);
        this.port.postMessage(bytes, [bytes]);
        this.samples = [];
      }
    }
    return true;
  }
}
registerProcessor("haydev-pcm16", HayDevPCM16);
