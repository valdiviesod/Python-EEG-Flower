/**
 * Flower 2D — Canvas-based Botanical Flower Generator
 *
 * Draws a unique flower from EEG band analysis:
 *   • 5 layers of petals (one per frequency band)
 *   • Petal size proportional to band power
 *   • Petal count reflects frequency character
 *   • Organic stem with leaves
 *   • Soft pastel color palette
 *   • Clean white background
 *   • Minimalist modern aesthetic
 */

class Flower2D {
    constructor(canvas, analyzer) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.analyzer = analyzer;
        this.params = analyzer.flowerParams;
        this.bands = analyzer.normalizedBands;
        this.profile = analyzer.profile;
    }

    draw(size) {
        const { canvas, ctx } = this;
        canvas.width = size || 2048;
        canvas.height = Math.round(canvas.width * 1.25); // taller for stem
        const W = canvas.width;
        const H = canvas.height;

        // Flower center position (slightly above center to leave room for stem)
        const cx = W / 2;
        const cy = H * 0.38;
        const maxR = Math.min(W, H * 0.55) * 0.40;

        // Clear
        ctx.clearRect(0, 0, W, H);

        // Background
        this._drawBackground(W, H);

        // Draw from back to front
        this._drawStem(ctx, cx, cy, maxR, W, H);
        this._drawLeaves(ctx, cx, cy, maxR, W, H);

        // Draw petal layers (outer to inner = delta to gamma)
        for (let i = 0; i < this.params.layers.length; i++) {
            this._drawPetalLayer(ctx, cx, cy, maxR, this.params.layers[i], i);
        }

        // Draw center
        this._drawCenter(ctx, cx, cy, maxR);

        // Draw small details / pistils
        this._drawPistils(ctx, cx, cy, maxR);
    }

    // ── Background ────────────────────────────────────────────────────────
    _drawBackground(W, H) {
        const ctx = this.ctx;

        // Soft warm white
        ctx.fillStyle = '#FAFAF8';
        ctx.fillRect(0, 0, W, H);

        // Very subtle radial warmth from center
        const grad = ctx.createRadialGradient(W / 2, H * 0.38, 0, W / 2, H * 0.38, W * 0.6);
        grad.addColorStop(0, 'rgba(255, 241, 230, 0.3)');
        grad.addColorStop(0.5, 'rgba(255, 245, 238, 0.15)');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // Subtle texture dots (like paper grain)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.008)';
        const seed = 12345;
        let s = seed;
        for (let i = 0; i < 300; i++) {
            s = (s * 16807 + 0) % 2147483647;
            const x = (s / 2147483647) * W;
            s = (s * 16807 + 0) % 2147483647;
            const y = (s / 2147483647) * H;
            ctx.beginPath();
            ctx.arc(x, y, 0.8, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // ── Stem ──────────────────────────────────────────────────────────────
    _drawStem(ctx, cx, cy, maxR, W, H) {
        const stemTop = cy + maxR * 0.25;
        const stemBottom = H * 0.92;
        const stemWidth = maxR * 0.03;

        ctx.save();

        // Main stem - gentle curve
        ctx.beginPath();
        ctx.moveTo(cx, stemTop);
        ctx.bezierCurveTo(
            cx - maxR * 0.02, stemTop + (stemBottom - stemTop) * 0.3,
            cx + maxR * 0.03, stemTop + (stemBottom - stemTop) * 0.6,
            cx, stemBottom
        );

        // Gradient from green top to darker green bottom
        const grad = ctx.createLinearGradient(cx, stemTop, cx, stemBottom);
        grad.addColorStop(0, '#9BC4A8');
        grad.addColorStop(0.5, '#7EAD8B');
        grad.addColorStop(1, '#6B9B78');
        ctx.strokeStyle = grad;
        ctx.lineWidth = stemWidth;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Thin highlight line
        ctx.beginPath();
        ctx.moveTo(cx - stemWidth * 0.2, stemTop + 10);
        ctx.bezierCurveTo(
            cx - maxR * 0.015, stemTop + (stemBottom - stemTop) * 0.3,
            cx + maxR * 0.025, stemTop + (stemBottom - stemTop) * 0.6,
            cx - stemWidth * 0.2, stemBottom - 10
        );
        ctx.strokeStyle = 'rgba(200, 230, 210, 0.4)';
        ctx.lineWidth = stemWidth * 0.3;
        ctx.stroke();

        ctx.restore();
    }

    // ── Leaves ────────────────────────────────────────────────────────────
    _drawLeaves(ctx, cx, cy, maxR, W, H) {
        const stemMid = cy + maxR * 0.25 + (H * 0.92 - cy - maxR * 0.25) * 0.35;
        const leafSize = maxR * 0.22;

        // Left leaf
        this._drawLeaf(ctx, cx - maxR * 0.02, stemMid, leafSize, -0.7, '#A8D8B9', '#8BC4A0');
        // Right leaf (smaller, higher)
        this._drawLeaf(ctx, cx + maxR * 0.01, stemMid - leafSize * 0.6, leafSize * 0.75, 0.6, '#B5E0C3', '#98CCA8');
    }

    _drawLeaf(ctx, x, y, size, angle, color, veinColor) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);

        // Leaf shape
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(
            size * 0.4, -size * 0.15,
            size * 0.8, -size * 0.12,
            size, 0
        );
        ctx.bezierCurveTo(
            size * 0.8, size * 0.12,
            size * 0.4, size * 0.15,
            0, 0
        );
        ctx.closePath();

        // Gradient fill
        const grad = ctx.createLinearGradient(0, 0, size, 0);
        grad.addColorStop(0, color);
        grad.addColorStop(1, this._alpha(color, 0.6));
        ctx.fillStyle = grad;
        ctx.fill();

        // Vein
        ctx.beginPath();
        ctx.moveTo(size * 0.05, 0);
        ctx.lineTo(size * 0.85, 0);
        ctx.strokeStyle = this._alpha(veinColor, 0.4);
        ctx.lineWidth = size * 0.012;
        ctx.stroke();

        // Side veins
        for (let i = 0; i < 3; i++) {
            const t = 0.25 + i * 0.22;
            const vx = size * t;
            ctx.beginPath();
            ctx.moveTo(vx, 0);
            ctx.lineTo(vx + size * 0.12, -size * 0.06);
            ctx.moveTo(vx, 0);
            ctx.lineTo(vx + size * 0.12, size * 0.06);
            ctx.strokeStyle = this._alpha(veinColor, 0.2);
            ctx.lineWidth = size * 0.008;
            ctx.stroke();
        }

        ctx.restore();
    }

    // ── Petal Layer ───────────────────────────────────────────────────────
    _drawPetalLayer(ctx, cx, cy, maxR, layer, layerIdx) {
        const { band, petalCount, petalLength, petalWidth, rotation, opacity } = layer;
        const len = maxR * petalLength * 2.2; // scale up for visibility
        const wid = maxR * petalWidth * 2.5;
        const angleStep = (Math.PI * 2) / petalCount;

        // Outer layers have larger radius from center
        const layerRadius = maxR * lerp(0.02, 0.05, layerIdx / 4);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotation);

        for (let i = 0; i < petalCount; i++) {
            const angle = i * angleStep;

            ctx.save();
            ctx.rotate(angle);

            // Petal body
            this._drawPetal(ctx, layerRadius, len, wid, band, opacity, layerIdx);

            ctx.restore();
        }

        ctx.restore();
    }

    _drawPetal(ctx, startR, length, width, band, opacity, layerIdx) {
        const tipY = -(startR + length);
        const baseY = -startR;
        const tipHalf = width * 0.22;
        const roundedTipY = tipY + length * 0.04;

        ctx.beginPath();
        ctx.moveTo(0, baseY);

        // Right side bezier — natural petal curve
        ctx.bezierCurveTo(
            width * 0.95, baseY - length * 0.18,
            width * 0.78, baseY - length * 0.72,
            tipHalf, roundedTipY
        );

        // Rounded top cap (instead of a sharp point)
        ctx.bezierCurveTo(
            width * 0.16, tipY - length * 0.03,
            -width * 0.16, tipY - length * 0.03,
            -tipHalf, roundedTipY
        );

        // Left side mirror
        ctx.bezierCurveTo(
            -width * 0.78, baseY - length * 0.72,
            -width * 0.95, baseY - length * 0.18,
            0, baseY
        );

        ctx.closePath();

        // Gradient fill: base is deeper, tip fades
        const grad = ctx.createLinearGradient(0, baseY, 0, tipY);
        grad.addColorStop(0, this._alpha(band.colorDeep, opacity));
        grad.addColorStop(0.3, this._alpha(band.color, opacity));
        grad.addColorStop(0.6, this._alpha(band.color, opacity * 0.85));
        grad.addColorStop(1, this._alpha(band.colorLight, opacity * 0.5));
        ctx.fillStyle = grad;
        ctx.fill();

        // Soft edge stroke
        ctx.strokeStyle = this._alpha(band.colorDeep, opacity * 0.3);
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Central vein line
        ctx.beginPath();
        ctx.moveTo(0, baseY - length * 0.05);
        ctx.bezierCurveTo(
            0, baseY - length * 0.3,
            0, baseY - length * 0.6,
            0, tipY + length * 0.08
        );
        ctx.strokeStyle = this._alpha(band.colorDeep, opacity * 0.2);
        ctx.lineWidth = 1;
        ctx.stroke();

        // Side veins (subtle)
        const numVeins = Math.max(2, Math.floor(length / 40));
        for (let v = 0; v < numVeins; v++) {
            const t = 0.2 + (v / numVeins) * 0.55;
            const vy = baseY - length * t;
            const vw = width * (1 - t) * 0.5;

            ctx.beginPath();
            ctx.moveTo(0, vy);
            ctx.quadraticCurveTo(vw * 0.6, vy - length * 0.04, vw, vy - length * 0.02);
            ctx.moveTo(0, vy);
            ctx.quadraticCurveTo(-vw * 0.6, vy - length * 0.04, -vw, vy - length * 0.02);
            ctx.strokeStyle = this._alpha(band.colorDeep, opacity * 0.1);
            ctx.lineWidth = 0.7;
            ctx.stroke();
        }
    }

    // ── Flower Center (pistil) ────────────────────────────────────────────
    _drawCenter(ctx, cx, cy, maxR) {
        const r = maxR * this.params.centerSize * 1.8;

        // Outer glow
        const glowGrad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 2.5);
        glowGrad.addColorStop(0, 'rgba(255, 228, 196, 0.2)');
        glowGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Main center circle
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, '#FFF5E6');
        grad.addColorStop(0.3, '#FFE4C9');
        grad.addColorStop(0.6, '#F5D0A9');
        grad.addColorStop(1, '#E8C49A');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // Subtle rim
        ctx.strokeStyle = 'rgba(200, 170, 130, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    // ── Pistils (tiny dots in center) ─────────────────────────────────────
    _drawPistils(ctx, cx, cy, maxR) {
        const centerR = maxR * this.params.centerSize * 1.8;
        const pistilCount = 20;
        let seed = 54321;

        for (let i = 0; i < pistilCount; i++) {
            seed = (seed * 16807 + 0) % 2147483647;
            const angle = (seed / 2147483647) * Math.PI * 2;
            seed = (seed * 16807 + 0) % 2147483647;
            const dist = (seed / 2147483647) * centerR * 0.7;

            const px = cx + dist * Math.cos(angle);
            const py = cy + dist * Math.sin(angle);

            seed = (seed * 16807 + 0) % 2147483647;
            const size = 1 + (seed / 2147483647) * 2.5;

            ctx.beginPath();
            ctx.arc(px, py, size, 0, Math.PI * 2);

            // Alternate warm colors
            const colors = ['#E8C49A', '#D4A574', '#C9976A', '#F0D5B0', '#DDB886'];
            ctx.fillStyle = colors[i % colors.length];
            ctx.fill();

            // Tiny highlight
            ctx.beginPath();
            ctx.arc(px - size * 0.2, py - size * 0.2, size * 0.35, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.fill();
        }
    }

    // ── Utility: Add Alpha to Hex Color ───────────────────────────────────
    _alpha(hex, alpha) {
        if (!hex || hex === 'transparent') return `rgba(0,0,0,${alpha})`;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    // ── Export as PNG ─────────────────────────────────────────────────────
    exportPNG(filename) {
        const link = document.createElement('a');
        link.download = filename || 'flor_neurofuncional_2d.png';
        link.href = this.canvas.toDataURL('image/png');
        link.click();
    }
}
