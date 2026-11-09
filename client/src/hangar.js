// Hangar 3D: fondo cinematográfico del menú y vista de naves (mismos modelos
// que en la partida). En modo "menu" la cámara gira despacio alrededor de la
// nave; en modo "hangar" el jugador la rota con el mouse (OrbitControls).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CIAN, COLOR_EQUIPO, NARANJA, acero, conTextura, emisivo, texAdvertencia, texHalo, texPanel,
  texPiso } from "./render/materiales.js";
import { crearNave, liberarNave } from "./render/naves.js";

export class Hangar {
  constructor(lienzo) {
    this.escena = new THREE.Scene();
    this.camara = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 900);
    this.controles = new OrbitControls(this.camara, lienzo);
    Object.assign(this.controles, { enableDamping: true, enablePan: false, minDistance: 6, maxDistance: 16,
      maxPolarAngle: Math.PI * 0.49, enabled: false });
    this.controles.target.set(0, 1.4, 0);
    this.modo = "menu";
    this.angulo = 0.6;
    this.t = 0;
    this._construir();
  }

  _construir() {
    const e = this.escena;
    e.background = new THREE.Color(0x04060b);
    e.fog = new THREE.Fog(0x04060b, 40, 140);
    e.add(new THREE.HemisphereLight(0xaab8ff, 0x1a1418, 0.7));
    const clave = new THREE.SpotLight(0xfff0dc, 170, 40, Math.PI / 6, 0.5, 1.6);
    clave.position.set(4, 14, 6);
    clave.target.position.set(0, 1, 0);
    clave.castShadow = true;
    clave.userData.sombra = true;
    clave.shadow.mapSize.set(1024, 1024);
    e.add(clave, clave.target);
    const contra = new THREE.PointLight(0x3f8cff, 40, 30, 1.6);
    contra.position.set(-6, 4, -6);
    e.add(contra);
    this.luzEquipo = contra;
    const borde = new THREE.PointLight(0x3ff2ff, 18, 20, 1.8);
    borde.position.set(6, 2, -4);
    e.add(borde);

    // piso del hangar
    const piso = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2),
      conTextura(texPiso(), 10, 10, { metalness: 0.6, roughness: 0.5 }));
    piso.receiveShadow = true;
    e.add(piso);

    // plataforma giratoria con anillos luminosos
    this.plataforma = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.5, 48), acero(0x2b3038, 0.45));
    base.position.y = 0.25; base.receiveShadow = true; base.castShadow = true;
    const tapa = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 0.06, 48),
      conTextura(texPanel(), 2, 2, { metalness: 0.7, roughness: 0.35, color: 0x9aa3b0 }));
    tapa.position.y = 0.52; tapa.receiveShadow = true;
    this.anillo = new THREE.Mesh(new THREE.TorusGeometry(4.0, 0.04, 8, 96).rotateX(Math.PI / 2), emisivo(CIAN, 1.2));
    this.anillo.position.y = 0.56;
    const anillo2 = new THREE.Mesh(new THREE.TorusGeometry(4.55, 0.03, 8, 96).rotateX(Math.PI / 2), emisivo(NARANJA, 0.9));
    anillo2.position.y = 0.05;
    this.plataforma.add(base, tapa, this.anillo, anillo2);
    e.add(this.plataforma);

    // brazos de mantenimiento y gradas alrededor
    const metal = acero(0x5a626e, 0.4), oscuro = acero(0x23272e, 0.5);
    const adv = new THREE.MeshStandardMaterial({ map: texAdvertencia(), metalness: 0.3, roughness: 0.6 });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      const brazo = new THREE.Group();
      const poste = new THREE.Mesh(new THREE.BoxGeometry(0.7, 9, 0.7), metal);
      poste.position.y = 4.5; poste.castShadow = true;
      const viga = new THREE.Mesh(new THREE.BoxGeometry(4, 0.45, 0.5), oscuro);
      viga.position.set(-2, 8.2, 0);
      const franja = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.72), adv);
      franja.position.y = 1.2;
      const luz = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, 0.4), emisivo(k % 2 ? CIAN : NARANJA, 3));
      luz.position.set(-3.8, 7.9, 0);
      brazo.add(poste, viga, franja, luz);
      brazo.position.set(Math.cos(a) * 11, 0, Math.sin(a) * 11);
      brazo.rotation.y = -a;
      e.add(brazo);
    }
    // pared del fondo con ventanal al espacio
    for (let k = -3; k <= 3; k++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(7.6, 14, 0.6),
        conTextura(texPanel(), 2, 4, { metalness: 0.6, roughness: 0.45, color: 0x59616d }));
      const a = Math.PI + k * 0.22;
      panel.position.set(Math.cos(a) * 26, 7, Math.sin(a) * 26);
      panel.lookAt(0, 7, 0);
      e.add(panel);
    }
    const ventana = new THREE.Mesh(new THREE.PlaneGeometry(60, 18),
      new THREE.MeshBasicMaterial({ color: 0x0b1530, transparent: true, opacity: 0.3 }));
    ventana.position.set(0, 12, -30);
    e.add(ventana);

    // estrellas y planeta visibles detrás
    const n = 1200, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 220 + Math.random() * 80, t = Math.PI * (0.15 + Math.random() * 0.7), f = Math.random() * Math.PI * 0.5;
      pos.set([Math.cos(t) * r, 10 + Math.sin(f) * r, -Math.sin(t) * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    e.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc9d6ff, size: 1.2, sizeAttenuation: false, fog: false })));
    const planeta = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 32),
      new THREE.MeshStandardMaterial({ color: 0x35285a, emissive: 0x140a28, roughness: 1, fog: false }));
    planeta.position.set(-120, 40, -260);
    e.add(planeta);

    // polvo flotando en el haz de luz
    const m = 160, pp = new Float32Array(m * 3);
    for (let i = 0; i < m; i++) pp.set([(Math.random() - 0.5) * 14, Math.random() * 10, (Math.random() - 0.5) * 14], i * 3);
    const gp = new THREE.BufferGeometry();
    gp.setAttribute("position", new THREE.BufferAttribute(pp, 3));
    this.polvo = new THREE.Points(gp, new THREE.PointsMaterial({ map: texHalo(), size: 0.18, color: 0xbfd8ff,
      transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    e.add(this.polvo);
  }

  mostrarClase(clase, equipo = "azul") {
    if (this.nave && this.nave.clase === clase && this.nave.equipo === equipo) return;
    if (this.nave) { this.plataforma.remove(this.nave.grupo); liberarNave(this.nave); }
    this.nave = crearNave(clase, equipo, { sombra: false });
    this.nave.grupo.position.y = 0.55;
    this.nave.grupo.scale.setScalar(1.9);
    this.nave.grupo.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.plataforma.add(this.nave.grupo);
    this.luzEquipo.color.set(COLOR_EQUIPO[equipo]);
  }

  ponerModo(modo) {
    this.modo = modo;
    this.controles.enabled = modo === "hangar";
    if (modo === "hangar") {
      this.camara.position.set(7, 4.2, 7.5);
      this.controles.target.set(0, 1.6, 0);
      this.controles.update();
    }
  }

  ajustarAspecto(a) {
    this.camara.aspect = a;
    this.camara.updateProjectionMatrix();
  }

  actualizar(dt) {
    this.t += dt;
    if (this.nave) {
      this.nave.actualizar(dt, { vel: 0.25 });
      this.nave.giro.rotation.y += dt * (this.modo === "menu" ? 0.25 : 0.12);
    }
    this.anillo.material.emissiveIntensity = 1.0 + Math.sin(this.t * 2) * 0.35;
    this.polvo.rotation.y += dt * 0.02;
    // la imagen se corre a la derecha en el menú (los botones quedan a la izquierda)
    const w = innerWidth, h = innerHeight;
    this.camara.setViewOffset(w, h, this.modo === "menu" ? -w * 0.2 : -w * 0.03, 0, w, h);
    if (this.modo === "menu") {
      this.angulo += dt * 0.06;
      const r = 14;
      this.camara.position.set(Math.cos(this.angulo) * r, 5 + Math.sin(this.t * 0.2) * 0.4, Math.sin(this.angulo) * r);
      this.camara.lookAt(0, 1.8, 0);
    } else this.controles.update();
  }
}
