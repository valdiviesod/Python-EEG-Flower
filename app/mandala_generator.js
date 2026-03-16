/**
 * MandalaGenerator — EEG-driven mandala using mandala_reference.svg as base
 *
 * Uses a real hand-designed mandala SVG as the structural core, then layers
 * EEG-driven decorative elements that make each mandala unique:
 *
 *   Delta  → global scale & outer wave border (deep rest → expansive, breathing)
 *   Theta  → rotation of base + organic petal halos (creativity → flowing forms)
 *   Alpha  → stroke clarity & lotus petal ring (calm → clean, open, spacious)
 *   Beta   → angular ray overlays + detail density (focus → sharp, precise)
 *   Gamma  → fractal echoes of base + micro-dots (cognition → complexity)
 *
 * The reference path is embedded at multiple scales with EEG-driven transforms,
 * creating a mandala-within-mandala fractal effect unique to each person.
 *
 * Output: clean SVG string (white bg, black strokes, no fill).
 */

class MandalaGenerator {

    /**
     * @param {object} report       – full report from EEGBandAnalyzer.getReport()
     * @param {string} referenceSvg – raw SVG text of mandala_reference.svg
     */
    constructor(report, referenceSvg) {
        this.bands = report.bands;
        this.params = report.flowerParams;
        this.profile = report.profile;
        this.emotions = report.emotionMetrics;

        // Parse reference SVG
        this.refPathData = this._extractPathData(referenceSvg);
        this.refViewBox = this._extractViewBox(referenceSvg);

        // EEG-driven parameters
        this._computeEEGParams();
    }

    // ── Parse the reference SVG ──────────────────────────────────────────

    _extractPathData(svgText) {
        if (!svgText) return '';
        const match = svgText.match(/<path\s+d="([^"]+)"/);
        return match ? match[1] : '';
    }

    _extractViewBox(svgText) {
        if (!svgText) return { w: 1259, h: 1280 };
        const match = svgText.match(/viewBox="([^"]+)"/);
        if (!match) return { w: 1259, h: 1280 };
        const parts = match[1].split(/\s+/).map(Number);
        return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }

    // ── Compute unique parameters from EEG data ─────────────────────────

    _computeEEGParams() {
        const bands = this.bands;
        const profile = this.profile;
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

        const getPower = (key) => {
            const b = bands.find(b => b.key === key);
            return b ? b.relativePower : 0.2;
        };
        const getVis = (key) => {
            const b = bands.find(b => b.key === key);
            return b ? (b.visualSize || b.relativePower) : 0.2;
        };

        const delta = getPower('delta');
        const theta = getPower('theta');
        const alpha = getPower('alpha');
        const beta  = getPower('beta');
        const gamma = getPower('gamma');

        const deltaV = getVis('delta');
        const thetaV = getVis('theta');
        const alphaV = getVis('alpha');
        const betaV  = getVis('beta');
        const gammaV = getVis('gamma');

        // Canvas size: delta-dominant → larger, more expansive mandalas
        this.size = Math.round(800 + deltaV * 400);
        this.cx = this.size / 2;
        this.cy = this.size / 2;

        // Base mandala scale (how big the reference SVG appears)
        this.baseScale = 0.28 + deltaV * 0.15;

        // Rotation of the base mandala (theta = creativity, fluid rotation)
        this.baseRotation = thetaV * 40 - 20; // -20° to +20°

        // Global stroke weight (alpha = clarity)
        this.strokeWeight = 0.4 + alphaV * 1.2;

        // Detail density multiplier (beta + gamma = precision & complexity)
        this.detailDensity = 0.5 + (betaV + gammaV) * 0.8;

        // Spacing between rings (high alpha = spacious, calm; high beta = dense)
        this.ringSpacing = 0.8 + alphaV * 0.6 - betaV * 0.3;

        // Fractal depth (how many echo copies of the base; gamma drives this)
        this.fractalDepth = Math.round(1 + gammaV * 3); // 1-4 copies

        // Outer wave complexity (delta = slow waves → fewer, broader undulations)
        this.outerWaveCount = Math.round(12 + (1 - deltaV) * 24);

        // Theta petal count (organic halos)
        this.thetaPetalCount = Math.round(6 + thetaV * 10);

        // Alpha lotus count
        this.alphaLotusCount = Math.round(8 + alphaV * 8);

        // Beta ray count
        this.betaRayCount = Math.round(12 + betaV * 20);

        // Gamma dot count
        this.gammaDotCount = Math.round(30 + gammaV * 60);

        // Emotion-driven accent: find dominant emotion for decorative style
        if (this.emotions && this.emotions.length > 0) {
            const sorted = [...this.emotions].sort((a, b) => b.value - a.value);
            this.dominantEmotion = sorted[0].key;
        } else {
            this.dominantEmotion = 'balance';
        }

        // Profile-based symmetry (relaxed = more symmetry, focused = more angular)
        this.symmetryOrder = profile.relaxation > 1
            ? Math.round(6 + profile.relaxation * 2)
            : Math.round(4 + profile.focus * 3);
    }

    // ── Generate complete SVG ────────────────────────────────────────────

    generate() {
        const s = this.size;
        const parts = [];

        parts.push(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">`,
            `<rect width="${s}" height="${s}" fill="#fff"/>`,
            `<g stroke="#000" fill="none" stroke-linecap="round" stroke-linejoin="round">`
        );

        // Layer 0: Outermost decorative wave border (delta-driven)
        parts.push(this._outerWaveBorder());

        // Layer 1: Delta ring — broad scallop arcs
        parts.push(this._deltaScallopRing());

        // Layer 2: Theta ring — organic flowing petals
        parts.push(this._thetaOrganicRing());

        // Layer 3: Alpha ring — lotus petals (calm, open)
        parts.push(this._alphaLotusRing());

        // Layer 4: Beta ring — sharp angular rays
        parts.push(this._betaRayRing());

        // Layer 5: Reference mandala base (main form) — the heart of the mandala
        parts.push(this._referenceMandalaPrimary());

        // Layer 6: Fractal echoes — smaller copies of the reference
        parts.push(this._fractalEchoes());

        // Layer 7: Gamma micro-details — dots, dashes, fine patterns
        parts.push(this._gammaMicroDetails());

        // Layer 8: Central bloom with emotion-driven style
        parts.push(this._centerBloom());

        parts.push('</g></svg>');
        return parts.join('\n');
    }

    // ── Helper primitives ────────────────────────────────────────────────

    _circle(r, sw = 0.5) {
        return `<circle cx="${this.cx}" cy="${this.cy}" r="${r}" stroke-width="${sw}"/>`;
    }

    _line(x1, y1, x2, y2, sw = 0.8) {
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${sw}"/>`;
    }

    _polarXY(r, angle) {
        return {
            x: this.cx + r * Math.cos(angle),
            y: this.cy + r * Math.sin(angle)
        };
    }

    // ── Embed the reference mandala path at a given scale/rotation ────────

    _referencePathGroup(scale, rotation, opacity = 1, strokeW = null) {
        if (!this.refPathData) return '';
        const vb = this.refViewBox;
        const sw = strokeW || this.strokeWeight;

        // The original SVG uses potrace coordinates with transform:
        //   translate(0, 1280) scale(0.1, -0.1)
        // Original viewBox is in "pt" units: 1259×1280
        // After the group transform, the visible area is ~125.9 × 128.0 units

        // We need to:
        // 1. Apply the potrace transform (translate + scale)
        // 2. Scale to fit our canvas at the desired size
        // 3. Center it
        // 4. Apply EEG-driven rotation

        const ptW = vb.w; // 1259
        const ptH = vb.h; // 1280
        const visibleW = ptW * 0.1; // ~125.9 after potrace scale
        const visibleH = ptH * 0.1; // ~128.0

        const targetSize = this.size * scale;
        const fitScale = targetSize / Math.max(visibleW, visibleH);

        const tx = this.cx;
        const ty = this.cy;

        return [
            `<g transform="translate(${tx}, ${ty}) rotate(${rotation}) scale(${fitScale}) translate(${-visibleW / 2}, ${-visibleH / 2})"`,
            `   opacity="${opacity}" stroke-width="${sw / fitScale}">`,
            `  <g transform="translate(0, ${ptH}) scale(0.1, -0.1)" fill="#000" stroke="none">`,
            `    <path d="${this.refPathData}"/>`,
            `  </g>`,
            `</g>`
        ].join('\n');
    }

    // ── Layer 0: Outer wave border (delta-driven) ────────────────────────

    _outerWaveBorder() {
        const parts = [];
        const s = this.size;
        const outerR = s * 0.48;
        const innerR = s * 0.465;
        const waveR = s * 0.455;
        const sw = this.strokeWeight * 0.8;

        // Double border circles
        parts.push(this._circle(outerR, sw * 1.5));
        parts.push(this._circle(innerR, sw * 0.4));

        // Wave undulations between borders — count driven by delta
        const n = this.outerWaveCount;
        const waveAmp = (outerR - waveR) * (0.4 + this.bands[0].relativePower * 0.6);

        for (let i = 0; i < n; i++) {
            const a1 = (i / n) * Math.PI * 2;
            const a2 = ((i + 0.5) / n) * Math.PI * 2;
            const a3 = ((i + 1) / n) * Math.PI * 2;

            const p1 = this._polarXY(waveR, a1);
            const peak = this._polarXY(waveR - waveAmp, a2);
            const p2 = this._polarXY(waveR, a3);

            parts.push(
                `<path d="M${p1.x},${p1.y} Q${peak.x},${peak.y} ${p2.x},${p2.y}" stroke-width="${sw * 0.6}"/>`
            );
        }

        // Tick marks at each wave peak
        for (let i = 0; i < n; i++) {
            const angle = ((i + 0.5) / n) * Math.PI * 2;
            const p1 = this._polarXY(innerR, angle);
            const p2 = this._polarXY(innerR - 4 * this.detailDensity, angle);
            parts.push(this._line(p1.x, p1.y, p2.x, p2.y, sw * 0.3));
        }

        return parts.join('\n');
    }

    // ── Layer 1: Delta scallop ring ──────────────────────────────────────

    _deltaScallopRing() {
        const parts = [];
        const s = this.size;
        const layer = this.params.layers[0];
        const power = layer ? layer.band.visualSize : 0.3;
        const n = layer ? layer.petalCount : 8;

        const outerR = s * 0.44;
        const innerR = s * 0.38 * this.ringSpacing;
        const arcH = (outerR - innerR) * (0.5 + power * 0.5);
        const sw = this.strokeWeight * (0.8 + power * 0.4);
        const rot = layer ? layer.rotation : 0;

        parts.push(this._circle((outerR + innerR) / 2, sw * 0.3));

        // Outer scallops
        for (let i = 0; i < n; i++) {
            const angle = (i / n) * Math.PI * 2 + rot;
            const nextAngle = ((i + 1) / n) * Math.PI * 2 + rot;
            const midAngle = (angle + nextAngle) / 2;

            const p1 = this._polarXY(outerR, angle);
            const p2 = this._polarXY(outerR, nextAngle);
            const cp = this._polarXY(outerR - arcH, midAngle);

            parts.push(
                `<path d="M${p1.x},${p1.y} Q${cp.x},${cp.y} ${p2.x},${p2.y}" stroke-width="${sw}"/>`
            );
        }

        // Inner mirrored scallops (offset by half)
        for (let i = 0; i < n; i++) {
            const angle = (i / n) * Math.PI * 2 + rot + Math.PI / n;
            const nextAngle = ((i + 1) / n) * Math.PI * 2 + rot + Math.PI / n;
            const midAngle = (angle + nextAngle) / 2;

            const p1 = this._polarXY(innerR, angle);
            const p2 = this._polarXY(innerR, nextAngle);
            const cp = this._polarXY(innerR + arcH * 0.35, midAngle);

            parts.push(
                `<path d="M${p1.x},${p1.y} Q${cp.x},${cp.y} ${p2.x},${p2.y}" stroke-width="${sw * 0.5}"/>`
            );
        }

        // Small decorative dots between scallops
        for (let i = 0; i < n; i++) {
            const angle = ((i + 0.5) / n) * Math.PI * 2 + rot;
            const p = this._polarXY(outerR - arcH * 0.2, angle);
            parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${1.2 * this.detailDensity}" fill="#000" stroke="none"/>`);
        }

        return parts.join('\n');
    }

    // ── Layer 2: Theta organic petal ring ────────────────────────────────

    _thetaOrganicRing() {
        const parts = [];
        const s = this.size;
        const layer = this.params.layers[1];
        const power = layer ? layer.band.visualSize : 0.3;
        const n = this.thetaPetalCount;

        const baseR = s * 0.36 * this.ringSpacing;
        const leafLen = s * 0.08 * (0.6 + power * 0.8);
        const leafW = leafLen * (0.28 + power * 0.12);
        const sw = this.strokeWeight * 0.9;
        const rot = layer ? layer.rotation : 0;

        parts.push(this._circle(baseR, sw * 0.25));

        for (let i = 0; i < n; i++) {
            const angle = (i / n) * Math.PI * 2 + rot;
            const base = this._polarXY(baseR, angle);
            const tip = this._polarXY(baseR + leafLen, angle);

            const perpAngle = angle + Math.PI / 2;
            // Asymmetric leaf — one side more curved than the other (organic feel)
            const asymmetry = 0.15 * Math.sin(i * 1.618); // golden ratio variation
            const cp1 = {
                x: (base.x + tip.x) / 2 + (leafW + asymmetry * leafW) * Math.cos(perpAngle),
                y: (base.y + tip.y) / 2 + (leafW + asymmetry * leafW) * Math.sin(perpAngle)
            };
            const cp2 = {
                x: (base.x + tip.x) / 2 - (leafW - asymmetry * leafW) * Math.cos(perpAngle),
                y: (base.y + tip.y) / 2 - (leafW - asymmetry * leafW) * Math.sin(perpAngle)
            };

            parts.push(
                `<path d="M${base.x},${base.y} Q${cp1.x},${cp1.y} ${tip.x},${tip.y} Q${cp2.x},${cp2.y} ${base.x},${base.y}" stroke-width="${sw}"/>`
            );

            // Delicate central vein
            parts.push(this._line(base.x, base.y, tip.x, tip.y, sw * 0.25));

            // Tiny dot at tip
            parts.push(`<circle cx="${tip.x}" cy="${tip.y}" r="${0.8 * this.detailDensity}" fill="#000" stroke="none"/>`);
        }

        // Interconnecting arcs between petals (weaving effect)
        if (this.detailDensity > 0.7) {
            for (let i = 0; i < n; i++) {
                const a1 = (i / n) * Math.PI * 2 + rot;
                const a2 = ((i + 1) / n) * Math.PI * 2 + rot;
                const midA = (a1 + a2) / 2;
                const p1 = this._polarXY(baseR + leafLen * 0.4, a1);
                const p2 = this._polarXY(baseR + leafLen * 0.4, a2);
                const cp = this._polarXY(baseR + leafLen * 0.15, midA);
                parts.push(
                    `<path d="M${p1.x},${p1.y} Q${cp.x},${cp.y} ${p2.x},${p2.y}" stroke-width="${sw * 0.3}"/>`
                );
            }
        }

        return parts.join('\n');
    }

    // ── Layer 3: Alpha lotus petal ring ──────────────────────────────────

    _alphaLotusRing() {
        const parts = [];
        const s = this.size;
        const layer = this.params.layers[2];
        const power = layer ? layer.band.visualSize : 0.3;
        const n = this.alphaLotusCount;

        const baseR = s * 0.30 * this.ringSpacing;
        const petalLen = s * 0.07 * (0.7 + power * 0.6);
        const petalW = petalLen * (0.35 + power * 0.1);
        const sw = this.strokeWeight;
        const rot = layer ? layer.rotation : 0;

        parts.push(this._circle(baseR, sw * 0.3));
        parts.push(this._circle(baseR + petalLen * 0.95, sw * 0.15));

        for (let i = 0; i < n; i++) {
            const angle = (i / n) * Math.PI * 2 + rot;
            const tipR = baseR + petalLen;

            const base = this._polarXY(baseR, angle);
            const tip = this._polarXY(tipR, angle);

            // Cubic bezier lotus petal — wider belly, pointed tip
            const cp1r = baseR + petalLen * 0.35;
            const cp2r = baseR + petalLen * 0.75;
            const cpSpread = petalW;

            const cp1 = this._polarXY(cp1r, angle + cpSpread / cp1r);
            const cp2 = this._polarXY(cp2r, angle + cpSpread * 0.4 / cp2r);
            const cp3 = this._polarXY(cp2r, angle - cpSpread * 0.4 / cp2r);
            const cp4 = this._polarXY(cp1r, angle - cpSpread / cp1r);

            parts.push(
                `<path d="M${base.x},${base.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${tip.x},${tip.y} C${cp3.x},${cp3.y} ${cp4.x},${cp4.y} ${base.x},${base.y}" stroke-width="${sw}"/>`
            );

            // Inner spine
            const innerTip = this._polarXY(baseR + petalLen * 0.6, angle);
            parts.push(this._line(base.x, base.y, innerTip.x, innerTip.y, sw * 0.2));
        }

        // Accent dots between petals
        for (let i = 0; i < n; i++) {
            const angle = ((i + 0.5) / n) * Math.PI * 2 + rot;
            const dotR = baseR + petalLen * 0.3;
            const p = this._polarXY(dotR, angle);
            parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${1.5 * this.detailDensity}" fill="#000" stroke="none"/>`);
        }

        // Secondary mini-petal layer (half-offset) for rich lotus look
        if (power > 0.25) {
            const miniN = n;
            const miniLen = petalLen * 0.55;
            const miniW = miniLen * 0.3;
            for (let i = 0; i < miniN; i++) {
                const angle = ((i + 0.5) / miniN) * Math.PI * 2 + rot;
                const base = this._polarXY(baseR + 2, angle);
                const tip = this._polarXY(baseR + miniLen, angle);
                const perp = angle + Math.PI / 2;
                const cp1 = {
                    x: (base.x + tip.x) / 2 + miniW * Math.cos(perp),
                    y: (base.y + tip.y) / 2 + miniW * Math.sin(perp)
                };
                const cp2 = {
                    x: (base.x + tip.x) / 2 - miniW * Math.cos(perp),
                    y: (base.y + tip.y) / 2 - miniW * Math.sin(perp)
                };
                parts.push(
                    `<path d="M${base.x},${base.y} Q${cp1.x},${cp1.y} ${tip.x},${tip.y} Q${cp2.x},${cp2.y} ${base.x},${base.y}" stroke-width="${sw * 0.5}"/>`
                );
            }
        }

        return parts.join('\n');
    }

    // ── Layer 4: Beta angular ray ring ───────────────────────────────────

    _betaRayRing() {
        const parts = [];
        const s = this.size;
        const layer = this.params.layers[3];
        const power = layer ? layer.band.visualSize : 0.3;
        const n = this.betaRayCount;

        const baseR = s * 0.24 * this.ringSpacing;
        const rayLen = s * 0.06 * (0.5 + power * 0.7);
        const rayW = rayLen * 0.15;
        const sw = this.strokeWeight * 0.7;
        const rot = layer ? layer.rotation : 0;

        parts.push(this._circle(baseR, sw * 0.35));

        for (let i = 0; i < n; i++) {
            const angle = (i / n) * Math.PI * 2 + rot;
            const base1 = this._polarXY(baseR, angle - rayW / baseR);
            const base2 = this._polarXY(baseR, angle + rayW / baseR);
            const tip = this._polarXY(baseR + rayLen, angle);

            // Diamond-shaped ray
            const midR = baseR + rayLen * 0.4;
            const mid1 = this._polarXY(midR, angle - rayW * 1.3 / midR);
            const mid2 = this._polarXY(midR, angle + rayW * 1.3 / midR);

            parts.push(
                `<path d="M${base1.x},${base1.y} L${mid1.x},${mid1.y} L${tip.x},${tip.y} L${mid2.x},${mid2.y} L${base2.x},${base2.y}" stroke-width="${sw}"/>`
            );
        }

        // Connecting wave between rays
        for (let i = 0; i < n; i++) {
            const a1 = (i / n) * Math.PI * 2 + rot;
            const a2 = ((i + 1) / n) * Math.PI * 2 + rot;
            const midA = (a1 + a2) / 2;
            const connR = baseR + rayLen * 0.35;
            const p1 = this._polarXY(connR, a1);
            const p2 = this._polarXY(connR, a2);
            const cp = this._polarXY(connR - rayLen * 0.15, midA);
            parts.push(
                `<path d="M${p1.x},${p1.y} Q${cp.x},${cp.y} ${p2.x},${p2.y}" stroke-width="${sw * 0.35}"/>`
            );
        }

        // Outer thin ring at ray tips
        parts.push(this._circle(baseR + rayLen * 0.9, sw * 0.2));

        return parts.join('\n');
    }

    // ── Layer 5: Reference mandala (primary, centered) ───────────────────

    _referenceMandalaPrimary() {
        if (!this.refPathData) return '';
        return this._referencePathGroup(
            this.baseScale,
            this.baseRotation,
            1,
            this.strokeWeight * 0.6
        );
    }

    // ── Layer 6: Fractal echoes ──────────────────────────────────────────

    _fractalEchoes() {
        if (!this.refPathData) return '';
        const parts = [];
        const depth = this.fractalDepth;

        for (let i = 1; i <= depth; i++) {
            const echoScale = this.baseScale * (0.4 / i);
            const echoRotation = this.baseRotation + i * 30 * (i % 2 === 0 ? 1 : -1);
            const echoOpacity = 0.7 - i * 0.15;

            parts.push(this._referencePathGroup(
                echoScale,
                echoRotation,
                Math.max(0.15, echoOpacity),
                this.strokeWeight * 0.4
            ));
        }

        // Ring of tiny mandala echoes around the center (like satellites)
        if (depth >= 2) {
            const satelliteCount = this.symmetryOrder;
            const orbitR = this.size * 0.12;
            const satScale = this.baseScale * 0.12;

            for (let i = 0; i < satelliteCount; i++) {
                const angle = (i / satelliteCount) * Math.PI * 2;
                const px = this.cx + orbitR * Math.cos(angle);
                const py = this.cy + orbitR * Math.sin(angle);

                const vb = this.refViewBox;
                const visibleW = vb.w * 0.1;
                const visibleH = vb.h * 0.1;
                const targetSize = this.size * satScale;
                const fitScale = targetSize / Math.max(visibleW, visibleH);
                const satRot = this.baseRotation + (i * 360 / satelliteCount);

                parts.push([
                    `<g transform="translate(${px}, ${py}) rotate(${satRot}) scale(${fitScale}) translate(${-visibleW / 2}, ${-visibleH / 2})"`,
                    `   opacity="0.3" stroke-width="${this.strokeWeight * 0.3 / fitScale}">`,
                    `  <g transform="translate(0, ${vb.h}) scale(0.1, -0.1)" fill="#000" stroke="none">`,
                    `    <path d="${this.refPathData}"/>`,
                    `  </g>`,
                    `</g>`
                ].join('\n'));
            }
        }

        return parts.join('\n');
    }

    // ── Layer 7: Gamma micro-details ─────────────────────────────────────

    _gammaMicroDetails() {
        const parts = [];
        const s = this.size;
        const layer = this.params.layers[4];
        const power = layer ? layer.band.visualSize : 0.2;
        const sw = this.strokeWeight * 0.5;
        const rot = layer ? layer.rotation : 0;

        const innerR = s * 0.08;
        const outerR = s * 0.15;

        // Radial dashes
        const dashCount = layer ? layer.petalCount : 20;
        const dashLen = (outerR - innerR) * (0.4 + power * 0.5);
        for (let i = 0; i < dashCount; i++) {
            const angle = (i / dashCount) * Math.PI * 2 + rot;
            const p1 = this._polarXY(innerR, angle);
            const p2 = this._polarXY(innerR + dashLen, angle);
            parts.push(this._line(p1.x, p1.y, p2.x, p2.y, sw));
        }

        // Inner dot ring
        const dotR = (innerR + outerR) / 2;
        const dotCount = this.gammaDotCount;
        for (let i = 0; i < dotCount; i++) {
            const angle = (i / dotCount) * Math.PI * 2;
            const p = this._polarXY(dotR, angle);
            const r = 0.5 + power * 0.8;
            parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="#000" stroke="none"/>`);
        }

        // Fine concentric rings
        const ringCount = Math.round(2 + this.detailDensity * 2);
        for (let i = 0; i < ringCount; i++) {
            const r = innerR + (outerR - innerR) * (i / ringCount);
            parts.push(this._circle(r, sw * 0.3));
        }

        // Outer guide circle
        parts.push(this._circle(outerR, sw * 0.4));

        return parts.join('\n');
    }

    // ── Layer 8: Central bloom ───────────────────────────────────────────

    _centerBloom() {
        const parts = [];
        const r = this.size * 0.055;
        const sw = this.strokeWeight;

        // Outer ring of center
        parts.push(this._circle(r * 1.5, sw * 0.5));

        // Petal count driven by emotion: serene = fewer broad petals, agitated = many
        const n = this.dominantEmotion === 'serenity' || this.dominantEmotion === 'balance'
            ? 6 : this.dominantEmotion === 'agitation' || this.dominantEmotion === 'focus'
            ? 12 : 8;

        // Inner petals
        for (let i = 0; i < n; i++) {
            const angle = (i / n) * Math.PI * 2;
            const base = this._polarXY(r * 0.25, angle);
            const tip = this._polarXY(r * 1.35, angle);
            const perpAngle = angle + Math.PI / 2;
            const w = r * (0.3 + 0.1 * Math.sin(i * 2.39)); // slight variation

            const cp1 = {
                x: (base.x + tip.x) / 2 + w * Math.cos(perpAngle),
                y: (base.y + tip.y) / 2 + w * Math.sin(perpAngle)
            };
            const cp2 = {
                x: (base.x + tip.x) / 2 - w * Math.cos(perpAngle),
                y: (base.y + tip.y) / 2 - w * Math.sin(perpAngle)
            };

            parts.push(
                `<path d="M${base.x},${base.y} Q${cp1.x},${cp1.y} ${tip.x},${tip.y} Q${cp2.x},${cp2.y} ${base.x},${base.y}" stroke-width="${sw * 0.8}"/>`
            );
        }

        // Secondary petals (half offset, smaller)
        const n2 = n;
        for (let i = 0; i < n2; i++) {
            const angle = ((i + 0.5) / n2) * Math.PI * 2;
            const base = this._polarXY(r * 0.3, angle);
            const tip = this._polarXY(r * 0.9, angle);
            const perpAngle = angle + Math.PI / 2;
            const w = r * 0.2;
            const cp1 = {
                x: (base.x + tip.x) / 2 + w * Math.cos(perpAngle),
                y: (base.y + tip.y) / 2 + w * Math.sin(perpAngle)
            };
            const cp2 = {
                x: (base.x + tip.x) / 2 - w * Math.cos(perpAngle),
                y: (base.y + tip.y) / 2 - w * Math.sin(perpAngle)
            };
            parts.push(
                `<path d="M${base.x},${base.y} Q${cp1.x},${cp1.y} ${tip.x},${tip.y} Q${cp2.x},${cp2.y} ${base.x},${base.y}" stroke-width="${sw * 0.4}"/>`
            );
        }

        // Center dot
        parts.push(`<circle cx="${this.cx}" cy="${this.cy}" r="${2.5 * this.detailDensity}" fill="#000" stroke="none"/>`);

        // Inner rings
        parts.push(this._circle(r * 0.45, sw * 0.4));
        parts.push(this._circle(r * 0.2, sw * 0.3));

        return parts.join('\n');
    }
}
