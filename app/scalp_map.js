/**
 * ScalpMap — Topographic brain heatmap for NAD
 *
 * Renders a realistic brain silhouette (from brain.svg) with IDW interpolation
 * across the 4 Muse 2 electrodes (TP9, AF7, AF8, TP10).
 * The colour scale runs cool→warm (blue → cyan → green → yellow → orange → red)
 * and the whole map pulses softly so it feels alive during capture.
 *
 * Public API:
 *   const sm = new ScalpMap(canvas);
 *   sm.update([tp9, af7, af8, tp10]);   // call from polling loop
 *   sm.stop();                           // cancel animation
 */

class ScalpMap {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');
        if (!this.ctx) throw new Error('ScalpMap: could not get 2D context');
        // Latest raw µV values per channel [TP9, AF7, AF8, TP10]
        this._values = [0, 0, 0, 0];

        // Smoothed display values (exponential moving average)
        this._smooth = [0, 0, 0, 0];
        this._alpha  = 0.18;   // smoothing factor

        // Running stats for adaptive normalisation
        this._min =  Infinity;
        this._max = -Infinity;

        // True once at least one update() call has been received
        this._hasData = false;

        // Pulse / shimmer phase
        this._phase = 0;

        // Offline canvas for the heatmap pixel computation
        this._offscreen = document.createElement('canvas');
        this._offCtx    = this._offscreen.getContext('2d');

        this._animId = null;
        this._running = false;

        // SVG brain paths — will be loaded asynchronously
        this._brainOutlinePath = null;  // The main silhouette (big path with cutouts)
        this._brainDetailPaths = [];    // Interior detail paths (sulci/folds)
        this._svgReady = false;
        this._svgViewBox = { w: 190.496, h: 190.497 };

        // Electrode positions in normalised coords [0,1] × [0,1]
        // Origin = top-left, y grows down.
        // Positions approximate 10-20 layout mapped to the brain SVG:
        //   AF7 — frontal-left,  AF8 — frontal-right
        //   TP9 — temporal-left, TP10 — temporal-right
        this._electrodes = [
            { name: 'TP9',  nx: 0.18, ny: 0.55 },   // ch0 - temporal left
            { name: 'AF7',  nx: 0.35, ny: 0.22 },   // ch1 - frontal left
            { name: 'AF8',  nx: 0.65, ny: 0.22 },   // ch2 - frontal right
            { name: 'TP10', nx: 0.82, ny: 0.55 },   // ch3 - temporal right
        ];

        this._W = 0;
        this._H = 0;

        this._loadBrainSVG();
        this._resize();
        this._loop();
    }

    // ── Public ──────────────────────────────────────────────────────────────

    update(channelValues) {
        // channelValues: [tp9, af7, af8, tp10]
        this._hasData = true;
        for (let i = 0; i < 4; i++) {
            const v = channelValues[i] ?? 0;
            this._values[i] = v;

            // Update min/max with a slow decay so old extremes fade
            if (v < this._min) this._min = v;
            if (v > this._max) this._max = v;

            // Smooth
            this._smooth[i] = this._smooth[i] * (1 - this._alpha) + v * this._alpha;
        }

        // Slowly relax the range toward a tighter window
        const range = this._max - this._min;
        if (range > 0) {
            this._min += range * 0.0004;
            this._max -= range * 0.0004;
        }
    }

    stop() {
        this._running = false;
        if (this._animId) cancelAnimationFrame(this._animId);
        this._animId = null;
    }

    resize() { this._resize(); }

    // ── Private ─────────────────────────────────────────────────────────────

    /**
     * Load the brain.svg file, parse all <path> elements, and identify the
     * main outline vs. interior detail paths.
     */
    async _loadBrainSVG() {
        try {
            const resp = await fetch('brain.svg');
            const text = await resp.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'image/svg+xml');

            // Get viewBox
            const svg = doc.querySelector('svg');
            if (svg) {
                const vb = svg.getAttribute('viewBox');
                if (vb) {
                    const parts = vb.trim().split(/[\s,]+/).map(Number);
                    if (parts.length === 4) {
                        this._svgViewBox = { w: parts[2], h: parts[3] };
                    }
                }
            }

            // Extract all path d-attributes
            const pathEls = doc.querySelectorAll('path');
            const allPaths = [];
            let longestIdx = 0;
            let longestLen = 0;

            pathEls.forEach((p, i) => {
                const d = p.getAttribute('d');
                if (!d) return;
                allPaths.push(d);
                if (d.length > longestLen) {
                    longestLen = d.length;
                    longestIdx = allPaths.length - 1;
                }
            });

            if (allPaths.length === 0) {
                console.warn('ScalpMap: no paths found in brain.svg');
                return;
            }

            // The longest path is the main brain outline/silhouette
            this._brainOutlinePath = new Path2D(allPaths[longestIdx]);

            // Everything else is detail
            this._brainDetailPaths = [];
            for (let i = 0; i < allPaths.length; i++) {
                if (i !== longestIdx) {
                    this._brainDetailPaths.push(new Path2D(allPaths[i]));
                }
            }

            this._svgReady = true;
        } catch (err) {
            console.warn('ScalpMap: failed to load brain.svg, falling back to ellipse', err);
        }
    }

    _resize() {
        const container = this.canvas.parentElement;
        if (!container) return;
        const dpr = window.devicePixelRatio || 1;
        const w   = Math.max(container.clientWidth  || 0, 100);
        const h   = Math.max(container.clientHeight || 0, 100);
        if (w === this._W && h === this._H) return; // nothing changed
        this.canvas.width  = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width  = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._W = w;
        this._H = h;

        this._offscreen.width  = Math.max(1, Math.ceil(w / 4));
        this._offscreen.height = Math.max(1, Math.ceil(h / 4));
    }

    _loop() {
        this._running = true;
        const tick = () => {
            if (!this._running) return;
            this._resize(); // re-measure every frame in case size changed after reveal
            this._phase += 0.025;
            this._draw();
            this._animId = requestAnimationFrame(tick);
        };
        tick();
    }

    /**
     * Calculate the transform to fit and centre the SVG in the canvas.
     * Returns { scale, offsetX, offsetY } so that:
     *   ctx.translate(offsetX, offsetY); ctx.scale(scale, scale);
     * maps SVG coords → canvas coords.
     */
    _getBrainTransform(W, H) {
        const vw = this._svgViewBox.w;
        const vh = this._svgViewBox.h;
        const padding = 0.08; // 8% padding on each side
        const availW = W * (1 - 2 * padding);
        const availH = H * (1 - 2 * padding);
        const scale = Math.min(availW / vw, availH / vh);
        const offsetX = (W - vw * scale) / 2;
        const offsetY = (H - vh * scale) / 2;
        return { scale, offsetX, offsetY };
    }

    _draw() {
        const ctx = this.ctx;
        const W = this._W;
        const H = this._H;
        if (!W || !H) return;

        // ── 1. Clear ──
        ctx.clearRect(0, 0, W, H);

        // Nothing to render yet — draw empty brain outline and return
        if (!this._hasData || !isFinite(this._min) || !isFinite(this._max)) {
            this._drawEmptyBrain(ctx, W, H);
            return;
        }

        // ── 2. Normalise smooth values → [0,1] ──
        let mn = this._min, mx = this._max;
        const range = mx - mn || 1;
        const norm = this._smooth.map(v => Math.max(0, Math.min(1, (v - mn) / range)));

        // ── 3. Build heatmap on offscreen canvas ──
        const ow = this._offscreen.width;
        const oh = this._offscreen.height;
        const octx = this._offCtx;
        const imgData = octx.createImageData(ow, oh);
        const data    = imgData.data;

        const scaleX = W / ow;
        const scaleY = H / oh;

        // Electrode pixel coords (in full canvas space)
        const eCoords = this._electrodes.map(e => ({
            px: e.nx * W,
            py: e.ny * H,
        }));

        // For hit-testing pixels against the brain shape, we need
        // the inverse of the brain transform. We'll use a simple bounding
        // approach: build the heatmap across the entire canvas, then clip later.
        for (let py = 0; py < oh; py++) {
            for (let px = 0; px < ow; px++) {
                const x = (px + 0.5) * scaleX;
                const y = (py + 0.5) * scaleY;

                // IDW interpolation (power=2)
                let wSum = 0, vSum = 0;
                for (let i = 0; i < 4; i++) {
                    const ex = eCoords[i].px;
                    const ey = eCoords[i].py;
                    const d2 = (x - ex) ** 2 + (y - ey) ** 2;
                    const w  = d2 < 1 ? 1e6 : 1 / d2;
                    wSum += w;
                    vSum += w * norm[i];
                }
                const val = vSum / wSum;  // [0,1]

                // Pulse shimmer: subtle brightness oscillation
                const shimmer = 1 + 0.06 * Math.sin(this._phase + px * 0.2 + py * 0.15);
                const t = Math.max(0, Math.min(1, val * shimmer));

                const [r, g, b] = this._colormap(t);
                const idx = (py * ow + px) * 4;
                data[idx]     = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
                data[idx + 3] = 220;
            }
        }
        octx.putImageData(imgData, 0, 0);

        // ── 4. Draw brain shape clip + heatmap ──
        if (this._svgReady) {
            this._drawWithSVG(ctx, W, H, eCoords, norm);
        } else {
            this._drawWithEllipse(ctx, W, H, eCoords, norm);
        }

        // ── 8. Colour scale bar (right edge) ──
        this._drawColorBar(ctx, W, H);
    }

    /**
     * Draw using the SVG brain silhouette as clip path.
     */
    _drawWithSVG(ctx, W, H, eCoords, norm) {
        const { scale, offsetX, offsetY } = this._getBrainTransform(W, H);

        // ── Clip to brain outline and fill with heatmap ──
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        // Background inside brain shape
        ctx.fillStyle = '#1a1030';
        ctx.fill(this._brainOutlinePath);

        // Clip to brain shape
        ctx.clip(this._brainOutlinePath);
        ctx.restore();

        // Draw the heatmap (stretched offscreen) clipped to brain
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        ctx.clip(this._brainOutlinePath);

        // We need to undo the transform for the drawImage call and map
        // the full canvas heatmap into the SVG coordinate space
        ctx.save();
        ctx.scale(1 / scale, 1 / scale);
        ctx.translate(-offsetX, -offsetY);
        ctx.drawImage(this._offscreen, 0, 0, W, H);
        ctx.restore();
        ctx.restore();

        // ── Brain outline stroke ──
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        ctx.shadowColor = 'rgba(139,92,246,0.5)';
        ctx.shadowBlur  = 18 / scale;
        ctx.strokeStyle = 'rgba(200,180,255,0.6)';
        ctx.lineWidth   = 2.5 / scale;
        ctx.stroke(this._brainOutlinePath);
        ctx.restore();

        // ── Brain interior details (sulci/folds) ──
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        ctx.strokeStyle = 'rgba(200,180,255,0.25)';
        ctx.lineWidth   = 1.2 / scale;
        ctx.fillStyle   = 'rgba(200,180,255,0.08)';
        for (const p of this._brainDetailPaths) {
            ctx.fill(p);
            ctx.stroke(p);
        }
        ctx.restore();

        // ── Electrode dots + labels ──
        this._drawElectrodes(ctx, W, H, eCoords, norm);
    }

    /**
     * Fallback: draw using the old ellipse method if SVG hasn't loaded.
     */
    _drawWithEllipse(ctx, W, H, eCoords, norm) {
        const cx  = W * 0.5;
        const cy  = H * 0.52;
        const rx  = W * 0.38;
        const ry  = H * 0.43;

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#1a1030';
        ctx.fill();
        ctx.drawImage(this._offscreen, 0, 0, W, H);
        ctx.restore();

        // Brain outline
        ctx.save();
        ctx.shadowColor = 'rgba(139,92,246,0.5)';
        ctx.shadowBlur  = 18;
        ctx.strokeStyle = 'rgba(200,180,255,0.6)';
        ctx.lineWidth   = 2.5;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Nose bump
        ctx.save();
        ctx.strokeStyle = 'rgba(200,180,255,0.4)';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.arc(cx, cy - ry, W * 0.04, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
        ctx.restore();

        this._drawElectrodes(ctx, W, H, eCoords, norm);
    }

    /**
     * Draw electrode dots and labels.
     */
    _drawElectrodes(ctx, W, H, eCoords, norm) {
        const cx = W * 0.5;
        const cy = H * 0.5;

        for (let i = 0; i < 4; i++) {
            const ex = eCoords[i].px;
            const ey = eCoords[i].py;
            const pulse = 1 + 0.18 * Math.sin(this._phase * 1.4 + i * 1.1);
            const r2    = 7 * pulse;
            const [cr, cg, cb] = this._colormap(norm[i]);

            // Glow halo
            ctx.save();
            ctx.beginPath();
            ctx.arc(ex, ey, r2 * 1.8, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${cr},${cg},${cb},0.25)`;
            ctx.fill();
            ctx.restore();

            // Dot
            ctx.save();
            ctx.beginPath();
            ctx.arc(ex, ey, r2, 0, Math.PI * 2);
            ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
            ctx.shadowColor = `rgb(${cr},${cg},${cb})`;
            ctx.shadowBlur  = 12;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.lineWidth   = 1.5;
            ctx.stroke();
            ctx.restore();

            // Label
            const name  = this._electrodes[i].name;
            const lx    = ex + (ex < cx ? -r2 - 22 : r2 + 6);
            const ly    = ey + (ey < cy ? -r2 - 6  : r2 + 14);
            ctx.save();
            ctx.font      = `bold 11px Inter, system-ui`;
            ctx.fillStyle = `rgba(${cr},${cg},${cb},0.9)`;
            ctx.fillText(name, lx, ly);
            ctx.restore();
        }
    }

    /**
     * Draw an empty brain when no data is available yet.
     */
    _drawEmptyBrain(ctx, W, H) {
        if (this._svgReady) {
            const { scale, offsetX, offsetY } = this._getBrainTransform(W, H);

            // Filled brain shape
            ctx.save();
            ctx.translate(offsetX, offsetY);
            ctx.scale(scale, scale);
            ctx.fillStyle = '#1a1030';
            ctx.fill(this._brainOutlinePath);
            ctx.restore();

            // Outline
            ctx.save();
            ctx.translate(offsetX, offsetY);
            ctx.scale(scale, scale);
            ctx.shadowColor = 'rgba(139,92,246,0.5)';
            ctx.shadowBlur  = 18 / scale;
            ctx.strokeStyle = 'rgba(200,180,255,0.6)';
            ctx.lineWidth   = 2.5 / scale;
            ctx.stroke(this._brainOutlinePath);
            ctx.restore();

            // Interior details (subtle)
            ctx.save();
            ctx.translate(offsetX, offsetY);
            ctx.scale(scale, scale);
            ctx.strokeStyle = 'rgba(200,180,255,0.15)';
            ctx.lineWidth   = 1 / scale;
            ctx.fillStyle   = 'rgba(200,180,255,0.05)';
            for (const p of this._brainDetailPaths) {
                ctx.fill(p);
                ctx.stroke(p);
            }
            ctx.restore();
        } else {
            // Fallback ellipse
            const cx = W * 0.5;
            const cy = H * 0.52;
            const rx = W * 0.38;
            const ry = H * 0.43;

            ctx.save();
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#1a1030';
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.shadowColor = 'rgba(139,92,246,0.5)';
            ctx.shadowBlur  = 18;
            ctx.strokeStyle = 'rgba(200,180,255,0.6)';
            ctx.lineWidth   = 2.5;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // "Waiting" label
        ctx.save();
        ctx.font = 'bold 13px Inter, system-ui';
        ctx.fillStyle = 'rgba(200,180,255,0.45)';
        ctx.textAlign = 'center';
        ctx.fillText('Esperando señal…', W * 0.5, H * 0.52);
        ctx.restore();
    }

    _drawColorBar(ctx, W, H) {
        const bx = W - 22;
        const by = H * 0.2;
        const bh = H * 0.6;
        const bw = 8;
        const steps = 60;
        const sh = bh / steps;
        for (let i = 0; i < steps; i++) {
            const t = 1 - i / (steps - 1);
            const [r, g, b] = this._colormap(t);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(bx, by + i * sh, bw, sh + 0.5);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth   = 0.5;
        ctx.strokeRect(bx, by, bw, bh);

        ctx.save();
        ctx.font      = '9px Inter, system-ui';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText('alto', bx - 3, by - 2);
        ctx.fillText('bajo', bx - 3, by + bh + 10);
        ctx.restore();
    }

    /**
     * Cool-warm colormap: blue → cyan → green → yellow → orange → red
     * t ∈ [0,1]
     */
    _colormap(t) {
        // Clamp and sanitise — protect against NaN / undefined / out-of-range
        if (!Number.isFinite(t)) t = 0;
        t = Math.max(0, Math.min(1, t));

        // 5-stop gradient
        const stops = [
            [0.05, 0.08, 0.45],   // deep blue
            [0.10, 0.55, 0.90],   // cyan
            [0.15, 0.80, 0.40],   // green
            [0.95, 0.85, 0.10],   // yellow
            [0.95, 0.40, 0.05],   // orange
            [0.90, 0.08, 0.08],   // red
        ];
        const n   = stops.length - 1;
        const seg = Math.min(Math.floor(t * n), n - 1);
        const f   = t * n - seg;
        const s0  = stops[seg];
        const s1  = stops[seg + 1];
        return [
            Math.round((s0[0] + (s1[0] - s0[0]) * f) * 255),
            Math.round((s0[1] + (s1[1] - s0[1]) * f) * 255),
            Math.round((s0[2] + (s1[2] - s0[2]) * f) * 255),
        ];
    }
}
