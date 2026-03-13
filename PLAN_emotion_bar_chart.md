# Plan: Gráfico de Barras Emocional — EEG Sensation Analysis

## Objetivo

Agregar un gráfico de barras horizontal al panel de análisis que muestre **10 sensaciones humanas** derivadas de métricas compuestas entre bandas EEG. Cada barra indica la intensidad de una sensación (0–100%), permitiendo al usuario entender cómo se sintió durante la captura.

---

## Sensaciones y Fórmulas

Cada sensación se calcula a partir de relaciones entre bandas (delta, theta, alpha, beta, gamma como potencias relativas normalizadas):

| # | Sensación | Fórmula base | Interpretación |
|---|-----------|-------------|----------------|
| 1 | **Serenidad** | `Alpha / (Beta + Gamma)` | Alto = calma profunda |
| 2 | **Agitación** | `(Beta + Gamma) / Alpha` | Alto = mente acelerada |
| 3 | **Pesadez / Fatiga** | `Delta / (Alpha + Beta)` | Alto = cansancio, densidad corporal |
| 4 | **Ligereza** | `(Alpha + Beta) / Delta` | Alto = sensación liviana |
| 5 | **Absorción interna** | `Theta / Beta` | Alto = ensimismamiento, fantasía |
| 6 | **Enfoque externo** | `Beta / Theta` | Alto = analítico, atención dirigida |
| 7 | **Equilibrio** | `Alpha / (Theta + Beta)` | Alto = centrado, regulado |
| 8 | **Dispersión** | `(Theta + Beta) / Alpha` | Alto = desorganización |
| 9 | **Intensidad vivencial** | `Gamma / Alpha` | Alto = experiencia vívida, saturada |
| 10 | **Neutralidad** | `Alpha / Gamma` | Alto = estado plano, neutro |

> **Normalización**: Cada ratio se mapea a 0–100% usando `min-max` con rangos empíricos razonables (ej. ratio 0–3 → 0–100%). Si un valor excede el rango, se clampea.

---

## Paleta de Colores por Sensación

Usar la paleta existente del proyecto, asignando colores por la banda dominante en cada fórmula:

| Sensación | Color principal | CSS var / hex |
|-----------|----------------|---------------|
| Serenidad | Alpha (rosa) | `#FFD1DC` → deep `#F2A5BE` |
| Agitación | Beta (durazno) | `#FFDAB9` → deep `#F5BD8E` |
| Pesadez | Delta (lavanda) | `#C4B7D8` → deep `#9B8EC0` |
| Ligereza | Alpha+Beta blend | `#FFD1DC` → `#FFDAB9` gradient |
| Absorción | Theta (verde) | `#A8D8B9` → deep `#7CC496` |
| Enfoque | Beta (durazno) | `#FFDAB9` → deep `#F5BD8E` |
| Equilibrio | Alpha (rosa) | `#FFD1DC` → deep `#F2A5BE` |
| Dispersión | Theta+Beta blend | `#A8D8B9` → `#FFDAB9` gradient |
| Intensidad | Gamma (limón) | `#FFF3B0` → deep `#F0E68C` |
| Neutralidad | Alpha (rosa claro) | `#FFE8EF` → `#FFD1DC` |

---

## Diseño Visual del Gráfico

```
┌─────────────────────────────────────────────────┐
│  ✨ Tu Estado Emocional                         │
│                                                  │
│  Serenidad      ████████████████████░░░░  72%   │
│  Agitación      ██████░░░░░░░░░░░░░░░░░  28%   │
│  Pesadez        ████████░░░░░░░░░░░░░░░  35%   │
│  Ligereza       ██████████████░░░░░░░░░  58%   │
│  Absorción      ██████████████████░░░░░  68%   │
│  Enfoque        ████████░░░░░░░░░░░░░░░  32%   │
│  Equilibrio     ████████████████░░░░░░░  61%   │
│  Dispersión     ██████████░░░░░░░░░░░░░  39%   │
│  Intensidad     ████░░░░░░░░░░░░░░░░░░░  18%   │
│  Neutralidad    ██████████████████████░  82%   │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Especificaciones de estilo:
- **Contenedor**: `background: var(--bg-surface)`, `border-radius: var(--radius)`, `border: 1px solid var(--border)`, padding `1.5rem`
- **Título**: emoji + texto, `color: var(--text)`, `font-weight: 600`
- **Cada barra**:
  - Label a la izquierda (120px fijo), `color: var(--text)`, font-size 0.85rem
  - Barra fondo: `var(--border)` con `border-radius: 6px`, altura 22px
  - Barra relleno: `background: linear-gradient(90deg, {color}, {colorDeep})` con `border-radius: 6px`
  - Porcentaje a la derecha, `color: var(--text-dim)`, font-size 0.8rem
  - Transición: `width 1s cubic-bezier(0.4, 0, 0.2, 1)`
- **Animación de entrada**: barras crecen de 0% a su valor con delay escalonado (50ms entre cada una)
- **Tooltip** (opcional): al hacer hover muestra la fórmula y una frase descriptiva

---

## Archivos a Modificar

### 1. `flower/eeg_band_analyzer.js`

**Agregar método** `computeEmotionMetrics()` en la clase `EEGBandAnalyzer`:

```javascript
computeEmotionMetrics() {
    const d = this.normalizedBands.delta;  // valores 0-1 (potencia relativa)
    const t = this.normalizedBands.theta;
    const a = this.normalizedBands.alpha;
    const b = this.normalizedBands.beta;
    const g = this.normalizedBands.gamma;

    const clamp01 = (v, min, max) => Math.max(0, Math.min(1, (v - min) / (max - min)));

    return [
        { key: 'serenity',    label: 'Serenidad',          value: clamp01(a / (b + g + 0.001), 0, 3),   color: '#FFD1DC', colorDeep: '#F2A5BE', emoji: '🕊️', description: 'Calma profunda y presencia' },
        { key: 'agitation',   label: 'Agitación',          value: clamp01((b + g) / (a + 0.001), 0, 3),  color: '#FFDAB9', colorDeep: '#F5BD8E', emoji: '⚡', description: 'Mente acelerada y activa' },
        { key: 'heaviness',   label: 'Pesadez',            value: clamp01(d / (a + b + 0.001), 0, 3),    color: '#C4B7D8', colorDeep: '#9B8EC0', emoji: '🪨', description: 'Cansancio o densidad corporal' },
        { key: 'lightness',   label: 'Ligereza',           value: clamp01((a + b) / (d + 0.001), 0, 5),  color: '#FFD1DC', colorDeep: '#FFDAB9', emoji: '🪶', description: 'Sensación liviana y despejada' },
        { key: 'absorption',  label: 'Absorción interna',  value: clamp01(t / (b + 0.001), 0, 3),        color: '#A8D8B9', colorDeep: '#7CC496', emoji: '🌀', description: 'Ensimismamiento e imaginación' },
        { key: 'focus',       label: 'Enfoque externo',    value: clamp01(b / (t + 0.001), 0, 3),        color: '#FFDAB9', colorDeep: '#F5BD8E', emoji: '🎯', description: 'Atención analítica dirigida' },
        { key: 'balance',     label: 'Equilibrio',         value: clamp01(a / (t + b + 0.001), 0, 2),    color: '#FFD1DC', colorDeep: '#F2A5BE', emoji: '⚖️', description: 'Regulación estable y centrada' },
        { key: 'dispersion',  label: 'Dispersión',         value: clamp01((t + b) / (a + 0.001), 0, 4),  color: '#A8D8B9', colorDeep: '#FFDAB9', emoji: '💨', description: 'Desorganización mental' },
        { key: 'intensity',   label: 'Intensidad vivencial',value: clamp01(g / (a + 0.001), 0, 2),       color: '#FFF3B0', colorDeep: '#F0E68C', emoji: '✨', description: 'Experiencia vívida y saturada' },
        { key: 'neutrality',  label: 'Neutralidad',        value: clamp01(a / (g + 0.001), 0, 5),        color: '#FFE8EF', colorDeep: '#FFD1DC', emoji: '🫧', description: 'Estado plano y neutro' },
    ];
}
```

- Llamar este método en el constructor y guardar en `this.emotionMetrics`
- Los `0.001` previenen división por cero
- Los rangos `min/max` del `clamp01` son empíricos y ajustables

### 2. `app/app.js`

**Agregar función** `renderEmotionChart(emotions)` que:

1. Crea un contenedor `<div class="emotion-chart">`
2. Título con emoji: `"✨ Tu Estado Emocional"`
3. Por cada sensación, genera:
   ```html
   <div class="emotion-row">
     <span class="emotion-emoji">{emoji}</span>
     <span class="emotion-label">{label}</span>
     <div class="emotion-bar-track">
       <div class="emotion-bar-fill" style="width:{value}%; background:linear-gradient(90deg,{color},{colorDeep})"></div>
     </div>
     <span class="emotion-value">{value}%</span>
   </div>
   ```
4. Animación: usar `requestAnimationFrame` → set width a 0 inicialmente, luego al valor real con delay escalonado

**Integrar en** `renderAnalysis()` (línea ~874):
- Después de `renderBandBar()` y antes de las band cards, insertar el emotion chart
- Pasar `analyzer.emotionMetrics` al render

### 3. `app/style.css`

**Agregar estilos** al final del archivo:

```css
/* ── Emotion Bar Chart ── */
.emotion-chart {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    margin-bottom: 1.5rem;
}

.emotion-chart-title {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 1.25rem;
}

.emotion-row {
    display: grid;
    grid-template-columns: 28px 140px 1fr 48px;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
}

.emotion-emoji { font-size: 1rem; text-align: center; }

.emotion-label {
    font-size: 0.85rem;
    color: var(--text);
    font-weight: 500;
}

.emotion-bar-track {
    height: 22px;
    background: var(--border);
    border-radius: 6px;
    overflow: hidden;
}

.emotion-bar-fill {
    height: 100%;
    border-radius: 6px;
    width: 0%;
    transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
}

.emotion-value {
    font-size: 0.8rem;
    color: var(--text-dim);
    text-align: right;
    font-weight: 600;
}
```

---

## Pasos de Ejecución (para la IA)

1. **Leer** `flower/eeg_band_analyzer.js` — ubicar el constructor y `_computeFlowerProfile()`
2. **Agregar** método `computeEmotionMetrics()` a la clase
3. **Agregar** llamada en constructor: `this.emotionMetrics = this.computeEmotionMetrics();`
4. **Leer** `app/app.js` — ubicar `renderAnalysis()` y `renderBandBar()`
5. **Agregar** función `renderEmotionChart(emotions)` en app.js
6. **Integrar** llamada a `renderEmotionChart` dentro de `renderAnalysis()`
7. **Leer** `app/style.css` — ir al final
8. **Agregar** los estilos CSS del emotion chart
9. **Probar** abriendo la app, cargando un JSON de captura y verificando que el gráfico aparece en el panel de análisis

---

## Notas Importantes

- Las bandas normalizadas (`normalizedBands`) ya existen en el analyzer como valores 0–1 (porcentaje de potencia total)
- Los rangos del `clamp01` son empíricos — se pueden ajustar observando datos reales
- Las sensaciones complementarias (serenidad/agitación, pesadez/ligereza, etc.) siempre suman ~100% si los rangos están bien calibrados
- No se modifica ninguna funcionalidad existente — es puramente aditivo
- Se reutiliza toda la paleta de colores CSS existente del proyecto
