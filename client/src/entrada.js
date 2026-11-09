// Teclado y mouse. Solo guarda el estado; la sesión de juego decide qué hacer.
export const entrada = {
  teclas: new Set(),
  mouse: { x: innerWidth / 2, y: innerHeight / 2, nx: 0, ny: 0 },
  disparando: false,
  rueda: 0,                      // acumulado desde el último cuadro
  pulsadas: [],                  // teclas recién presionadas (se vacía cada cuadro)
  soltadas: [],
  activa: false,                 // solo dentro de la partida
};

const ignorar = (ev) => ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement;

addEventListener("keydown", (ev) => {
  if (!entrada.activa || ignorar(ev)) return;
  if (["Tab", "Space", "KeyQ", "KeyE"].includes(ev.code)) ev.preventDefault();
  if (!ev.repeat) entrada.pulsadas.push(ev.code);
  entrada.teclas.add(ev.code);
});
addEventListener("keyup", (ev) => {
  entrada.teclas.delete(ev.code);
  if (entrada.activa) entrada.soltadas.push(ev.code);
});
addEventListener("blur", () => { entrada.teclas.clear(); entrada.disparando = false; });
addEventListener("mousemove", (ev) => {
  const m = entrada.mouse;
  m.x = ev.clientX; m.y = ev.clientY;
  m.nx = (ev.clientX / innerWidth) * 2 - 1;
  m.ny = -(ev.clientY / innerHeight) * 2 + 1;
});
addEventListener("mouseup", (ev) => { if (ev.button === 0) entrada.disparando = false; });
addEventListener("wheel", (ev) => { if (entrada.activa) entrada.rueda += Math.sign(ev.deltaY); }, { passive: true });

/** El lienzo es el único que inicia el disparo (los clics en el HUD no disparan). */
export function engancharLienzo(lienzo) {
  lienzo.addEventListener("mousedown", (ev) => { if (ev.button === 0 && entrada.activa) entrada.disparando = true; });
  lienzo.addEventListener("contextmenu", (ev) => ev.preventDefault());
}

export function consumir() {
  const r = { pulsadas: entrada.pulsadas, soltadas: entrada.soltadas, rueda: entrada.rueda };
  entrada.pulsadas = []; entrada.soltadas = []; entrada.rueda = 0;
  return r;
}

export const pulsada = (...codigos) => codigos.some((c) => entrada.teclas.has(c));
