# Plan: perfiles por nombre y capturas asociadas

## Objetivo

Cambiar el modelo actual de "una captura = una pulso en campo resonante" a "un nombre = un perfil = una pulso 3D en campo resonante".

Cada perfil agrupa varias capturas EEG 2D. Al abrir un perfil desde el campo resonante no debe mostrarse de inmediato una pulso 2D única; debe mostrarse una lista de capturas asociadas a ese nombre. Solo cuando el usuario selecciona una captura se renderiza la pulso 2D y su análisis.

## Comportamiento esperado

1. En captura, el usuario escribe un nombre o elige un nombre existente desde un selector.
2. Si el nombre ya existe, la nueva captura se asocia a ese perfil.
3. Si el nombre no existe, se crea un perfil nuevo automáticamente al guardar la captura.
4. En campo resonante aparece una sola pulso 3D por nombre/perfil, no una por captura.
5. Al hacer clic en una pulso 3D del campo resonante se abre el detalle del perfil.
6. El detalle muestra primero lista de capturas 2D asociadas a ese nombre.
7. Al seleccionar una captura de la lista, se carga su JSON, se renderiza su pulso 2D y se muestra su análisis.
8. Renombrar un perfil debe mover todas las capturas de ese nombre al nuevo nombre.
9. Eliminar debe definirse con dos acciones separadas: eliminar captura individual o eliminar perfil completo.

## Estado actual relevante

- `app_server.py` guarda capturas en `captures/*.json`.
- Cada JSON contiene `metadata.user_name`, `metadata.user_state`, `metadata.capture_timestamp`, `metadata.duration_seconds`, etc.
- `/api/garden/list` devuelve lista plana de capturas.
- `/api/garden/file?name=<filename>` devuelve un JSON de captura.
- `/api/garden/latest` devuelve la última captura.
- `pulse/galaxy.js` carga cada captura y crea una estrella por captura en `GalaxyGarden.loadCaptures`.
- `app/app.js` abre el modal con `openGardenModalFromData(captureData)` y renderiza pulso 2D + análisis inmediatamente.

## Modelo de datos propuesto

Mantener compatibilidad con capturas existentes. No mover archivos en primera fase.

Cada captura sigue siendo un JSON plano:

```json
{
  "metadata": {
    "profile_name": "María García",
    "user_name": "María García",
    "capture_id": "eeg_maria_garcia_20260505_132000",
    "capture_timestamp": "2026-05-05 13:20:00",
    "user_state": "serenidad"
  },
  "eeg_channels": {},
  "timestamps": [],
  "statistics": {}
}
```

Reglas:

- `profile_name` será campo nuevo canónico.
- `user_name` queda por compatibilidad y debe mantenerse igual a `profile_name`.
- Si una captura vieja no tiene `profile_name`, backend usa `metadata.user_name`.
- Si tampoco tiene nombre, usar `"Anónimo"` o `"Sin nombre"` como grupo.
- `capture_id` puede derivarse del filename para capturas viejas.

## API backend

### `GET /api/profiles/list`

Devuelve perfiles agrupados por nombre.

Respuesta:

```json
{
  "ok": true,
  "profiles": [
    {
      "profile_name": "María García",
      "slug": "maria-garcia",
      "capture_count": 4,
      "latest_capture_filename": "eeg_Maria_Garcia_serenidad_20260505_132000.json",
      "latest_capture_timestamp": "2026-05-05 13:20:00",
      "states": ["serenidad", "energia"],
      "total_samples": 24800,
      "representative": {
        "filename": "eeg_Maria_Garcia_serenidad_20260505_132000.json",
        "duration_seconds": 60.0,
        "sample_rate_hz": 256.0
      }
    }
  ]
}
```

Uso:

- Cargar selector de nombres existentes en vista captura.
- Cargar campo resonante con una pulso por perfil.

### `GET /api/profiles/captures?name=<profile_name>`

Devuelve capturas de un perfil, sin cargar EEG completo.

Respuesta:

```json
{
  "ok": true,
  "profile_name": "María García",
  "captures": [
    {
      "filename": "eeg_Maria_Garcia_serenidad_20260505_132000.json",
      "capture_timestamp": "2026-05-05 13:20:00",
      "user_state": "serenidad",
      "duration_seconds": 60.0,
      "total_samples": 15360,
      "sample_rate_hz": 256.0
    }
  ]
}
```

Uso:

- Modal detalle de perfil.
- Lista seleccionable de capturas 2D.

### `GET /api/profiles/representative?name=<profile_name>`

Devuelve JSON EEG completo de captura representativa del perfil.

Regla inicial:

- Usar captura más reciente con `total_samples > 0`.
- Si todas tienen `0` muestras, usar más reciente.

Uso:

- Construir una sola pulso 3D del perfil en campo resonante.
- Evitar cargar todos los EEG completos para pintar campo.

### Mantener endpoints existentes

No romper:

- `GET /api/garden/list`
- `GET /api/garden/file?name=<filename>`
- `GET /api/garden/latest`
- `POST /api/garden/delete`
- `POST /api/garden/rename`

Pero internamente conviene que:

- `/api/garden/list` pueda quedar legacy.
- Nuevo campo resonante use `/api/profiles/list`.
- Modal use `/api/profiles/captures`.

### `POST /api/profiles/rename`

Renombra perfil completo.

Body:

```json
{
  "oldName": "María García",
  "newName": "Maria G"
}
```

Efecto:

- Actualizar `metadata.profile_name`.
- Actualizar `metadata.user_name`.
- Aplicar a todas las capturas cuyo nombre normalizado coincida.
- No hace falta renombrar archivos en primera fase; evitar riesgo.

### `POST /api/profiles/delete`

Eliminar perfil completo.

Body:

```json
{
  "name": "María García"
}
```

Efecto:

- Borra todas las capturas del perfil.
- Mostrar confirmación fuerte en UI.

### `POST /api/profiles/capture/delete`

Eliminar una captura individual.

Body:

```json
{
  "filename": "eeg_Maria_Garcia_serenidad_20260505_132000.json"
}
```

Efecto:

- Borra solo ese JSON.
- Si era última captura del perfil, el perfil desaparece de `/api/profiles/list`.

## Cambios en captura

Archivos:

- `app/index.html`
- `app/app.js`
- `app/style.css`
- `app_server.py`

UI propuesta:

- Mantener input `#input-name`.
- Agregar selector/autocomplete de perfiles existentes debajo o dentro del mismo campo.
- Label sugerido: "Nombre del participante o perfil existente".
- Al enfocar, cargar nombres desde `/api/profiles/list`.
- Si usuario selecciona nombre existente, llenar `#input-name`.
- Si usuario escribe nombre nuevo, crear perfil implícito al guardar captura.

Validaciones:

- Nombre requerido para crear perfil real.
- Normalizar espacios: trim, colapsar espacios múltiples.
- Comparación case-insensitive para detectar existente.
- Si usuario escribe `maria garcia` y existe `María García`, asociar al existente si normalización coincide.

Inicio captura:

- En `POST /api/capture/start`, enviar `profileName` además de `userName`.
- Backend acepta ambos; si no viene `profileName`, usa `userName`.
- En `_build_capture_payload_locked`, guardar `profile_name`.
- En `_auto_save_capture`, usar `profile_name` para nombre de archivo.

## Campo resonante

Archivos:

- `app/app.js`
- `pulse/galaxy.js`
- `app/style.css`

Cambio principal:

- `loadGarden()` debe llamar `/api/profiles/list`, no `/api/garden/list`.
- `GalaxyGarden.loadCaptures(...)` debe convertirse o complementarse con `GalaxyGarden.loadProfiles(...)`.
- Cada item visual representa perfil, no captura.

Carga de datos para 3D:

Opción recomendada:

- `loadProfiles(profilesList)` recibe metadatos agrupados.
- Por cada perfil, carga `/api/profiles/representative?name=...`.
- Con ese JSON crea `EEGBandAnalyzer` y report.
- Crea una sola estrella/pulso 3D por perfil.

Datos que debe tener cada estrella:

```js
{
  type: 'profile',
  profile_name: 'María García',
  capture_count: 4,
  latest_capture_filename: '...',
  representative_capture: { ...json EEG... }
}
```

Filtro:

- `filterByName(query)` debe buscar en `star.data.profile_name`.
- Mantener fallback a `star.data.metadata.user_name` para compatibilidad.

Etiqueta:

- Mostrar nombre y contador: `María García · 4 capturas`.

Click:

- En vez de `openGardenModalFromData(captureData)`, llamar `openProfileModal(profileData)`.

## Detalle de perfil

Archivos:

- `app/index.html`
- `app/app.js`
- `app/style.css`

Cambiar modal actual:

- Header: `Perfil de <nombre>`.
- Meta: `<N> capturas · última: <fecha>`.
- Primer panel visible: lista de capturas.
- No crear `LavaPulse` al abrir modal.
- No crear `EEGBandAnalyzer` al abrir modal.

Estructura UI propuesta:

- Nueva pestaña o panel inicial: `Capturas`.
- Lista/cards:
  - Fecha/hora.
  - Estado emocional.
  - Duración.
  - Muestras.
  - Botón `Ver pulso 2D`.
  - Botón `Eliminar captura`.
- Panel 2D + análisis queda vacío hasta selección.

Flujo al abrir:

1. `openProfileModal(profileData)`.
2. Guardar `gardenCurrentProfileName`.
3. Llamar `/api/profiles/captures?name=...`.
4. Renderizar lista.
5. Mostrar mensaje: "Selecciona una captura para ver su pulso 2D y análisis".
6. No iniciar MIDI todavía.

Flujo al seleccionar captura:

1. Fetch `/api/garden/file?name=<filename>`.
2. Guardar `gardenCurrentJson` y `gardenCurrentFile`.
3. Crear `EEGBandAnalyzer(captureJson)`.
4. Crear `LavaPulse(canvas, analyzer)`.
5. Renderizar análisis con `renderGardenAnalysisHTML(report)`.
6. Activar reproducción MIDI si aplica.
7. Habilitar descargar MIDI.

Pestañas sugeridas:

- `Capturas`
- `Pulso 2D`
- `Análisis`

Regla:

- `Pulso 2D` y `Análisis` pueden estar deshabilitadas hasta seleccionar captura.

## Pulso 3D en detalle

Requisito dice que en campo resonante habrá un solo pulso 3D por nombre. En detalle no debe cargar su pulso 2D automático.

Decisión recomendada:

- Quitar pestaña `Pulso 3D` del modal de detalle por ahora.
- Mantener 3D solo en campo resonante.
- Si luego se necesita 3D en detalle, usar la captura representativa del perfil, no una captura individual.

## Renombrar

Cambiar significado de botón actual `Renombrar`:

- Antes: renombra captura individual.
- Nuevo: renombra perfil completo.

UI:

- Texto modal: "Renombrar perfil".
- Advertencia: "Se actualizarán todas las capturas asociadas a este nombre".

Backend:

- Implementar `/api/profiles/rename`.
- Actualizar todos los JSON del perfil.
- Refrescar campo resonante y modal tras éxito.

## Eliminar

Separar acciones:

- En header del perfil: `Eliminar perfil`.
- En cada item de lista: `Eliminar captura`.

Confirmaciones:

- Eliminar captura: "Se eliminará esta captura, el perfil seguirá existiendo si tiene más capturas".
- Eliminar perfil: "Se eliminarán N capturas de este perfil. No se puede deshacer".

Backend:

- Perfil completo: `/api/profiles/delete`.
- Captura individual: `/api/profiles/capture/delete` o reutilizar `/api/garden/delete`.

## Migración de capturas existentes

No se requiere migración física inicial.

Lectura agrupada:

- Backend escanea `captures/*.json`.
- Para cada archivo:
  - `profile_name = metadata.profile_name || metadata.user_name || 'Sin nombre'`.
  - `capture_id = metadata.capture_id || filename sin .json`.
  - Agrega a grupo normalizado.

Normalización recomendada:

- Trim.
- Lowercase.
- Quitar dobles espacios.
- Opcional: quitar acentos para comparar (`María` = `Maria`).

Escritura nueva:

- Agregar `profile_name` a todos los JSON nuevos.
- Mantener `user_name`.

Tarea opcional posterior:

- Script `migrate_profiles.py` para reescribir capturas viejas agregando `profile_name` y `capture_id`.
- No necesario para primera entrega si endpoints hacen fallback.

## Orden de implementación

1. Backend helpers:
   - `normalize_profile_name(name)`.
   - `get_capture_profile_name(data)`.
   - `load_capture_index()` que devuelve capturas y perfiles agrupados.

2. Backend endpoints:
   - `GET /api/profiles/list`.
   - `GET /api/profiles/captures`.
   - `GET /api/profiles/representative`.
   - `POST /api/profiles/rename`.
   - `POST /api/profiles/delete`.

3. Guardado de captura:
   - Agregar `profile_name` a metadata.
   - Aceptar `profileName` en `/api/capture/start`.

4. UI captura:
   - Cargar perfiles existentes.
   - Agregar selector/autocomplete.
   - Enviar `profileName`.

5. Campo resonante:
   - Cambiar `loadGarden()` a `/api/profiles/list`.
   - Crear `GalaxyGarden.loadProfiles()`.
   - Una estrella por perfil.
   - Etiqueta con contador.

6. Modal perfil:
   - Crear `openProfileModal(profileData)`.
   - Renderizar lista de capturas.
   - Diferir 2D/análisis hasta selección.

7. Acciones:
   - Renombrar perfil.
   - Eliminar captura.
   - Eliminar perfil.

8. Compatibilidad:
   - Mantener funciones viejas hasta que no haya referencias.
   - Fallback para capturas sin `profile_name`.

## Riesgos y decisiones

- Cargar representante por perfil sigue haciendo fetch de JSON completo por perfil. Aceptable si hay pocos perfiles; si crece, agregar endpoint con análisis resumido precalculado.
- Dos nombres casi iguales pueden crear perfiles separados. Mitigar con normalización y selector claro.
- Renombrar archivos puede romper referencias; no renombrar archivos en primera fase.
- Capturas con `total_samples = 0` pueden generar pulso pobre. Representante debe preferir muestras reales.
- Modal actual asume captura individual. Refactor debe evitar reproducir MIDI y crear `LavaPulse` antes de selección.

## Pruebas manuales

1. Crear captura con nombre nuevo `Ana`.
2. Ver campo resonante: aparece una sola pulso 3D `Ana · 1 captura`.
3. Crear otra captura con nombre `Ana`.
4. Ver campo resonante: sigue una sola pulso 3D `Ana · 2 capturas`.
5. Abrir `Ana`: aparece lista de 2 capturas, sin pulso 2D cargado.
6. Seleccionar primera captura: aparece pulso 2D + análisis correcto.
7. Seleccionar segunda captura: pulso 2D y análisis cambian.
8. Descargar MIDI usa captura seleccionada.
9. Eliminar una captura: contador baja.
10. Eliminar última captura: perfil desaparece.
11. Renombrar perfil `Ana` a `Ana P`: ambas capturas cambian de grupo.
12. Capturas viejas sin `profile_name` aparecen agrupadas por `user_name`.

## Criterio de terminado

- No hay duplicados visuales por capturas del mismo nombre en campo resonante.
- Captura nueva con nombre existente se asocia al perfil existente.
- Detalle de perfil no carga pulso 2D hasta que usuario elige captura.
- Cada captura seleccionada muestra su propio pulso 2D y análisis.
- Endpoints legacy siguen funcionando para no romper flujo actual.
