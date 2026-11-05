// Escena 3D de Nebula Arena (solo dibujo: las reglas viven en el servidor).
// Coordenadas del juego: (x, y) en [0, 100]. En Three.js: (x - 50, altura, y - 50).
// Pensada para gráficas integradas: resolución 1x, bloom a media resolución,
// sombras solo de los obstáculos y sombras de las naves "falsas" (un disco).
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const COLOR = { azul: 0x3d8bff, rojo: 0xff3d5e };
const MITAD = 50;
export const aMundo = (x, y, h = 0) => new THREE.Vector3(x - MITAD, h, y - MITAD);

// ---------------------------------------------------------------- texturas generadas
function texturaPiso() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#121733";
  g.fillRect(0, 0, 256, 256);
  // paneles con una ligera variación
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const l = 18 + Math.random() * 6;
    g.fillStyle = `hsl(228, 38%, ${l}%)`;
    g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
  }
  g.strokeStyle = "rgba(90, 170, 255, 0.55)";
  g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  g.strokeStyle = "rgba(90, 170, 255, 0.18)";
  g.lineWidth = 1;
  for (let k = 64; k < 256; k += 64) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 256); g.moveTo(0, k); g.lineTo(256, k); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(12.5, 12.5);                    // un panel grande cada 8 unidades
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function texturaPared() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#3a4570";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#47538a";
  g.fillRect(4, 4, 120, 56);
  g.fillRect(4, 68, 56, 56);
  g.fillRect(68, 68, 56, 56);
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.fillRect(0, 62, 128, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function texturaSombra() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(0,0,0,0.65)");
  r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------- escena
export class Escena {
  constructor(lienzo) {
    this.renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070a1c);
    this.scene.fog = new THREE.Fog(0x070a1c, 90, 220);

    this.camara = new THREE.PerspectiveCamera(48, 1, 0.1, 500);
    this.camara.position.set(0, 70, 60);
    this.camara.lookAt(0, 0, 0);

    this.etiquetas = new CSS2DRenderer();
    this.etiquetas.domElement.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:4";
    document.body.appendChild(this.etiquetas.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camara));
    // umbral alto: solo brillan las partes emisivas (aros, cañones, disparos)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.4, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.sombra = texturaSombra();
    this._luces();
    this._cielo();
    this.naves = new Map();
    this.efectos = [];
    this.mapaListo = false;
    this.orbita = null;
    this.reloj = new THREE.Clock();
    this.suelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this._geo = {
      trazador: new THREE.BoxGeometry(1, 0.12, 0.12),
      destello: new THREE.SphereGeometry(0.45, 10, 8),
    };
    window.addEventListener("resize", () => this.ajustar());
    this.ajustar();
  }

  ajustar() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(Math.round(w / 2), Math.round(h / 2));   // bloom a media resolución
    this.etiquetas.setSize(w, h);
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
  }

  _luces() {
    this.scene.add(new THREE.HemisphereLight(0xa9bcff, 0x221836, 1.25));
    const sol = new THREE.DirectionalLight(0xdde6ff, 2.2);
    sol.position.set(-35, 70, 25);
    sol.castShadow = true;
    sol.shadow.mapSize.set(1024, 1024);
    sol.shadow.bias = -0.0008;
    Object.assign(sol.shadow.camera, { left: -58, right: 58, top: 58, bottom: -58, near: 10, far: 180 });
    this.scene.add(sol);
    // luz de cada base
    for (const [eq, x] of [["azul", -44], ["rojo", 44]]) {
      const l = new THREE.PointLight(COLOR[eq], 45, 32, 1.6);
      l.position.set(x, 6, 0);
      this.scene.add(l);
    }
  }

  _cielo() {
    const n = 1200, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 230 + Math.random() * 60, t = Math.random() * Math.PI * 2, f = 0.15 + Math.random() * Math.PI * 0.4;
      pos.set([r * Math.cos(t) * Math.sin(f), r * Math.cos(f) * 0.7, r * Math.sin(t) * Math.sin(f)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaec4ff, size: 1.1, fog: false, sizeAttenuation: false })));
  }

  construirMapa(mapa) {
    if (this.mapaListo) return;
    this.mapaListo = true;
    const T = mapa.tamano;

    // piso de paneles
    const piso = new THREE.Mesh(new THREE.PlaneGeometry(T, T),
      new THREE.MeshStandardMaterial({ map: texturaPiso(), metalness: 0.35, roughness: 0.55 }));
    piso.rotation.x = -Math.PI / 2;
    piso.receiveShadow = true;
    this.scene.add(piso);

    // base exterior oscura
    const base = new THREE.Mesh(new THREE.BoxGeometry(T + 10, 3, T + 10),
      new THREE.MeshStandardMaterial({ color: 0x0b0e22, metalness: 0.5, roughness: 0.6 }));
    base.position.y = -1.52;
    this.scene.add(base);

    // muro perimetral bajo con franja luminosa
    const matMuro = new THREE.MeshStandardMaterial({ color: 0x2c3560, metalness: 0.6, roughness: 0.4 });
    const matFranja = new THREE.MeshStandardMaterial({ color: 0x4ff3ff, emissive: 0x4ff3ff, emissiveIntensity: 1.6 });
    for (const [x, z, w, d] of [[0, -T / 2 - 0.5, T + 2, 1], [0, T / 2 + 0.5, T + 2, 1], [-T / 2 - 0.5, 0, 1, T], [T / 2 + 0.5, 0, 1, T]]) {
      const muro = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), matMuro);
      muro.position.set(x, 0.8, z);
      muro.receiveShadow = true;
      const franja = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.12, d + 0.02), matFranja);
      franja.position.y = 0.55;
      muro.add(franja);
      this.scene.add(muro);
    }

    // círculo central y zonas de aparición
    const anillo = new THREE.Mesh(new THREE.RingGeometry(7.7, 8, 72),
      new THREE.MeshBasicMaterial({ color: 0x4ff3ff, transparent: true, opacity: 0.35 }));
    anillo.rotation.x = -Math.PI / 2; anillo.position.y = 0.02;
    this.scene.add(anillo);
    for (const [eq, puntos] of Object.entries(mapa.apariciones)) {
      const xs = puntos.map((p) => p[0]), ys = puntos.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const zona = new THREE.Mesh(new THREE.PlaneGeometry(9, 30),
        new THREE.MeshBasicMaterial({ color: COLOR[eq], transparent: true, opacity: 0.16 }));
      zona.rotation.x = -Math.PI / 2;
      zona.position.copy(aMundo(cx, cy, 0.02));
      this.scene.add(zona);
      const borde = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(9, 30)),
        new THREE.LineBasicMaterial({ color: COLOR[eq] }));
      borde.rotation.x = -Math.PI / 2;
      borde.position.copy(aMundo(cx, cy, 0.04));
      this.scene.add(borde);
    }

    // obstáculos: bloques con paneles, tapa clara y franja de neón
    const texPared = texturaPared();
    const matTapa = new THREE.MeshStandardMaterial({ color: 0x5a67a6, metalness: 0.4, roughness: 0.5 });
    const matNeon = new THREE.MeshStandardMaterial({ color: 0x9a7bff, emissive: 0x8a6bff, emissiveIntensity: 1.8 });
    for (const [x, y, w, h] of mapa.obstaculos) {
      const alto = Math.max(w, h) >= 10 ? 4.2 : w * h >= 30 ? 3.2 : 2.4;
      const tex = texPared.clone();
      tex.repeat.set(Math.max(w, h) / 4, alto / 4);
      tex.needsUpdate = true;
      const matLado = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.55, roughness: 0.45 });
      // caras: +x, -x, +y (tapa), -y, +z, -z
      const bloque = new THREE.Mesh(new THREE.BoxGeometry(w, alto, h),
        [matLado, matLado, matTapa, matLado, matLado, matLado]);
      bloque.position.copy(aMundo(x + w / 2, y + h / 2, alto / 2));
      bloque.castShadow = bloque.receiveShadow = true;
      const neon = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.14, h + 0.06), matNeon);
      neon.position.y = alto / 2 - 0.35;
      bloque.add(neon);
      const zocalo = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.25, h + 0.3), matMuro);
      zocalo.position.y = -alto / 2 + 0.12;
      bloque.add(zocalo);
      this.scene.add(bloque);
    }
  }

  // ---------------------------------------------------------------- naves
  _crearNave(j) {
    const color = COLOR[j.equipo] ?? 0xffffff;
    const grupo = new THREE.Group();
    const casco = new THREE.MeshStandardMaterial({ color: 0xe9edf8, metalness: 0.45, roughness: 0.3 });
    const oscuro = new THREE.MeshStandardMaterial({ color: 0x23283f, metalness: 0.7, roughness: 0.35 });
    const brillo = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.4 });
    const vidrio = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.85 });

    const sombra = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6),
      new THREE.MeshBasicMaterial({ map: this.sombra, transparent: true, depthWrite: false }));
    sombra.rotation.x = -Math.PI / 2; sombra.position.y = 0.03;

    const flotante = new THREE.Group();        // sube y baja
    const giro = new THREE.Group();            // apunta
    flotante.add(giro);

    const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.05, 0.55, 20), casco);
    cuerpo.position.y = 1.0;
    const falda = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 0.9, 0.18, 20), brillo);
    falda.position.y = 0.66;
    const cabina = new THREE.Mesh(new THREE.SphereGeometry(0.52, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), vidrio);
    cabina.position.set(0.12, 1.27, 0);
    const canon = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.22, 0.22), oscuro);
    canon.position.set(1.15, 1.05, 0);
    const punta = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 0.28), brillo);
    punta.position.set(1.88, 1.05, 0);
    const alaI = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.35), oscuro);
    alaI.position.set(-0.2, 1.0, 1.05);
    const alaD = alaI.clone(); alaD.position.z = -1.05;
    const luzI = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.14), brillo);
    luzI.position.set(-0.6, 1.0, 1.05);
    const luzD = luzI.clone(); luzD.position.z = -1.05;
    giro.add(cuerpo, falda, cabina, canon, punta, alaI, alaD, luzI, luzD);

    const aro = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.55, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    aro.rotation.x = -Math.PI / 2; aro.position.y = 0.05;

    grupo.add(sombra, aro, flotante);

    const div = document.createElement("div");
    div.className = `etiqueta-nombre ${j.equipo}`;
    const nombre = document.createElement("span");
    const barra = document.createElement("div");
    barra.className = "mini-vida";
    const relleno = document.createElement("i");
    barra.append(relleno);
    div.append(nombre, barra);
    const etiqueta = new CSS2DObject(div);
    etiqueta.position.y = 2.4;
    grupo.add(etiqueta);

    this.scene.add(grupo);
    return { grupo, flotante, giro, aro, etiqueta, nombre, relleno, equipo: j.equipo, fase: Math.random() * 6 };
  }

  actualizarNave(id, j, x, y, dir, esYo) {
    let n = this.naves.get(id);
    if (!n || n.equipo !== j.equipo) {
      if (n) this.quitarNave(id);
      n = this._crearNave(j);
      this.naves.set(id, n);
    }
    n.grupo.position.copy(aMundo(x, y));
    n.giro.rotation.y = -dir;
    const vivo = j.vida > 0;
    n.grupo.visible = vivo;
    n.etiqueta.visible = vivo && !esYo;          // CSS2DRenderer controla style.display
    if (n.nombre.textContent !== j.nombre) n.nombre.textContent = j.nombre;
    n.relleno.style.width = `${j.vida}%`;
    n.aro.material.opacity = esYo ? 1 : 0.6;
    n.aro.scale.setScalar(esYo ? 1.15 : 1);
  }

  quitarNave(id) {
    const n = this.naves.get(id);
    if (!n) return;
    n.etiqueta.element.remove();
    this.scene.remove(n.grupo);
    this.naves.delete(id);
  }

  limpiarNaves(vivos) {
    for (const id of [...this.naves.keys()]) if (!vivos.has(id)) this.quitarNave(id);
  }

  // ---------------------------------------------------------------- efectos
  _efecto(obj, vida, extra = {}) {
    this.scene.add(obj);
    this.efectos.push({ obj, vida, total: vida, ...extra });
  }

  trazador(ev, equipo) {
    const color = COLOR[equipo] ?? 0xffffff;
    const a = aMundo(ev.x1, ev.y1, 1.05), b = aMundo(ev.x2, ev.y2, 1.05);
    const largo = a.distanceTo(b);
    const rayo = new THREE.Mesh(this._geo.trazador,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    rayo.scale.set(largo, 1, 1);
    rayo.position.copy(a).lerp(b, 0.5);
    rayo.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    const halo = new THREE.Mesh(this._geo.trazador,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }));
    halo.scale.set(1, 3, 3);
    rayo.add(halo);
    this._efecto(rayo, 0.12, { hijos: [halo] });
    const destello = new THREE.Mesh(this._geo.destello, new THREE.MeshBasicMaterial({ color, transparent: true }));
    destello.position.copy(a);
    this._efecto(destello, 0.08, { crece: 1.8 });
    this.chispas(b, ev.impacto ? 0xffffff : color, ev.impacto ? 12 : 5);
  }

  chispas(pos, color, n) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3), v = [];
    for (let i = 0; i < n; i++) {
      p.set([pos.x, pos.y, pos.z], i * 3);
      v.push(new THREE.Vector3((Math.random() - 0.5) * 14, Math.random() * 9, (Math.random() - 0.5) * 14));
    }
    geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const puntos = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.35, transparent: true }));
    this._efecto(puntos, 0.4, { vel: v, propia: true });
  }

  explosion(x, y, equipo) {
    const color = COLOR[equipo] ?? 0xffffff;
    this.chispas(aMundo(x, y, 1.1), color, 36);
    this.chispas(aMundo(x, y, 1.1), 0xffd28a, 18);
    const bola = new THREE.Mesh(this._geo.destello, new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true }));
    bola.position.copy(aMundo(x, y, 1.1));
    this._efecto(bola, 0.3, { crece: 6 });
    const onda = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.6, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide }));
    onda.rotation.x = -Math.PI / 2;
    onda.position.copy(aMundo(x, y, 0.08));
    this._efecto(onda, 0.55, { crece: 9, propia: true });
  }

  _efectos(dt) {
    this.efectos = this.efectos.filter((e) => {
      e.vida -= dt;
      const k = Math.max(e.vida / e.total, 0);
      e.obj.material.opacity = k;
      if (e.hijos) for (const h of e.hijos) h.material.opacity = k * 0.6;
      if (e.vel) {
        const p = e.obj.geometry.attributes.position;
        e.vel.forEach((v, i) => {
          v.y -= 25 * dt;
          p.setXYZ(i, p.getX(i) + v.x * dt, Math.max(0.05, p.getY(i) + v.y * dt), p.getZ(i) + v.z * dt);
        });
        p.needsUpdate = true;
      }
      if (e.crece) e.obj.scale.setScalar(1 + (1 - k) * e.crece);
      if (e.vida <= 0) {
        this.scene.remove(e.obj);
        e.obj.material.dispose();
        if (e.hijos) for (const h of e.hijos) h.material.dispose();
        if (e.propia) e.obj.geometry.dispose();
        return false;
      }
      return true;
    });
  }

  // ---------------------------------------------------------------- cámara
  seguir(x, y, dt, apuntaX, apuntaY) {
    // se adelanta un poco hacia donde apuntas, para ver más del frente
    const ax = apuntaX == null ? x : x + Math.max(-8, Math.min(8, (apuntaX - x) * 0.25));
    const ay = apuntaY == null ? y : y + Math.max(-6, Math.min(6, (apuntaY - y) * 0.25));
    const objetivo = aMundo(ax, ay);
    const deseada = objetivo.clone().add(new THREE.Vector3(0, 30, 19));
    const k = 1 - Math.exp(-6 * dt);
    this.camara.position.lerp(deseada, k);
    this._mirada = (this._mirada || objetivo.clone()).lerp(objetivo, k);
    this.camara.lookAt(this._mirada);
  }

  activarOrbita() {
    if (this.orbita) return;
    this.camara.position.set(0, 75, 70);
    this.orbita = new OrbitControls(this.camara, this.renderer.domElement);
    this.orbita.target.set(0, 0, 0);
    this.orbita.maxPolarAngle = Math.PI * 0.45;
    this.orbita.minDistance = 25; this.orbita.maxDistance = 160;
    this.orbita.enableDamping = true;
  }

  desactivarOrbita() {
    if (this.orbita) { this.orbita.dispose(); this.orbita = null; }
  }

  /** Punto del suelo bajo el mouse, en coordenadas del juego. */
  puntoDelMouse(mx, my) {
    this.raycaster.setFromCamera(new THREE.Vector2(mx, my), this.camara);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.suelo, p) ? { x: p.x + MITAD, y: p.z + MITAD } : null;
  }

  dibujar() {
    const dt = Math.min(this.reloj.getDelta(), 0.1);
    this._efectos(dt);
    const t = this.reloj.elapsedTime;
    for (const n of this.naves.values()) n.flotante.position.y = Math.sin(t * 3 + n.fase) * 0.12;
    if (this.orbita) this.orbita.update();
    this.composer.render();
    this.etiquetas.render(this.scene, this.camara);
    return dt;
  }
}
