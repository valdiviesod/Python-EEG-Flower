class Flower2DRenderer {
    constructor(canvas, report) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.report = report;
    }

    draw(size = 1280) {
        const canvas = this.canvas;
        canvas.width = size;
        canvas.height = Math.round(size * 1.2);

        const W = canvas.width;
        const H = canvas.height;
        const cx = W / 2;
        const cy = H * 0.43;

        const morphology = this.report.morphology;
        const openness = morphology.openness;
        const weight = morphology.weight;
        const curvature = morphology.curvature;
        const symmetry = morphology.symmetry;
        const brightness = morphology.brightness;

        const maxR = Math.min(W, H) * (0.22 + openness * 0.15);

        this._drawBackground(W, H, brightness);
        this._drawStem(cx, cy, maxR, H, weight, symmetry);
        this._drawLeaves(cx, cy, maxR, weight, curvature, symmetry);

        const sortedBands = [...this.report.bands].sort((a, b) => a.low - b.low);
        for (let i = 0; i < sortedBands.length; i++) {
            const band = sortedBands[i];
            this._drawLayer(cx, cy, maxR, band, i, { openness, weight, curvature, symmetry, brightness });
        }

        this._drawCenter(cx, cy, maxR, brightness);
    }

    exportPNG(filename = 'flor_neurofuncional_2d.png') {
        const link = document.createElement('a');
        link.download = filename;
        link.href = this.canvas.toDataURL('image/png');
        link.click();
    }

    _drawBackground(W, H, brightness) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, W, H);

        ctx.fillStyle = '#FAFAF8';
        ctx.fillRect(0, 0, W, H);

        const grad = ctx.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.4, W * 0.7);
        grad.addColorStop(0, `rgba(255, 240, 232, ${0.22 + brightness * 0.2})`);
        grad.addColorStop(0.7, 'rgba(255, 248, 245, 0.08)');
        grad.addColorStop(1, 'rgba(250, 250, 248, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
    }

    _drawStem(cx, cy, maxR, H, weight, symmetry) {
        const ctx = this.ctx;
        const stemTop = cy + maxR * 0.28;
        const stemBottom = H * 0.9;
        const sway = (1 - symmetry) * maxR * 0.18;
        const droop = weight * maxR * 0.24;

        ctx.beginPath();
        ctx.moveTo(cx, stemTop);
        ctx.bezierCurveTo(
            cx - maxR * 0.04 - sway,
            stemTop + (stemBottom - stemTop) * 0.26,
            cx + maxR * 0.05 + sway,
            stemTop + (stemBottom - stemTop) * 0.68 + droop,
            cx - sway * 0.4,
            stemBottom
        );

        const grad = ctx.createLinearGradient(cx, stemTop, cx, stemBottom);
        grad.addColorStop(0, '#9BC4A8');
        grad.addColorStop(1, '#6B9B78');
        ctx.strokeStyle = grad;
        ctx.lineWidth = Math.max(4, maxR * 0.04);
        ctx.lineCap = 'round';
        ctx.stroke();
    }

    _drawLeaves(cx, cy, maxR, weight, curvature, symmetry) {
        const leafY = cy + maxR * 1.08;
        const size = maxR * (0.34 + curvature * 0.22);
        this._drawLeaf(cx - maxR * 0.08, leafY, size, -0.8 - weight * 0.5, '#A8D8B9', symmetry);
        this._drawLeaf(cx + maxR * 0.06, leafY - size * 0.5, size * 0.78, 0.62 + weight * 0.2, '#B9E4C9', symmetry);
    }

    _drawLeaf(x, y, size, angle, color, symmetry) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);

        const asym = (1 - symmetry) * 0.22;

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(size * (0.42 + asym), -size * 0.2, size * 0.86, -size * (0.1 + asym), size, 0);
        ctx.bezierCurveTo(size * 0.84, size * (0.14 + asym), size * (0.45 - asym), size * 0.16, 0, 0);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.78;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(size * 0.08, 0);
        ctx.lineTo(size * 0.86, 0);
        ctx.strokeStyle = 'rgba(118, 170, 135, 0.45)';
        ctx.lineWidth = Math.max(1.2, size * 0.016);
        ctx.stroke();

        ctx.restore();
    }

    _drawLayer(cx, cy, maxR, band, layerIndex, morph) {
        const ctx = this.ctx;
        const openness = morph.openness;
        const weight = morph.weight;
        const curvature = morph.curvature;
        const symmetry = morph.symmetry;
        const brightness = morph.brightness;

        const bandPower = band.relativePower;
        const count = [7, 8, 10, 12, 14][layerIndex];
        const radialOffset = maxR * (0.02 + layerIndex * 0.052 + openness * 0.03);
        const baseLength = maxR * (0.55 + bandPower * 1.2 + openness * 0.55);
        const baseWidth = maxR * (0.2 - layerIndex * 0.022 + bandPower * 0.22);
        const droop = weight * 0.5;
        const irr = (1 - symmetry) * 0.33;

        ctx.save();
        ctx.translate(cx, cy);

        for (let i = 0; i < count; i++) {
            const t = i / count;
            const angle = t * Math.PI * 2;
            const rand = this._seededNoise(i + layerIndex * 101);
            const angleJitter = (rand - 0.5) * irr;
            const localLen = baseLength * (1 + (rand - 0.5) * irr * 0.8);
            const localWid = baseWidth * (1 + (0.5 - rand) * irr * 0.6);

            ctx.save();
            ctx.rotate(angle + angleJitter + layerIndex * 0.15);
            this._drawPetalShape(radialOffset, localLen, localWid, band, {
                droop,
                curvature,
                brightness,
                opacity: 0.42 + bandPower * 0.85,
            });
            ctx.restore();
        }

        ctx.restore();
    }

    _drawPetalShape(startR, length, width, band, cfg) {
        const ctx = this.ctx;
        const baseY = -startR;
        const tipY = -(startR + length);

        const drop = cfg.droop;
        const sideCurve = 0.6 + cfg.curvature * 0.7;
        const tipRound = 0.16 + (1 - cfg.curvature) * 0.2;

        ctx.beginPath();
        ctx.moveTo(0, baseY);

        );
            // Use flower pastel palette for band colors
            const palette = [
                { color: '#C4B7D8', colorDeep: '#9B8EC0', colorLight: '#E6E0F5' }, // Delta
                { color: '#A8D8B9', colorDeep: '#7CC496', colorLight: '#D6F5E4' }, // Theta
                { color: '#FFD1DC', colorDeep: '#F2A5BE', colorLight: '#FFEAF2' }, // Alpha
                { color: '#FFDAB9', colorDeep: '#F5BD8E', colorLight: '#FFF5E6' }, // Beta
                { color: '#FFF3B0', colorDeep: '#F0E68C', colorLight: '#FFFBE6' }  // Gamma
            ];
            const bandColors = palette[layerIndex % palette.length];
            band.color = bandColors.color;
            band.colorDeep = bandColors.colorDeep;
            band.colorLight = bandColors.colorLight;

        ctx.bezierCurveTo(
            width * 0.08,
            tipY - length * 0.02,
            -width * 0.08,
            tipY - length * 0.02,
            -width * tipRound,
            tipY + length * (0.05 + drop * 0.24)
        );

        ctx.bezierCurveTo(
            -width * (0.85 + sideCurve * 0.2),
            baseY - length * (0.72 - drop * 0.25),
            -width,
            baseY - length * 0.2,
            0,
            baseY
        );

        ctx.closePath();

        const grad = ctx.createLinearGradient(0, baseY, 0, tipY);
        grad.addColorStop(0, this._hexToRgba(band.colorDeep, cfg.opacity));
        grad.addColorStop(0.55, this._hexToRgba(band.color, cfg.opacity * (0.92 + cfg.brightness * 0.2)));
        grad.addColorStop(1, this._hexToRgba(band.colorLight, cfg.opacity * (0.55 + cfg.brightness * 0.4)));

        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = this._hexToRgba(band.colorDeep, 0.22 + cfg.brightness * 0.18);
        ctx.lineWidth = 1.2;
        ctx.stroke();
    }

    _drawCenter(cx, cy, maxR, brightness) {
        const ctx = this.ctx;
        const radius = maxR * (0.18 + brightness * 0.14);

        const glow = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 2.4);
        glow.addColorStop(0, `rgba(255, 224, 188, ${0.35 + brightness * 0.25})`);
        glow.addColorStop(1, 'rgba(255, 224, 188, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 2.4, 0, Math.PI * 2);
        ctx.fill();

        const fill = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        fill.addColorStop(0, '#FFF7E8');
        fill.addColorStop(0.45, '#FFE5C8');
        fill.addColorStop(1, '#E9C49A');

        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    _seededNoise(n) {
        const x = Math.sin(n * 12.9898) * 43758.5453;
        return x - Math.floor(x);
    }

    _hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}
