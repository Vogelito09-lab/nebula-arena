// HUD militar: marcador, vida/escudo, habilidades con enfriamiento, arma,
// carga del Phantom, killfeed con asistencias, pantalla de destrucción,
// tabla (Tab) y resultados. Solo DOM; los datos vienen de la sesión.
const $ = (id) => document.getElementById(id);
const ORDEN = ["interceptor", "titan", "spectre", "destroyer", "phantom"];
const TECLAS = { q: "Q", e: "E", s: "ESPACIO" };
const EQUIPO = { azul: "BLUE SQUAD", rojo: "RED SQUAD" };

export const nombreEquipo = (eq) => EQUIPO[eq] ?? eq;

function el(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

export class Hud {
  constructor() {
    this.slots = {};
    for (const k of ["q", "e", "s"]) {
      const s = el("div", "hab");
      s.dataset.k = k;
      const icono = el("div", "hab-icono");
      const tecla = el("span", "hab-tecla", TECLAS[k]);
      const cd = el("span", "hab-cd");
      const nombre = el("span", "hab-nombre");
      icono.append(cd);
      s.append(icono, tecla, nombre);
      $("habilidades").append(s);
      this.slots[k] = { s, cd, nombre, icono };
    }
    this.cache = {};
    this.claseActual = null;
  }

  _txt(id, v) {
    if (this.cache[id] === v) return;
    this.cache[id] = v;
    $(id).textContent = v;
  }

  mostrar(visible, modo = "jugar") {
    $("hud").classList.toggle("oculto", !visible);
    document.body.classList.toggle("jugando", visible && modo === "jugar");
    document.body.classList.toggle("espectando", visible && modo === "espectar");
    if (!visible) {
      $("feed").replaceChildren();
      for (const id of ["muerto", "tabla-marcador", "pausa", "aviso-central"]) $(id).classList.add("oculto");
      this.cache = {};
      this.claseActual = null;
    }
  }

  modo(texto, equipo) {
    this._txt("modo", texto);
    $("modo").dataset.equipo = equipo ?? "";
  }

  red(ping, fps, mostrarFps) {
    this._txt("ping", ping == null ? "— ms" : `${Math.round(ping)} ms`);
    $("fps").hidden = !mostrarFps;
    if (mostrarFps) this._txt("fps", `${Math.round(fps)} FPS`);
  }

  marcador(m, r, prorroga, meta) {
    this._txt("pts-azul", String(m?.azul ?? 0));
    this._txt("pts-rojo", String(m?.rojo ?? 0));
    const s = Math.ceil(r ?? 0);
    this._txt("reloj", `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
    $("reloj").classList.toggle("urgente", prorroga || s <= 30);
    $("prorroga").classList.toggle("oculto", !prorroga);
    this._txt("meta", prorroga ? "LA SIGUIENTE BAJA GANA" : `PRIMERO A ${meta} BAJAS`);
    const total = Math.max(1, meta);
    $("barra-azul").style.width = `${Math.min(100, (m?.azul ?? 0) / total * 100)}%`;
    $("barra-rojo").style.width = `${Math.min(100, (m?.rojo ?? 0) / total * 100)}%`;
  }

  /** Cambia la ficha de clase del panel inferior. */
  clase(cfg, clave) {
    if (this.claseActual === clave) return;
    this.claseActual = clave;
    this._txt("clase-nombre", cfg.nombre.toUpperCase());
    this._txt("clase-rol", cfg.rol);
    $("panel-vida").dataset.clase = clave;
    this._txt("arma-nombre", cfg.arma.nombre.toUpperCase());
    this._txt("arma-datos", `${cfg.arma.dano} DAÑO · ${(1 / cfg.arma.cadencia).toFixed(1)}/s · ${cfg.arma.alcance} m`);
    for (const k of ["q", "e", "s"]) {
      this.slots[k].nombre.textContent = cfg[k].nombre ?? (k === "s" ? "Propulsión" : "");
      this.slots[k].s.title = cfg[k].desc ?? "";
      this.slots[k].s.dataset.max = cfg[k].cd;
    }
    $("carga-caja").classList.toggle("oculto", clave !== "phantom");
  }

  vida(vida, vmax, escudo, escudoMax) {
    const k = Math.max(0, vida) / vmax;
    $("vida-relleno").style.width = `${k * 100}%`;
    $("vida-relleno").classList.toggle("baja-vida", k <= 0.35);
    $("escudo-relleno").style.width = `${Math.min(1, escudo / Math.max(1, escudoMax)) * 100}%`;
    this._txt("vida-num", String(Math.max(0, Math.round(vida))));
    this._txt("vida-max", `/ ${vmax}`);
    this._txt("escudo-num", escudo > 0 ? `+${Math.round(escudo)} ESCUDO` : "");
  }

  habilidades(cd, est, cfg, clave) {
    for (const k of ["q", "e", "s"]) {
      const { s, cd: t } = this.slots[k];
      const falta = cd?.[k] ?? 0;
      const max = cfg[k].cd || 1;
      s.style.setProperty("--p", Math.min(1, falta / max));
      s.classList.toggle("lista", falta <= 0);
      t.textContent = falta > 0 ? (falta >= 10 ? Math.ceil(falta) : falta.toFixed(1)) : "";
    }
    const activo = {
      interceptor: { q: est.impulso, e: est.invulnerable },
      titan: { q: est.escudo, e: est.fort },
      spectre: {}, destroyer: {},
      phantom: { q: est.carga !== undefined, e: est.camo },
    }[clave] ?? {};
    for (const k of ["q", "e"]) this.slots[k].s.classList.toggle("activa", !!activo[k]);
  }

  arma(listo, carga, camo) {
    $("cadencia-relleno").style.width = `${listo * 100}%`;
    $("carga-relleno").style.width = `${(carga ?? 0) * 100}%`;
    $("carga-caja").classList.toggle("cargando", carga !== undefined);
    $("carga-pct").textContent = carga !== undefined ? `${Math.round(carga * 100)} %` : "Q PARA CARGAR";
    $("estado-camo").classList.toggle("oculto", !camo);
    document.body.classList.toggle("camuflado", !!camo);
  }

  mira(x, y, enRango) {
    const m = $("mira");
    m.style.transform = `translate(${x}px, ${y}px)`;
    m.classList.toggle("fuera", !enRango);
  }

  impacto(baja = false) {
    const m = $("marca-impacto");
    m.classList.remove("activa", "baja");
    void m.offsetWidth;
    m.classList.add("activa");
    if (baja) m.classList.add("baja");
  }

  dano() {
    const v = $("vineta-dano");
    v.classList.remove("activa");
    void v.offsetWidth;
    v.classList.add("activa");
  }

  feed(ev, e, yoId) {
    const div = el("div", "baja");
    if (ev.de === yoId || ev.a === yoId) div.classList.add("mia");
    const a = el("span", e[ev.de]?.equipo ?? "", ev.de_nombre);
    const arma = el("span", "arma", e[ev.de]?.clase ? `[${e[ev.de].clase.slice(0, 3).toUpperCase()}]` : "⟶");
    const b = el("span", e[ev.a]?.equipo ?? "", ev.a_nombre);
    div.append(a, arma, b);
    if (ev.asist?.length) div.append(el("span", "asist", `+ ${ev.asist.join(", ")}`));
    $("feed").prepend(div);
    while ($("feed").children.length > 6) $("feed").lastChild.remove();
    setTimeout(() => div.remove(), 7000);
  }

  avisoCentral(titulo, sub = "", ms = 2500) {
    const a = $("aviso-central");
    $("aviso-titulo").textContent = titulo;
    $("aviso-sub").textContent = sub;
    a.classList.remove("oculto");
    clearTimeout(this._aviso);
    if (ms > 0) this._aviso = setTimeout(() => a.classList.add("oculto"), ms);   // 0 = fijo
  }

  ocultarAviso() {
    clearTimeout(this._aviso);
    $("aviso-central").classList.add("oculto");
  }

  // ---------------------------------------------------------------- muerte y cambio de clase
  construirSelectorClases(clases, alElegir) {
    const caja = $("muerto-clases");
    caja.replaceChildren(...ORDEN.map((c, i) => {
      const b = el("button", "carta-clase");
      b.type = "button";
      b.dataset.clase = c;
      b.append(el("span", "num", String(i + 1)), el("b", "", clases[c].nombre), el("small", "", clases[c].rol));
      b.addEventListener("click", () => alElegir(c));
      return b;
    }));
  }

  muerto(visible, { por, falta, actual, siguiente } = {}) {
    $("muerto").classList.toggle("oculto", !visible);
    if (!visible) return;
    if (por !== undefined) this._txt("muerto-por", por ? `por ${por}` : "");
    this._txt("respawn", falta > 0 ? `REAPARICIÓN EN ${falta.toFixed(1)} s` : "REAPARECIENDO…");
    for (const b of $("muerto-clases").children) {
      b.classList.toggle("elegida", b.dataset.clase === (siguiente ?? actual));
    }
  }

  // ---------------------------------------------------------------- tabla (Tab) y resultados
  tabla(visible, e, yoId) {
    $("tabla-marcador").classList.toggle("oculto", !visible);
    if (!visible) return;
    for (const eq of ["azul", "rojo"]) {
      const t = $(`tm-${eq}`);
      const cab = el("tr");
      for (const h of [nombreEquipo(eq), "CLASE", "B", "M", "A"]) cab.append(el("th", "", h));
      const filas = Object.values(e).filter((j) => j.equipo === eq)
        .sort((a, b) => b.bajas - a.bajas || a.muertes - b.muertes)
        .map((j) => {
          const tr = el("tr", j.id === yoId ? "yo" : "");
          const n = el("td", j.bot ? "bot" : "", j.nombre);
          if (j.vida <= 0) n.classList.add("caido");
          tr.append(n, el("td", "clase", (j.clase ?? "").toUpperCase()), el("td", "", j.bajas),
            el("td", "", j.muertes), el("td", "", j.asist ?? 0));
          return tr;
        });
      t.replaceChildren(cab, ...filas);
    }
  }

  resultados(fin, miEquipo, miNombre) {
    const titulo = $("res-titulo");
    titulo.textContent = fin.ganador === "empate" ? "EMPATE"
      : !miEquipo ? `GANA ${nombreEquipo(fin.ganador)}` : fin.ganador === miEquipo ? "VICTORIA" : "DERROTA";
    titulo.dataset.equipo = fin.ganador;
    $("res-marcador").textContent = `BLUE SQUAD ${fin.marcador.azul} — ${fin.marcador.rojo} RED SQUAD` +
      (fin.prorroga ? "  ·  PRÓRROGA" : "");
    $("res-tabla").replaceChildren(...fin.jugadores.map((j) => {
      const tr = el("tr", j.nombre === miNombre && !j.bot ? "yo" : "");
      tr.dataset.equipo = j.equipo;
      tr.append(el("td", "", j.nombre), el("td", "", nombreEquipo(j.equipo)),
        el("td", "", (j.clase ?? "").toUpperCase()), el("td", "", j.bajas), el("td", "", j.muertes),
        el("td", "", j.asist ?? 0));
      return tr;
    }));
    $("resultados").classList.add("visible");
  }

  ocultarResultados() { $("resultados").classList.remove("visible"); }
}
