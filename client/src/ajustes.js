// Ajustes del jugador guardados en el navegador (localStorage).
const CLAVE = "nebula-ajustes";
const DEFECTO = {
  volGeneral: 0.8, volEfectos: 0.9, volMusica: 0.45,
  calidad: "alto",          // "alto" | "bajo"
  mostrarFps: true,
  clase: null,              // clase elegida en el hangar
  colorHangar: "azul",
};

export const ajustes = { ...DEFECTO, ...leer() };
const oyentes = new Set();

function leer() {
  try { return JSON.parse(localStorage.getItem(CLAVE)) ?? {}; } catch { return {}; }
}

export function guardar(cambios) {
  Object.assign(ajustes, cambios);
  localStorage.setItem(CLAVE, JSON.stringify(ajustes));
  for (const f of oyentes) f(ajustes, cambios);
}

export function alCambiar(f) { oyentes.add(f); return () => oyentes.delete(f); }
