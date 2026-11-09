// Estadísticas locales del piloto (solo en este navegador). El cliente NUNCA
// escribe en la clasificación global: esa la publica el servidor de partida.
const CLAVE = "nebula-estadisticas";

function vacio() {
  return { partidas: 0, victorias: 0, derrotas: 0, empates: 0, bajas: 0, muertes: 0, asist: 0,
    mejorBajas: 0, segundos: 0, porClase: {} };
}

export function leerEstadisticas() {
  try { return { ...vacio(), ...JSON.parse(localStorage.getItem(CLAVE)) }; } catch { return vacio(); }
}

/** Registra una partida terminada. resultado: "victoria" | "derrota" | "empate". */
export function registrarPartida({ resultado, clase, bajas, muertes, asist, segundos }) {
  const s = leerEstadisticas();
  s.partidas += 1;
  if (resultado === "victoria") s.victorias += 1;
  else if (resultado === "derrota") s.derrotas += 1;
  else s.empates += 1;
  s.bajas += bajas; s.muertes += muertes; s.asist += asist;
  s.mejorBajas = Math.max(s.mejorBajas, bajas);
  s.segundos += Math.round(segundos);
  const c = (s.porClase[clase] ??= { partidas: 0, victorias: 0, bajas: 0, muertes: 0, asist: 0 });
  c.partidas += 1;
  if (resultado === "victoria") c.victorias += 1;
  c.bajas += bajas; c.muertes += muertes; c.asist += asist;
  localStorage.setItem(CLAVE, JSON.stringify(s));
  return s;
}

export function borrarEstadisticas() { localStorage.removeItem(CLAVE); }
