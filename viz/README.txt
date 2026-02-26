VIZ MUSE EEG (NUEVA INTERFAZ)
=============================

La carpeta `viz` ahora reemplaza el flujo por consola para:

1) Captura EEG en tiempo real (manual)
2) Captura EEG con duración personalizada
3) Guardar el JSON capturado (descarga directa)
4) Convertir cualquier JSON EEG a MIDI desde la GUI


Cómo ejecutar
-------------

1. Abre terminal en la raíz del proyecto (`EEG MIDI py`).
2. Inicia el servidor:

    python viz_local_server.py

3. Abre en navegador:

    http://127.0.0.1:8010/viz/


Configurar Muse
---------------

En la app del Muse configura OSC hacia:

- IP: 127.0.0.1
- Puerto: 5000


Flujo recomendado
-----------------

- Si quieres captura manual en vivo:
   - deja vacía la duración
   - pulsa "Iniciar captura"
   - pulsa "Detener captura"
   - pulsa "Guardar JSON"

- Si quieres captura automática por tiempo:
   - escribe segundos en "Duración personalizada"
   - pulsa "Iniciar captura"
   - espera a que termine sola
   - pulsa "Guardar JSON"

- Para convertir JSON a MIDI:
   - selecciona un archivo JSON EEG
   - pulsa "Convertir a MIDI"
   - se descargará el `.mid`
