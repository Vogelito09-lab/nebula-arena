// Modelos de las cinco naves. La MISMA función se usa en el hangar y en la partida.
// La nave mira hacia +X (ángulo 0 del juego). Cascos extruidos desde su silueta
// vista desde arriba, con placas, armas, motores y luces del color del equipo.
import * as THREE from "three";
import { COLOR_EQUIPO, CIAN, NARANJA, acero, emisivo, texAdvertencia, texCasco, texHalo, texSombra, vidrio } from "./materiales.js";

const ALTURA_VUELO = 0.95;

/** Casco extruido: puntos [[x(adelante), z(lado)]...] → geometría con alto y bisel. */
function casco(puntos, alto, bisel = 0.08) {
  const s = new THREE.Shape(puntos.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: alto, bevelEnabled: true, bevelThickness: bisel,
    bevelSize: bisel, bevelSegments: 2, curveSegments: 12 });
  g.rotateX(-Math.PI / 2);               // forma en XZ, extrusión hacia +Y
  g.translate(0, -alto / 2, 0);
  g.computeVertexNormals();
  return g;
}

const espejo = (pts) => [...pts, ...pts.slice().reverse().map(([x, z]) => [x, -z])];

function malla(geo, mat, x = 0, y = 0, z = 0, sombra = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = sombra;
  return m;
}

function cilindroX(r1, r2, largo, mat, x, y, z, seg = 14) {
  const g = new THREE.CylinderGeometry(r1, r2, largo, seg);
  g.rotateZ(-Math.PI / 2);               // eje hacia +X
  return malla(g, mat, x, y, z);
}

/** Motor: tobera + brillo + llama (la llama crece con la velocidad). */
function motor(nave, x, y, z, radio, color) {
  const tobera = cilindroX(radio * 0.8, radio, radio * 1.6, nave.mats.oscuro, x, y, z);
  const interior = new THREE.Mesh(new THREE.CircleGeometry(radio * 0.72, 16), emisivo(color, 3));
  interior.rotation.y = -Math.PI / 2;
  interior.position.set(x - radio * 0.81, y, z);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texHalo(), color, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(radio * 4);
  halo.position.set(x - radio * 1.0, y, z);
  const llamaGeo = new THREE.ConeGeometry(radio * 0.7, 1, 12, 1, true);
  llamaGeo.rotateZ(Math.PI / 2);
  llamaGeo.translate(-0.5, 0, 0);
  const llama = new THREE.Mesh(llamaGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  llama.position.set(x - radio * 0.8, y, z);
  nave.cuerpo.add(tobera, interior, halo, llama);
  nave.motores.push({ halo, llama, radio });
}

// ---------------------------------------------------------------- diseños
const DISENOS = {
  interceptor(n) {
    const { casco: mc, oscuro, acento } = n.mats;
    n.cuerpo.add(malla(casco([[1.45, 0], [0.25, 0.34], [-0.7, 0.44], [-0.95, 0.26],
      [-0.95, -0.26], [-0.7, -0.44], [0.25, -0.34]], 0.32), mc));
    const cabina = malla(new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), vidrio(0x8fe6ff), 0.3, 0.2, 0);
    cabina.scale.set(1.0, 0.5, 0.45);
    n.cuerpo.add(cabina);
    for (const lado of [1, -1]) {
      const ala = malla(casco([[0.15, 0.28 * lado], [-0.55, 1.18 * lado], [-0.85, 1.2 * lado], [-0.55, 0.3 * lado]], 0.05, 0.03), oscuro, 0, -0.02, 0);
      n.cuerpo.add(ala);
      n.cuerpo.add(cilindroX(0.06, 0.07, 0.95, oscuro, -0.2, 0.0, 1.1 * lado));
      n.cuerpo.add(malla(new THREE.BoxGeometry(0.12, 0.08, 0.08), acento, 0.3, 0.0, 1.1 * lado, false));
      n.canones.push(new THREE.Vector3(0.36, 0, 1.1 * lado));
      n.cuerpo.add(malla(new THREE.BoxGeometry(0.9, 0.03, 0.04), acento, -0.15, 0.17, 0.3 * lado, false));
    }
    motor(n, -1.05, 0, 0, 0.24, n.colorEquipo);
  },

  titan(n) {
    const { casco: mc, oscuro, acento } = n.mats;
    n.cuerpo.add(malla(casco([[1.15, 0.5], [0.65, 0.98], [-0.85, 0.98], [-1.25, 0.6],
      [-1.25, -0.6], [-0.85, -0.98], [0.65, -0.98], [1.15, -0.5]], 0.5, 0.12), mc));
    n.cuerpo.add(malla(casco([[0.7, 0.35], [0.35, 0.62], [-0.75, 0.62], [-0.95, 0.4],
      [-0.95, -0.4], [-0.75, -0.62], [0.35, -0.62], [0.7, -0.35]], 0.18, 0.06), oscuro, 0, 0.38, 0));
    const torreta = malla(new THREE.CylinderGeometry(0.42, 0.5, 0.3, 8), oscuro, 0.05, 0.6, 0);
    n.cuerpo.add(torreta);
    for (const lado of [1, -1]) {
      n.cuerpo.add(malla(new THREE.BoxGeometry(1.35, 0.17, 0.17), oscuro, 0.8, 0.62, 0.17 * lado));
      n.cuerpo.add(malla(new THREE.BoxGeometry(0.14, 0.22, 0.22), acento, 1.5, 0.62, 0.17 * lado, false));
      n.canones.push(new THREE.Vector3(1.55, 0.62, 0.17 * lado));
      n.cuerpo.add(cilindroX(0.28, 0.3, 1.4, mc, -0.35, -0.05, 1.08 * lado));
      n.cuerpo.add(malla(new THREE.BoxGeometry(1.1, 0.05, 0.05), acento, -0.3, 0.28, 0.98 * lado, false));
      motor(n, -1.15, -0.05, 1.08 * lado, 0.24, n.colorEquipo);
      motor(n, -1.3, 0.05, 0.45 * lado, 0.2, n.colorEquipo);
    }
    const emisor = malla(new THREE.TorusGeometry(0.22, 0.05, 8, 24), acento, -0.4, 0.62, 0, false);
    emisor.rotation.x = Math.PI / 2;
    n.cuerpo.add(emisor);
  },

  spectre(n) {
    const { casco: mc, oscuro, acento } = n.mats;
    const forma = new THREE.Shape();
    forma.moveTo(1.15, 0);
    forma.quadraticCurveTo(0.6, 0.55, 0, 0.62);
    forma.quadraticCurveTo(-0.75, 0.6, -0.85, 0);
    forma.quadraticCurveTo(-0.75, -0.6, 0, -0.62);
    forma.quadraticCurveTo(0.6, -0.55, 1.15, 0);
    const g = new THREE.ExtrudeGeometry(forma, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.12,
      bevelSize: 0.1, bevelSegments: 3, curveSegments: 18 });
    g.rotateX(-Math.PI / 2); g.translate(0, -0.18, 0); g.computeVertexNormals();
    n.cuerpo.add(malla(g, mc));
    const anillo = malla(new THREE.TorusGeometry(1.08, 0.06, 8, 48), acento, 0, 0.02, 0, false);
    anillo.rotation.x = Math.PI / 2;
    n.cuerpo.add(anillo);
    n.giratorio = anillo;
    const nucleo = malla(new THREE.OctahedronGeometry(0.22), emisivo(CIAN, 2.6), -0.1, 0.42, 0, false);
    n.cuerpo.add(nucleo);
    n.nucleo = nucleo;
    for (const lado of [1, -1]) {
      const capsula = malla(new THREE.CapsuleGeometry(0.17, 0.55, 6, 12), mc, -0.15, 0, 0.92 * lado);
      capsula.rotation.z = Math.PI / 2;
      n.cuerpo.add(capsula);
      n.cuerpo.add(malla(new THREE.BoxGeometry(0.22, 0.05, 0.05), emisivo(0x5dffb1, 2.4), -0.15, 0.18, 0.92 * lado, false));
      n.cuerpo.add(malla(new THREE.BoxGeometry(0.05, 0.05, 0.22), emisivo(0x5dffb1, 2.4), -0.15, 0.18, 0.92 * lado, false));
    }
    n.cuerpo.add(cilindroX(0.1, 0.12, 0.7, oscuro, 1.15, 0.0, 0));
    for (const x of [0.95, 1.15, 1.35]) {
      const bobina = malla(new THREE.TorusGeometry(0.14, 0.03, 6, 16), acento, x, 0, 0, false);
      bobina.rotation.y = Math.PI / 2;
      n.cuerpo.add(bobina);
    }
    n.canones.push(new THREE.Vector3(1.5, 0, 0));
    motor(n, -0.95, 0, 0.28, 0.17, n.colorEquipo);
    motor(n, -0.95, 0, -0.28, 0.17, n.colorEquipo);
  },

  destroyer(n) {
    const { casco: mc, oscuro, acento } = n.mats;
    n.cuerpo.add(malla(casco([[1.35, 0], [0.45, 0.55], [-0.3, 0.98], [-1.05, 0.78], [-0.72, 0],
      [-1.05, -0.78], [-0.3, -0.98], [0.45, -0.55]], 0.42, 0.1), mc));
    n.cuerpo.add(malla(casco([[0.6, 0], [0.1, 0.3], [-0.6, 0.3], [-0.6, -0.3], [0.1, -0.3]], 0.2, 0.05), oscuro, 0, 0.33, 0));
    const advertencia = new THREE.MeshStandardMaterial({ map: texAdvertencia(), metalness: 0.5, roughness: 0.5 });
    for (const lado of [1, -1]) {
      const vaina = malla(new THREE.BoxGeometry(0.85, 0.32, 0.38), oscuro, -0.15, 0.08, 0.78 * lado);
      n.cuerpo.add(vaina);
      n.cuerpo.add(malla(new THREE.BoxGeometry(0.86, 0.07, 0.39), advertencia, -0.15, 0.27, 0.78 * lado, false));
      for (const dz of [-0.09, 0.09]) for (const dy of [0.0, 0.14]) {
        n.cuerpo.add(cilindroX(0.055, 0.055, 0.12, emisivo(NARANJA, 1.8), 0.29, dy, 0.78 * lado + dz, 8));
      }
      motor(n, -0.95, 0, 0.42 * lado, 0.2, n.colorEquipo);
    }
    n.cuerpo.add(cilindroX(0.11, 0.13, 1.2, oscuro, 1.25, 0.05, 0));
    n.cuerpo.add(malla(new THREE.BoxGeometry(0.22, 0.2, 0.3), oscuro, 1.85, 0.05, 0));
    n.cuerpo.add(malla(new THREE.BoxGeometry(0.05, 0.12, 0.32), acento, 1.97, 0.05, 0, false));
    n.canones.push(new THREE.Vector3(2.0, 0.05, 0));
  },

  phantom(n) {
    const { oscuro, acento } = n.mats;
    const cascoOscuro = acero(0x1d222c, 0.35, { map: n.mats.casco.map });
    n.cuerpo.add(malla(casco([[1.6, 0], [0.6, 0.2], [-0.6, 0.34], [-1.15, 0.24],
      [-1.15, -0.24], [-0.6, -0.34], [0.6, -0.2]], 0.26, 0.07), cascoOscuro));
    const cian = emisivo(CIAN, 2.8);
    for (const lado of [1, -1]) {
      n.cuerpo.add(malla(new THREE.BoxGeometry(1.9, 0.06, 0.07), oscuro, 1.2, 0.2, 0.08 * lado));
      const aleta = malla(casco([[-0.4, 0], [-1.05, 0.55 * lado], [-1.2, 0.55 * lado], [-0.95, 0]], 0.04, 0.02), cascoOscuro, 0, 0.0, 0.22 * lado);
      n.cuerpo.add(aleta);
      n.cuerpo.add(malla(new THREE.BoxGeometry(0.5, 0.03, 0.03), acento, -0.95, 0.06, 0.6 * lado, false));
      motor(n, -1.2, 0, 0.13 * lado, 0.11, CIAN);
    }
    n.bobinas = [];
    for (let k = 0; k < 5; k++) {
      const b = malla(new THREE.TorusGeometry(0.15, 0.025, 6, 16), cian.clone(), 0.55 + k * 0.33, 0.2, 0, false);
      b.rotation.y = Math.PI / 2;
      n.cuerpo.add(b);
      n.bobinas.push(b);
    }
    n.cuerpo.add(malla(new THREE.SphereGeometry(0.09, 12, 8), cian, 0.95, 0.2, 0, false));   // sensor óptico
    n.cuerpo.add(malla(new THREE.BoxGeometry(0.6, 0.04, 0.04), cian, 0.1, 0.17, 0, false));
    n.canones.push(new THREE.Vector3(2.15, 0.2, 0));
  },
};

/**
 * Crea una nave. Devuelve { grupo, actualizar(dt, info), ... }.
 * info: { vel (0..1), lateral (-1..1), impulso, escudo, fort, carga (0..1),
 *         opacidad (camuflaje), invulnerable }
 */
export function crearNave(clase, equipo, { sombra = true } = {}) {
  const colorEquipo = COLOR_EQUIPO[equipo] ?? 0xffffff;
  const n = {
    clase, equipo, colorEquipo,
    grupo: new THREE.Group(),       // posición en el mundo
    giro: new THREE.Group(),        // apunta
    cuerpo: new THREE.Group(),      // se inclina y flota
    motores: [], canones: [], t: Math.random() * 10, golpe: 0,
    mats: {
      casco: acero(0xb7bdc8, 0.35, { map: texCasco() }),
      oscuro: acero(0x30353f, 0.45),
      acento: emisivo(colorEquipo, 2.4),
    },
  };
  n.grupo.add(n.giro);
  n.giro.add(n.cuerpo);
  n.cuerpo.position.y = ALTURA_VUELO;
  (DISENOS[clase] ?? DISENOS.spectre)(n);
  n.cuerpo.scale.setScalar(1.08);

  if (sombra) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({ map: texSombra(), transparent: true, depthWrite: false }));
    s.rotation.x = -Math.PI / 2; s.position.y = 0.03;
    n.grupo.add(s);
    n.sombra = s;
    const aro = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.42, 40),
      new THREE.MeshBasicMaterial({ color: colorEquipo, transparent: true, opacity: 0.55, depthWrite: false }));
    aro.rotation.x = -Math.PI / 2; aro.position.y = 0.05;
    n.grupo.add(aro);
    n.aro = aro;
  }

  // burbuja de escudo (Titan) y anillo de fortificación
  n.burbuja = new THREE.Mesh(new THREE.SphereGeometry(1.7, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false }));
  n.burbuja.position.y = ALTURA_VUELO;
  n.grupo.add(n.burbuja);

  // materiales para camuflaje y destello de daño
  n.todosMats = [];
  n.grupo.traverse((o) => {
    if (o.material && !n.todosMats.includes(o.material)) n.todosMats.push(o.material);
  });
  for (const m of n.todosMats) m.userData.opacidadBase = m.opacity;
  n.opacidad = 1;

  n.actualizar = (dt, info = {}) => actualizar(n, dt, info);
  return n;
}

const tmp = new THREE.Color();

function actualizar(n, dt, info) {
  n.t += dt;
  const vel = info.vel ?? 0;
  n.cuerpo.position.y = ALTURA_VUELO + Math.sin(n.t * 2.6) * 0.07;
  // alabeo al moverse de lado y cabeceo al acelerar
  const objetivoRoll = -(info.lateral ?? 0) * 0.35;
  n.cuerpo.rotation.x += (objetivoRoll - n.cuerpo.rotation.x) * Math.min(1, dt * 6);
  n.cuerpo.rotation.z += ((info.adelante ?? 0) * -0.12 - n.cuerpo.rotation.z) * Math.min(1, dt * 5);

  const empuje = 0.35 + vel * 0.9 + (info.impulso ? 0.8 : 0);
  for (const m of n.motores) {
    const parpadeo = 0.9 + Math.random() * 0.2;
    m.halo.scale.setScalar(m.radio * (3 + empuje * 2.2) * parpadeo);
    m.llama.scale.set(m.radio * 2 + empuje * 1.4 * parpadeo, 1, 1);
    m.llama.material.opacity = 0.25 + empuje * 0.3;
  }
  if (n.giratorio) n.giratorio.rotation.z += dt * 1.8;
  if (n.nucleo) n.nucleo.rotation.y += dt * 2.5;
  if (n.bobinas) {
    const c = info.carga ?? 0;
    n.bobinas.forEach((b, k) => {
      b.material.emissiveIntensity = 1.6 + c * 6 * (0.6 + 0.4 * Math.sin(n.t * 30 + k));
      b.scale.setScalar(1 + c * 0.35);
    });
  }

  // escudo / fortificación / invulnerable
  const objetivoBurbuja = info.escudo ? 0.22 : info.fort ? 0.12 : info.invulnerable ? 0.3 : 0;
  const bm = n.burbuja.material;
  bm.opacity += (objetivoBurbuja - bm.opacity) * Math.min(1, dt * 8);
  bm.color.set(info.fort && !info.escudo ? 0xffb347 : info.invulnerable ? 0xffffff : 0x7fd8ff);
  n.burbuja.visible = bm.opacity > 0.01;
  n.burbuja.scale.setScalar(1 + Math.sin(n.t * 4) * 0.03);

  // camuflaje: transparencia de todos los materiales
  const objetivoOp = info.opacidad ?? 1;
  if (Math.abs(objetivoOp - n.opacidad) > 0.001) {
    n.opacidad += (objetivoOp - n.opacidad) * Math.min(1, dt * 6);
    if (Math.abs(objetivoOp - n.opacidad) < 0.01) n.opacidad = objetivoOp;
    for (const m of n.todosMats) {
      if (m === bm) continue;
      m.transparent = n.opacidad < 1 || m.userData.opacidadBase < 1 || m.blending === THREE.AdditiveBlending;
      m.opacity = m.userData.opacidadBase * n.opacidad;
    }
  }

  // destello al recibir daño
  if (info.golpe) n.golpe = 0.12;
  if (n.golpe > 0) {
    n.golpe -= dt;
    const k = Math.max(0, n.golpe / 0.12);
    tmp.setRGB(k, k * 0.8, k * 0.7);
    n.mats.casco.emissive.copy(tmp);
  } else if (n.mats.casco.emissive.r) {
    n.mats.casco.emissive.setRGB(0, 0, 0);
  }
}

/** Posición en el mundo de la boca del cañón (para destellos). */
export function bocaDelCanon(n, destino = new THREE.Vector3()) {
  const c = n.canones[0] ?? new THREE.Vector3(1.4, 0, 0);
  destino.copy(c).multiplyScalar(n.cuerpo.scale.x);
  destino.y += n.cuerpo.position.y;
  return n.giro.localToWorld(destino);
}

export function liberarNave(n) {
  n.grupo.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
  for (const m of n.todosMats) m.dispose();
}
