// Cámara isométrica ortográfica: ~45° de inclinación, sigue al jugador con
// suavidad, respeta los límites del mapa y hace transparentes las paredes que
// tapan a las naves.
import * as THREE from "three";
import { aMundo } from "./coordenadas.js";

const INCLINACION = THREE.MathUtils.degToRad(48);   // ángulo sobre el horizonte
const DISTANCIA = 120;

export class CamaraIso extends THREE.OrthographicCamera {
  constructor() {
    super(-1, 1, 1, -1, 1, 400);
    this.altoVista = 46;            // unidades visibles en vertical (zoom)
    this.yaw = Math.PI / 4;         // 45°: vista isométrica
    this.objetivo = new THREE.Vector3();
    this.mirada = new THREE.Vector3();
    this.aspecto = 1;
    this.raycaster = new THREE.Raycaster();
    this.desvanecidos = new Map();  // grupo -> opacidad actual
    this.colocar(this.objetivo);
  }

  /** El equipo rojo ve la arena girada 180°: su enemigo siempre queda "arriba". */
  orientarPara(equipo) {
    this.yaw = equipo === "rojo" ? Math.PI / 4 + Math.PI : Math.PI / 4;
  }

  ajustarAspecto(a) {
    this.aspecto = a;
    const h = this.altoVista / 2;
    Object.assign(this, { left: -h * a, right: h * a, top: h, bottom: -h });
    this.updateProjectionMatrix();
  }

  acercar(delta) {
    this.altoVista = THREE.MathUtils.clamp(this.altoVista * (1 + delta), 30, 70);
    this.ajustarAspecto(this.aspecto);
  }

  direccion() {
    // vector desde el objetivo hacia la cámara
    return new THREE.Vector3(-Math.cos(this.yaw) * Math.cos(INCLINACION), Math.sin(INCLINACION),
      Math.sin(this.yaw) * Math.cos(INCLINACION));
  }

  colocar(p) {
    this.mirada.copy(p);
    this.position.copy(p).addScaledVector(this.direccion(), DISTANCIA);
    this.lookAt(p);
  }

  /** Sigue al punto (x, y) del juego con suavidad; con margen en los bordes del mapa. */
  seguir(x, y, dt, adelanto = null) {
    const lim = 50 - this.altoVista * 0.3;
    let ox = x, oy = y;
    if (adelanto) { ox += adelanto.x; oy += adelanto.y; }
    const meta = aMundo(THREE.MathUtils.clamp(ox, 50 - lim, 50 + lim), THREE.MathUtils.clamp(oy, 50 - lim, 50 + lim));
    this.mirada.lerp(meta, 1 - Math.exp(-7 * dt));
    this.position.copy(this.mirada).addScaledVector(this.direccion(), DISTANCIA);
    this.lookAt(this.mirada);
  }

  /** Ejes de pantalla proyectados al piso, en coordenadas del juego:
   *  W = arriba de la pantalla, D = derecha. */
  ejesPantalla() {
    const d = this.direccion();
    const arriba = { x: -d.x, y: -d.z };       // hacia donde mira la cámara, en el piso
    const n = Math.hypot(arriba.x, arriba.y);
    arriba.x /= n; arriba.y /= n;
    return { arriba, derecha: { x: -arriba.y, y: arriba.x } };
  }

  /** Punto del piso (coordenadas del juego) bajo el mouse (ndc -1..1). */
  puntoDelPiso(nx, ny) {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this);
    const p = new THREE.Vector3();
    const piso = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.95);   // a la altura de vuelo
    return this.raycaster.ray.intersectPlane(piso, p) ? { x: p.x + 50, y: p.z + 50 } : null;
  }

  /** Paredes inteligentes: lo que tapa a alguna de las naves dadas se vuelve
   *  semitransparente y recupera su opacidad poco a poco. */
  ocluir(ocluibles, puntos, dt) {
    const tapan = new Set();
    const dir = this.direccion();
    for (const p of puntos) {
      const origen = aMundo(p.x, p.y, 1);
      this.raycaster.set(origen, dir);
      this.raycaster.far = DISTANCIA;
      for (const hit of this.raycaster.intersectObjects(ocluibles, true)) {
        let g = hit.object;
        while (g && !g.userData.ocluible && g.parent) g = g.parent;
        tapan.add(g.userData.ocluible ? g : hit.object);
      }
    }
    for (const g of tapan) if (!this.desvanecidos.has(g)) this.desvanecidos.set(g, 1);
    for (const [g, op] of this.desvanecidos) {
      const meta = tapan.has(g) ? 0.22 : 1;
      const nueva = op + (meta - op) * Math.min(1, dt * 8);
      const final = Math.abs(nueva - meta) < 0.01 ? meta : nueva;
      g.traverse((o) => {
        if (!o.material) return;
        for (const m of [].concat(o.material)) {
          if (m.userData.op0 === undefined) m.userData.op0 = m.opacity;
          m.transparent = final < 1 || m.userData.op0 < 1;
          m.opacity = m.userData.op0 * final;
          m.depthWrite = final >= 1;
        }
      });
      if (final === 1 && !tapan.has(g)) this.desvanecidos.delete(g);
      else this.desvanecidos.set(g, final);
    }
  }
}
