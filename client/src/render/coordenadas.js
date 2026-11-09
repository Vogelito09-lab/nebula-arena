// Coordenadas del juego: (x, y) en [0, 100] sobre el piso. En Three.js: (x - 50, altura, y - 50).
import * as THREE from "three";

export const MITAD = 50;
export const aMundo = (x, y, h = 0) => new THREE.Vector3(x - MITAD, h, y - MITAD);
export const aJuego = (v) => ({ x: v.x + MITAD, y: v.z + MITAD });
