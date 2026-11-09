// Efectos visuales con pools (sin crear y destruir objetos en cada disparo):
// proyectiles, rayos, explosiones, partículas, restos y zonas de habilidades.
import * as THREE from "three";
import { aMundo } from "./coordenadas.js";
import { CIAN, COLOR_EQUIPO, NARANJA, texHalo } from "./materiales.js";

const ALTURA = 1.0;
const MAX_PARTICULAS = 1600;
const MAX_LUCES = 2;

function aditivo(color, opacidad = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacidad,
    blending: THREE.AdditiveBlending, depthWrite: false });
}

function halo(color, escala) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texHalo(), color, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(escala);
  return s;
}

export class Efectos {
  constructor(escena, calidad) {
    this.escena = escena;
    this.calidad = calidad;
    this.proyectiles = new Map();          // id -> visual
    this.libres = {};                      // pool por tipo de arma
    this.temporales = [];                  // rayos, ondas, destellos
    this.restos = [];
    this.zonas = new Map();
    this._particulas();
    this.luces = [];
    for (let k = 0; k < MAX_LUCES; k++) {
      const l = new THREE.PointLight(0xffaa55, 0, 18, 1.8);
      l.userData.vida = 0;
      escena.add(l);
      this.luces.push(l);
    }
  }

  // ---------------------------------------------------------------- partículas (un solo sistema)
  _particulas() {
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICULAS * 3);
    this.pCol = new Float32Array(MAX_PARTICULAS * 3);
    this.pVel = new Float32Array(MAX_PARTICULAS * 3);
    this.pVida = new Float32Array(MAX_PARTICULAS);
    this.pTotal = new Float32Array(MAX_PARTICULAS);
    this.pBase = new Float32Array(MAX_PARTICULAS * 3);
    this.pArrastre = new Float32Array(MAX_PARTICULAS);
    this.pPos.fill(-9999);
    g.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.pCol, 3));
    this.puntos = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.45, vertexColors: true, map: texHalo(),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.puntos.frustumCulled = false;
    this.escena.add(this.puntos);
    this.pSig = 0;
  }

  emitir(pos, color, n, { vel = 10, vida = 0.5, arriba = 4, arrastre = 2.5 } = {}) {
    n = Math.max(1, Math.round(n * this.calidad.particulas));
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.pSig; this.pSig = (this.pSig + 1) % MAX_PARTICULAS;
      const a = Math.random() * Math.PI * 2, r = Math.random() * vel;
      this.pPos.set([pos.x, pos.y, pos.z], i * 3);
      this.pVel.set([Math.cos(a) * r, Math.random() * arriba, Math.sin(a) * r], i * 3);
      const v = vida * (0.6 + Math.random() * 0.6);
      this.pVida[i] = v; this.pTotal[i] = v;
      this.pBase.set([c.r, c.g, c.b], i * 3);
      this.pArrastre[i] = arrastre;
    }
  }

  _moverParticulas(dt) {
    for (let i = 0; i < MAX_PARTICULAS; i++) {
      if (this.pVida[i] <= 0) continue;
      this.pVida[i] -= dt;
      const k3 = i * 3;
      if (this.pVida[i] <= 0) { this.pPos[k3 + 1] = -9999; continue; }
      const f = Math.max(0, 1 - this.pArrastre[i] * dt);
      this.pVel[k3] *= f; this.pVel[k3 + 2] *= f; this.pVel[k3 + 1] -= 9 * dt;
      this.pPos[k3] += this.pVel[k3] * dt;
      this.pPos[k3 + 1] = Math.max(0.05, this.pPos[k3 + 1] + this.pVel[k3 + 1] * dt);
      this.pPos[k3 + 2] += this.pVel[k3 + 2] * dt;
      const k = this.pVida[i] / this.pTotal[i];
      this.pCol[k3] = this.pBase[k3] * k; this.pCol[k3 + 1] = this.pBase[k3 + 1] * k; this.pCol[k3 + 2] = this.pBase[k3 + 2] * k;
    }
    this.puntos.geometry.attributes.position.needsUpdate = true;
    this.puntos.geometry.attributes.color.needsUpdate = true;
  }

  destelloLuz(pos, color, intensidad = 60, vida = 0.25) {
    const l = this.luces.reduce((a, b) => (a.userData.vida < b.userData.vida ? a : b));
    l.position.copy(pos).setY(pos.y + 1.5);
    l.color.set(color);
    l.userData = { vida, total: vida, max: intensidad };
    l.intensity = intensidad;
  }

  // ---------------------------------------------------------------- proyectiles
  _visualProyectil(arma, equipo) {
    const clave = `${arma}-${equipo}`;
    const pool = (this.libres[clave] ??= []);
    if (pool.length) { const v = pool.pop(); v.grupo.visible = true; return v; }
    const color = COLOR_EQUIPO[equipo] ?? 0xffffff;
    const grupo = new THREE.Group();
    let largo = 1.2, estela = false;
    if (arma === "misil") {
      const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.9, 8).rotateZ(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 0.6, roughness: 0.35 }));
      grupo.add(cuerpo, halo(NARANJA, 1.6).translateX(-0.5));
      estela = true;
    } else {
      const radio = { canon: 0.14, pesado: 0.38, asalto: 0.2 }[arma] ?? 0.14;
      largo = { canon: 1.4, pesado: 1.1, asalto: 1.0 }[arma] ?? 1.2;
      const nucleo = new THREE.Mesh(new THREE.CapsuleGeometry(radio, largo, 4, 8).rotateZ(Math.PI / 2), aditivo(0xffffff));
      const exterior = new THREE.Mesh(new THREE.CapsuleGeometry(radio * 1.9, largo * 1.1, 4, 8).rotateZ(Math.PI / 2),
        aditivo(arma === "asalto" ? NARANJA : color, 0.6));
      grupo.add(nucleo, exterior, halo(arma === "asalto" ? NARANJA : color, radio * 12));
    }
    this.escena.add(grupo);
    return { grupo, clave, estela, color };
  }

  disparoProyectil(ev, equipo, claseTirador) {
    let arma = ev.arma;
    if (arma === "canon") arma = claseTirador === "titan" ? "pesado" : claseTirador === "destroyer" ? "asalto" : "canon";
    const v = this._visualProyectil(arma, equipo);
    v.x = ev.x; v.y = ev.y; v.vx = ev.vx; v.vy = ev.vy; v.resto = ev.alc;
    v.arma = arma;
    v.grupo.position.copy(aMundo(ev.x, ev.y, ALTURA));
    v.grupo.rotation.y = -Math.atan2(ev.vy, ev.vx);
    this.proyectiles.set(ev.id, v);
    const boca = aMundo(ev.x, ev.y, ALTURA);
    this.emitir(boca, arma === "misil" ? NARANJA : v.color, arma === "pesado" ? 10 : 4, { vel: 4, vida: 0.15, arriba: 1 });
  }

  finProyectil(ev) {
    const v = this.proyectiles.get(ev.id);
    const pos = aMundo(ev.x, ev.y, ALTURA);
    if (v) {
      this.proyectiles.delete(ev.id);
      v.grupo.visible = false;
      this.libres[v.clave].push(v);
    }
    const color = v?.arma === "misil" || v?.arma === "asalto" ? NARANJA : v?.color ?? 0xffffff;
    this.emitir(pos, ev.impacto ? 0xffffff : color, ev.impacto ? 14 : 7, { vel: 9, vida: 0.35 });
    if (ev.impacto) this.emitir(pos, color, 8, { vel: 6, vida: 0.4 });
    if (v?.arma === "misil") this.explosion(ev.x, ev.y, 2.2, NARANJA, 0.6);
  }

  _moverProyectiles(dt) {
    for (const [id, v] of this.proyectiles) {
      const vel = Math.hypot(v.vx, v.vy);
      const paso = Math.min(vel * dt, v.resto);
      v.x += v.vx / vel * paso; v.y += v.vy / vel * paso; v.resto -= paso;
      v.grupo.position.copy(aMundo(v.x, v.y, ALTURA));
      if (v.estela && Math.random() < 0.8) this.emitir(v.grupo.position, 0x9a9aa8, 1, { vel: 0.6, vida: 0.6, arriba: 0.6, arrastre: 4 });
      if (v.resto <= 0) {                     // el servidor ya debió mandar proy_fin
        this.proyectiles.delete(id);
        v.grupo.visible = false;
        this.libres[v.clave].push(v);
      }
    }
  }

  // ---------------------------------------------------------------- rayos
  rayo(ev, equipo) {
    const color = COLOR_EQUIPO[equipo] ?? 0xffffff;
    const a = aMundo(ev.x1, ev.y1, ALTURA), b = aMundo(ev.x2, ev.y2, ALTURA);
    const largo = Math.max(0.01, a.distanceTo(b));
    const rail = ev.arma === "railgun";
    const grosor = rail ? 0.16 + (ev.carga ?? 0) * 0.25 : 0.07;
    const g = new THREE.Group();
    const nucleo = new THREE.Mesh(new THREE.BoxGeometry(largo, grosor, grosor), aditivo(0xffffff));
    const brillo = new THREE.Mesh(new THREE.BoxGeometry(largo, grosor * 4, grosor * 4), aditivo(rail ? CIAN : color, 0.5));
    g.add(nucleo, brillo);
    g.position.copy(a).lerp(b, 0.5);
    g.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    this.escena.add(g);
    this.temporales.push({ obj: g, vida: rail ? 0.4 : 0.09, total: rail ? 0.4 : 0.09, mats: [nucleo.material, brillo.material], ops: [1, 0.5], ancho: rail });
    const boca = halo(rail ? CIAN : color, rail ? 3.5 : 1.6);
    boca.position.copy(a);
    this.escena.add(boca);
    this.temporales.push({ obj: boca, vida: 0.08, total: 0.08, mats: [boca.material], ops: [1] });
    this.emitir(b, ev.impacto ? 0xffffff : color, ev.impacto ? 16 : 6, { vel: 9, vida: 0.3 });
    if (rail) {
      for (let k = 0; k < largo; k += 1.6) this.emitir(a.clone().lerp(b, k / largo), CIAN, 1, { vel: 1.2, vida: 0.5, arriba: 1 });
      this.destelloLuz(a, CIAN, 40, 0.15);
    }
  }

  // ---------------------------------------------------------------- explosiones
  explosion(x, y, radio, color = NARANJA, fuerza = 1) {
    const p = aMundo(x, y, ALTURA);
    const bola = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), aditivo(0xffe2b0));
    bola.position.copy(p);
    this.escena.add(bola);
    this.temporales.push({ obj: bola, vida: 0.32, total: 0.32, mats: [bola.material], ops: [1], crece: radio * 1.6 });
    const onda = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.9, 48), aditivo(color, 0.9));
    onda.rotation.x = -Math.PI / 2;
    onda.position.copy(p).setY(0.12);
    this.escena.add(onda);
    this.temporales.push({ obj: onda, vida: 0.5, total: 0.5, mats: [onda.material], ops: [0.9], crece: radio * 1.3 });
    if (radio >= 5) {                       // bombardeo: columna de fuego y segunda onda
      const columna = new THREE.Mesh(new THREE.CylinderGeometry(radio * 0.35, radio * 0.6, 14, 20, 1, true), aditivo(0xffb060, 0.7));
      columna.position.copy(p).setY(7);
      this.escena.add(columna);
      this.temporales.push({ obj: columna, vida: 0.45, total: 0.45, mats: [columna.material], ops: [0.7], crece: 0.6 });
      const onda2 = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), aditivo(0xffffff, 0.8));
      onda2.rotation.x = -Math.PI / 2;
      onda2.position.copy(p).setY(0.15);
      this.escena.add(onda2);
      this.temporales.push({ obj: onda2, vida: 0.7, total: 0.7, mats: [onda2.material], ops: [0.8], crece: radio * 1.1 });
      this.emitir(p, 0x55555e, 40, { vel: radio * 1.5, vida: 1.6, arriba: 5, arrastre: 2 });
    }
    this.emitir(p, color, 40 * fuerza, { vel: 12 * fuerza, vida: 0.7, arriba: 8 });
    this.emitir(p, 0xffd28a, 24 * fuerza, { vel: 7, vida: 0.5, arriba: 6 });
    this.emitir(p, 0x55555e, 18 * fuerza, { vel: 4, vida: 1.2, arriba: 3, arrastre: 3 });
    this.destelloLuz(p, color, 90 * fuerza, 0.3);
  }

  destruccion(x, y, equipo, nave) {
    this.explosion(x, y, 3, COLOR_EQUIPO[equipo] ?? NARANJA, 1.3);
    // restos que salen volando con el material del casco
    const mat = nave?.mats?.casco ?? new THREE.MeshStandardMaterial({ color: 0x999999 });
    for (let k = 0; k < 9; k++) {
      const s = 0.15 + Math.random() * 0.35;
      const r = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.4, s * 1.4), mat);
      r.position.copy(aMundo(x, y, 1));
      const a = Math.random() * Math.PI * 2, v = 5 + Math.random() * 8;
      r.userData = { vx: Math.cos(a) * v, vy: 4 + Math.random() * 7, vz: Math.sin(a) * v, vida: 1.6,
        rx: Math.random() * 10, rz: Math.random() * 10 };
      this.escena.add(r);
      this.restos.push(r);
    }
  }

  // ---------------------------------------------------------------- habilidades
  pulsoArea(x, y, radio, color) {
    const anillo = new THREE.Mesh(new THREE.RingGeometry(radio * 0.92, radio, 64), aditivo(color, 0.8));
    anillo.rotation.x = -Math.PI / 2;
    anillo.position.copy(aMundo(x, y, 0.15));
    anillo.scale.setScalar(0.1);
    this.escena.add(anillo);
    this.temporales.push({ obj: anillo, vida: 0.6, total: 0.6, mats: [anillo.material], ops: [0.8], abre: true });
    this.emitir(aMundo(x, y, 1), color, 30, { vel: radio * 1.2, vida: 0.5, arriba: 2 });
  }

  estela(x1, y1, x2, y2, color) {
    const a = aMundo(x1, y1, ALTURA), b = aMundo(x2, y2, ALTURA);
    for (let k = 0; k <= 10; k++) this.emitir(a.clone().lerp(b, k / 10), color, 2, { vel: 1, vida: 0.4, arriba: 0.5 });
  }

  /** Sincroniza las zonas (campos de apoyo, bombardeos) con el snapshot. */
  zonasDesde(lista) {
    const vistas = new Set();
    for (const z of lista ?? []) {
      const clave = `${z.tipo}-${z.x}-${z.y}`;
      vistas.add(clave);
      let v = this.zonas.get(clave);
      if (!v) {
        v = this._crearZona(z);
        this.zonas.set(clave, v);
      }
      v.t = z.t;
    }
    for (const [k, v] of this.zonas) {
      if (!vistas.has(k)) {
        this.escena.remove(v.grupo);
        v.grupo.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
        this.zonas.delete(k);
      }
    }
  }

  _crearZona(z) {
    const grupo = new THREE.Group();
    grupo.position.copy(aMundo(z.x, z.y, 0.1));
    if (z.tipo === "campo") {
      const color = COLOR_EQUIPO[z.equipo];
      const disco = new THREE.Mesh(new THREE.CircleGeometry(z.r, 48), aditivo(color, 0.12));
      disco.rotation.x = -Math.PI / 2;
      const borde = new THREE.Mesh(new THREE.RingGeometry(z.r - 0.25, z.r, 64), aditivo(0x5dffb1, 0.8));
      borde.rotation.x = -Math.PI / 2;
      const domo = new THREE.Mesh(new THREE.SphereGeometry(z.r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        aditivo(0x5dffb1, 0.06));
      domo.material.side = THREE.DoubleSide;
      grupo.add(disco, borde, domo);
      grupo.userData.animar = (t) => { borde.material.opacity = 0.5 + 0.3 * Math.sin(t * 5); };
    } else {
      const disco = new THREE.Mesh(new THREE.CircleGeometry(z.r, 48), aditivo(0xff3b2e, 0.18));
      disco.rotation.x = -Math.PI / 2;
      const borde = new THREE.Mesh(new THREE.RingGeometry(z.r - 0.3, z.r, 64), aditivo(0xff5a2e, 0.9));
      borde.rotation.x = -Math.PI / 2;
      const llenado = new THREE.Mesh(new THREE.CircleGeometry(z.r, 48), aditivo(0xff8a1f, 0.35));
      llenado.rotation.x = -Math.PI / 2; llenado.position.y = 0.02;
      const mira = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.7, 4), aditivo(0xffffff, 0.9));
      mira.rotation.x = -Math.PI / 2; mira.position.y = 0.03;
      grupo.add(disco, borde, llenado, mira);

      // haz de marcaje que baja del cielo
      const haz = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.5, 44, 12, 1, true), aditivo(0xff5a2e, 0.25));
      haz.position.y = 22;
      grupo.add(haz);

      // salva de obuses: cae del cielo y llega justo cuando el servidor resuelve la explosión
      const obuses = [[0, 0, 1.0, 1.0], [z.r * 0.45, z.r * 0.2, 0.55, 0.93], [-z.r * 0.3, -z.r * 0.4, 0.55, 0.87]]
        .map(([ox, oz, escala, llegada]) => {
          const o = new THREE.Group();
          const nucleo = new THREE.Mesh(new THREE.CapsuleGeometry(0.22 * escala, 1.6 * escala, 4, 8), aditivo(0xffffff));
          const brillo = new THREE.Mesh(new THREE.CapsuleGeometry(0.5 * escala, 2.2 * escala, 4, 8), aditivo(0xff8a1f, 0.55));
          o.add(nucleo, brillo, halo(0xffb060, 4 * escala));
          o.visible = false;
          grupo.add(o);
          return { o, ox, oz, escala, llegada };
        });
      const ALTURA = 36, DERIVA = 9;          // caen en diagonal, desde atrás de la cámara
      let inicio = null;
      const total = Math.max(z.t, 0.3);
      grupo.userData.animar = (t) => {
        inicio ??= t;
        const k = Math.min(1, (t - inicio) / total);   // 0 → 1 hasta el impacto
        llenado.scale.setScalar(Math.max(0.02, k));
        borde.material.opacity = 0.5 + 0.5 * Math.sin(t * (10 + k * 20));
        haz.material.opacity = 0.12 + 0.3 * k + 0.1 * Math.sin(t * 30);
        haz.scale.x = haz.scale.z = 1 - 0.6 * k;
        mira.rotation.z = t * 4;
        for (const b of obuses) {
          const f = Math.min(1, (t - inicio) / (total * b.llegada));
          const caida = f * f;                          // acelera al caer
          const h = ALTURA * (1 - caida);
          b.o.visible = f < 1;
          b.o.position.set(b.ox - DERIVA * (1 - caida), Math.max(0.3, h), b.oz - DERIVA * (1 - caida));
          b.o.lookAt(grupo.position.x + b.ox, 0, grupo.position.z + b.oz);
          b.o.rotateX(Math.PI / 2);
          if (b.o.visible && Math.random() < 0.9) {     // estela de humo y fuego
            const p = b.o.getWorldPosition(new THREE.Vector3());
            this.emitir(p, Math.random() < 0.5 ? 0xff8a1f : 0x77777f, 1, { vel: 0.8, vida: 0.7, arriba: 0.5, arrastre: 3 });
          }
          if (f >= 1 && !b.cayo) {                     // los obuses pequeños estallan antes
            b.cayo = true;
            if (b.escala < 1) {
              const p = b.o.getWorldPosition(new THREE.Vector3());
              this.emitir(p, 0xffd28a, 18, { vel: 8, vida: 0.4, arriba: 6 });
              this.destelloLuz(p, 0xff8a1f, 50, 0.15);
            }
          }
        }
      };
    }
    this.escena.add(grupo);
    return { grupo, t: z.t };
  }

  // ---------------------------------------------------------------- por cuadro
  actualizar(dt, t) {
    this._moverProyectiles(dt);
    this._moverParticulas(dt);
    this.temporales = this.temporales.filter((e) => {
      e.vida -= dt;
      const k = Math.max(0, e.vida / e.total);
      e.mats.forEach((m, i) => { m.opacity = e.ops[i] * k; });
      if (e.crece) e.obj.scale.setScalar(1 + (1 - k) * e.crece);
      if (e.abre) e.obj.scale.setScalar(Math.min(1, (1 - k) * 2.2));
      if (e.ancho) e.obj.scale.set(1, k, k);
      if (e.vida <= 0) {
        this.escena.remove(e.obj);
        e.obj.traverse((o) => { o.geometry?.dispose(); });
        e.mats.forEach((m) => m.dispose());
        return false;
      }
      return true;
    });
    this.restos = this.restos.filter((r) => {
      const u = r.userData;
      u.vida -= dt;
      u.vy -= 20 * dt;
      r.position.x += u.vx * dt; r.position.z += u.vz * dt;
      r.position.y = Math.max(0.1, r.position.y + u.vy * dt);
      if (r.position.y <= 0.1) { u.vx *= 0.9; u.vz *= 0.9; u.vy = Math.abs(u.vy) * 0.3; }
      r.rotation.x += u.rx * dt; r.rotation.z += u.rz * dt;
      if (u.vida <= 0) { this.escena.remove(r); r.geometry.dispose(); return false; }
      return true;
    });
    for (const l of this.luces) {
      if (l.userData.vida > 0) {
        l.userData.vida -= dt;
        l.intensity = l.userData.max * Math.max(0, l.userData.vida / l.userData.total);
      } else l.intensity = 0;
    }
    for (const z of this.zonas.values()) z.grupo.userData.animar?.(t, z);
  }

  limpiar() {
    for (const v of this.proyectiles.values()) { v.grupo.visible = false; this.libres[v.clave].push(v); }
    this.proyectiles.clear();
    for (const z of this.zonas.values()) this.escena.remove(z.grupo);
    this.zonas.clear();
  }
}
