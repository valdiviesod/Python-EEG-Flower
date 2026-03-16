/**
 * MandalaGenerator — EEG-driven mandala basado en mandala_reference.svg
 *
 * Genera UN SOLO mandala usando mandala_reference.svg como forma principal.
 * Los datos EEG controlan cómo se presenta ese único mandala:
 *
 *   Delta  → escala global (más grande / más pequeño)
 *   Theta  → rotación
 *   Alpha  → grosor del trazo y claridad visual
 *   Beta   → densidad del borde decorativo
 *   Gamma  → cantidad de puntos decorativos centrales
 *
 * Output: SVG limpio (fondo blanco, un solo mandala centrado).
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

    _computeEEGParams() {
        const getVis = (key) => {
            const b = this.bands.find(b => b.key === key);
            return b ? (b.visualSize != null ? b.visualSize : b.relativePower) : 0.2;
        };

        const deltaV = getVis('delta');
        const thetaV = getVis('theta');
        const alphaV = getVis('alpha');
        const betaV  = getVis('beta');
        const gammaV = getVis('gamma');

        // Tamaño del canvas
        this.size = Math.round(800 + deltaV * 400);
        this.cx   = this.size / 2;
        this.cy   = this.size / 2;

        // Escala del mandala único — ocupa entre 75% y 92% del canvas
        this.baseScale = 0.75 + deltaV * 0.17;

        // Rotación
        this.baseRotation = thetaV * 45 - 22.5;

        // Grosor de trazo
        this.strokeWeight = 0.5 + alphaV * 1.2;

        // Borde: cantidad de ticks decorativos
        this.borderNotches = Math.round(24 + betaV * 36);

        // Puntos gamma decorativos alrededor del centro
        this.gammaDots = Math.round(12 + gammaV * 48);
    }

    generate() {
        const s = this.size;
        const parts = [
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">`,
            `<rect width="${s}" height="${s}" fill="#fff"/>`,
            `<g stroke="#000" fill="none" stroke-linecap="round" stroke-linejoin="round">`
        ];

        // Borde circular decorativo
        parts.push(this._outerBorder());

        // EL ÚNICO mandala de referencia, centrado
        parts.push(this._primaryMandala());

        // Pequeños puntos decorativos alrededor del centro
        parts.push(this._gammaDetails());

        // Punto central
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

    // ── Borde exterior ───────────────────────────────────────────────────

    _outerBorder() {
        const s    = this.size;
        const rOut = s * 0.48;
        const rIn  = s * 0.468;
        const sw   = this.strokeWeight;
        const n    = Math.max(12, this.borderNotches);
        const parts = [];

        parts.push(this._circle(rOut, sw * 1.2));
        parts.push(this._circle(rIn,  sw * 0.35));

        for (let i = 0; i < n; i++) {
            const angle = (i / n) * Math.PI * 2;
            const p1 = this._polarXY(rIn, angle);
            const p2 = this._polarXY(rIn - s * 0.008, angle);
            parts.push(`<line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}" stroke-width="${(sw * 0.3).toFixed(3)}"/>`);
        }

        return parts.join('\n');
    }

    // ── Mandala de referencia (ÚNICO) ────────────────────────────────────

    _primaryMandala() {
        if (!this.refPathData) return '';
        const vb = this.refViewBox;

        const visW = vb.w * 0.1;
        const visH = vb.h * 0.1;

        const targetPx = this.size * this.baseScale;
        const fit = targetPx / Math.max(visW, visH);

        return [
            `<g transform="translate(${this.cx},${this.cy}) rotate(${this.baseRotation}) scale(${fit}) translate(${-visW / 2},${-visH / 2})">`,
            `  <g transform="translate(0,${vb.h}) scale(0.1,-0.1)" fill="#000" stroke="none">`,
            `    <path d="${this.refPathData}"/>`,
            `  </g>`,
            `</g>`
        ].join('\n');
    }

    // ── Detalles gamma (puntos finos) ────────────────────────────────────

    _gammaDetails() {
        const parts = [];
        const s     = this.size;
        const dotR  = s * 0.06;
        const gammaVis = this.bands.find(b => b.key === 'gamma')?.visualSize || 0.2;

        for (let i = 0; i < this.gammaDots; i++) {
            const angle = (i / this.gammaDots) * Math.PI * 2;
            const p = this._polarXY(dotR, angle);
            const r = 0.5 + gammaVis * 0.7;
            parts.push(`<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${r.toFixed(2)}" fill="#000" stroke="none"/>`);
        }

        return parts.join('\n');
    }

    // ── Punto central ────────────────────────────────────────────────────

    _centerDot() {
        const r = this.size * 0.005;
        return `<circle cx="${this.cx}" cy="${this.cy}" r="${r.toFixed(2)}" fill="#000" stroke="none"/>`;
    }
}
