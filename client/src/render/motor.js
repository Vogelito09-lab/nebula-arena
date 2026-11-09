// Renderer, posprocesado y perfiles gráficos (BAJO / ALTO).
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

export const PERFILES = {
  bajo: { nombre: "Bajo", escala: 0.75, sombras: false, bloom: false, particulas: 0.4, antialias: false },
  alto: { nombre: "Alto", escala: 1.0, sombras: true, bloom: true, particulas: 1.0, antialias: true },
};

export class Motor {
  constructor(lienzo, perfil = "alto") {
    this.lienzo = lienzo;
    this.calidad = { ...PERFILES[perfil] ?? PERFILES.alto, clave: perfil };
    this.renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.etiquetas = new CSS2DRenderer();
    this.etiquetas.domElement.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:4";
    document.body.appendChild(this.etiquetas.domElement);

    this.escena = null;
    this.camara = null;
    this.composer = null;
    window.addEventListener("resize", () => this.ajustar());
  }

  /** Cambia la escena/cámara activas (menú/hangar o partida). */
  usar(escena, camara) {
    this.escena = escena;
    this.camara = camara;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(escena, camara));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.aplicarCalidad();
  }

  aplicarCalidad(perfil) {
    if (perfil) this.calidad = { ...PERFILES[perfil], clave: perfil };
    const c = this.calidad;
    this.renderer.shadowMap.enabled = c.sombras;
    // En la partida el escenario no se mueve: el mapa de sombras se dibuja una vez
    // (las naves llevan sombra de contacto propia). En el hangar se actualiza siempre.
    this.renderer.shadowMap.autoUpdate = !this.escena?.userData.sombrasEstaticas;
    this.renderer.shadowMap.needsUpdate = true;
    if (this.escena) {
      this.escena.traverse((o) => {
        if (o.isLight && o.userData.sombra) o.castShadow = c.sombras;
        if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true;
      });
    }
    if (this.bloom) this.bloom.enabled = c.bloom;
    this.ajustar();
  }

  ajustar() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio, 1.25) * this.calidad.escala;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      this.bloom?.setSize(Math.round(w * pr / 2), Math.round(h * pr / 2));
    }
    this.etiquetas.setSize(w, h);
    if (this.camara?.ajustarAspecto) this.camara.ajustarAspecto(w / h);
    else if (this.camara?.isPerspectiveCamera) {
      this.camara.aspect = w / h;
      this.camara.updateProjectionMatrix();
    }
  }

  dibujar() {
    if (!this.escena) return;
    if (this.calidad.bloom) this.composer.render();
    else this.renderer.render(this.escena, this.camara);
    this.etiquetas.render(this.escena, this.camara);
  }
}

/** Luces y cielo comunes a la partida. */
export function ambienteEspacial(escena) {
  escena.background = new THREE.Color(0x05070d);
  escena.fog = new THREE.Fog(0x05070d, 140, 320);
  escena.add(new THREE.HemisphereLight(0xb8c8ff, 0x2a2228, 1.1));
  const sol = new THREE.DirectionalLight(0xfff1df, 2.6);
  sol.position.set(-45, 80, 35);
  sol.castShadow = true;
  sol.userData.sombra = true;
  sol.shadow.mapSize.set(2048, 2048);
  sol.shadow.bias = -0.0006;
  sol.shadow.normalBias = 0.03;
  Object.assign(sol.shadow.camera, { left: -62, right: 62, top: 62, bottom: -62, near: 10, far: 220 });
  escena.add(sol);
  const relleno = new THREE.DirectionalLight(0x6f8cff, 0.6);
  relleno.position.set(40, 30, -50);
  escena.add(relleno);

  // estrellas
  const n = 1800, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 260 + Math.random() * 60, t = Math.random() * Math.PI * 2, f = Math.random() * Math.PI;
    pos.set([r * Math.cos(t) * Math.sin(f), r * Math.cos(f), r * Math.sin(t) * Math.sin(f)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  escena.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc9d6ff, size: 1.3, sizeAttenuation: false, fog: false })));

  // planeta lejano
  const planeta = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 32),
    new THREE.MeshStandardMaterial({ color: 0x3a2a55, emissive: 0x150a2a, roughness: 1, fog: false }));
  planeta.position.set(-150, -120, -230);
  escena.add(planeta);
  const atm = new THREE.Mesh(new THREE.SphereGeometry(74, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x6a8cff, transparent: true, opacity: 0.12, side: THREE.BackSide, fog: false }));
  atm.position.copy(planeta.position);
  escena.add(atm);
  escena.userData.sombrasEstaticas = true;
  return { sol };
}
