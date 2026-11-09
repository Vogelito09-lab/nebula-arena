// Texturas y materiales procedurales (generados con canvas: sin archivos externos).
import * as THREE from "three";

export const COLOR_EQUIPO = { azul: 0x2f8cff, rojo: 0xff3b4e };
export const CIAN = 0x3ff2ff;
export const NARANJA = 0xff8a1f;

function lienzo(w, h, dibujar) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  dibujar(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function ruido(g, w, h, n, alfa) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() * 255 | 0;
    g.fillStyle = `rgba(${v},${v},${v},${alfa * Math.random()})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

function manchas(g, w, h, n) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 6 + Math.random() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(10,8,6,0.22)");
    gr.addColorStop(1, "rgba(10,8,6,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

// ---------------------------------------------------------------- texturas
const cache = {};
const una = (k, f) => (cache[k] ??= f());

/** Cubierta metálica del piso: placas con juntas, tornillos, desgaste. */
export const texPiso = () => una("piso", () => lienzo(512, 512, (g, w, h) => {
  g.fillStyle = "#3a404c"; g.fillRect(0, 0, w, h);
  const n = 4, s = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const l = 26 + Math.random() * 7;
    g.fillStyle = `hsl(220, 9%, ${l}%)`;
    g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
    // estrías antideslizantes en algunas placas
    if ((i + j) % 3 === 0) {
      g.strokeStyle = "rgba(0,0,0,0.18)"; g.lineWidth = 2;
      for (let k = 12; k < s - 12; k += 10) {
        g.beginPath(); g.moveTo(i * s + 12, j * s + k); g.lineTo(i * s + s - 12, j * s + k); g.stroke();
      }
    }
    g.fillStyle = "rgba(20,22,28,0.8)";
    for (const [a, b] of [[10, 10], [s - 14, 10], [10, s - 14], [s - 14, s - 14]]) {
      g.beginPath(); g.arc(i * s + a + 2, j * s + b + 2, 2.5, 0, 7); g.fill();
    }
  }
  g.fillStyle = "rgba(0,0,0,0.55)";
  for (let k = 0; k <= n; k++) { g.fillRect(k * s - 2, 0, 4, h); g.fillRect(0, k * s - 2, w, 4); }
  manchas(g, w, h, 40);
  ruido(g, w, h, 5000, 0.12);
}));

/** Paneles blindados de los muros. */
export const texPanel = () => una("panel", () => lienzo(256, 256, (g, w, h) => {
  g.fillStyle = "#4b5260"; g.fillRect(0, 0, w, h);
  const filas = [[0, 0, 256, 92], [0, 96, 124, 160], [128, 96, 128, 76], [128, 176, 128, 80]];
  for (const [x, y, ww, hh] of filas) {
    const gr = g.createLinearGradient(x, y, x, y + hh);
    gr.addColorStop(0, "#69707e"); gr.addColorStop(1, "#4d5462");
    g.fillStyle = gr; g.fillRect(x + 3, y + 3, ww - 6, hh - 6);
    g.strokeStyle = "rgba(255,255,255,0.08)"; g.strokeRect(x + 4, y + 4, ww - 8, hh - 8);
  }
  g.fillStyle = "#2a2f38";
  for (let k = 20; k < 236; k += 18) g.fillRect(k, 40, 8, 3);   // rejilla de ventilación
  manchas(g, w, h, 14);
  ruido(g, w, h, 2500, 0.15);
}));

/** Lámina corrugada de contenedor (en gris: se tiñe con el color del material). */
export const texCorrugado = () => una("corrugado", () => lienzo(256, 128, (g, w, h) => {
  for (let x = 0; x < w; x += 8) {
    const gr = g.createLinearGradient(x, 0, x + 8, 0);
    gr.addColorStop(0, "#bdbdbd"); gr.addColorStop(0.5, "#ffffff"); gr.addColorStop(1, "#9a9a9a");
    g.fillStyle = gr; g.fillRect(x, 0, 8, h);
  }
  g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
  manchas(g, w, h, 18);
  ruido(g, w, h, 2500, 0.18);
}));

/** Franjas de advertencia negro/naranja. */
export const texAdvertencia = () => una("adv", () => lienzo(128, 32, (g, w, h) => {
  g.fillStyle = "#16171b"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#f08a1c";
  for (let x = -h; x < w + h; x += 24) {
    g.beginPath(); g.moveTo(x, h); g.lineTo(x + 12, h); g.lineTo(x + 12 + h, 0); g.lineTo(x + h, 0); g.fill();
  }
  ruido(g, w, h, 600, 0.25);
}));

/** Casco de nave: placas finas. */
export const texCasco = () => una("casco", () => lienzo(256, 256, (g, w, h) => {
  g.fillStyle = "#c9ced8"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(40,45,55,0.35)"; g.lineWidth = 1.5;
  for (let k = 0; k < 9; k++) {
    g.beginPath(); g.moveTo(Math.random() * w, 0); g.lineTo(Math.random() * w, h); g.stroke();
    g.beginPath(); g.moveTo(0, Math.random() * h); g.lineTo(w, Math.random() * h); g.stroke();
  }
  ruido(g, w, h, 1800, 0.1);
}));

/** Brillo radial para halos, motores y sombras falsas. */
export const texHalo = () => una("halo", () => {
  const t = lienzo(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.35, "rgba(255,255,255,0.45)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
});

export const texSombra = () => una("sombra", () => lienzo(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(0,0,0,0.7)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
}));

// ---------------------------------------------------------------- materiales
export function acero(color = 0x7d8594, rugosidad = 0.42, opciones = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.8, roughness: rugosidad, ...opciones });
}

export function emisivo(color, intensidad = 2.2) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensidad,
    roughness: 0.4, metalness: 0.1 });
}

export function vidrio(color = 0x9fdcff) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 0.1, roughness: 0.05, transmission: 0,
    transparent: true, opacity: 0.55, emissive: color, emissiveIntensity: 0.35, clearcoat: 1 });
}

export function conTextura(tex, repX, repY, opciones = {}) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(repX, repY);
  return new THREE.MeshStandardMaterial({ map: t, metalness: 0.75, roughness: 0.5, ...opciones });
}
