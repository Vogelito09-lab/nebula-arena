"""Convierte los documentos del proyecto a PDF con el formato del reporte del
alumno: portada con logo del ITC, cuerpo en Arial justificado, figuras
numeradas ("Figura N. pie en cursiva") y número de página abajo al centro.

En el Markdown:
  ![pie de la figura](ruta/a/imagen.png)            -> figura con imagen
  <!-- consola: ruta.txt | 1-20,30-35 | pie -->     -> figura con salida de consola

Uso: python docs/reportes/generar_pdf.py <salida_dir> <archivo.md> [<archivo.md> ...]
"""
import html
import os
import pathlib
import re
import subprocess
import sys
import tempfile

import fitz  # pymupdf
import markdown

LOGO = pathlib.Path(__file__).resolve().parents[1] / "logo-itc.png"  # docs/logo-itc.png
FECHA = "11 de noviembre de 2026"
EQUIPO = ["Jarom Cortes Perez", "Carlos Antonio Vogel Romero"]

CSS = """
@page { size: Letter; margin: 22mm 22mm 20mm 22mm; }
body { font-family: Arial, 'Liberation Sans', sans-serif; font-size: 10.6pt; line-height: 1.42; color: #000; }
p, li { text-align: justify; }
h1, h2, h3, h4 { font-weight: bold; color: #000; page-break-after: avoid; }
h2 { font-size: 12pt; margin: 16px 0 6px; }
h3 { font-size: 11pt; margin: 12px 0 4px; }
h4 { font-size: 10.6pt; margin: 10px 0 4px; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 9.5pt; page-break-inside: avoid; }
th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; vertical-align: top; }
th { background: #eee; }
code { font-family: Consolas, monospace; font-size: 9.5pt; }
pre { background: #f4f4f4; border: 1px solid #ddd; padding: 6px 8px; font-size: 7.6pt; line-height: 1.25;
      white-space: pre-wrap; word-break: break-all; page-break-inside: avoid; }
pre code { font-size: inherit; }
figure { margin: 10px 0 12px; page-break-inside: avoid; }
figure img { display: block; max-width: 100%; max-height: 105mm; margin: 0 auto; border: 1px solid #ccc; }
figure pre { margin: 0; background: #1e1e1e; color: #e6e6e6; border: 1px solid #555; }
body > pre { font-size: 6.3pt; white-space: pre; word-break: normal; overflow: hidden; }
figcaption { font-size: 9.5pt; margin-top: 4px; text-align: left; }
figcaption i { font-style: italic; }
.portada { text-align: center; page-break-after: always; padding-top: 6mm; }
.portada img { width: 62mm; margin-bottom: 4mm; }
.portada p { text-align: center; margin: 0 0 12px; font-size: 10.6pt; }
"""

# el reporte técnico tiene máximo 6 páginas (sin contar la portada): formato más compacto
COMPACTO = """
@page { margin: 16mm 17mm 16mm 17mm; }
body { font-size: 10.2pt; line-height: 1.36; }
h2 { font-size: 11pt; margin: 10px 0 4px; }
p { margin: 5px 0; } ul, ol { margin: 4px 0; padding-left: 20px; }
table { font-size: 8.6pt; margin: 5px 0; } th, td { padding: 2px 5px; }
pre { font-size: 7pt; padding: 4px 6px; margin: 5px 0; }
body > pre { font-size: 6.3pt; white-space: pre; word-break: normal; overflow: hidden; }
figure { margin: 6px 0 8px; } figure img { max-height: 72mm; } figcaption { font-size: 8.6pt; }
"""

# figuras lado a lado: <div class="par"> ... </div> alrededor de dos imágenes
PAR = """
.par { display: flex; gap: 4mm; page-break-inside: avoid; }
.par figure { flex: 1; margin: 6px 0; } .par figure img { max-height: 58mm; }
"""

CHROME = next(p for p in [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
] if os.path.exists(p))

CONSOLA = re.compile(r"<!--\s*consola:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*-->")
IMAGEN = re.compile(r'<p>\s*<img alt="([^"]*)" src="([^"]+)"\s*/?>\s*</p>')


def lineas(ruta, rangos):
    texto = ruta.read_text(encoding="utf-8-sig").splitlines()
    if rangos.strip() == "todo":
        return "\n".join(texto)
    partes = []
    for r in rangos.split(","):
        a, _, b = r.partition("-")
        partes.append("\n".join(texto[int(a) - 1:int(b or a)]))
    return "\n[…]\n".join(partes)


def convertir(md, salida):
    fuente = md.read_text(encoding="utf-8")
    titulo = re.search(r"^# (.+)$", fuente, re.M).group(1).strip()
    fuente = re.sub(r"^# .+\n", "", fuente, count=1, flags=re.M)
    fuente = re.sub(r"^\*\*Equipo:\*\*.*\n", "", fuente, count=1, flags=re.M)

    n = 0
    def consola(m):
        nonlocal n
        n += 1
        ruta = (md.parent / m.group(1)).resolve()
        return (f'\n<figure><pre>{html.escape(lineas(ruta, m.group(2)))}</pre>'
                f'<figcaption><b>Figura {n}.</b> <i>{html.escape(m.group(3))}</i></figcaption></figure>\n')
    # numerar en orden de aparición: imágenes y consolas comparten contador
    piezas = []
    for bloque in re.split(r"(<!--\s*consola:.+?-->|!\[[^\]]*\]\([^)]+\))", fuente):
        if CONSOLA.fullmatch(bloque or ""):
            piezas.append(CONSOLA.sub(consola, bloque))
        elif re.fullmatch(r"!\[[^\]]*\]\([^)]+\)", bloque or ""):
            n += 1
            alt, src = re.fullmatch(r"!\[([^\]]*)\]\(([^)]+)\)", bloque).groups()
            ruta = (md.parent / src).resolve().as_uri()
            piezas.append(f'\n<figure><img src="{ruta}" alt="">'
                          f'<figcaption><b>Figura {n}.</b> <i>{html.escape(alt)}</i></figcaption></figure>\n')
        else:
            piezas.append(bloque)
    cuerpo = markdown.markdown("".join(piezas), extensions=["tables", "fenced_code", "sane_lists", "md_in_html"])

    portada = (f'<section class="portada"><img src="{LOGO.as_uri()}" alt="">'
               + "".join(f"<p>{html.escape(t)}</p>" for t in [
                   "Instituto Tecnológico de Colima", "Ingeniería en Inteligencia Artificial",
                   "Cómputo en la Nube", "Proyecto Nebula Arena — Unidad 3", titulo, *EQUIPO, FECHA])
               + "</section>")
    doc = (f"<!doctype html><html lang='es'><head><meta charset='utf-8'><title>{html.escape(titulo)}</title>"
           f"<style>{CSS}{PAR}</style></head><body>{portada}{cuerpo}</body></html>")
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8", dir=md.parent) as f:
        f.write(doc)
        tmp = f.name
    crudo = salida / (md.stem + ".sin-numeros.pdf")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    "--allow-file-access-from-files", f"--print-to-pdf={crudo}", pathlib.Path(tmp).as_uri()],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    os.remove(tmp)

    # número de página abajo al centro (la portada cuenta como 1 pero no lo muestra)
    d = fitz.open(crudo)
    for i, p in enumerate(d):
        if i == 0:
            continue
        t = str(i + 1)
        ancho = fitz.get_text_length(t, fontname="helv", fontsize=9.5)
        p.insert_text(((p.rect.width - ancho) / 2, p.rect.height - 34), t, fontname="helv", fontsize=9.5)
    pdf = salida / (md.stem + ".pdf")
    d.save(pdf, garbage=3, deflate=True)
    d.close()
    os.remove(crudo)
    print("ok", pdf.name, f"{fitz.open(pdf).page_count} págs", f"{n} figuras", pdf.stat().st_size)


salida = pathlib.Path(sys.argv[1]).resolve()
salida.mkdir(parents=True, exist_ok=True)
for md in map(pathlib.Path, sys.argv[2:]):
    convertir(md.resolve(), salida)
