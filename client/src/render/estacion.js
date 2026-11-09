// Orbital Station en 3D. Cada obstáculo del servidor (x, y, ancho, alto, tipo)
// se dibuja con su forma; su huella en el piso coincide con la colisión. Lo que
// está por encima (pasarelas, torres, antenas) es decorado y no estorba.
import * as THREE from "three";
import { aMundo } from "./coordenadas.js";
import { CIAN, COLOR_EQUIPO, NARANJA, acero, conTextura, emisivo, texAdvertencia, texCorrugado,
  texHalo, texPanel, texPiso } from "./materiales.js";

const COLORES_CONTENEDOR = [0xb5532a, 0x55606f, 0x2c5a8c, 0x8a8f99, 0x9c3b2e];

export function construirEstacion(escena, mapa, calidad) {
  const raiz = new THREE.Group();
  raiz.name = "estacion";
  const ocluibles = [];            // grupos que se desvanecen si tapan a una nave
  const animados = [];
  const T = mapa.tamano;

  // ---------------------------------------------------------------- piso y bordes
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(T, T), conTextura(texPiso(), 12.5, 12.5,
    { metalness: 0.55, roughness: 0.62 }));
  piso.rotation.x = -Math.PI / 2;
  piso.receiveShadow = true;
  raiz.add(piso);

  // franjas de carril y bordes de advertencia en el piso
  const adv = new THREE.MeshStandardMaterial({ map: texAdvertencia().clone(), metalness: 0.3, roughness: 0.7 });
  adv.map.repeat.set(30, 1);
  adv.map.needsUpdate = true;
  for (const [x, z, w, d, rot] of [[0, -T / 2 + 0.6, T, 1.2, 0], [0, T / 2 - 0.6, T, 1.2, 0],
    [-T / 2 + 0.6, 0, T, 1.2, Math.PI / 2], [T / 2 - 0.6, 0, T, 1.2, Math.PI / 2]]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), adv);
    f.rotation.set(-Math.PI / 2, 0, rot);
    f.position.set(x, 0.02, z);
    f.receiveShadow = true;
    raiz.add(f);
  }
  // líneas tenues (la cuadrícula queda como detalle, no como protagonista)
  const rejilla = new THREE.GridHelper(T, 25, 0x2a3a55, 0x1a2436);
  rejilla.material.transparent = true;
  rejilla.material.opacity = 0.25;
  rejilla.position.y = 0.015;
  raiz.add(rejilla);

  // base de la estación bajo la arena
  const base = new THREE.Mesh(new THREE.BoxGeometry(T + 14, 6, T + 14), acero(0x1b1f27, 0.6));
  base.position.y = -3.02;
  raiz.add(base);
  const placaInf = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.55, T * 0.35, 14, 8), acero(0x15181f, 0.7));
  placaInf.position.y = -13;
  raiz.add(placaInf);

  // barandal perimetral con franja de luz
  const matBarandal = acero(0x59606d, 0.4);
  const luzBorde = emisivo(CIAN, 1.4);
  for (const [x, z, w, d] of [[0, -T / 2 - 0.6, T + 2.4, 1.2], [0, T / 2 + 0.6, T + 2.4, 1.2],
    [-T / 2 - 0.6, 0, 1.2, T], [T / 2 + 0.6, 0, 1.2, T]]) {
    const muro = new THREE.Mesh(new THREE.BoxGeometry(w, 1.8, d), conTextura(texPanel(), Math.max(w, d) / 6, 0.5));
    muro.position.set(x, 0.9, z);
    muro.receiveShadow = muro.castShadow = true;
    raiz.add(muro);
    const franja = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.1, d + 0.02), luzBorde);
    franja.position.set(x, 1.45, z);
    raiz.add(franja);
    const tope = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d + 0.3), matBarandal);
    tope.position.set(x, 1.86, z);
    raiz.add(tope);
  }

  // ---------------------------------------------------------------- bases de equipo
  for (const [eq, puntos] of Object.entries(mapa.apariciones)) {
    const color = COLOR_EQUIPO[eq];
    for (const [px, py] of puntos) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.12, 6), acero(0x2d333e, 0.4));
      pad.position.copy(aMundo(px, py, 0.06));
      raiz.add(pad);
      const anillo = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.35, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
      anillo.rotation.x = -Math.PI / 2;
      anillo.position.copy(aMundo(px, py, 0.14));
      raiz.add(anillo);
    }
    const xs = puntos.map((p) => p[0]), ys = puntos.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const zona = new THREE.Mesh(new THREE.PlaneGeometry(9, 30), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08 }));
    zona.rotation.x = -Math.PI / 2;
    zona.position.copy(aMundo(cx, cy, 0.03));
    raiz.add(zona);
    const luz = new THREE.PointLight(color, 60, 26, 1.7);
    luz.position.copy(aMundo(cx + (eq === "azul" ? 3 : -3), cy, 5));
    raiz.add(luz);
    // puerta del hangar de cada equipo, detrás de la base (fuera de la arena)
    const puerta = new THREE.Group();
    const marco = new THREE.Mesh(new THREE.BoxGeometry(2.5, 9, 26), conTextura(texPanel(), 4, 1.5));
    const hoja = new THREE.Mesh(new THREE.PlaneGeometry(18, 6), emisivo(color, 0.6));
    hoja.rotation.y = eq === "azul" ? Math.PI / 2 : -Math.PI / 2;
    hoja.position.x = eq === "azul" ? 1.3 : -1.3;
    puerta.add(marco, hoja);
    puerta.position.copy(aMundo(eq === "azul" ? -4.5 : T + 4.5, cy, 4.5));
    raiz.add(puerta);
  }

  // ---------------------------------------------------------------- reactor central (solo luz)
  const reactor = new THREE.Group();
  reactor.position.copy(aMundo(T / 2, T / 2, 0));
  const rejillaR = new THREE.Mesh(new THREE.CircleGeometry(3.6, 40), acero(0x22262e, 0.5));
  rejillaR.rotation.x = -Math.PI / 2; rejillaR.position.y = 0.03;
  const brillo = new THREE.Mesh(new THREE.CircleGeometry(2.6, 40), emisivo(CIAN, 1.4));
  brillo.rotation.x = -Math.PI / 2; brillo.position.y = 0.04;
  const aro1 = new THREE.Mesh(new THREE.RingGeometry(3.4, 3.7, 48), emisivo(CIAN, 2));
  aro1.rotation.x = -Math.PI / 2; aro1.position.y = 0.05;
  for (let k = 0; k < 8; k++) {
    const barra = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.06, 0.12), acero(0x111318, 0.5));
    barra.rotation.y = (k / 8) * Math.PI;
    barra.position.y = 0.06;
    reactor.add(barra);
  }
  const holo = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.05, 6, 48),
    new THREE.MeshBasicMaterial({ color: CIAN, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending }));
  holo.rotation.x = Math.PI / 2; holo.position.y = 11;
  const holo2 = holo.clone(); holo2.scale.setScalar(0.65); holo2.position.y = 12.2;
  reactor.add(rejillaR, brillo, aro1, holo, holo2);
  const luzReactor = new THREE.PointLight(CIAN, 70, 22, 1.6);
  luzReactor.position.y = 3;
  reactor.add(luzReactor);
  raiz.add(reactor);
  animados.push((t) => {
    holo.rotation.z = t * 0.4; holo2.rotation.z = -t * 0.7;
    brillo.material.emissiveIntensity = 1.2 + Math.sin(t * 2.2) * 0.35;
    luzReactor.intensity = 60 + Math.sin(t * 2.2) * 12;
  });

  // ---------------------------------------------------------------- obstáculos
  mapa.obstaculos.forEach(([x, y, w, h], i) => {
    const tipo = mapa.tipos?.[i] ?? "bloque";
    const g = (PIEZAS[tipo] ?? PIEZAS.bloque)(w, h, i);
    g.position.copy(aMundo(x + w / 2, y + h / 2, 0));
    g.traverse((o) => { if (o.isMesh) { o.castShadow = calidad.sombras; o.receiveShadow = true; } });
    g.userData.ocluible = true;
    raiz.add(g);
    ocluibles.push(g);
    if (g.userData.animar) animados.push(g.userData.animar);
  });

  // ---------------------------------------------------------------- decorado elevado
  for (const pas of [[[23, 22], [77, 22]], [[23, 78], [77, 78]]]) {
    const p = pasarela(pas);
    raiz.add(p);
    ocluibles.push(p);
  }
  for (const [x, y, alto] of [[-9, -9, 26], [109, 109, 26], [109, -9, 20], [-9, 109, 20], [50, -14, 14], [50, 114, 14]]) {
    raiz.add(torre(aMundo(x, y), alto));
  }
  const luces = balizas(T);
  raiz.add(luces.grupo);
  animados.push(luces.animar);

  escena.add(raiz);
  return {
    raiz, ocluibles,
    actualizar(t) { for (const f of animados) f(t); },
  };
}

// ---------------------------------------------------------------- piezas por tipo
function caja(w, al, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, al, d), mat);
  m.position.set(x, y, z);
  return m;
}

const PIEZAS = {
  muro(w, h) {
    const g = new THREE.Group();
    const alto = 5;
    const largo = Math.max(w, h), ancho = Math.min(w, h), horiz = w >= h;
    const panel = conTextura(texPanel(), largo / 4, 1.3);
    const cuerpo = caja(horiz ? w : w * 0.82, alto, horiz ? h * 0.82 : h, panel, 0, alto / 2, 0);
    g.add(cuerpo);
    const matContra = acero(0x3c424e, 0.5);
    const n = Math.max(2, Math.round(largo / 3.5));
    for (let k = 0; k < n; k++) {                         // contrafuertes
      const t = (k / (n - 1) - 0.5) * (largo - 1);
      const c = caja(horiz ? 0.8 : ancho, alto + 0.4, horiz ? ancho : 0.8, matContra, horiz ? t : 0, (alto + 0.4) / 2, horiz ? 0 : t);
      g.add(c);
    }
    g.add(caja(horiz ? w + 0.1 : w * 0.86, 0.12, horiz ? h * 0.86 : h + 0.1, emisivo(0x8a6bff, 1.8), 0, alto - 0.5, 0));
    g.add(caja(horiz ? w + 0.2 : w + 0.15, 0.35, horiz ? h + 0.15 : h + 0.2, acero(0x2b3039, 0.6), 0, 0.17, 0));
    return g;
  },

  bloque(w, h) {
    const g = new THREE.Group();
    const alto = 3.2;
    g.add(caja(w, alto, h, conTextura(texPanel(), w / 3, 1), 0, alto / 2, 0));
    const tapa = caja(w - 0.6, 0.35, h - 0.6, acero(0x5c6474, 0.4), 0, alto + 0.17, 0);
    g.add(tapa);
    const adv = new THREE.MeshStandardMaterial({ map: texAdvertencia(), metalness: 0.4, roughness: 0.6 });
    g.add(caja(w + 0.05, 0.4, h + 0.05, adv, 0, 0.55, 0));
    g.add(caja(1.2, 0.5, 0.8, acero(0x2a2e36), w / 4, alto + 0.6, 0));    // equipo en el techo
    g.add(caja(0.25, 0.25, 0.25, emisivo(NARANJA, 2.5), -w / 3, alto + 0.5, h / 3));
    return g;
  },

  contenedores(w, h, i) {
    const g = new THREE.Group();
    const horiz = w >= h, largo = Math.max(w, h), n = Math.max(1, Math.round(largo / 4));
    for (let k = 0; k < n; k++) {
      const t = ((k + 0.5) / n - 0.5) * largo;
      const c = contenedor(largo / n - 0.15, Math.min(w, h) - 0.1, COLORES_CONTENEDOR[(i + k) % COLORES_CONTENEDOR.length]);
      c.rotation.y = horiz ? 0 : Math.PI / 2;
      c.position.set(horiz ? t : 0, 0, horiz ? 0 : t);
      g.add(c);
    }
    const arriba = contenedor(largo / n - 0.15, Math.min(w, h) - 0.1, COLORES_CONTENEDOR[(i + 3) % COLORES_CONTENEDOR.length]);
    arriba.rotation.y = (horiz ? 0 : Math.PI / 2) + 0.06;
    arriba.position.y = 2.6;
    g.add(arriba);
    return g;
  },

  contenedor(w, h, i) {
    const g = new THREE.Group();
    const horiz = w >= h;
    const c = contenedor(Math.max(w, h) - 0.1, Math.min(w, h) - 0.1, COLORES_CONTENEDOR[i % COLORES_CONTENEDOR.length]);
    c.rotation.y = horiz ? 0 : Math.PI / 2;
    g.add(c);
    return g;
  },

  barrera(w, h) {
    const g = new THREE.Group();
    const horiz = w >= h, largo = Math.max(w, h), ancho = Math.min(w, h);
    const forma = new THREE.Shape();
    forma.moveTo(-ancho / 2, 0); forma.lineTo(ancho / 2, 0); forma.lineTo(ancho / 2 * 0.55, 1.9);
    forma.lineTo(-ancho / 2 * 0.55, 1.9); forma.lineTo(-ancho / 2, 0);
    const geo = new THREE.ExtrudeGeometry(forma, { depth: largo, bevelEnabled: false });
    geo.translate(0, 0, -largo / 2);
    const m = new THREE.Mesh(geo, conTextura(texPanel(), 0.6, largo / 4));
    if (horiz) m.rotation.y = Math.PI / 2;
    g.add(m);
    const luz = caja(horiz ? largo : 0.1, 0.08, horiz ? 0.1 : largo, emisivo(NARANJA, 2), 0, 1.6, 0);
    g.add(luz);
    return g;
  },

  pilar(w, h) {
    const g = new THREE.Group();
    const r = Math.min(w, h) / 2;
    const alto = 11;
    const fuste = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.8, alto, 8), conTextura(texPanel(), 2, 3));
    fuste.position.y = alto / 2;
    g.add(fuste);
    g.add(caja(w, 0.8, h, acero(0x3a404b, 0.5), 0, 0.4, 0));
    g.add(caja(w * 0.95, 0.6, h * 0.95, acero(0x3a404b, 0.5), 0, alto, 0));
    for (const y of [2.2, 6, 9.4]) {
      const aro = new THREE.Mesh(new THREE.TorusGeometry(r * 0.78, 0.07, 6, 24), emisivo(CIAN, 2));
      aro.rotation.x = Math.PI / 2; aro.position.y = y;
      g.add(aro);
    }
    return g;
  },

  consola(w, h) {
    const g = new THREE.Group();
    g.add(caja(w, 1.4, h, acero(0x40474f, 0.5), 0, 0.7, 0));
    const pantalla = caja(w * 0.8, 1.1, 0.1, emisivo(0x3fb7ff, 1.6), 0, 1.9, 0);
    pantalla.rotation.x = -0.4;
    g.add(pantalla);
    const mastil = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 6, 8), acero(0x5a616d));
    mastil.position.set(w / 3, 3.4, 0);
    g.add(mastil);
    const plato = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), acero(0x9aa1ad, 0.3, { side: THREE.DoubleSide }));
    plato.position.set(w / 3, 6.4, 0);
    plato.rotation.x = Math.PI * 0.85;
    g.add(plato);
    const baliza = caja(0.2, 0.2, 0.2, emisivo(0xff3b4e, 3), w / 3, 6.5, 0);
    g.add(baliza);
    g.userData.animar = (t) => { plato.rotation.z = t * 0.4; baliza.visible = Math.sin(t * 4) > 0; };
    return g;
  },

  caja(w, h) {
    const g = new THREE.Group();
    const mat = acero(0x6b5a40, 0.7, { metalness: 0.3 });
    g.add(caja(w, 1.4, h, mat, 0, 0.7, 0));
    g.add(caja(w * 0.6, 1.0, h * 0.6, mat, 0.2, 1.9, -0.2));
    g.add(caja(w + 0.04, 0.12, h + 0.04, acero(0x2b2f36), 0, 1.2, 0));
    return g;
  },

  nucleo(w, h) {
    const g = new THREE.Group();
    g.add(caja(w, 2.4, h, conTextura(texPanel(), 1.5, 1), 0, 1.2, 0));
    for (let k = 0; k < 3; k++) {
      const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.6, 12), acero(0x2a2f38, 0.4));
      bob.position.set((k - 1) * 1.4, 3.2, 0);
      g.add(bob);
      const luz = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.15, 12), emisivo(CIAN, 2.6));
      luz.position.set((k - 1) * 1.4, 3.2, 0);
      g.add(luz);
    }
    const tubo = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, w + 1, 10), acero(0x8a919c, 0.3));
    tubo.rotation.z = Math.PI / 2; tubo.position.set(0, 2.1, h / 2 + 0.2);
    g.add(tubo);
    return g;
  },
};

function contenedor(largo, ancho, color) {
  const g = new THREE.Group();
  const alto = 2.5;
  const mat = new THREE.MeshStandardMaterial({ map: texCorrugado().clone(), color, metalness: 0.55, roughness: 0.55 });
  mat.map.repeat.set(largo / 2.5, 1);
  mat.map.needsUpdate = true;
  g.add(caja(largo, alto, ancho, mat, 0, alto / 2, 0));
  const marco = acero(0x2c3038, 0.5);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    g.add(caja(0.18, alto + 0.02, 0.18, marco, sx * (largo / 2 - 0.05), alto / 2, sz * (ancho / 2 - 0.05)));
  }
  g.add(caja(largo + 0.02, 0.14, ancho + 0.02, marco, 0, alto - 0.05, 0));
  return g;
}

function pasarela([[x1, y1], [x2, y2]]) {
  const g = new THREE.Group();
  const a = aMundo(x1, y1, 0), b = aMundo(x2, y2, 0);
  const largo = a.distanceTo(b);
  const alto = 11;
  const viga = new THREE.Mesh(new THREE.BoxGeometry(largo, 0.5, 2.6), acero(0x3a414d, 0.5));
  viga.position.set(0, alto, 0);
  g.add(viga);
  const luz = emisivo(CIAN, 1.6);
  for (const s of [1, -1]) {
    g.add(caja(largo, 0.08, 0.08, luz, 0, alto + 0.3, s * 1.25));
    g.add(caja(largo, 0.9, 0.08, acero(0x59606d, 0.4, { transparent: true, opacity: 0.6 }), 0, alto + 0.7, s * 1.3));
  }
  for (let k = 0; k <= 8; k++) {
    const tr = caja(0.12, 0.5, 2.6, acero(0x23272f), (k / 8 - 0.5) * largo, alto - 0.5, 0);
    g.add(tr);
  }
  g.position.copy(a.clone().lerp(b, 0.5));
  g.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
  return g;
}

function torre(pos, alto) {
  const g = new THREE.Group();
  const mat = acero(0x2f3540, 0.55);
  const fuste = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.4, alto, 6), mat);
  fuste.position.y = alto / 2 - 6;
  g.add(fuste);
  for (let k = 0; k < 3; k++) {
    const anillo = new THREE.Mesh(new THREE.TorusGeometry(1.8 - k * 0.2, 0.12, 6, 24), emisivo(k === 1 ? NARANJA : CIAN, 1.5));
    anillo.rotation.x = Math.PI / 2;
    anillo.position.y = alto * (0.3 + k * 0.25) - 6;
    g.add(anillo);
  }
  const antena = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 7, 6), acero(0x8f96a2));
  antena.position.y = alto - 2.5;
  g.add(antena);
  const baliza = new THREE.Sprite(new THREE.SpriteMaterial({ map: texHalo(), color: 0xff3b4e, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  baliza.position.y = alto + 1;
  baliza.scale.setScalar(2.5);
  g.add(baliza);
  g.position.copy(pos);
  return g;
}

function balizas(T) {
  const grupo = new THREE.Group();
  const lista = [];
  for (let k = 0; k < 16; k++) {
    const lado = k % 4, t = (Math.floor(k / 4) + 0.5) / 4;
    const x = lado === 0 ? t * T : lado === 1 ? T + 0.6 : lado === 2 ? t * T : -0.6;
    const y = lado === 0 ? -0.6 : lado === 1 ? t * T : lado === 2 ? T + 0.6 : t * T;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texHalo(), color: NARANJA, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.copy(aMundo(x, y, 2.1));
    s.scale.setScalar(1.6);
    grupo.add(s);
    lista.push([s, k * 0.7]);
  }
  return {
    grupo,
    animar: (t) => { for (const [s, f] of lista) s.material.opacity = 0.35 + 0.65 * Math.max(0, Math.sin(t * 3 + f)); },
  };
}
