# NAD — Neuroarmonía Divergente

> **Captura tus ondas cerebrales. Conviértelas en arte, música y pulsos únicas.**

NAD es una aplicación web de código abierto que conecta la diadema **Muse 2** con un servidor Python local, convierte señales EEG en tiempo real en visualizaciones botánicas generativas, archivos MIDI descargables y mandalas personalizados. Cada sesión produce una obra irrepetible — una pulso que crece desde las frecuencias de tu cerebro.

---

## Vista rápida

| Captura EEG en vivo | Pulso Neurofuncional | Jardín de sesiones |
|---|---|---|
| Gráfica butterfly multicanal sobre fondo negro, con trazos dinámicos y diferenciados por canal | Pulso 2D/3D generada desde 5 bandas de frecuencia cerebral | Galería interactiva de todas tus capturas anteriores |

---

## Características principales

### Captura EEG en tiempo real
- Recibe datos de la diadema **Muse 2** vía protocolo **OSC/UDP** (puerto 5000)
- 4 canales simultáneos: `TP9` (temporal izquierdo), `AF7` (frontal izquierdo), `AF8` (frontal derecho), `TP10` (temporal derecho)
- Visualización en directo con **gráfica butterfly EEG**:
  - Fondo negro con glow y retícula sutil
  - 4 canales superpuestos (`TP9`, `AF7`, `AF8`, `TP10`) con color independiente
  - Trazos múltiples por canal para una sensación más orgánica y dinámica
  - Vista resumen posterior con la misma estética butterfly
- Contador de picos de actividad beta (**Trazo**) y recuperaciones alfa (**Recuperación**)
- Guía de mindfulness animada durante la sesión
- Captura con duración fija o manual (detención libre)
- Auto-guardado en `captures/` al terminar

### Pulso Neurofuncional
La captura se transforma en una **pulso generativa única** analizando 5 bandas de frecuencia cerebral mediante FFT:

| Banda | Frecuencia | Color | Significado |
|---|---|---|---|
| 🌙 **Base** (Delta) | 0.5 – 4 Hz | Lavanda `#8B5CF6` | Inmersión profunda, inconsciente |
| 🌌 **Flujo** (Theta) | 4 – 8 Hz | Salvia `#22C55E` | Movimiento interno, creatividad |
| 💫 **Pulso** (Alpha) | 8 – 13 Hz | Rosa `#EC4899` | Atención relajada, presencia |
| ☀️ **Trazo** (Beta) | 13 – 30 Hz | Durazno `#F97316` | Acción, dirección, pensamiento activo |
| ⚡ **Destello** (Gamma) | 30 – 44 Hz | Limón `#EAB308` | Intensidad, claridad suprema |

Cada banda determina el **tamaño, forma y color de cada capa de pétalos**. La pulso resultante es matemáticamente única para cada persona y cada momento.

**Visualización disponible en:**
- **2D** — Canvas HTML con curvas Bézier y gradientes botánicos, exportable como PNG
- **3D** — Escultura Three.js con materiales translúcidos, sombras PCF, partículas de polen y rotación suave. Exportable para **impresión 3D** en formatos GLB, 3MF y STL con colores integrados

### Jardín Neurofuncional
- Vista de galería 3D interactiva (Three.js) con todas las capturas guardadas
- Cada pulso crece en el jardín con su propio color y forma desde los datos EEG reales
- Clic en cualquier pulso para abrir su ficha completa: pulso 2D, pulso 3D y análisis de bandas
- **Reproducción MIDI musical**: cada pulso suena con guitarra nylon real (`soundfont-player` + MusyngKite), notas cuantizadas a la escala pentatónica de Do mayor, con reverb de sala (ConvolverNode 2.2s) y mezcla estéreo por canal
- Opciones por pulso: descargar MIDI, descargar mandala, renombrar, eliminar

### Exportaciones
- 📊 **JSON** — datos EEG crudos con metadatos (nombre, edad, duración, frecuencia de muestreo)
- 🎵 **MIDI** — conversión directa de señal EEG a notas MIDI (4 pistas, una por canal), descargable desde la captura o desde el jardín
- ☸️ **Mandala SVG** — mandala generativo derivado de la actividad cerebral, listo para imprimir
- 💫 **Pulso PNG** — exportación directa desde canvas
- 🖨️ **Modelos 3D** (GLB / 3MF / STL) — para impresión 3D con colores por banda

### Tour interactivo
Al abrir la app o iniciar una nueva captura, un tour guiado paso a paso introduce al usuario en cada función de la interfaz, sin necesidad de conocimientos técnicos.

---

## Arquitectura

```
NAD/
├── app_server.py          # Servidor HTTP unificado (Python stdlib, puerto 8000)
├── muse_capture.py        # Receptor OSC + conversor EEG→MIDI (python-osc, midiutil)
├── pulse_to_3d_print.py  # Pipeline de exportación 3D (trimesh, numpy)
├── safe_json_storage.py   # Escritura atómica de capturas JSON
├── requirements.txt
│
├── app/                   # SPA principal (vanilla JS + HTML + CSS)
│   ├── index.html         # Shell de la app, 3 vistas: Captura / Pulso / Jardín
│   ├── app.js             # Lógica principal: captura, tour, MIDI, jardín
│   ├── scalp_map.js       # Render butterfly EEG en tiempo real (Canvas 2D)
│   ├── mandala_generator.js
│   ├── brain.svg          # Recurso legado de la visualización cerebral anterior
│   └── style.css
│
├── pulse/                # Motor de pulsos (compartido con app)
│   ├── eeg_band_analyzer.js  # FFT + extracción de bandas + perfiles emocionales
│   ├── pulse_2d.js          # Renderizado 2D (Canvas, curvas Bézier)
│   ├── pulse_3d.js          # Escultura 3D (Three.js r128)
│   └── garden.js             # Jardín 3D interactivo (Three.js + OrbitControls)
│
└── captures/              # Capturas guardadas (.json, auto-generado)
```

### API REST del servidor

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/` | Sirve la SPA |
| `POST` | `/api/capture/start` | Inicia captura OSC con duración, nombre, edad opcionales |
| `POST` | `/api/capture/stop` | Detiene la captura y guarda en `captures/` |
| `GET` | `/api/capture/status` | Estado actual + datos en bruto de la captura activa |
| `GET` | `/api/capture/stream` | SSE en tiempo real (Server-Sent Events) |
| `GET` | `/api/capture/download-json` | Descarga el JSON de la sesión activa |
| `GET` | `/api/garden/list` | Lista todas las capturas guardadas |
| `GET` | `/api/garden/file?name=…` | Descarga una captura específica |
| `POST` | `/api/json-to-midi` | Convierte JSON de captura a archivo MIDI binario |
| `POST` | `/api/convert-pulse` | Genera modelo 3D imprimible desde parámetros de pulso |

### Pipeline de audio (jardín)

```
EEG JSON → /api/json-to-midi → @tonejs/midi parser
  → buildGardenPlaybackPlan()
      · Cuantización pentatónica (Do mayor: C D E G A)
      · Clamp de pitch C3–C6 (MIDI 48–84)
      · Reducción de densidad (máx. 300 notas/pista)
      · Espaciado mínimo 0.08s por canal
      · Dinámica suave (velocity × 0.55)
  → scheduleGardenMidiLoop()
      · soundfont-player → acoustic_guitar_nylon (MusyngKite)
      · StereoPannerNode por canal (−0.55 / −0.18 / +0.18 / +0.55)
      · Bus seco (gain 0.65) + Bus húmedo (ConvolverNode IR 2.2s, gain 0.35)
      · Master gain → AudioContext.destination
```

---

## Requisitos

### Python
```
python >= 3.10
python-osc >= 1.8.0
midiutil >= 1.2.1
matplotlib >= 3.5.0
numpy >= 1.21.0
trimesh >= 4.0.0
scipy >= 1.11.0
```

### Hardware
- **Diadema Muse 2** (InteraXon) con la app **Mind Monitor** (iOS/Android) configurada para enviar datos OSC a la IP de tu computadora, puerto `5000`
- Computadora en la misma red WiFi que la diadema

### Navegador
Cualquier navegador moderno (Chrome, Firefox, Edge, Safari) con soporte para Web Audio API y WebGL.

---

## Instalación y uso

```bash
# 1. Clona el repositorio
git clone https://github.com/valdiviesod/Python-EEG-Pulse.git
cd "Python-EEG-Pulse"

# 2. Instala dependencias Python
pip install -r requirements.txt

# 3. Inicia el servidor
python app_server.py

# 4. Abre la app en el navegador
# http://127.0.0.1:8000
```

Configura **Mind Monitor** en tu teléfono:
- Menú → OSC Stream
- IP: la IP local de tu computadora (visible en la terminal al iniciar el servidor)
- Puerto: `5000`
- Activa el stream y abre la app → **Iniciar Captura**

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Servidor | Python 3 `http.server.ThreadingHTTPServer` (sin dependencias web externas) |
| Protocolo EEG | OSC/UDP via `python-osc` |
| Generación MIDI | `midiutil` |
| Análisis de frecuencias | `numpy` FFT |
| Exportación 3D | `trimesh`, `scipy` |
| Frontend | Vanilla JS (ES2020), HTML5 Canvas, CSS3 |
| Visualización 3D | Three.js r128 + OrbitControls |
| Audio | Web Audio API + `soundfont-player` + `@tonejs/midi` |
| Fuentes | Google Fonts — Inter + Playfair Display |

---

## Filosofía de diseño

NAD está pensada para **personas sin conocimientos técnicos**. La interfaz no muestra datos de ingeniería — en lugar de frecuencias en Hz, ve bandas con nombres poéticos; en lugar de un monitor clínico, ve una visualización butterfly viva y expresiva. El objetivo es que la experiencia sea accesible, íntima y significativa: tu actividad cerebral como obra de arte.

---

## Licencia

MIT — libre para usar, modificar y distribuir.
