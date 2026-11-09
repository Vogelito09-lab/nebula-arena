// Nebula Arena V2: menú con hangar 3D, ajustes, estadísticas locales y la
// sesión de partida. El servidor (server/server.py) sigue siendo la autoridad.
import "./estilos.css";
import { ajustes, guardar } from "./ajustes.js";
import { audio } from "./audio.js";
import { CLASE_DEFECTO, CLASES } from "./datos-juego.js";
import { engancharLienzo } from "./entrada.js";
import { borrarEstadisticas, leerEstadisticas } from "./estadisticas.js";
import { Hangar } from "./hangar.js";
import { Hud } from "./hud.js";
import { Sesion } from "./juego.js";
import { Motor } from "./render/motor.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const LEADERBOARD = params.get("leaderboard");
const SERVIDOR_DEF = params.get("servidor") || `ws://${location.hostname || "localhost"}:7654`;
const ORDEN = ["interceptor", "titan", "spectre", "destroyer", "phantom"];
const ATRIBUTOS = { velocidad: "VELOCIDAD", blindaje: "BLINDAJE", dano: "DAÑO", alcance: "ALCANCE",
  cadencia: "CADENCIA", precision: "PRECISIÓN" };

const lienzo = $("lienzo");
const motor = new Motor(lienzo, ajustes.calidad);
const hangar = new Hangar(lienzo);
const hud = new Hud();
engancharLienzo(lienzo);
let sesion = null;
let claseVista = ajustes.clase && CLASES[ajustes.clase] ? ajustes.clase : CLASE_DEFECTO;

motor.usar(hangar.escena, hangar.camara);
hangar.mostrarClase(claseVista, ajustes.colorHangar);
if (import.meta.env.DEV) window.__nebula = { motor, hangar, get sesion() { return sesion; } };

// ---------------------------------------------------------------- pantallas
const PANTALLAS = ["menu", "hangar", "ajustes", "estadisticas", "clasificacion"];
let anterior = "menu";
function mostrar(id) {
  for (const p of PANTALLAS) $(p).classList.toggle("visible", p === id);
  if (id === "menu" || id === "hangar") {
    hangar.ponerModo(id === "hangar" ? "hangar" : "menu");
    document.body.dataset.pantalla = id;
  }
}
function aviso(txt, error = false) {
  const a = $("estado-conexion");
  a.textContent = txt;
  a.classList.toggle("error", error);
}
// el audio arranca con la primera interacción (regla de los navegadores)
addEventListener("pointerdown", () => audio.iniciar(), { once: false });
addEventListener("keydown", () => audio.iniciar(), { once: true });
for (const b of document.querySelectorAll("button")) b.addEventListener("click", () => audio.ui("clic"));

$("servidor").value = SERVIDOR_DEF;
$("nombre").value = localStorage.getItem("nebula-nombre") || "";
if (LEADERBOARD) $("btn-clasificacion").hidden = false;

$("form-inicio").addEventListener("submit", (ev) => { ev.preventDefault(); jugar("jugar"); });
$("btn-espectar").addEventListener("click", () => jugar("espectar"));
$("btn-hangar").addEventListener("click", () => { pintarHangar(); mostrar("hangar"); });
$("btn-ajustes").addEventListener("click", () => abrirAjustes("menu"));
$("btn-estadisticas").addEventListener("click", () => { pintarEstadisticas(); mostrar("estadisticas"); });
$("btn-clasificacion").addEventListener("click", verClasificacion);
for (const b of document.querySelectorAll("[data-volver]")) {
  b.addEventListener("click", () => {
    if (b.closest("#ajustes") && sesion) { $("ajustes").classList.remove("visible"); return; }
    mostrar("menu");
  });
}

// ---------------------------------------------------------------- menú: ficha de la nave elegida
function pintarMenuClase() {
  const c = CLASES[claseVista];
  $("menu-clase-nombre").textContent = c.nombre.toUpperCase();
  $("menu-clase-rol").textContent = c.rol;
}
pintarMenuClase();

// ---------------------------------------------------------------- hangar
let colorHangar = ajustes.colorHangar;
function pintarHangar() {
  const lista = $("lista-clases");
  lista.replaceChildren(...ORDEN.map((k, i) => {
    const c = CLASES[k];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "carta";
    b.dataset.clase = k;
    b.innerHTML = `<span class="num">0${i + 1}</span><b></b><small></small>`;
    b.querySelector("b").textContent = c.nombre.toUpperCase();
    b.querySelector("small").textContent = c.rol;
    b.classList.toggle("activa", k === claseVista);
    b.classList.toggle("elegida", k === (ajustes.clase ?? CLASE_DEFECTO));
    b.addEventListener("click", () => { claseVista = k; audio.ui("sel"); pintarHangar(); });
    return b;
  }));
  const c = CLASES[claseVista];
  $("ficha-nombre").textContent = c.nombre.toUpperCase();
  $("ficha-rol").textContent = c.rol;
  $("ficha-vida").textContent = `${c.vida} PV · VELOCIDAD ${c.velocidad}`;
  $("ficha-atributos").replaceChildren(...Object.entries(ATRIBUTOS).map(([k, nombre]) => {
    const fila = document.createElement("div");
    fila.className = "attr";
    fila.innerHTML = `<span></span><i><b></b></i><em></em>`;
    fila.querySelector("span").textContent = nombre;
    fila.querySelector("b").style.width = `${c.atributos[k]}%`;
    fila.querySelector("em").textContent = c.atributos[k];
    return fila;
  }));
  const a = c.arma;
  $("ficha-arma").textContent = `${a.nombre} — ${a.dano} de daño, ${(1 / a.cadencia).toFixed(1)} disparos/s, alcance ${a.alcance}` +
    (a.tipo === "railgun" ? ". Atraviesa naves, no paredes." : a.tipo === "instantaneo" ? ". Impacto instantáneo." : ". Proyectil.");
  $("ficha-habilidades").replaceChildren(...[["Q", c.q], ["E", c.e], ["ESPACIO", c.s]].map(([t, h]) => {
    const li = document.createElement("li");
    li.innerHTML = `<kbd></kbd><div><b></b><small></small></div><em></em>`;
    li.querySelector("kbd").textContent = t;
    li.querySelector("b").textContent = h.nombre ?? "Propulsión";
    li.querySelector("small").textContent = h.desc ?? "";
    li.querySelector("em").textContent = `${h.cd} s`;
    return li;
  }));
  for (const b of document.querySelectorAll("#color-hangar button")) b.classList.toggle("activa", b.dataset.equipo === colorHangar);
  const elegida = claseVista === (ajustes.clase ?? CLASE_DEFECTO);
  $("btn-elegir").textContent = elegida ? "NAVE SELECCIONADA ✓" : "SELECCIONAR NAVE";
  $("btn-elegir").disabled = elegida;
  hangar.mostrarClase(claseVista, colorHangar);
}
for (const b of document.querySelectorAll("#color-hangar button")) {
  b.addEventListener("click", () => { colorHangar = b.dataset.equipo; guardar({ colorHangar }); pintarHangar(); });
}
$("btn-elegir").addEventListener("click", () => {
  guardar({ clase: claseVista });
  pintarHangar();
  pintarMenuClase();
});
$("btn-volver-hangar").addEventListener("click", () => {
  claseVista = ajustes.clase ?? CLASE_DEFECTO;
  hangar.mostrarClase(claseVista, colorHangar);
  mostrar("menu");
});
// Teclado en el hangar: flechas para cambiar de nave, Enter para equiparla, Esc para volver
addEventListener("keydown", (ev) => {
  if (!$("hangar").classList.contains("visible") || ev.target instanceof HTMLInputElement) return;
  const paso = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[ev.code];
  if (paso) {
    ev.preventDefault();
    claseVista = ORDEN[(ORDEN.indexOf(claseVista) + paso + ORDEN.length) % ORDEN.length];
    audio.ui("sel");
    pintarHangar();
  } else if (ev.code === "Enter" || ev.code === "NumpadEnter") {
    ev.preventDefault();
    if (!$("btn-elegir").disabled) $("btn-elegir").click();
  } else if (ev.code === "Escape") {
    $("btn-volver-hangar").click();
  }
});

// ---------------------------------------------------------------- ajustes
function abrirAjustes(desde) {
  anterior = desde;
  for (const k of ["volGeneral", "volEfectos", "volMusica"]) $(k).value = Math.round(ajustes[k] * 100);
  for (const b of document.querySelectorAll("#calidad button")) b.classList.toggle("activa", b.dataset.calidad === ajustes.calidad);
  $("mostrarFps").checked = ajustes.mostrarFps;
  if (desde === "partida") $("ajustes").classList.add("visible");
  else mostrar("ajustes");
}
for (const k of ["volGeneral", "volEfectos", "volMusica"]) {
  $(k).addEventListener("input", () => guardar({ [k]: $(k).value / 100 }));
}
$("mostrarFps").addEventListener("change", () => guardar({ mostrarFps: $("mostrarFps").checked }));
for (const b of document.querySelectorAll("#calidad button")) {
  b.addEventListener("click", () => {
    guardar({ calidad: b.dataset.calidad });
    motor.aplicarCalidad(b.dataset.calidad);
    for (const o of document.querySelectorAll("#calidad button")) o.classList.toggle("activa", o === b);
  });
}

// ---------------------------------------------------------------- estadísticas locales
function pintarEstadisticas() {
  const s = leerEstadisticas();
  const kd = s.muertes ? (s.bajas / s.muertes).toFixed(2) : s.bajas.toFixed(2);
  const datos = [["PARTIDAS", s.partidas], ["VICTORIAS", s.victorias], ["DERROTAS", s.derrotas], ["EMPATES", s.empates],
    ["BAJAS", s.bajas], ["MUERTES", s.muertes], ["ASISTENCIAS", s.asist], ["K/D", kd],
    ["MEJOR PARTIDA", `${s.mejorBajas} bajas`], ["TIEMPO", `${Math.round(s.segundos / 60)} min`]];
  $("est-resumen").replaceChildren(...datos.map(([n, v]) => {
    const d = document.createElement("div");
    d.innerHTML = "<small></small><b></b>";
    d.querySelector("small").textContent = n;
    d.querySelector("b").textContent = v;
    return d;
  }));
  $("est-clases").replaceChildren(...ORDEN.map((k) => {
    const c = s.porClase[k] ?? { partidas: 0, victorias: 0, bajas: 0, muertes: 0, asist: 0 };
    const tr = document.createElement("tr");
    for (const v of [CLASES[k].nombre, c.partidas, c.victorias, c.bajas, c.muertes, c.asist]) {
      const td = document.createElement("td"); td.textContent = v; tr.append(td);
    }
    return tr;
  }));
}
$("btn-borrar-est").addEventListener("click", () => {
  if (confirm("¿Borrar las estadísticas guardadas en este navegador?")) { borrarEstadisticas(); pintarEstadisticas(); }
});

// ---------------------------------------------------------------- clasificación global (solo lectura)
async function verClasificacion() {
  mostrar("clasificacion");
  const tb = $("tabla-clasificacion");
  tb.innerHTML = `<tr><td colspan="6">Cargando…</td></tr>`;
  try {
    const r = await fetch(`${LEADERBOARD.replace(/\/$/, "")}/top`);
    const filas = await r.json();
    tb.replaceChildren(...filas.map((f) => {
      const tr = document.createElement("tr");
      for (const v of [f.posicion, f.jugador, f.puntos, f.partidas, f.victorias, f.derrotas]) {
        const td = document.createElement("td"); td.textContent = v; tr.append(td);
      }
      return tr;
    }));
    if (!filas.length) tb.innerHTML = `<tr><td colspan="6">Aún no hay puntajes.</td></tr>`;
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="6">No se pudo cargar la clasificación (${e.message}).</td></tr>`;
  }
}

// ---------------------------------------------------------------- estado del servidor (se asoma como espectador)
let sondeo = null;
function comprobarServidor() {
  const chip = $("estado-servidor");
  if (sesion || !$("menu").classList.contains("visible")) return;
  if (sondeo) sondeo.close();
  const base = ($("servidor").value.trim() || SERVIDOR_DEF).replace(/\/$/, "");
  let ws;
  try { ws = new WebSocket(`${base}/espectador`); } catch {
    chip.className = "chip mal"; chip.textContent = "URL INVÁLIDA"; return;
  }
  sondeo = ws;
  const fin = (clase, txt) => { if (sondeo !== ws) return; chip.className = `chip ${clase}`; chip.textContent = txt; ws.close(); sondeo = null; };
  const espera = setTimeout(() => fin("mal", "SIN RESPUESTA"), 3000);
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (!d.e) return;
    clearTimeout(espera);
    const pilotos = Object.values(d.e).filter((j) => !j.bot).length;
    fin("ok", pilotos ? `EN LÍNEA · ${pilotos} ${pilotos === 1 ? "PILOTO" : "PILOTOS"}` : "EN LÍNEA · ARENA LIBRE");
  };
  ws.onerror = () => { clearTimeout(espera); fin("mal", "SERVIDOR APAGADO"); };
}
comprobarServidor();
setInterval(comprobarServidor, 5000);
$("servidor").addEventListener("change", comprobarServidor);

// ---------------------------------------------------------------- partida
function jugar(modo) {
  const nombre = $("nombre").value.trim().slice(0, 16);
  if (modo === "jugar" && !nombre) { aviso("Escribe tu callsign de piloto.", true); $("nombre").focus(); return; }
  localStorage.setItem("nebula-nombre", nombre);
  const base = ($("servidor").value.trim() || SERVIDOR_DEF).replace(/\/$/, "");
  const url = modo === "espectar" ? `${base}/espectador` : base;
  for (const b of document.querySelectorAll("#form-inicio button")) b.disabled = true;
  aviso(`Conectando a ${url}…`);
  sesion = new Sesion({
    motor, hud, url, modo, nombre, clase: ajustes.clase ?? CLASE_DEFECTO,
    alCerrar: (mensaje, error) => volverAlMenu(mensaje, error),
  });
  // la escena del juego se activa cuando llega la bienvenida
  const espera = setInterval(() => {
    if (!sesion || sesion.cerrada) { clearInterval(espera); return; }
    if (sesion.escena) {
      clearInterval(espera);
      for (const p of PANTALLAS) $(p).classList.remove("visible");
      document.body.dataset.pantalla = "partida";
      aviso("");
    }
  }, 30);
}

function volverAlMenu(mensaje = "", error = false) {
  if (sesion && !sesion.cerrada) sesion.salir();
  sesion = null;
  hud.mostrar(false);
  hud.ocultarResultados();
  $("ajustes").classList.remove("visible");
  motor.usar(hangar.escena, hangar.camara);
  for (const b of document.querySelectorAll("#form-inicio button")) b.disabled = false;
  mostrar("menu");
  aviso(mensaje, error);
  comprobarServidor();
}

$("btn-continuar").addEventListener("click", () => sesion?.alternarPausa(false));
$("btn-ajustes-pausa").addEventListener("click", () => abrirAjustes("partida"));
$("btn-salir-pausa").addEventListener("click", () => volverAlMenu());
$("btn-salir-res").addEventListener("click", () => volverAlMenu());
$("btn-seguir-res").addEventListener("click", () => hud.ocultarResultados());

// ---------------------------------------------------------------- bucle
let previo = performance.now(), fps = 60, acumulado = 0, cuadros = 0;
function cuadro(ahora) {
  const dt = Math.min(0.05, (ahora - previo) / 1000);
  previo = ahora;
  acumulado += dt; cuadros += 1;
  if (acumulado >= 0.5) { fps = cuadros / acumulado; acumulado = 0; cuadros = 0; }
  if (sesion?.escena) {
    sesion.fps = fps;
    sesion.cuadro(dt, ahora);
  } else hangar.actualizar(dt);
  motor.dibujar();
  requestAnimationFrame(cuadro);
}
requestAnimationFrame(cuadro);
