/**
 * Áudio da chamada no Piu Desktop (renderer): microfone com cancelamento de eco do Chromium, Opus pelo
 * WebCodecs (48 kHz, 20 ms, ~24 kbps), reprodução com folga anti-oscilação e níveis de voz para a
 * animação. A voz que chega pode ser Opus (Desktop ou Android 10+) ou PCMU (Android 7–9).
 * Sem AudioWorklet (a CSP não aceita módulo por blob): captura por ScriptProcessor, que basta para voz.
 */
import { decodePcmuFloat } from '../../../mobile/src/calls/pcmu';
import { Framer, Smoother, levelOf, rmsOf, scheduleAt } from './callAudioCore';

export type Codec = 'opus' | 'pcmu';
export type AudioDevice = { id: string; label: string; kind: 'mic' | 'out' };

const RATE = 48_000;
const FRAME = 960;

export function webAudioAvailable(): boolean {
  return typeof AudioEncoder !== 'undefined' && typeof AudioDecoder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** Microfones e saídas do sistema (os nomes só aparecem depois da permissão do microfone). */
export async function listDevices(): Promise<AudioDevice[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter(d => d.kind === 'audioinput' || d.kind === 'audiooutput')
    .map(d => ({ id: d.deviceId, label: d.label, kind: d.kind === 'audioinput' ? 'mic' : 'out' }));
}

const micConstraints = (deviceId?: string): MediaStreamConstraints => ({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
});

/** Medidor do microfone para a caixa "pre" (antes de ligar). */
export class MicMeter {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private an?: AnalyserNode;
  private buf = new Float32Array(1024);
  private sm = new Smoother();
  async start(deviceId?: string) {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia(micConstraints(deviceId));
    this.ctx = new AudioContext();
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = 1024;
    this.ctx.createMediaStreamSource(this.stream).connect(this.an);
  }
  level(): number {
    if (!this.an) return 0;
    this.an.getFloatTimeDomainData(this.buf);
    return this.sm.push(levelOf(rmsOf(this.buf)), performance.now());
  }
  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    void this.ctx?.close().catch(() => {});
    this.ctx = this.stream = this.an = undefined;
  }
}

export class WebAudioEngine {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private proc?: ScriptProcessorNode;
  private enc?: AudioEncoder;
  private dec?: AudioDecoder;
  private out?: GainNode;
  private micAn?: AnalyserNode;
  private outAn?: AnalyserNode;
  private framer = new Framer(FRAME);
  private ts = 0;
  private next = 0;
  private lastSeq = -1;
  private muted = false;
  private smMine = new Smoother();
  private smTheirs = new Smoother();
  private tmp = new Float32Array(1024);
  private onFrame?: (codec: Codec, payload: Uint8Array) => void;

  constructor(private micId?: string, private outId?: string) {}

  async start(onFrame: (codec: Codec, payload: Uint8Array) => void) {
    this.stop();
    this.onFrame = onFrame;
    this.stream = await navigator.mediaDevices.getUserMedia(micConstraints(this.micId));
    const ctx = this.ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
    if (this.outId) await this.setOutput(this.outId);
    this.out = ctx.createGain();
    this.outAn = ctx.createAnalyser(); this.outAn.fftSize = 1024;
    this.out.connect(this.outAn); this.out.connect(ctx.destination);
    const src = ctx.createMediaStreamSource(this.stream);
    this.micAn = ctx.createAnalyser(); this.micAn.fftSize = 1024;
    src.connect(this.micAn);
    this.enc = new AudioEncoder({
      output: chunk => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); this.onFrame?.('opus', b); },
      error: () => {},
    });
    this.enc.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: 24_000, opus: { frameDuration: 20_000, application: 'voip' } } as AudioEncoderConfig);
    this.dec = new AudioDecoder({ output: d => this.schedule(d), error: () => {} });
    this.dec.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1 });
    // ScriptProcessor precisa estar ligado a um destino para rodar; sai mudo por um ganho 0.
    this.proc = ctx.createScriptProcessor(1024, 1, 1);
    const sink = ctx.createGain(); sink.gain.value = 0;
    src.connect(this.proc); this.proc.connect(sink); sink.connect(ctx.destination);
    this.proc.onaudioprocess = e => {
      if (this.muted || !this.enc || this.enc.state !== 'configured') return;
      this.framer.push(e.inputBuffer.getChannelData(0), f => {
        const data = new AudioData({ format: 'f32', sampleRate: RATE, numberOfFrames: FRAME, numberOfChannels: 1, timestamp: this.ts, data: f as Float32Array<ArrayBuffer> });
        this.ts += 20_000;
        this.enc!.encode(data);
        data.close();
      });
    };
  }

  play(codec: Codec, payload: Uint8Array, seq: number) {
    if (!this.ctx || seq <= this.lastSeq) return;
    this.lastSeq = seq;
    if (codec === 'pcmu') {
      const f = decodePcmuFloat(payload);
      const buf = this.ctx.createBuffer(1, f.length, 8000);
      buf.copyToChannel(f, 0);
      this.queue(buf);
      return;
    }
    if (this.dec?.state === 'configured') this.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: seq * 20_000, data: payload }));
  }

  private schedule(d: AudioData) {
    if (!this.ctx) { d.close(); return; }
    const f = new Float32Array(d.numberOfFrames);
    d.copyTo(f, { planeIndex: 0, format: 'f32-planar' });
    const buf = this.ctx.createBuffer(1, f.length, d.sampleRate);
    buf.copyToChannel(f, 0);
    d.close();
    this.queue(buf);
  }

  private queue(buf: AudioBuffer) {
    const ctx = this.ctx!, at = scheduleAt(this.next, ctx.currentTime);
    if (at === null) return;
    const s = ctx.createBufferSource();
    s.buffer = buf; s.connect(this.out!); s.start(at);
    this.next = at + buf.duration;
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.stream?.getAudioTracks().forEach(t => { t.enabled = !m; });
    if (m) this.framer.reset();
  }

  levels() {
    const now = performance.now();
    const read = (an: AnalyserNode | undefined, sm: Smoother) => {
      if (!an) return 0;
      an.getFloatTimeDomainData(this.tmp);
      return sm.push(levelOf(rmsOf(this.tmp)), now);
    };
    return { mine: this.muted ? 0 : read(this.micAn, this.smMine), theirs: read(this.outAn, this.smTheirs) };
  }

  /** Troca o microfone no meio da chamada. */
  async setMic(id: string) {
    this.micId = id;
    if (this.onFrame) await this.start(this.onFrame);
  }

  async setOutput(id: string) {
    this.outId = id;
    const c = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    await c?.setSinkId?.(id).catch(() => {});
  }

  stop() {
    if (this.proc) this.proc.onaudioprocess = null;
    try { this.enc?.state !== 'closed' && this.enc?.close(); } catch { /* já fechado */ }
    try { this.dec?.state !== 'closed' && this.dec?.close(); } catch { /* já fechado */ }
    this.stream?.getTracks().forEach(t => t.stop());
    void this.ctx?.close().catch(() => {});
    this.ctx = this.stream = this.proc = this.enc = this.dec = this.out = this.micAn = this.outAn = undefined;
    this.framer.reset();
    this.ts = 0; this.next = 0; this.lastSeq = -1;
  }
}
