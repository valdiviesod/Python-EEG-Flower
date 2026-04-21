/**
 * ScalpMap — live butterfly EEG renderer for NAD.
 *
 * Keeps the existing public API used by app.js:
 *   const sm = new ScalpMap(canvas);
 *   sm.update([tp9, af7, af8, tp10]);
 *   sm.stop();
 *   sm.resize();
 *
 * The visualization is a dense multi-channel butterfly plot on a black stage,
 * with independent color, glow, drift and motion per channel.
 */

class ScalpMap {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        if (!this.ctx) throw new Error('ScalpMap: could not get 2D context');

        // Colors aligned with EEG band botanical palette (eeg_band_analyzer.js)
        this.colors = [
            { line: '#8B5CF6', glow: '139,92,246'  }, // TP9  → Base    🌙 lavanda
            { line: '#22C55E', glow: '34,197,94'   }, // AF7  → Flujo   🌿 verde
            { line: '#EC4899', glow: '236,72,153'  }, // AF8  → Pulso   🌸 rosa
            { line: '#F97316', glow: '249,115,22'  }, // TP10 → Trazo   ☀️ durazno
        ];
        this.names = ['TP9', 'AF7', 'AF8', 'TP10'];
        this.histories = Array.from({ length: 4 }, () => []);
        this.trailCount = 10;
        this.maxPoints = 600;
        this.phase = 0;
        this.running = false;
        this.animId = null;
        this.smooth = [0, 0, 0, 0];
        this.alpha = 0.12; // slower smoothing = longer visible wave crests
        this.lastValues = [0, 0, 0, 0];
        this.min = Infinity;
        this.max = -Infinity;
        this.noiseSeed = Array.from({ length: 4 }, (_, i) => i * 1.618);
        this.sparkles = [];
        this._W = 0;
        this._H = 0;

        this._seedHistory();
        this._seedSparkles();
        this._resize();
        this._loop();
    }

    update(channelValues) {
        if (!Array.isArray(channelValues) || channelValues.length < 4) return;
        for (let i = 0; i < 4; i++) {
            const raw = Number.isFinite(channelValues[i]) ? channelValues[i] : 0;
            this.lastValues[i] = raw;
            this.min = Math.min(this.min, raw);
            this.max = Math.max(this.max, raw);
            this.smooth[i] = this.smooth[i] * (1 - this.alpha) + raw * this.alpha;

            const history = this.histories[i];
            history.push(this.smooth[i]);
            if (history.length > this.maxPoints) history.splice(0, history.length - this.maxPoints);
        }

        const range = this.max - this.min;
        if (range > 0) {
            this.min += range * 0.0008;
            this.max -= range * 0.0008;
        }
    }

    stop() {
        this.running = false;
        if (this.animId) cancelAnimationFrame(this.animId);
        this.animId = null;
    }

    resize() {
        this._resize();
    }

    _seedHistory() {
        for (let ch = 0; ch < 4; ch++) {
            const history = this.histories[ch];
            history.length = 0;
            for (let i = 0; i < this.maxPoints; i++) {
                const t = i / this.maxPoints;
                history.push(
                    // slow primary swell — very long wavelength
                    Math.sin(t * Math.PI * (1.2 + ch * 0.22)) * (34 + ch * 7) +
                    // medium undulation
                    Math.cos(t * Math.PI * (3.1 + ch * 0.41)) * (18 + ch * 4) +
                    // subtle high-freq ripple
                    Math.sin(t * Math.PI * (7.8 + ch * 0.9)) * (5 + ch * 1.2)
                );
            }
        }
    }

    _seedSparkles() {
        this.sparkles = Array.from({ length: 56 }, () => ({
            x: Math.random(),
            y: Math.random(),
            r: 0.8 + Math.random() * 2.6,
            a: 0.12 + Math.random() * 0.35,
            drift: 0.1 + Math.random() * 0.4,
            speed: 0.2 + Math.random() * 0.7,
        }));
    }

    _resize() {
        const container = this.canvas.parentElement;
        if (!container) return;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(container.clientWidth || 0, 120);
        const h = Math.max(container.clientHeight || 0, 120);
        if (w === this._W && h === this._H) return;
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._W = w;
        this._H = h;
    }

    _loop() {
        this.running = true;
        let last = performance.now();
        const tick = (ts) => {
            if (!this.running) return;
            const dt = Math.min(0.05, Math.max(0.001, (ts - last) / 1000));
            last = ts;
            this.phase += dt * 1.1; // slightly slower for more majestic flow
            this._resize();
            this._draw(dt);
            this.animId = requestAnimationFrame(tick);
        };
        this.animId = requestAnimationFrame(tick);
    }

    _draw(dt) {
        const ctx = this.ctx;
        const W = this._W;
        const H = this._H;
        if (!W || !H) return;

        ctx.clearRect(0, 0, W, H);
        this._drawBackground(ctx, W, H, dt);
        this._drawGrid(ctx, W, H);
        this._drawButterfly(ctx, W, H);
        this._drawLegend(ctx, W, H);
    }

    _drawBackground(ctx, W, H, dt) {
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#020307');
        bg.addColorStop(0.5, '#050814');
        bg.addColorStop(1, '#010204');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        const halo = ctx.createRadialGradient(W * 0.5, H * 0.48, H * 0.05, W * 0.5, H * 0.48, H * 0.62);
        halo.addColorStop(0, 'rgba(120, 130, 255, 0.07)');
        halo.addColorStop(0.5, 'rgba(64, 90, 255, 0.04)');
        halo.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, W, H);

        for (const p of this.sparkles) {
            p.y += dt * p.speed * 0.018;
            if (p.y > 1.05) {
                p.y = -0.05;
                p.x = Math.random();
            }
            const x = p.x * W + Math.sin(this.phase * p.drift + p.x * 10) * 8;
            const y = p.y * H;
            const alpha = p.a * (0.65 + 0.35 * Math.sin(this.phase * (1 + p.drift) + p.y * 12));
            ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(x, y, p.r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    _drawGrid(ctx, W, H) {
        ctx.save();
        ctx.strokeStyle = 'rgba(150, 170, 255, 0.07)';
        ctx.lineWidth = 1;

        const cols = 10;
        const rows = 6;
        for (let i = 1; i < cols; i++) {
            const x = (W / cols) * i;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
        }
        for (let i = 1; i < rows; i++) {
            const y = (H / rows) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.moveTo(0, H * 0.5);
        ctx.lineTo(W, H * 0.5);
        ctx.stroke();
        ctx.restore();
    }

    _drawButterfly(ctx, W, H) {
        const midY = H * 0.5;
        const range = Math.max(1, this.max - this.min);
        // tall band — waves span most of the canvas height
        const bandHeight = H * 0.46;
        // channels spread across full height for maximum visual separation
        const channelOffsets = [-0.24, -0.08, 0.08, 0.24].map(v => v * H);

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // global slow swell shared by all channels — gives cohesive "breathing" feel
        const globalSwell = Math.sin(this.phase * 0.38) * H * 0.035;

        for (let ch = 0; ch < 4; ch++) {
            const history = this.histories[ch];
            if (history.length < 2) continue;

            const { line, glow } = this.colors[ch];
            const channelEnergy = this._channelEnergy(history);
            // amplitude scales generously with energy for dramatic peaks
            const amplitude = bandHeight * (0.38 + channelEnergy * 0.62);
            const baseY = midY + channelOffsets[ch] * (0.55 + channelEnergy * 0.35) + globalSwell;

            // build y-coordinate array once — reuse for both trails and main line
            const pts = new Float32Array(history.length);
            const N = history.length - 1;
            for (let i = 0; i <= N; i++) {
                const t = i / N;
                const normalized = ((history[i] - this.min) / range) - 0.5;
                // two-layer undulation envelope — long swell + subtle ripple
                const swellA = 0.72 + 0.28 * Math.sin(t * Math.PI * (1.8 + ch * 0.25) + this.phase * 0.55);
                const ripple = Math.sin(t * Math.PI * 5.5 + this.phase * (1.15 + ch * 0.14)) * (3 + channelEnergy * 7);
                pts[i] = baseY - normalized * amplitude * swellA + ripple;
            }

            // ── Ghost trails — wide glow ribbons ──────────────────────────────
            for (let trail = this.trailCount - 1; trail >= 0; trail--) {
                const trailMix = trail / (this.trailCount - 1);
                // drift each trail vertically with a slow sine so they fan out
                const driftAmt = (16 + channelEnergy * 48) * (trailMix - 0.5) * (1 + ch * 0.08);
                const driftX = Math.sin(this.phase * (0.72 + ch * 0.09) + trail * 0.62 + this.noiseSeed[ch]) * (10 + 18 * trailMix);

                this._strokeSmooth(ctx, history.length, W, (i) => {
                    const t = i / N;
                    const slowWave = Math.sin(t * Math.PI * 2.6 + this.phase * (0.9 + ch * 0.11) + trail * 0.38) * (6 + channelEnergy * 14);
                    return pts[i] + driftAmt + slowWave + driftX;
                });

                ctx.strokeStyle = `rgba(${glow}, ${0.04 + trailMix * 0.09})`;
                ctx.lineWidth = 14 - trailMix * 6;
                ctx.shadowBlur = 20 + trailMix * 20;
                ctx.shadowColor = `rgba(${glow}, ${0.14 + trailMix * 0.14})`;
                ctx.stroke();
            }

            // ── Main crisp line — bezier smoothed ────────────────────────────
            this._strokeSmooth(ctx, history.length, W, (i) => pts[i]);
            ctx.strokeStyle = line;
            ctx.lineWidth = 2.5 + channelEnergy * 1.8;
            ctx.shadowBlur = 22;
            ctx.shadowColor = `rgba(${glow}, 0.55)`;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
    }

    /**
     * Build a smooth bezier path through all sample points.
     * Uses midpoint quadratic technique for continuous curvature.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} len  — number of samples
     * @param {number} W    — canvas width
     * @param {function(number): number} yFn — maps sample index → y
     */
    _strokeSmooth(ctx, len, W, yFn) {
        const N = len - 1;
        ctx.beginPath();
        let x0 = 0, y0 = yFn(0);
        ctx.moveTo(x0, y0);
        for (let i = 1; i <= N; i++) {
            const x1 = (i / N) * W;
            const y1 = yFn(i);
            // midpoint between previous and current becomes the bezier anchor
            const mx = (x0 + x1) * 0.5;
            const my = (y0 + y1) * 0.5;
            ctx.quadraticCurveTo(x0, y0, mx, my);
            x0 = x1; y0 = y1;
        }
        ctx.lineTo(x0, y0);
    }

    _drawLegend(ctx, W, H) {
        const padX = 22;
        const baseY = 22;
        ctx.font = '600 12px Inter, system-ui, sans-serif';
        ctx.textBaseline = 'middle';

        for (let i = 0; i < this.names.length; i++) {
            const x = padX + i * 82;
            const y = baseY;
            ctx.fillStyle = `rgba(${this.colors[i].glow}, 0.16)`;
            ctx.beginPath();
            ctx.roundRect(x - 10, y - 10, 68, 20, 10);
            ctx.fill();

            ctx.fillStyle = this.colors[i].line;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = 'rgba(235, 242, 255, 0.9)';
            ctx.fillText(this.names[i], x + 10, y);
        }

        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(210,220,255,0.55)';
        ctx.fillText('Butterfly EEG en vivo', W - 20, baseY);
        ctx.textAlign = 'start';
    }

    _channelEnergy(history) {
        const len = Math.min(48, history.length - 1);
        if (len <= 1) return 0.35;
        let delta = 0;
        for (let i = history.length - len; i < history.length; i++) {
            delta += Math.abs(history[i] - history[i - 1]);
        }
        return Math.max(0.12, Math.min(1, delta / len / 22));
    }
}
