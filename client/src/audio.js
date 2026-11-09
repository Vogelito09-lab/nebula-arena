// Sonido 100 % procedural con Web Audio (sin archivos): efectos por arma,
// explosiones, interfaz y una música ambiental. Volumen general, de efectos y
// de música por separado.
import { ajustes, alCambiar } from "./ajustes.js";

class Audio {
  constructor() {
    this.ctx = null;
    this.ultimo = {};                  // limita sonidos repetidos en el mismo instante
    alCambiar(() => this._volumenes());
  }

  /** Se llama tras el primer clic/tecla (los navegadores lo exigen). */
  iniciar() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.maestro = c.createGain();
    this.compresor = c.createDynamicsCompressor();
    this.maestro.connect(this.compresor).connect(c.destination);
    this.efectos = c.createGain(); this.efectos.connect(this.maestro);
    this.musica = c.createGain(); this.musica.connect(this.maestro);
    const largo = c.sampleRate;
    this.ruido = c.createBuffer(1, largo, c.sampleRate);
    const d = this.ruido.getChannelData(0);
    for (let i = 0; i < largo; i++) d[i] = Math.random() * 2 - 1;
    this._volumenes();
    this._musica();
  }

  _volumenes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.maestro.gain.setTargetAtTime(ajustes.volGeneral, t, 0.05);
    this.efectos.gain.setTargetAtTime(ajustes.volEfectos, t, 0.05);
    this.musica.gain.setTargetAtTime(ajustes.volMusica * 0.35, t, 0.3);
  }

  // ------------------------------------------------------------ piezas
  _salida(vol, pan = 0) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.efectos);
    } else g.connect(this.efectos);
    return g;
  }

  _tono(destino, { tipo = "sine", f0, f1 = f0, dur, vol = 1, ataque = 0.004, retraso = 0 }) {
    const c = this.ctx, t = c.currentTime + retraso;
    const o = c.createOscillator(), g = c.createGain();
    o.type = tipo;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(destino);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _ruido(destino, { dur, vol = 1, filtro = "lowpass", f0 = 2000, f1 = f0, q = 0.8, retraso = 0 }) {
    const c = this.ctx, t = c.currentTime + retraso;
    const s = c.createBufferSource();
    s.buffer = this.ruido;
    s.loop = true;
    const fl = c.createBiquadFilter();
    fl.type = filtro; fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t);
    fl.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(destino);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  _limitar(clave, ms) {
    const ahora = performance.now();
    if (ahora - (this.ultimo[clave] ?? 0) < ms) return false;
    this.ultimo[clave] = ahora;
    return true;
  }

  // ------------------------------------------------------------ efectos del juego
  /** distancia: unidades del juego hasta el oyente; pan: -1..1 */
  disparo(arma, { distancia = 0, pan = 0, propio = false } = {}) {
    if (!this.ctx || !this._limitar(`d-${arma}-${propio}`, propio ? 30 : 45)) return;
    const vol = (propio ? 0.55 : 0.4) / (1 + distancia / 22);
    if (vol < 0.02) return;
    const s = this._salida(vol, pan);
    switch (arma) {
      case "pulso":
        this._tono(s, { tipo: "square", f0: 1300, f1: 220, dur: 0.09, vol: 0.35 });
        this._ruido(s, { dur: 0.05, vol: 0.25, filtro: "highpass", f0: 3000 });
        break;
      case "canon":
        this._tono(s, { tipo: "sawtooth", f0: 1900, f1: 600, dur: 0.06, vol: 0.25 });
        break;
      case "pesado":
        this._tono(s, { tipo: "sine", f0: 160, f1: 45, dur: 0.32, vol: 0.9 });
        this._tono(s, { tipo: "square", f0: 420, f1: 90, dur: 0.18, vol: 0.25 });
        this._ruido(s, { dur: 0.22, vol: 0.4, f0: 1200, f1: 200 });
        break;
      case "asalto":
        this._tono(s, { tipo: "sawtooth", f0: 700, f1: 160, dur: 0.12, vol: 0.35 });
        this._ruido(s, { dur: 0.1, vol: 0.35, f0: 2500, f1: 500 });
        break;
      case "railgun":
        this._tono(s, { tipo: "sawtooth", f0: 3200, f1: 140, dur: 0.45, vol: 0.4 });
        this._tono(s, { tipo: "sine", f0: 90, f1: 40, dur: 0.4, vol: 0.8 });
        this._ruido(s, { dur: 0.3, vol: 0.5, filtro: "bandpass", f0: 6000, f1: 800, q: 1.5 });
        break;
      case "misil":
        this._ruido(s, { dur: 0.5, vol: 0.45, filtro: "bandpass", f0: 600, f1: 2400, q: 2 });
        break;
      default:
        this._tono(s, { tipo: "square", f0: 900, f1: 200, dur: 0.08, vol: 0.3 });
    }
  }

  explosion({ distancia = 0, pan = 0, grande = false } = {}) {
    if (!this.ctx || !this._limitar(`x-${grande}`, 40)) return;
    const vol = (grande ? 1 : 0.7) / (1 + distancia / 30);
    const s = this._salida(vol, pan);
    this._ruido(s, { dur: grande ? 1.1 : 0.6, vol: 0.9, f0: 1800, f1: 60 });
    this._tono(s, { tipo: "sine", f0: 110, f1: 28, dur: grande ? 0.9 : 0.5, vol: 1 });
  }

  impacto() {               // marcador de acierto
    if (!this.ctx || !this._limitar("imp", 50)) return;
    this._tono(this._salida(0.35), { tipo: "triangle", f0: 1900, f1: 1500, dur: 0.06, vol: 0.6 });
  }

  danoRecibido() {
    if (!this.ctx || !this._limitar("dr", 90)) return;
    const s = this._salida(0.45);
    this._tono(s, { tipo: "sawtooth", f0: 140, f1: 70, dur: 0.18, vol: 0.5 });
    this._ruido(s, { dur: 0.12, vol: 0.3, f0: 900, f1: 200 });
  }

  habilidad(clase, cual, { distancia = 0, pan = 0 } = {}) {
    if (!this.ctx) return;
    const s = this._salida(0.5 / (1 + distancia / 25), pan);
    if (cual === "s" || (clase === "interceptor" && cual === "e")) {
      this._ruido(s, { dur: 0.3, vol: 0.6, filtro: "bandpass", f0: 400, f1: 3000, q: 1.2 });
      return;
    }
    const base = { interceptor: 520, titan: 180, spectre: 660, destroyer: 300, phantom: 880 }[clase] ?? 440;
    this._tono(s, { tipo: "triangle", f0: base, f1: base * 2, dur: 0.35, vol: 0.5 });
    this._tono(s, { tipo: "sine", f0: base * 1.5, f1: base * 3, dur: 0.3, vol: 0.25, retraso: 0.06 });
  }

  carga() {                 // Phantom empieza a cargar
    if (!this.ctx) return;
    this._tono(this._salida(0.3), { tipo: "sawtooth", f0: 200, f1: 1600, dur: 1.8, vol: 0.25, ataque: 0.3 });
  }

  baja(propia) {            // propia: la hizo el jugador
    if (!this.ctx) return;
    const s = this._salida(0.4);
    if (propia) {
      this._tono(s, { tipo: "triangle", f0: 880, dur: 0.12, vol: 0.5 });
      this._tono(s, { tipo: "triangle", f0: 1320, dur: 0.2, vol: 0.5, retraso: 0.09 });
    } else this._tono(s, { tipo: "sine", f0: 660, f1: 640, dur: 0.12, vol: 0.2 });
  }

  muerte() {
    if (!this.ctx) return;
    const s = this._salida(0.6);
    this._tono(s, { tipo: "sawtooth", f0: 400, f1: 50, dur: 1.1, vol: 0.5 });
  }

  aviso() {                 // prórroga, inicio
    if (!this.ctx) return;
    const s = this._salida(0.45);
    for (let k = 0; k < 3; k++) this._tono(s, { tipo: "square", f0: 740, dur: 0.12, vol: 0.3, retraso: k * 0.2 });
  }

  ui(tipo = "clic") {
    if (!this.ctx) return;
    const s = this._salida(0.25);
    if (tipo === "clic") this._tono(s, { tipo: "triangle", f0: 1200, f1: 900, dur: 0.05, vol: 0.5 });
    else this._tono(s, { tipo: "sine", f0: 500, f1: 800, dur: 0.08, vol: 0.4 });
  }

  // ------------------------------------------------------------ música ambiental
  _musica() {
    const c = this.ctx;
    const filtro = c.createBiquadFilter();
    filtro.type = "lowpass"; filtro.frequency.value = 700; filtro.Q.value = 0.7;
    filtro.connect(this.musica);
    const lfo = c.createOscillator(), lfoG = c.createGain();
    lfo.frequency.value = 0.07; lfoG.gain.value = 350;
    lfo.connect(lfoG).connect(filtro.frequency);
    lfo.start();
    const acordes = [[55, 82.4, 110, 164.8], [49, 73.4, 98, 146.8], [43.7, 65.4, 87.3, 130.8], [51.9, 77.8, 103.8, 155.6]];
    const voces = acordes[0].map((f, k) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = k % 2 ? "triangle" : "sawtooth";
      o.frequency.value = f;
      o.detune.value = (k - 1.5) * 6;
      g.gain.value = k === 0 ? 0.35 : 0.18;
      o.connect(g).connect(filtro);
      o.start();
      return o;
    });
    let i = 0;
    setInterval(() => {
      i = (i + 1) % acordes.length;
      const t = c.currentTime;
      voces.forEach((o, k) => o.frequency.setTargetAtTime(acordes[i][k], t, 1.5));
    }, 9000);
  }
}

export const audio = new Audio();
