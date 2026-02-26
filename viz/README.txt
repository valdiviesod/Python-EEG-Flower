INSTRUCCIONES DE USO
====================

Para ver la visualización correctamente, necesitas ejecutar un servidor web local.
Si abres el archivo index.html directamente (doble clic), es muy probable que no funcione debido a las restricciones de seguridad de los navegadores (CORS) que impiden cargar archivos JSON locales.

Cómo ejecutar:
--------------

OPCIÓN 1 (Recomendada - VS Code):
1. Instala la extensión "Live Server" en VS Code.
2. Haz clic derecho en el archivo `index.html` dentro de la carpeta `viz`.
3. Selecciona "Open with Live Server".

OPCIÓN 2 (Python):
1. Abre una terminal en la carpeta `EEG MIDI py`.
2. Ejecuta el comando: 
   python -m http.server
3. Abre tu navegador en: http://localhost:8000/viz/

NOTA SOBRE DATOS:
-----------------
La visualización buscará automáticamente el archivo "../SAD 1.json".
Si quieres visualizar nuevos datos capturados con `muse_capture.py`:
1. Captura datos nuevos (se guardarán como eeg_data_Xs.json).
2. Renombra el archivo nuevo a "SAD 1.json" o edita la línea 48 de `visualizer.js` para apuntar a tu nuevo archivo.
