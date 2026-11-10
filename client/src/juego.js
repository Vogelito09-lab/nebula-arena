// Sesión de partida: red, predicción del movimiento propio, interpolación de
// las demás naves, eventos (disparos, proyectiles, habilidades, bajas) y
// sincronización con la escena 3D. El servidor es autoritativo: aquí solo se
// predice el movimiento propio y se dibuja lo que el servidor confirma.
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { audio } from "./audio.js";
import { ajustes } from "./ajustes.js";
import { CLASES as CLASES_LOCALES } from "./datos-juego.js";
import { consumir, entrada, pulsada } from "./entrada.js";
import { registrarPartida } from "./estadisticas.js";
import { nombreEquipo } from "./hud.js";
import { CamaraIso } from "./render/camara.js";
import { aMundo } from "./render/coordenadas.js";
import { Efectos } from "./render/efectos.js";
import { construirEstacion } from "./render/estacion.js";
import { COLOR_EQUIPO, CIAN } from "./render/materiales.js";
import { ambienteEspacial, orientarLuces } from "./render/motor.js";
import { crearNave, liberarNave } from "./render/naves.js";

const RADIO = 1;
const ENVIO_HZ = 20;
const RETRASO_INTERP_MS = 100;
const ACELERACION = 11;              // respuesta del movimiento (1/s)
const DETECCION_CAMUFLAJE = 6;       // igual que el servidor
const ORDEN = ["interceptor", "titan", "spectre", "destroyer", "phantom"];

export class Sesion {
  /**
   * @param {object} o
   *   motor, hud, url, modo ("jugar"|"espectar"), nombre, clase, escuadron ("azul"|"rojo"|undefined),
   *   alCerrar(mensaje, error)
   */
  constructor(o) {
    Object.assign(this, o);
    this.clases = CLASES_LOCALES;
    this.id = null; this.equipo = null; this.mapa = null;
    this.x = 50; this.y = 50; this.dir = 0;
    this.vel = { x: 0, y: 0 };
    this.offset = { x: 0, y: 0 };      // suaviza correcciones y desplazamientos
    this.vivo = true; this.muertoHasta = 0; this.matadoPor = "";
    this.snaps = []; this.ultimo = null; this.pendientes = [];
    this.ping = null; this.finMostrado = false; this.inicio = performance.now();
    this.ultimoEnvio = 0; this.ultimoDisparo = 0; this.habPendiente = null; this.clasePendiente = null;
    this.claseSig = null;
    this.naves = new Map();
    this.misProyectiles = new Set();
    this.vidasPrevias = new Map();
    this.cerrada = false;
    this.pausa = false;
    this.temblor = 0;
    this._conectar();
    this._ping = setInterval(() => this._enviar({ ping: performance.now() }), 1000);
  }

  // ================================================================ red
  _conectar() {
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { this._cerrar(`URL inválida: ${e.message}`, true); return; }
    this.ws = ws;
    let abierto = false;
    ws.onopen = () => {
      abierto = true;
      if (this.modo === "jugar") {
        this.id = `p-${Math.random().toString(36).slice(2, 10)}`;
        // (0, 0) está fuera del área válida: el servidor nos coloca en la base del equipo.
        const alta = { id: this.id, x: 0, y: 0, nombre: this.nombre, clase: this.clase };
        if (this.escuadron) alta.equipo = this.escuadron;   // preferencia; el servidor decide si hay lugar
        ws.send(JSON.stringify(alta));
      }
    };
    ws.onmessage = (m) => this._recibir(JSON.parse(m.data));
    ws.onclose = (ev) => {
      if (this.cerrada) return;
      if (!abierto) return this._cerrar(`No hay servidor en ${this.url}. ¿Está corriendo server.py?`, true);
      if (ev.code === 4000) return this._cerrar("La partida está llena (10 pilotos). Prueba el modo espectador.", true);
      this._cerrar(ev.code === 1000 || ev.code === 1001 ? "Partida terminada." : `Conexión cerrada (código ${ev.code}).`,
        ev.code !== 1000 && ev.code !== 1001);
    };
  }

  _enviar(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  _cerrar(mensaje, error) {
    if (this.cerrada) return;
    this.salir();
    this.alCerrar?.(mensaje, error);
  }

  salir() {
    if (this.cerrada) return;
    this.cerrada = true;
    clearInterval(this._ping);
    if (this.ws && this.ws.readyState <= 1) this.ws.close(1000);
    entrada.activa = false;
    this._liberarEscena();
  }

  _recibir(d) {
    if (d.bienvenida) return this._bienvenida(d.bienvenida);
    if (d.pong !== undefined) { this.ping = performance.now() - d.pong; return; }
    if (d.correccion) {                         // movimiento rechazado o desplazamiento (dash)
      const { x, y } = d.correccion;
      this.offset.x += this.x - x; this.offset.y += this.y - y;
      this.x = x; this.y = y;
      return;
    }
    if (d.e) this._snapshot(d);
  }

  _bienvenida(b) {
    this.mapa = b.mapa;
    if (b.clases) this.clases = b.clases;
    this._construirEscena();
    if (this.modo === "jugar") {
      Object.assign(this, { id: b.id, equipo: b.equipo, x: b.x, y: b.y, clase: b.clase });
      this.camara.orientarPara(this.equipo);
      orientarLuces(this.escena, this.equipo);
      this.motor.renderer.shadowMap.needsUpdate = true;   // las sombras son estáticas
      this.camara.colocar(aMundo(this.x, this.y));
      this.hud.modo(nombreEquipo(this.equipo), this.equipo);
      this.hud.construirSelectorClases(this.clases, (c) => this.elegirClase(c));
      this.hud.avisoCentral(nombreEquipo(this.equipo), `${this.clases[this.clase].nombre.toUpperCase()} · PRIMERO A ${this.mapa.meta_bajas} BAJAS`);
      entrada.activa = true;
    } else {
      this.hud.modo("ESPECTADOR · WASD mueve la cámara · rueda: zoom");
      this.camara.colocar(aMundo(50, 50));
      entrada.activa = true;
    }
    this.hud.mostrar(true, this.modo);
    audio.aviso();
  }

  // ================================================================ escena
  _construirEscena() {
    this.escena = new THREE.Scene();
    ambienteEspacial(this.escena);
    this.estacion = construirEstacion(this.escena, this.mapa, this.motor.calidad);
    this.camara = new CamaraIso();
    this.efectos = new Efectos(this.escena, this.motor.calidad);
    this.motor.usar(this.escena, this.camara);

    // línea de apuntado / alcance y marcador del bombardeo
    this.lineaMira = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.14).translate(0.5, 0, 0).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false,
        blending: THREE.AdditiveBlending }));
    this.lineaMira.visible = false;
    this.escena.add(this.lineaMira);
    this.marcaBombardeo = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff5a2e, transparent: true, opacity: 0.8, depthWrite: false }));
    this.marcaBombardeo.visible = false;
    this.escena.add(this.marcaBombardeo);
  }

  _liberarEscena() {
    for (const v of this.naves.values()) this._quitarNave(v);
    this.naves.clear();
    if (!this.escena) return;
    this.escena.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material ?? [])) m.dispose();
    });
    this.escena = null;
  }

  // ================================================================ snapshots y eventos
  _snapshot(d) {
    const ahora = performance.now();
    this.snaps.push({ t: ahora, e: d.e });
    while (this.snaps.length > 40) this.snaps.shift();
    this.ultimo = d;
    this.hud.marcador(d.m, d.r, d.pr, this.mapa?.meta_bajas ?? 50);
    this.efectos?.zonasDesde(d.z);
    if (this.modo === "espectar") {
      // sin pilotos no hay partida (el reloj y los bots arrancan con el primer humano)
      // el servidor arma una exhibición solo de bots ("ex"); un servidor viejo no la tiene
      const vacia = Object.keys(d.e).length === 0;
      const situacion = vacia ? "vacia" : d.ex ? "exhibicion" : "partida";
      if (situacion !== this.situacion) {
        this.situacion = situacion;
        if (vacia) this.hud.avisoCentral("ARENA VACÍA", "LA PARTIDA EMPIEZA CUANDO ENTRA UN PILOTO · ESC PARA SALIR", 0);
        else if (d.ex) this.hud.avisoCentral("EXHIBICIÓN", "PARTIDA SOLO DE BOTS · SE REEMPLAZA CUANDO ENTRA UN PILOTO", 4000);
        else this.hud.ocultarAviso();
        this.hud.modo(d.ex ? "ESPECTADOR · EXHIBICIÓN DE BOTS" : "ESPECTADOR · WASD mueve la cámara · rueda: zoom");
      }
    }

    for (const ev of d.ev ?? []) {
      if (this._esPropio(ev)) this._evento(ev, d.e, true);
      else this.pendientes.push({ t: ahora, ev, e: d.e });
    }

    const yo = this.id && d.e[this.id];
    if (yo) {
      const vivo = yo.vida > 0;
      if (vivo && !this.vivo) {                                     // reaparición
        this.x = yo.x; this.y = yo.y; this.vel = { x: 0, y: 0 }; this.offset = { x: 0, y: 0 };
        this.claseSig = null;
        this.camara.colocar(aMundo(this.x, this.y));
      } else if (vivo && Math.hypot(yo.x - this.x, yo.y - this.y) > 6) {   // desfase grande
        this.offset.x += this.x - yo.x; this.offset.y += this.y - yo.y;
        this.x = yo.x; this.y = yo.y;
      }
      const previa = this.vidasPrevias.get("yo");
      if (previa !== undefined && vivo && yo.vida + (yo.escudo ?? 0) < previa) {
        this.hud.dano(); audio.danoRecibido(); this.temblor = 0.25;
      }
      this.vidasPrevias.set("yo", yo.vida + (yo.escudo ?? 0));
      this.vivo = vivo;
      this.clase = yo.clase;
    }

    if (d.fin && !this.finMostrado) { this.finMostrado = true; this._fin(d.fin); }
    if (!d.fin && this.finMostrado) { this.finMostrado = false; this.hud.ocultarResultados(); this.inicio = ahora; }
  }

  _esPropio(ev) {
    if (!this.id) return false;
    if (ev.tipo === "proy" && ev.de === this.id) { this.misProyectiles.add(ev.id); return true; }
    if (ev.tipo === "proy_fin") return this.misProyectiles.has(ev.id);
    if (ev.tipo === "baja") return ev.a === this.id || ev.de === this.id;
    return ev.de === this.id && (ev.tipo === "disparo" || ev.tipo === "hab");
  }

  _oido(x, y) {                       // distancia y paneo respecto al oyente
    const cx = this.modo === "jugar" ? this.x : this.camara.mirada.x + 50;
    const cy = this.modo === "jugar" ? this.y : this.camara.mirada.z + 50;
    const { derecha } = this.camara.ejesPantalla();
    const dx = x - cx, dy = y - cy;
    return { distancia: Math.hypot(dx, dy), pan: (dx * derecha.x + dy * derecha.y) / 30 };
  }

  _evento(ev, e, propio = false) {
    const fx = this.efectos;
    if (!fx) return;
    const tirador = e[ev.de];
    const equipo = tirador?.equipo;
    switch (ev.tipo) {
      case "disparo": {
        let datos = ev;
        if (propio) {                          // el rayo sale de la nave predicha
          const dx = this.x - tirador.x, dy = this.y - tirador.y;
          datos = { ...ev, x1: ev.x1 + dx, y1: ev.y1 + dy };
          if (ev.impacto) { this.hud.impacto(); audio.impacto(); }
        }
        fx.rayo(datos, equipo);
        audio.disparo(ev.arma, { ...this._oido(ev.x1, ev.y1), propio });
        this._fogonazo(ev.de);
        break;
      }
      case "proy": {
        fx.disparoProyectil(ev, equipo, tirador?.clase);
        const arma = ev.arma === "misil" ? "misil" : tirador?.clase === "titan" ? "pesado"
          : tirador?.clase === "destroyer" ? "asalto" : "canon";
        audio.disparo(arma, { ...this._oido(ev.x, ev.y), propio });
        if (ev.arma !== "misil") this._fogonazo(ev.de);
        break;
      }
      case "proy_fin":
        fx.finProyectil(ev);
        if (propio) {
          this.misProyectiles.delete(ev.id);
          if (ev.impacto) { this.hud.impacto(); audio.impacto(); }
        }
        break;
      case "explosion":
        fx.explosion(ev.x, ev.y, ev.r, NARANJA_EXPL, ev.r > 4 ? 1.4 : 0.8);
        audio.explosion({ ...this._oido(ev.x, ev.y), grande: ev.r > 4 });
        if (this.modo === "jugar" && Math.hypot(ev.x - this.x, ev.y - this.y) < ev.r + 4) this.temblor = 0.3;
        break;
      case "hab":
        this._eventoHabilidad(ev, e, propio);
        break;
      case "revelado": {
        const v = this.naves.get(ev.a);
        if (v) v.revelado = 0.6;
        break;
      }
      case "baja": {
        const v = e[ev.a];
        const nave = this.naves.get(ev.a);
        if (v) fx.destruccion(nave?.x ?? v.x, nave?.y ?? v.y, v.equipo, nave?.nave);
        audio.explosion({ ...this._oido(v?.x ?? 50, v?.y ?? 50), grande: true });
        this.hud.feed(ev, e, this.id);
        if (ev.a === this.id) {
          this.muertoHasta = performance.now() + RESPAWN_MS;
          this.matadoPor = ev.de_nombre;
          this.vivo = false;
          audio.muerte();
        } else if (ev.de === this.id) {
          this.hud.impacto(true);
          audio.baja(true);
          this.hud.avisoCentral("", `ELIMINASTE A ${ev.a_nombre.toUpperCase()}`, 1200);
        } else if (ev.asist?.includes(this.nombre)) {
          audio.baja(false);
        }
        break;
      }
      case "prorroga":
        this.hud.avisoCentral("PRÓRROGA", "LA SIGUIENTE BAJA GANA", 3000);
        audio.aviso();
        break;
      default:
    }
  }

  _eventoHabilidad(ev, e, propio) {
    const fx = this.efectos;
    const color = COLOR_EQUIPO[e[ev.de]?.equipo] ?? 0xffffff;
    audio.habilidad(ev.clase, ev.hab, this._oido(ev.x, ev.y));
    const clave = `${ev.clase}-${ev.hab}`;
    if (ev.hab === "s" || clave === "interceptor-e") {
      // desplazamiento: estela entre el punto de partida y el final
      const x0 = propio ? this.x + this.offset.x : ev.x, y0 = propio ? this.y + this.offset.y : ev.y;
      if (ev.x2 !== undefined) fx.estela(x0, y0, ev.x2, ev.y2, color);
      const v = this.naves.get(ev.de);
      if (v && !propio) { v.x = ev.x2 ?? v.x; v.y = ev.y2 ?? v.y; }
      return;
    }
    switch (clave) {
      case "spectre-q": fx.pulsoArea(ev.x, ev.y, ev.r, 0x5dffb1); break;
      case "spectre-e": fx.pulsoArea(ev.x, ev.y, ev.r, 0x5dffb1); break;
      case "titan-q": fx.pulsoArea(ev.x, ev.y, 3, 0x7fd8ff); break;
      case "titan-e": fx.pulsoArea(ev.x, ev.y, 3.5, 0xffb347); break;
      case "interceptor-q": fx.pulsoArea(ev.x, ev.y, 2.5, color); break;
      case "phantom-q": if (propio) audio.carga(); break;
      case "phantom-e": fx.pulsoArea(ev.x, ev.y, 2.5, CIAN); break;
      case "destroyer-q": fx.pulsoArea(ev.ax, ev.ay, ev.r, 0xff5a2e); break;
      default:
    }
  }

  _fogonazo(id) {
    const v = this.naves.get(id);
    if (v) v.fogonazo = 0.08;
  }

  _procesarPendientes(ahora) {
    const limite = ahora - RETRASO_INTERP_MS;
    let i = 0;
    while (i < this.pendientes.length && this.pendientes[i].t <= limite) {
      const p = this.pendientes[i++];
      this._evento(p.ev, p.e, false);
    }
    if (i) this.pendientes.splice(0, i);
  }

  _fin(fin) {
    this.hud.resultados(fin, this.equipo, this.nombre);
    this.hud.muerto(false);
    if (this.modo !== "jugar") return;
    const mio = fin.jugadores.find((j) => j.nombre === this.nombre && !j.bot && j.equipo === this.equipo);
    if (mio) {
      registrarPartida({
        resultado: fin.ganador === "empate" ? "empate" : fin.ganador === this.equipo ? "victoria" : "derrota",
        clase: mio.clase, bajas: mio.bajas, muertes: mio.muertes, asist: mio.asist ?? 0,
        segundos: (performance.now() - this.inicio) / 1000,
      });
    }
  }

  // ================================================================ acciones del jugador
  elegirClase(c) {
    if (!this.clases[c] || this.modo !== "jugar") return;
    audio.ui("clic");
    this.claseSig = c;
    this.clasePendiente = c;
    this._enviarEstado(performance.now(), true);
  }

  _cfg() { return this.clases[this.clase] ?? this.clases.spectre; }

  _yo() { return this.id ? this.ultimo?.e?.[this.id] : null; }

  _multVel(yo) {
    const cfg = this._cfg(), est = yo?.est ?? {};
    let m = 1;
    if (est.impulso) m *= cfg.q.mult_vel;
    if (est.fort) m *= cfg.e.mult_vel;
    if (est.carga !== undefined) m *= cfg.q.mult_vel;
    return m;
  }

  _choca(x, y, r = RADIO) {
    const T = this.mapa.tamano;
    if (x < r || y < r || x > T - r || y > T - r) return true;
    for (const [ox, oy, w, h] of this.mapa.obstaculos) {
      const cx = Math.min(Math.max(x, ox), ox + w), cy = Math.min(Math.max(y, oy), oy + h);
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
    }
    return false;
  }

  /** Distancia libre desde (x, y) en la dirección (dx, dy) hasta la primera pared (método de las losas). */
  _distanciaPared(x, y, dx, dy, max) {
    let mejor = max;
    for (const [ox, oy, w, h] of this.mapa.obstaculos) {
      let t0 = 0, t1 = mejor;
      for (const [p, d, a, b] of [[x, dx, ox, ox + w], [y, dy, oy, oy + h]]) {
        if (Math.abs(d) < 1e-9) { if (p < a || p > b) { t0 = Infinity; break; } continue; }
        let ta = (a - p) / d, tb = (b - p) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) break;
      }
      if (t0 <= t1 && t0 < mejor) mejor = t0;
    }
    return mejor;
  }

  _direccionMovimiento() {
    let ar = 0, de = 0;
    if (pulsada("KeyW", "ArrowUp")) ar += 1;
    if (pulsada("KeyS", "ArrowDown")) ar -= 1;
    if (pulsada("KeyD", "ArrowRight")) de += 1;
    if (pulsada("KeyA", "ArrowLeft")) de -= 1;
    const { arriba, derecha } = this.camara.ejesPantalla();
    let dx = arriba.x * ar + derecha.x * de, dy = arriba.y * ar + derecha.y * de;
    const n = Math.hypot(dx, dy);
    if (n > 0) { dx /= n; dy /= n; }
    return { dx, dy, hay: n > 0 };
  }

  _moverLocal(dt, yo) {
    const { dx, dy } = this.pausa ? { dx: 0, dy: 0 } : this._direccionMovimiento();
    this.mov = { dx, dy };
    if (!this.vivo || this.finMostrado) { this.vel = { x: 0, y: 0 }; return; }
    const vmax = this._cfg().velocidad * this._multVel(yo);
    const k = Math.min(1, dt * ACELERACION);
    this.vel.x += (dx * vmax - this.vel.x) * k;
    this.vel.y += (dy * vmax - this.vel.y) * k;
    const nx = this.x + this.vel.x * dt;
    if (!this._choca(nx, this.y)) this.x = nx; else this.vel.x = 0;
    const ny = this.y + this.vel.y * dt;
    if (!this._choca(this.x, ny)) this.y = ny; else this.vel.y = 0;

    const p = this.camara.puntoDelPiso(entrada.mouse.nx, entrada.mouse.ny);
    if (p) { this.dir = Math.atan2(p.y - this.y, p.x - this.x); this.apunta = p; }
  }

  _habilidades(teclas, ahora, yo) {
    if (!this.vivo || this.finMostrado || this.pausa || !yo) return;
    const cfg = this._cfg();
    const cd = yo.cd ?? {};
    const listo = (k) => (cd[k] ?? 0) <= 0 && !(this.usado?.[k] > ahora);
    const pedir = (k, extra = {}) => {
      if (!listo(k)) return;
      this.usado = { ...this.usado, [k]: ahora + 250 };   // evita repetir mientras llega el snapshot
      this.habPendiente = { hab: k, mdx: +this.mov.dx.toFixed(3), mdy: +this.mov.dy.toFixed(3), ...extra };
    };
    this.apuntandoBombardeo = this.clase === "destroyer" && pulsada("KeyQ") && listo("q");
    for (const t of teclas.pulsadas) {
      if (t === "KeyE") pedir("e");
      else if (t === "Space") pedir("s");
      else if (t === "KeyQ" && this.clase !== "destroyer") pedir("q");
    }
    if (this.clase === "destroyer" && teclas.soltadas.includes("KeyQ") && this.apunta) {
      const p = this._puntoBombardeo(cfg);
      pedir("q", { ax: +p.x.toFixed(2), ay: +p.y.toFixed(2) });
    }
    if (this.habPendiente) this._enviarEstado(ahora, true);
  }

  _puntoBombardeo(cfg) {
    const a = cfg.q.alcance;
    let dx = this.apunta.x - this.x, dy = this.apunta.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d > a) { dx = dx / d * a; dy = dy / d * a; }
    return { x: Math.min(99, Math.max(1, this.x + dx)), y: Math.min(99, Math.max(1, this.y + dy)) };
  }

  _enviarEstado(ahora, forzar = false) {
    if (this.modo !== "jugar" || !this.id || !this.mapa) return;
    const cad = this._cfg().arma.cadencia * 1000;
    const quiereDisparar = entrada.disparando && this.vivo && !this.finMostrado && !this.pausa;
    const tocaDisparo = quiereDisparar && ahora - this.ultimoDisparo >= cad + 6;
    if (!forzar && !tocaDisparo && ahora - this.ultimoEnvio < 1000 / ENVIO_HZ) return;
    this.ultimoEnvio = ahora;
    const msg = { id: this.id, x: +this.x.toFixed(3), y: +this.y.toFixed(3), dir: +this.dir.toFixed(4), dispara: false };
    if (this.clasePendiente) { msg.clase = this.clasePendiente; this.clasePendiente = null; }
    if (this.vivo && !this.finMostrado) {
      if (quiereDisparar) {
        msg.dispara = true;
        if (tocaDisparo) this.ultimoDisparo = ahora;
      }
      if (this.habPendiente) { Object.assign(msg, this.habPendiente); this.habPendiente = null; }
    } else if (!msg.clase) return;          // muerto: solo se manda el cambio de clase
    this._enviar(msg);
  }

  // ================================================================ naves en escena
  _sincronizarNave(id, j) {
    let v = this.naves.get(id);
    if (v && v.clase !== j.clase) { this._quitarNave(v); this.naves.delete(id); v = null; }
    if (!v) {
      const nave = crearNave(j.clase, j.equipo, { sombra: true });
      this.escena.add(nave.grupo);
      const div = document.createElement("div");
      div.className = `etiqueta ${j.equipo}`;
      const nombre = document.createElement("span");
      nombre.textContent = j.nombre;
      const barra = document.createElement("i");
      const relleno = document.createElement("b");
      barra.append(relleno);
      div.append(nombre, barra);
      const etiqueta = new CSS2DObject(div);
      etiqueta.position.set(0, 3.1, 0);
      nave.grupo.add(etiqueta);
      v = { nave, clase: j.clase, equipo: j.equipo, etiqueta, relleno, x: j.x, y: j.y, vidaPrev: j.vida,
        golpe: false, revelado: 0, fogonazo: 0 };
      this.naves.set(id, v);
    }
    return v;
  }

  _quitarNave(v) {
    v.etiqueta.element.remove();
    v.nave.grupo.removeFromParent();
    liberarNave(v.nave);
  }

  _dibujarNaves(ahora, dt) {
    const s = this.snaps;
    if (!s.length) return;
    const objetivo = ahora - RETRASO_INTERP_MS;
    let a = s[0], b = s[s.length - 1];
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i - 1].t <= objetivo) { a = s[i - 1]; b = s[i]; break; }
    }
    const k = b.t > a.t ? Math.min(Math.max((objetivo - a.t) / (b.t - a.t), 0), 1) : 1;
    const vistos = new Set();
    const ultimo = s[s.length - 1].e;
    const yoMundo = this.modo === "jugar" ? { x: this.x, y: this.y } : null;
    for (const [id, jb] of Object.entries(b.e)) {
      const propio = id === this.id;
      const fuente = propio ? ultimo[id] ?? jb : jb;
      vistos.add(id);
      const v = this._sincronizarNave(id, fuente);
      const est = fuente.est ?? {};
      let x, y, dir;
      if (propio) {
        x = this.x + this.offset.x; y = this.y + this.offset.y; dir = this.dir;
      } else {
        const ja = a.e[id] ?? jb;
        // reaparición: sin deslizar (un dash de hasta 9 u sí se interpola)
        const salto = Math.hypot(jb.x - ja.x, jb.y - ja.y) > 12 || ja.vida <= 0;
        x = salto ? jb.x : ja.x + (jb.x - ja.x) * k;
        y = salto ? jb.y : ja.y + (jb.y - ja.y) * k;
        dir = anguloLerp(ja.dir ?? 0, jb.dir ?? 0, k);
      }
      const vivo = fuente.vida > 0;
      v.nave.grupo.visible = vivo;
      v.etiqueta.visible = vivo && !propio;
      if (!vivo) { v.vidaPrev = fuente.vida; continue; }
      // velocidad visual para alabeo y motores
      const vx = (x - v.x) / Math.max(dt, 1e-3), vy = (y - v.y) / Math.max(dt, 1e-3);
      v.x = x; v.y = y;
      const cfg = this.clases[fuente.clase] ?? this.clases.spectre;
      const rapidez = Math.min(1.6, Math.hypot(vx, vy) / cfg.velocidad);
      const fx = Math.cos(dir), fy = Math.sin(dir);
      v.nave.grupo.position.copy(aMundo(x, y));
      v.nave.giro.rotation.y = -dir;
      // camuflaje: aliados lo ven tenue; enemigos solo de cerca
      let opacidad = 1;
      if (est.camo) {
        const aliado = this.modo !== "jugar" || fuente.equipo === this.equipo;
        const cerca = yoMundo && Math.hypot(x - yoMundo.x, y - yoMundo.y) <= DETECCION_CAMUFLAJE;
        opacidad = aliado ? 0.32 : cerca ? 0.18 : 0;
      }
      if (v.revelado > 0) { v.revelado -= dt; opacidad = Math.max(opacidad, 1); }
      v.etiqueta.visible = v.etiqueta.visible && opacidad > 0.5;
      if (v.nave.sombra) v.nave.sombra.visible = opacidad > 0.1;
      if (v.nave.aro) v.nave.aro.visible = opacidad > 0.1;
      const vida = fuente.vida + (fuente.escudo ?? 0);
      const golpe = vida < v.vidaPrev;
      v.vidaPrev = vida;
      v.nave.actualizar(dt, {
        vel: rapidez,
        adelante: (vx * fx + vy * fy) / cfg.velocidad,
        lateral: (-vx * fy + vy * fx) / cfg.velocidad,
        impulso: !!est.impulso, escudo: (fuente.escudo ?? 0) > 0, fort: !!est.fort,
        carga: est.carga ?? 0, opacidad, invulnerable: !!est.invulnerable, golpe,
      });
      if (!propio) v.relleno.style.width = `${Math.max(0, fuente.vida / (fuente.vmax ?? cfg.vida)) * 100}%`;
    }
    for (const [id, v] of this.naves) if (!vistos.has(id)) { this._quitarNave(v); this.naves.delete(id); }
  }

  // ================================================================ cuadro
  cuadro(dt, ahora) {
    if (this.cerrada || !this.escena) return;
    const teclas = consumir();
    for (const t of teclas.pulsadas) {
      if (t === "Escape") { this.alternarPausa(); continue; }
      if (this.modo !== "jugar" || this.vivo || this.finMostrado) continue;
      if (/^Digit[1-5]$/.test(t)) this.elegirClase(ORDEN[+t.slice(5) - 1]);
      // pantalla de destrucción: las flechas recorren las naves
      const paso = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[t];
      if (paso) {
        const actual = this.claseSig ?? this.clase;
        this.elegirClase(ORDEN[(ORDEN.indexOf(actual) + paso + ORDEN.length) % ORDEN.length]);
      }
    }
    if (teclas.rueda) this.camara.acercar(teclas.rueda * 0.08);
    this.hud.tabla(pulsada("Tab"), this.ultimo?.e ?? {}, this.id);

    const yo = this._yo();
    if (this.modo === "jugar") {
      this._moverLocal(dt, yo);
      this._habilidades(teclas, ahora, yo);
      this._enviarEstado(ahora);
      const decae = Math.exp(-dt * 14);
      this.offset.x *= decae; this.offset.y *= decae;
      // la cámara se adelanta un poco hacia donde apunta el mouse
      let adelanto = null;
      if (this.apunta) {
        const ax = (this.apunta.x - this.x) * 0.22, ay = (this.apunta.y - this.y) * 0.22;
        const n = Math.hypot(ax, ay), max = 7;
        adelanto = n > max ? { x: ax / n * max, y: ay / n * max } : { x: ax, y: ay };
      }
      this.camara.seguir(this.x + this.offset.x, this.y + this.offset.y, dt, adelanto);
    } else {
      const { dx, dy, hay } = this._direccionMovimiento();
      if (hay) {
        const m = this.camara.mirada;
        const nx = Math.min(45, Math.max(-45, m.x + dx * 40 * dt)), nz = Math.min(45, Math.max(-45, m.z + dy * 40 * dt));
        this.camara.colocar(new THREE.Vector3(nx, 0, nz));
      }
    }
    if (this.temblor > 0) {
      this.temblor -= dt;
      const f = this.temblor * 1.6;
      this.camara.position.x += (Math.random() - 0.5) * f;
      this.camara.position.z += (Math.random() - 0.5) * f;
    }

    this._procesarPendientes(ahora);
    this._dibujarNaves(ahora, dt);
    this.efectos.actualizar(dt, ahora / 1000);
    this.estacion.actualizar(ahora / 1000);

    // paredes que tapan a las naves: se vuelven transparentes
    const puntos = [];
    if (this.modo === "jugar" && this.vivo) puntos.push({ x: this.x, y: this.y });
    for (const [id, v] of this.naves) if (id !== this.id && v.nave.grupo.visible) puntos.push(v);
    this.camara.ocluir(this.estacion.ocluibles, puntos, dt);

    this._hud(ahora, yo);
  }

  _hud(ahora, yo) {
    this.hud.red(this.ping, this.fps ?? 0, ajustes.mostrarFps);
    if (this.modo !== "jugar" || !yo) {
      this.lineaMira.visible = false;
      return;
    }
    const cfg = this._cfg();
    this.hud.clase(cfg, this.clase);
    const escudoMax = this.clase === "titan" ? cfg.q.escudo : 100;
    this.hud.vida(yo.vida, yo.vmax ?? cfg.vida, yo.escudo ?? 0, escudoMax);
    this.hud.habilidades(yo.cd, yo.est ?? {}, cfg, this.clase);
    const cad = cfg.arma.cadencia * 1000;
    const listo = Math.min(1, (ahora - this.ultimoDisparo) / cad);
    this.hud.arma(listo, yo.est?.carga, yo.est?.camo);

    // línea de alcance (más marcada para el railgun) y bombardeo
    const alc = cfg.arma.alcance;
    const vivo = this.vivo && !this.finMostrado;
    const distMouse = this.apunta ? Math.hypot(this.apunta.x - this.x, this.apunta.y - this.y) : 0;
    this.hud.mira(entrada.mouse.x, entrada.mouse.y, distMouse <= alc);
    this.lineaMira.visible = vivo && !yo.est?.camo;
    if (this.lineaMira.visible) {
      const fx = Math.cos(this.dir), fy = Math.sin(this.dir);
      const libre = this._distanciaPared(this.x + fx * 1.2, this.y + fy * 1.2, fx, fy, alc);
      this.lineaMira.position.copy(aMundo(this.x + this.offset.x + fx * 1.2, this.y + this.offset.y + fy * 1.2, 0.95));
      this.lineaMira.rotation.y = -this.dir;
      this.lineaMira.scale.set(libre, 1, this.clase === "phantom" ? 1.4 : 1);
      const m = this.lineaMira.material;
      const carga = yo.est?.carga;
      m.color.set(this.clase === "phantom" ? CIAN : COLOR_EQUIPO[this.equipo]);
      m.opacity = this.clase === "phantom" ? 0.22 + (carga ?? 0) * 0.5 : 0.12;
    }
    this.marcaBombardeo.visible = vivo && !!this.apuntandoBombardeo && !!this.apunta;
    if (this.marcaBombardeo.visible) {
      const p = this._puntoBombardeo(cfg);
      this.marcaBombardeo.position.copy(aMundo(p.x, p.y, 0.12));
      this.marcaBombardeo.scale.setScalar(cfg.q.radio);
    }

    // pantalla de destrucción con cambio de clase
    if (!this.vivo && !this.finMostrado) {
      this.hud.muerto(true, { por: this.matadoPor, falta: Math.max(0, (this.muertoHasta - ahora) / 1000),
        actual: this.clase, siguiente: this.claseSig });
    } else this.hud.muerto(false);
  }

  alternarPausa(forzar) {
    this.pausa = forzar ?? !this.pausa;
    document.getElementById("pausa").classList.toggle("oculto", !this.pausa);
    if (this.pausa) entrada.disparando = false;
  }
}

const RESPAWN_MS = 3000;
const NARANJA_EXPL = 0xff8a1f;

function anguloLerp(a, b, k) {
  let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}
