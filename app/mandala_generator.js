/**
 * MandalaGenerator — EEG-driven mandala basado en mandala_reference.svg
 *
 * Usa el mandala de referencia como forma principal. Los datos EEG de cada
 * persona determinan cómo se transforma esa forma:
 *
 *   Delta  → escala global (más grande / más pequeño)
 *   Theta  → rotación y ecos giratorios adicionales
 *   Alpha  → grosor del trazo y claridad visual
 *   Beta   → cantidad de ecos fractales y densidad
 *   Gamma  → micro-detalles: puntos radiantes y anillos finos
 *
 * Composición:
 *   1. Borde circular exterior (EEG-driven notches)
 *   2. Ecos del mandala de referencia a escalas menores (fractales)
 *   3. Satélites en órbita (mini-copias del mandala base)
 *   4. Mandala de referencia principal (forma base)
 *   5. Detalles gamma centrales (puntos y anillos)
 *   6. Punto central
 *
 * Output: SVG limpio (fondo blanco, trazos negros).
 */

class MandalaGenerator {

    /**
     * @param {object} report       – reporte completo de EEGBandAnalyzer.getReport()
     * @param {string} referenceSvg – texto SVG de mandala_reference.svg
     */
    constructor(report, referenceSvg) {
        this.bands   = report.bands;
        this.params  = report.flowerParams;
        this.profile = report.profile;
        this.emotions = report.emotionMetrics;

        this.refPathData = this._extractPathData(referenceSvg);
        this.refViewBox  = this._extractViewBox(referenceSvg);

        this._computeEEGParams();
    }

    // ── Parseo del SVG de referencia ─────────────────────────────────────

    _extractPathData(svgText) {
        if (!svgText) return '';
        const m = svgText.match(/<path\s+d="([^"]+)"/);
        return m ? m[1] : '';
    }

    _extractViewBox(svgText) {
        if (!svgText) return { x: 0, y: 0, w: 1259, h: 1280 };
        const m = svgText.match(/viewBox="([^"]+)"/);
        if (!m) return { x: 0, y: 0, w: 1259, h: 1280 };
        const p = m[1].split(/\s+/).map(Number);
        return { x: p[0] || 0, y: p[1] || 0, w: p[2], h: p[3] };
    }

    // ── Parámetros EEG únicos por persona ────────────────────────────────

    _computeEEGParams() {
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const getVis = (key) => {
            const b = this.bands.find(b => b.key === key);
            return b ? (b.visualSize != null ? b.visualSize : b.relativePower) : 0.2;
        };

        const deltaV = getVis('delta');
        const thetaV = getVis('theta');
        const alphaV = getVis('alpha');
        const betaV  = getVis('beta');
        const gammaV = getVis('gamma');

        // Tamaño del canvas: delta = más expansivo
        this.size = Math.round(800 + deltaV * 400);
        this.cx   = this.size / 2;
        this.cy   = this.size / 2;

        // Escala del mandala de referencia principal
        this.baseScale = 0.30 + deltaV * 0.18;

        // Rotación (theta = creatividad, formas fluidas)
        this.baseRotation = thetaV * 45 - 22.5;   // -22.5° a +22.5°

        // Grosor de trazo (alpha = claridad)
        this.strokeWeight = 0.5 + alphaV * 1.2;

        // Ecos fractales: cuántas copias menores (beta + gamma)
        this.fractalDepth = Math.round(1 + betaV * 2 + gammaV * 1.5); // 1–5

        // Satélites orbitando el centro (gamma = cognición compleja)
        this.satelliteCount = Math.round(gammaV * 8);  // 0–8

        // Detalles gamma: puntos y anillos finos
        this.gammaDots  = Math.round(20 + gammaV * 60);
        this.gammaRings = Math.round(1 + gammaV * 3);

        // Notches del borde exterior (delta = lentas → pocas; gamma = rápidas → muchas)
        this.borderNotches = Math.round(24 + (gammaV - deltaV) * 30);

        // Emoción dominante para el punto central
        if (this.emotions && this.emotions.length > 0) {
            const sorted = [...this.emotions].sort((a, b) => b.value - a.value);
            this.dominantEmotion = sorted[0].key;
        } else {
            this.dominantEmotion = 'balance';
        }
    }

    // ── Generar SVG completo ─────────────────────────────────────────────

    generate() {
        const s = this.size;
        const parts = [
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">`,
            `<rect width="${s}" height="${s}" fill="#fff"/>`,
            `<g stroke="#000" fill="none" stroke-linecap="round" stroke-linejoin="round">`
        ];

        // 1. Borde exterior
        parts.push(this._outerBorder());

        // 2. Ecos fractales (copias del mandala a escalas menores, detrás)
        parts.push(this._fractalEchoes());

        // 3. Satélites (mini-copias orbitando, si gamma es alto)
        if (this.satelliteCount > 0) {
            parts.push(this._satellites());
        }

        // 4. Mandala de referencia principal
        parts.push(this._primaryMandala());

        // 5. Detalles gamma (puntos y anillos centrales finos)
        parts.push(this._gammaDetails());

        // 6. Punto central
        parts.push(this._centerDot());

        parts.push('</g></svg>');
        return parts.join('\n');
    }

    // ── Utilidades ───────────────────────────────────────────────────────

    _circle(r, sw = 0.5) {
        return `<circle cx="${this.cx}" cy="${this.cy}" r="${r}" stroke-width="${sw}"/>`;
    }

    _polarXY(r, angle) {
        return {
            x: this.cx + r * Math.cos(angle),
            y: this.cy + r * Math.sin(angle)
        };
    }

    /**
     * Genera un grupo SVG con el path del mandala de referencia
     * centrado en (cx, cy) con la escala y rotación indicadas.
     */
    _refGroup(scale, rotation, opacity = 1, strokeW = null) {
        if (!this.refPathData) return '';
        const vb  = this.refViewBox;
        const sw  = (strokeW || this.strokeWeight);

        // Las coordenadas originales del potrace son:
        //   viewBox="0 0 1259 1280" con transform="translate(0,1280) scale(0.1,-0.1)"
        // Tras aplicar ese transform, el área visible es ≈125.9 × 128 unidades.
        const visW = vb.w * 0.1;
        const visH = vb.h * 0.1;

        const targetPx = this.size * scale;
        const fit = targetPx / Math.max(visW, visH);

        return [
            `<g transform="translate(${this.cx},${this.cy}) rotate(${rotation}) scale(${fit}) translate(${-visW / 2},${-visH / 2})"`,
            `   opacity="${opacity.toFixed(3)}" stroke-width="${(sw / fit).toFixed(4)}">`,
            `  <g transform="translate(0,${vb.h}) scale(0.1,-0.1)" fill="#000" stroke="none">`,
            `    <path d="${this.refPathData}"/>`,
            `  </g>`,
            `</g>`
        ].join('\n');
    }

    // ── 1. Borde exterior ────────────────────────────────────────────────

    _outerBorder() {
        const s    = this.size;
        const rOut = s * 0.48;
        const rIn  = s * 0.468;
        const sw   = this.strokeWeight;
        const n    = Math.max(12, this.borderNotches);
        const parts = [];

        parts.push(this._circle(rOut, sw * 1.2));
        parts.push(this._circle(rIn,  sw * 0.35));

        // Pequeños ticks entre los dos círculos
        for (let i = 0; i < n; i++) {
            const angle = (i / n) * Math.PI * 2;
            const p1 = this._polarXY(rIn,       angle);
            const p2 = this._polarXY(rIn - s * 0.008, angle);
            parts.push(`<line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}" stroke-width="${(sw * 0.3).toFixed(3)}"/>`);
        }

        return parts.join('\n');
    }

    // ── 2. Ecos fractales ────────────────────────────────────────────────

    _fractalEchoes() {
        if (!this.refPathData) return '';
        const depth = this.fractalDepth;
        const parts = [];

        for (let i = 1; i <= depth; i++) {
            const scale    = this.baseScale * (0.42 / i);
            const rotation = this.baseRotation + i * 28 * (i % 2 === 0 ? 1 : -1);
            const opacity  = Math.max(0.12, 0.65 - i * 0.12);
            parts.push(this._refGroup(scale, rotation, opacity, this.strokeWeight * 0.4));
        }

        return parts.join('\n');
    }

    // ── 3. Satélites orbitando ───────────────────────────────────────────

    _satellites() {
        if (!this.refPathData) return '';
        const parts = [];
        const n     = this.satelliteCount;
        const orbitR = this.size * 0.30;
        const satScale = this.baseScale * 0.10;
        const vb    = this.refViewBox;
        const visW  = vb.w * 0.1;
        const visH  = vb.h * 0.1;
        const targetPx = this.size * satScale;
        const fit   = targetPx / Math.max(visW, visH);
        const sw    = this.strokeWeight * 0.25 / fit;

        for (let i = 0; i < n; i++) {
            const angle = (i / n) * Math.PI * 2;
            const px = this.cx + orbitR * Math.cos(angle);
            const py = this.cy + orbitR * Math.sin(angle);
            const rot = this.baseRotation + (i * 360 / n);

            parts.push([
                `<g transform="translate(${px.toFixed(2)},${py.toFixed(2)}) rotate(${rot.toFixed(2)}) scale(${fit.toFixed(4)}) translate(${(-visW / 2).toFixed(2)},${(-visH / 2).toFixed(2)})"`,
                `   opacity="0.25" stroke-width="${sw.toFixed(4)}">`,
                `  <g transform="translate(0,${vb.h}) scale(0.1,-0.1)" fill="#000" stroke="none">`,
                `    <path d="${this.refPathData}"/>`,
                `  </g>`,
                `</g>`
            ].join('\n'));
        }

        return parts.join('\n');
    }

    // ── 4. Mandala de referencia principal ───────────────────────────────

    _primaryMandala() {
        return this._refGroup(this.baseScale, this.baseRotation, 1, this.strokeWeight * 0.65);
    }

    // ── 5. Detalles gamma ────────────────────────────────────────────────

    _gammaDetails() {
        const parts = [];
        const s     = this.size;
        const sw    = this.strokeWeight * 0.4;
        const innerR = s * 0.04;
        const outerR = s * 0.12;

        // Anillos concéntricos finos
        for (let i = 0; i < this.gammaRings; i++) {
            const r = innerR + (outerR - innerR) * ((i + 1) / (this.gammaRings + 1));
            parts.push(this._circle(r, sw));
        }

        // Corona de puntos
        const dotR = (innerR + outerR) * 0.65;
        for (let i = 0; i < this.gammaDots; i++) {
            const angle = (i / this.gammaDots) * Math.PI * 2;
            const p = this._polarXY(dotR, angle);
            const r = 0.6 + (this.bands.find(b => b.key === 'gamma')?.visualSize || 0.2) * 0.8;
            parts.push(`<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${r.toFixed(2)}" fill="#000" stroke="none"/>`);
        }

        return parts.join('\n');
    }

    // ── 6. Punto central ────────────────────────────────────────────────

    _centerDot() {
        const r = this.size * 0.006;
        return `<circle cx="${this.cx}" cy="${this.cy}" r="${r.toFixed(2)}" fill="#000" stroke="none"/>`;
    }
}
