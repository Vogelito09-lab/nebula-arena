// Cliente de Nebula Arena: entrada, red, predicción, interpolación y HUD.
// El servidor es autoritativo: aquí solo se predice el movimiento propio y se
// dibuja lo que el servidor confirma (disparos, daño, bajas, marcador).
import { Escena } from "./escena.js";
import { MAPA_MENU } from "./mapa-menu.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const LEADERBOARD = params.get("leaderboard");
const SERVIDOR_DEF = params.get("servidor") || `ws://${location.hostname || "localhost"}:7654`;

// Mismas constantes que server/juego.py
const VELOCIDAD = 12, RADIO = 1, CADENCIA_S = 0.25, RESPAWN_S = 3, ENVIO_HZ = 20;
const RETRASO_INTERP_MS = 100;

const escena = new Escena($("lienzo"));
if (import.meta.env.DEV) window.__escena = escena;   // depuración
let mapa = null;

// ---------------------------------------------------------------- estado
const st = {
  ws: null, modo: null,             // "jugar" | "espectar"
  id: null, equipo: null, nombre: "",
  x: 50, y: 50, dir: 0,             // posición predicha del jugador local
  vivo: true, muertoHasta: 0,
  teclas: new Set(), mouse: { x: 0, y: 0, nx: 0, ny: 0 }, disparando: false,
  ultimoDisparo: 0, ultimoEnvio: 0,
  snaps: [],                        // [{ t: ms local, e }]
  ultimo: null,                     // último snapshot completo
  ping: null, finMostrado: false,
};

// ---------------------------------------------------------------- colisión local (espejo de juego.choca)
function choca(x, y, r = RADIO) {
  if (!mapa) return false;
  const T = mapa.tamano;
  if (x < r || y < r || x > T - r || y > T - r) return true;
  for (const [ox, oy, w, h] of mapa.obstaculos) {
    const cx = Math.min(Math.max(x, ox), ox + w), cy = Math.min(Math.max(y, oy), oy + h);
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
  }
  return false;
}

// ---------------------------------------------------------------- pantallas
function mostrar(id) {
  for (const p of ["inicio", "clasificacion", "resultados"]) $(p).classList.toggle("visible", p === id);
}
function aviso(txt, error = false) {
  const a = $("estado-conexion");
  a.textContent = txt;
  a.classList.toggle("error", error);
}

$("servidor").value = SERVIDOR_DEF;
$("nombre").value = localStorage.getItem("nebula-nombre") || "";
if (LEADERBOARD) $("btn-clasificacion").hidden = false;

$("form-inicio").addEventListener("submit", (ev) => { ev.preventDefault(); conectar("jugar"); });
$("btn-espectar").addEventListener("click", () => conectar("espectar"));
$("btn-salir-res").addEventListener("click", salir);
$("btn-clasificacion").addEventListener("click", verClasificacion);
$("btn-cerrar-clasificacion").addEventListener("click", () => mostrar("inicio"));

async function verClasificacion() {
  mostrar("clasificacion");
  const tb = $("tabla-clasificacion");
  tb.innerHTML = `<tr><td colspan="6">Cargando…</td></tr>`;
  try {
    const r = await fetch(`${LEADERBOARD.replace(/\/$/, "")}/top`);
    const filas = await r.json();
    tb.replaceChildren(...filas.map((f) => fila([f.posicion, f.jugador, f.puntos, f.partidas, f.victorias, f.derrotas])));
    if (!filas.length) tb.innerHTML = `<tr><td colspan="6">Aún no hay puntajes.</td></tr>`;
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="6">No se pudo cargar la clasificación (${e.message}).</td></tr>`;
  }
}

function fila(celdas, clase = "") {
  const tr = document.createElement("tr");
  if (clase) tr.className = clase;
  for (const c of celdas) {
    const td = document.createElement("td");
    td.textContent = c;
    tr.append(td);
  }
  return tr;
}

// ---------------------------------------------------------------- red
function conectar(modo) {
  const nombre = $("nombre").value.trim().slice(0, 16);
  if (modo === "jugar" && !nombre) { aviso("Escribe tu nombre de piloto.", true); return; }
  localStorage.setItem("nebula-nombre", nombre);
  const base = ($("servidor").value.trim() || SERVIDOR_DEF).replace(/\/$/, "");
  const url = modo === "espectar" ? `${base}/espectador` : base;

  for (const b of document.querySelectorAll("#form-inicio button")) b.disabled = true;
  aviso(`Conectando a ${url}…`);
  Object.assign(st, { modo, nombre, id: null, snaps: [], ultimo: null, finMostrado: false, vivo: true });

  let ws;
  try { ws = new WebSocket(url); } catch (e) { return fallo(`URL inválida: ${e.message}`); }
  st.ws = ws;
  let abierto = false;

  ws.onopen = () => {
    abierto = true;
    if (modo === "jugar") {
      const id = `p-${Math.random().toString(36).slice(2, 10)}`;
      st.id = id;
      // (0, 0) está fuera del área válida: el servidor nos coloca en la base del equipo.
      ws.send(JSON.stringify({ id, x: 0, y: 0, nombre }));
    }
  };
  ws.onmessage = (m) => recibir(JSON.parse(m.data));
  ws.onerror = () => {};
  ws.onclose = (ev) => {
    if (st.ws !== ws) return;
    st.ws = null;
    if (!abierto) return fallo(`No hay servidor en ${url}. ¿Está corriendo server.py?`);
    if (ev.code === 4000) return fallo("La partida está llena (10 jugadores). Prueba el modo espectador.");
    salir();
    aviso(ev.code === 1000 || ev.code === 1001 ? "Partida terminada." : `Conexión cerrada (código ${ev.code}).`, ev.code !== 1000);
  };
}

function fallo(txt) {
  salir();
  aviso(txt, true);
}

function salir() {
  const ws = st.ws;
  st.ws = null;
  if (ws && ws.readyState <= 1) ws.close(1000);
  st.modo = null;
  document.body.classList.remove("jugando");
  $("hud").classList.add("oculto");
  $("feed").replaceChildren();
  escena.desactivarOrbita();
  escena.limpiarNaves(new Set());
  for (const b of document.querySelectorAll("#form-inicio button")) b.disabled = false;
  aviso("");
  mostrar("inicio");
}

function enviar(obj) {
  if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify(obj));
}

function recibir(d) {
  if (d.bienvenida) return bienvenida(d.bienvenida);
  if (d.pong !== undefined) { st.ping = performance.now() - d.pong; return; }
  if (d.correccion) {                     // el servidor rechazó el movimiento
    st.x = d.correccion.x; st.y = d.correccion.y;
    return;
  }
  if (d.e) snapshot(d);
}

function bienvenida(b) {
  mapa = b.mapa;
  escena.construirMapa(mapa);
  $("meta").textContent = `Primero a ${mapa.meta_bajas} bajas`;
  mostrar(null);
  $("hud").classList.remove("oculto");
  if (st.modo === "espectar") {
    escena.activarOrbita();
    $("vida-caja").classList.add("oculto");
    $("mira").classList.add("oculto");
    $("modo").textContent = "ESPECTADOR · arrastra para girar la cámara";
  } else {
    Object.assign(st, { id: b.id, equipo: b.equipo, x: b.x, y: b.y });
    document.body.classList.add("jugando");
    $("vida-caja").classList.remove("oculto");
    $("mira").classList.remove("oculto");
    $("modo").textContent = `Equipo ${b.equipo.toUpperCase()}`;
    $("modo").style.color = b.equipo === "azul" ? "var(--azul)" : "var(--rojo)";
  }
}

function snapshot(d) {
  const ahora = performance.now();
  st.snaps.push({ t: ahora, e: d.e });
  while (st.snaps.length > 30) st.snaps.shift();
  st.ultimo = d;

  // marcador y reloj
  $("pts-azul").textContent = d.m?.azul ?? 0;
  $("pts-rojo").textContent = d.m?.rojo ?? 0;
  const r = Math.ceil(d.r ?? 0);
  $("reloj").textContent = `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;

  for (const ev of d.ev || []) evento(ev, d.e);

  // estado propio según el servidor
  const yo = st.id && d.e[st.id];
  if (yo) {
    const vivo = yo.vida > 0;
    if (vivo && !st.vivo) { st.x = yo.x; st.y = yo.y; }             // reaparición
    else if (vivo && Math.hypot(yo.x - st.x, yo.y - st.y) > 4) {    // desfase grande
      st.x = yo.x; st.y = yo.y;
    }
    st.vivo = vivo;
    $("vida-num").textContent = yo.vida;
    $("vida-relleno").style.width = `${yo.vida}%`;
    $("vida-relleno").classList.toggle("baja-vida", yo.vida <= 35);
    $("muerto").classList.toggle("oculto", vivo);
  }

  // fin de partida
  if (d.fin && !st.finMostrado) { st.finMostrado = true; resultados(d.fin); }
  if (!d.fin && st.finMostrado) { st.finMostrado = false; mostrar(null); }

  if (!$("tabla-marcador").classList.contains("oculto")) marcador();
}

function evento(ev, e) {
  if (ev.tipo === "disparo") {
    escena.trazador(ev, e[ev.de]?.equipo);
  } else if (ev.tipo === "baja") {
    const v = e[ev.a];
    if (v) escena.explosion(v.x, v.y, v.equipo);
    agregarBaja(ev, e);
    if (ev.a === st.id) {
      st.muertoHasta = performance.now() + RESPAWN_S * 1000;
      $("muerto-por").textContent = `por ${ev.de_nombre}`;
    }
  }
}

function agregarBaja(ev, e) {
  const div = document.createElement("div");
  div.className = "baja";
  const a = document.createElement("span"), b = document.createElement("span"), arma = document.createElement("span");
  a.className = e[ev.de]?.equipo || ""; a.textContent = ev.de_nombre;
  b.className = e[ev.a]?.equipo || ""; b.textContent = ev.a_nombre;
  arma.className = "arma"; arma.textContent = "⟶";
  div.append(a, arma, b);
  $("feed").prepend(div);
  while ($("feed").children.length > 5) $("feed").lastChild.remove();
  setTimeout(() => div.remove(), 6000);
}

function marcador() {
  const e = st.ultimo?.e || {};
  for (const eq of ["azul", "rojo"]) {
    const t = $(`tm-${eq}`);
    const cab = document.createElement("tr");
    for (const h of [eq.toUpperCase(), "Bajas", "Muertes"]) {
      const th = document.createElement("th"); th.textContent = h; cab.append(th);
    }
    const filas = Object.values(e).filter((j) => j.equipo === eq)
      .sort((a, b) => b.bajas - a.bajas || a.muertes - b.muertes)
      .map((j) => {
        const tr = fila([j.nombre, j.bajas, j.muertes], j.id === st.id ? "yo" : "");
        if (j.bot) tr.firstChild.className = "bot";
        return tr;
      });
    t.replaceChildren(cab, ...filas);
  }
}

function resultados(fin) {
  const mio = st.equipo;
  $("res-titulo").textContent = fin.ganador === "empate" ? "Empate"
    : !mio ? `Gana el equipo ${fin.ganador}` : fin.ganador === mio ? "Victoria" : "Derrota";
  $("res-titulo").style.color = fin.ganador === "azul" ? "var(--azul)" : fin.ganador === "rojo" ? "var(--rojo)" : "";
  $("res-marcador").textContent = `AZUL ${fin.marcador.azul} — ${fin.marcador.rojo} ROJO`;
  $("res-tabla").replaceChildren(...fin.jugadores.map((j) =>
    fila([j.nombre, j.equipo, j.bajas, j.muertes], j.nombre === st.nombre && !j.bot ? "yo" : "")));
  mostrar("resultados");
}

// ---------------------------------------------------------------- entrada
addEventListener("keydown", (ev) => {
  if (!st.modo) return;
  if (ev.code === "Tab") { ev.preventDefault(); marcador(); $("tabla-marcador").classList.remove("oculto"); }
  else if (ev.code === "Escape") salir();
  else st.teclas.add(ev.code);
});
addEventListener("keyup", (ev) => {
  if (ev.code === "Tab") $("tabla-marcador").classList.add("oculto");
  st.teclas.delete(ev.code);
});
addEventListener("blur", () => { st.teclas.clear(); st.disparando = false; });
addEventListener("mousemove", (ev) => {
  st.mouse.x = ev.clientX; st.mouse.y = ev.clientY;
  st.mouse.nx = (ev.clientX / innerWidth) * 2 - 1;
  st.mouse.ny = -(ev.clientY / innerHeight) * 2 + 1;
});
$("lienzo").addEventListener("mousedown", (ev) => { if (ev.button === 0) st.disparando = true; });
addEventListener("mouseup", (ev) => { if (ev.button === 0) st.disparando = false; });
$("lienzo").addEventListener("contextmenu", (ev) => ev.preventDefault());

setInterval(() => { if (st.modo) enviar({ ping: performance.now() }); }, 1000);

// ---------------------------------------------------------------- simulación local
function moverLocal(dt) {
  if (!st.vivo || st.finMostrado || !mapa) return;
  let dx = 0, dy = 0;
  const t = st.teclas;
  if (t.has("KeyW") || t.has("ArrowUp")) dy -= 1;
  if (t.has("KeyS") || t.has("ArrowDown")) dy += 1;
  if (t.has("KeyA") || t.has("ArrowLeft")) dx -= 1;
  if (t.has("KeyD") || t.has("ArrowRight")) dx += 1;
  const n = Math.hypot(dx, dy);
  if (n > 0) {
    const paso = (VELOCIDAD * dt) / n;
    // por ejes, para deslizarse a lo largo de las paredes
    if (!choca(st.x + dx * paso, st.y)) st.x += dx * paso;
    if (!choca(st.x, st.y + dy * paso)) st.y += dy * paso;
  }
  const p = escena.puntoDelMouse(st.mouse.nx, st.mouse.ny);
  if (p) { st.dir = Math.atan2(p.y - st.y, p.x - st.x); st.apunta = p; }
}

function enviarEstado(ahora) {
  if (st.modo !== "jugar" || !st.id || !mapa) return;
  if (ahora - st.ultimoEnvio < 1000 / ENVIO_HZ) return;
  st.ultimoEnvio = ahora;
  if (!st.vivo || st.finMostrado) return;          // muerto o entre partidas: no se manda nada
  let dispara = false;
  if (st.disparando && ahora - st.ultimoDisparo >= CADENCIA_S * 1000) {
    dispara = true;
    st.ultimoDisparo = ahora;
  }
  enviar({ id: st.id, x: +st.x.toFixed(3), y: +st.y.toFixed(3), dir: +st.dir.toFixed(4), dispara });
}

// ---------------------------------------------------------------- interpolación de entidades remotas
function anguloLerp(a, b, k) {
  let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}

function dibujarEntidades(ahora) {
  const s = st.snaps;
  if (!s.length) return;
  const objetivo = ahora - RETRASO_INTERP_MS;
  let a = s[0], b = s[s.length - 1];
  for (let i = s.length - 1; i > 0; i--) {
    if (s[i - 1].t <= objetivo) { a = s[i - 1]; b = s[i]; break; }
  }
  const k = b.t > a.t ? Math.min(Math.max((objetivo - a.t) / (b.t - a.t), 0), 1) : 1;
  const vivos = new Set(Object.keys(b.e));
  for (const [id, jb] of Object.entries(b.e)) {
    if (id === st.id) {
      escena.actualizarNave(id, jb, st.x, st.y, st.dir, true);
      continue;
    }
    const ja = a.e[id] || jb;
    const salto = Math.hypot(jb.x - ja.x, jb.y - ja.y) > 5;          // reaparición: sin deslizar
    const x = salto ? jb.x : ja.x + (jb.x - ja.x) * k;
    const y = salto ? jb.y : ja.y + (jb.y - ja.y) * k;
    escena.actualizarNave(id, jb, x, y, anguloLerp(ja.dir ?? 0, jb.dir ?? 0, k), false);
  }
  escena.limpiarNaves(vivos);
}

// ---------------------------------------------------------------- bucle de dibujo
let anguloMenu = 0;
function cuadro() {
  const ahora = performance.now();
  const dt = escena.dtPrevio ?? 0.016;
  if (st.modo === "jugar") {
    moverLocal(dt);
    enviarEstado(ahora);
    escena.seguir(st.x, st.y, dt, st.apunta?.x, st.apunta?.y);
    const m = $("mira");
    m.style.left = `${st.mouse.x}px`; m.style.top = `${st.mouse.y}px`;
    if (!st.vivo) {
      const falta = Math.max(0, (st.muertoHasta - ahora) / 1000);
      $("respawn").textContent = `Reapareces en ${falta.toFixed(1)} s`;
    }
  } else if (!st.modo) {                              // menú: cámara orbitando
    anguloMenu += dt * 0.08;
    escena.camara.position.set(Math.cos(anguloMenu) * 85, 55, Math.sin(anguloMenu) * 85);
    escena.camara.lookAt(0, 0, 0);
  }
  dibujarEntidades(ahora);
  $("ping").textContent = st.ping == null ? "— ms" : `${Math.round(st.ping)} ms`;
  escena.dtPrevio = escena.dibujar();
  requestAnimationFrame(cuadro);
}

// Arena de fondo en el menú (misma geometría que el servidor, se reemplaza al conectar).
escena.construirMapa(MAPA_MENU);
requestAnimationFrame(cuadro);
