// 배경 음악
// - config.js 의 music.file 이 비어 있으면: 브라우저에서 직접 연주하는 오르골 "Jingle Bells" (작곡 1857년, 저작권 만료곡)
// - music.file 에 mp3 경로를 넣으면: 그 파일을 반복 재생 (사용할 권리가 있는 음원만 넣어 주세요)

const BEAT = 0.3; // 한 박 길이(초)
const N = { C3: 130.8, F3: 174.6, G3: 196.0, D4: 293.7, B3: 246.9, C4: 261.6, A3: 220.0,
  C5: 523.3, D5: 587.3, E5: 659.3, F5: 698.5, G5: 784.0, A5: 880.0, C6: 1046.5 };

// [음, 박자]  (Jingle Bells 후렴 두 번)
const A = [['E5',1],['E5',1],['E5',2], ['E5',1],['E5',1],['E5',2], ['E5',1],['G5',1],['C5',1.5],['D5',0.5], ['E5',4],
  ['F5',1],['F5',1],['F5',1.5],['F5',0.5], ['F5',1],['E5',1],['E5',1],['E5',0.5],['E5',0.5]];
const END1 = [['E5',1],['D5',1],['D5',1],['E5',1], ['D5',2],['G5',2]];
const END2 = [['G5',1],['G5',1],['F5',1],['D5',1], ['C5',4]];
const MELODY = [...A, ...END1, ...A, ...END2];
// 마디별 베이스 (4박 = 1마디)
const BASS = ['C3','C3','C3','C3','F3','C3','G3','G3', 'C3','C3','C3','C3','F3','C3','G3','C3'];

export class Music {
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.on = false;
    this.ctx = null;
    this.audio = null;
  }

  _initSynth() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = this.cfg.volume ?? 0.5;
    // 은은한 울림(에코)
    const delay = ctx.createDelay(); delay.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.bus.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(this.master);
    this.master.connect(ctx.destination);
    // 방울 소리용 노이즈
    const len = ctx.sampleRate * 0.2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  _bell(freq, t, dur, gain) { // 오르골 소리: 기음 + 배음, 빠르게 사라짐
    const ctx = this.ctx;
    [[1, 1], [2, 0.35], [3.01, 0.12], [4.2, 0.06]].forEach(([m, g]) => {
      const o = ctx.createOscillator(), v = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq * m;
      v.gain.setValueAtTime(0, t);
      v.gain.linearRampToValueAtTime(gain * g, t + 0.006);
      v.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.5, dur * 2.2) / m);
      o.connect(v); v.connect(this.bus);
      o.start(t); o.stop(t + 2.5);
    });
  }

  _jingle(t, gain) { // 썰매 방울
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const v = ctx.createGain();
    v.gain.setValueAtTime(gain, t); v.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    s.connect(f); f.connect(v); v.connect(this.bus);
    s.start(t); s.stop(t + 0.2);
  }

  _scheduleLoop(start) {
    let t = start;
    MELODY.forEach(([n, b]) => { this._bell(N[n], t, b * BEAT, 0.22); t += b * BEAT; });
    BASS.forEach((n, i) => {
      const bt = start + i * 4 * BEAT;
      this._bell(N[n], bt, 2 * BEAT, 0.12);
      this._bell(N[n] * 1.5, bt + 2 * BEAT, 2 * BEAT, 0.06);
      for (let k = 0; k < 8; k++) this._jingle(bt + k * BEAT * 0.5, k % 2 ? 0.025 : 0.05);
    });
    return start + BASS.length * 4 * BEAT + 2 * BEAT; // 끝나고 잠깐 쉼
  }

  _tick() {
    if (!this.on) return;
    if (this.ctx.currentTime > this.next - 1.5) this.next = this._scheduleLoop(this.next);
  }

  start() {
    if (this.on) return;
    this.on = true;
    if (this.cfg.file) {
      if (!this.audio) { this.audio = new Audio(this.cfg.file); this.audio.loop = true; this.audio.volume = this.cfg.volume ?? 0.5; }
      this.audio.play().catch(() => {});
      return;
    }
    if (!this.ctx) this._initSynth();
    this.ctx.resume();
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(this.cfg.volume ?? 0.5, this.ctx.currentTime);
    this.next = this.ctx.currentTime + 0.1;
    this._tick();
    this.timer = setInterval(() => this._tick(), 400);
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    if (this.audio) { this.audio.pause(); return; }
    clearInterval(this.timer);
    // 이미 예약된 음이 남지 않도록 오디오 자체를 잠시 멈췄다가 다음에 새로 시작
    this.ctx.suspend();
    this.ctx.close(); this.ctx = null;
  }

  toggle() { this.on ? this.stop() : this.start(); return this.on; }
}
