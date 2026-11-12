# Práctica 3.1 — Entrenar y servir un bot sencillo

## Introducción

En un juego en línea los bots ocupan los lugares vacíos de una partida y cada uno
toma decisiones varias veces por segundo. Antes de meterlos a la nube hay que
saber cuánto cuesta que "piensen". En esta práctica entrenamos un agente pequeño,
medimos cuánto tarda en decidir y con eso calculamos cuántas máquinas y cuánto
dinero haría falta para 2,000 bots.

Una aclaración: los bots que juegan dentro de Nebula Arena son de reglas (una
máquina de estados con búsqueda de caminos A\*). El agente de esta práctica se
usó solo para medir el costo de la inferencia, como pide el material.

## Objetivo

Entrenar un agente con aprendizaje por refuerzo (PPO de Stable-Baselines3) en un
entorno simulado, comparar el entrenamiento en CPU y en GPU, y estimar la
infraestructura y el costo por hora para servir 2,000 bots a 10 decisiones por
segundo.

## Lo que hicimos

### 1. Preparar el entrenamiento

Escribimos el script `ai/training/entrenar_bot.py`. Entrena el agente en
`CartPole-v1` (un poste que hay que mantener en equilibrio, parecido a equilibrar
una nave), lo evalúa en 10 episodios, mide la inferencia y guarda el modelo con
un JSON de resultados. También lo dejamos como cuaderno de Colab
(`practica_3_1.ipynb`) para correr la misma prueba en CPU y en GPU.

Usamos siempre los mismos parámetros para que la comparación fuera justa:
100,000 pasos de entrenamiento y semilla 0.

### 2. Entrenar en Colab con CPU y con GPU, y en la laptop

El 5 de noviembre corrimos el cuaderno en Google Colab con una GPU Tesla T4,
primero entrenando en CPU y luego en GPU, en la misma máquina virtual. Después
repetimos el entrenamiento en la laptop (AMD Ryzen, 12 hilos, Windows 11). En los
tres casos el agente aprendió por completo: recompensa media de 500 de 500.

| Medición | Colab, CPU | Colab, GPU T4 | Laptop, CPU |
|---|---|---|---|
| Tiempo de entrenamiento | **132.6 s** | **222.9 s** | 173.4 s |
| Recompensa media (máx. 500) | 500.0 | 500.0 | 500.0 |
| Latencia de una decisión (1 hilo de CPU) | 0.359 ms | 0.432 ms | 0.224 ms |
| Decisiones por segundo por núcleo | 2,787 | 2,315 | 4,460 |

La latencia la medimos siempre en CPU con un solo hilo, porque lo que nos interesa
es cuántas decisiones da un núcleo: promediamos 10,000 llamadas después de 200 de
calentamiento.

### 3. Por qué la GPU fue más lenta

Nos sorprendió que **la GPU tardara 68 % más que la CPU**. Al revisarlo
entendimos la razón: la red del agente es diminuta (dos capas de 64 neuronas) y
PPO pasa casi todo el tiempo simulando el entorno, que corre en CPU. En cada paso
hay que copiar los datos a la GPU y traer la respuesta de vuelta, y esas copias
cuestan más que el cálculo que se ahorra. La GPU solo conviene con redes grandes,
imágenes o cientos de entornos en paralelo. Para un bot como este, entrenar en CPU
es más rápido y más barato.

### 4. Dimensionar 2,000 bots a 10 Hz

Si 2,000 bots deciden 10 veces por segundo, el servicio debe dar
2,000 × 10 = **20,000 decisiones por segundo**. Para calcular la nube usamos la
medición más baja de Colab (2,315 por vCPU), porque una vCPU de nube rinde menos
que un núcleo de escritorio:

20,000 / 2,315 = 8.64 vCPU, y con 30 % de margen **12 vCPU**, que son 3 máquinas
de 4 vCPU. Es muy parecido al ejemplo del material (11 vCPU).

### 5. Costo por hora

Consultamos los precios oficiales de Compute Engine en `us-central1` el 9 de
noviembre (solo la máquina virtual, sin disco ni red):

| Opción (3 máquinas de 4 vCPU, 24/7) | USD/hora | USD/mes | USD por bot y hora |
|---|---|---|---|
| **3 × c3-standard-4, bajo demanda** | **0.6048** | **441.52** | **0.000302** |
| 3 × c3-highcpu-4, bajo demanda | 0.5103 | 372.53 | 0.000255 |
| 3 × c3-standard-4, compromiso de 1 año | 0.3810 | 278.17 | 0.000191 |
| 3 × e2-highcpu-4, bajo demanda | 0.2968 | 216.68 | 0.000148 |

El entrenamiento casi no cuesta: dura unos 2 minutos en 2 vCPU, alrededor de
USD 0.002 en una `e2-standard-2`, o gratis en Colab.

## Resultados

- El agente aprendió por completo en los tres equipos (500 de 500).
- Una vCPU de nube da entre 2,315 y 2,787 decisiones por segundo.
- 2,000 bots a 10 Hz necesitan **12 vCPU** y cuestan **USD 0.60 por hora**, o sea
  **USD 0.0003 por bot y hora**.
- La `c3-highcpu-4` ahorra 16 % sin perder rendimiento, porque el modelo pesa unos
  KB y no necesita la memoria extra.

## Conclusión

Medir antes de comprar cambió la decisión: la GPU, que parecía la opción obvia,
salió más lenta y más cara para este bot. Con la latencia medida pudimos
convertir "2,000 bots" en un número concreto de máquinas y de dólares por hora.
Antes de producción repetiríamos la medición en la máquina real, porque Colab no
garantiza qué CPU asigna. El entrenamiento puede correr en instancias Spot, ya que
si lo interrumpen se reanuda desde el último punto guardado.
