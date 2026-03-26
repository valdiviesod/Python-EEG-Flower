/**
 * ScalpMap — Zonal brain activity map for NAD
 *
 * Renders the realistic brain silhouette (from brain.svg, 190×190 viewBox)
 * divided into anatomical zones, each zone filled with its own base colour
 * that brightens and pulses according to the EEG signal from the mapped
 * Muse 2 electrodes.
 *
 * Zone → electrode mapping (Muse 2: TP9, AF7, AF8, TP10):
 *   frontal    (Pensamiento) → AF7 (ch1) + AF8 (ch2) avg — violet  #8B5CF6
 *   parietal   (Sentidos)    → all four average            — emerald #22C55E
 *   occipital  (Visión)      → TP9 (ch0) + TP10 (ch3) avg — pink    #EC4899
 *   temporal_l (Memoria)     → TP9 (ch0)                  — orange  #F97316
 *   temporal_r (Emoción)     → TP10 (ch3)                 — amber   #EAB308
 *
 * The brain.svg file must contain one <path data-zone="…"> per zone
 * plus an outer <path id="outline"> for the silhouette stroke.
 *
 * Public API:
 *   const sm = new ScalpMap(canvas);
 *   sm.update([tp9, af7, af8, tp10]);
 *   sm.stop();
 *   sm.resize();
 */

class ScalpMap {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');
        if (!this.ctx) throw new Error('ScalpMap: could not get 2D context');

        // Latest smoothed value per channel [TP9, AF7, AF8, TP10]
        this._smooth = [0, 0, 0, 0];
        this._alpha  = 0.14;   // EMA smoothing

        // Running adaptive range for normalisation
        this._min =  Infinity;
        this._max = -Infinity;
        this._hasData = false;

        // Animation phase (for pulsing)
        this._phase = 0;

        // Zone definitions: name, base colour [r,g,b], electrode indices and weights
        this._zones = [
            {
                name:   'frontal',
                color:  [139, 92, 246],   // violet
                elecs:  [1, 2],           // AF7, AF8
                path2d: null,
            },
            {
                name:   'parietal',
                color:  [34, 197, 94],    // emerald
                elecs:  [0, 1, 2, 3],     // all four
                path2d: null,
            },
            {
                name:   'occipital',
                color:  [236, 72, 153],   // pink
                elecs:  [0, 3],           // TP9, TP10
                path2d: null,
            },
            {
                name:   'temporal_l',
                color:  [249, 115, 22],   // orange
                elecs:  [0],              // TP9
                path2d: null,
            },
            {
                name:   'temporal_r',
                color:  [234, 179, 8],    // amber
                elecs:  [3],              // TP10
                path2d: null,
            },
        ];

        // Sulci paths (white separator lines drawn on top)
        this._sulciPaths = [];

        // Outer brain outline (stroke only)
        this._outlinePath = null;

        // SVG transform: maps SVG coords → canvas coords
        this._svgViewBox = { w: 190.496, h: 190.497 };
        this._svgReady = false;

        this._W = 0;
        this._H = 0;

        this._animId  = null;
        this._running = false;

        this._loadSVG();
        this._resize();
        this._loop();
    }

    // ── Public ──────────────────────────────────────────────────────────────

    update(channelValues) {
        // channelValues: [tp9, af7, af8, tp10]
        this._hasData = true;
        for (let i = 0; i < 4; i++) {
            const v = channelValues[i] ?? 0;
            if (v < this._min) this._min = v;
            if (v > this._max) this._max = v;
            this._smooth[i] = this._smooth[i] * (1 - this._alpha) + v * this._alpha;
        }
        // Slowly relax the adaptive range
        const range = this._max - this._min;
        if (range > 0) {
            this._min += range * 0.0003;
            this._max -= range * 0.0003;
        }
    }

    stop() {
        this._running = false;
        if (this._animId) cancelAnimationFrame(this._animId);
        this._animId = null;
    }

    resize() { this._resize(); }

    // ── Private ─────────────────────────────────────────────────────────────

    async _loadSVG() {
        try {
            const resp = await fetch('brain.svg');
            const text = await resp.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'image/svg+xml');

            const svg = doc.querySelector('svg');
            if (svg) {
                const vb = svg.getAttribute('viewBox');
                if (vb) {
                    const parts = vb.trim().split(/[\s,]+/).map(Number);
                    if (parts.length >= 4) {
                        this._svgViewBox = { w: parts[2], h: parts[3] };
                    }
                }
            }

            // Load zone paths
            for (const zone of this._zones) {
                const el = doc.querySelector(`[data-zone="${zone.name}"]`);
                if (el) {
                    const d = el.getAttribute('d');
                    if (d) zone.path2d = new Path2D(d);
                }
            }

            // Load sulci
            const sulciEls = doc.querySelectorAll('.sulcus');
            sulciEls.forEach(el => {
                const d = el.getAttribute('d');
                if (d) {
                    this._sulciPaths.push({
                        path2d:       new Path2D(d),
                        stroke:       el.getAttribute('stroke')       || 'rgba(255,255,255,0.35)',
                        strokeWidth:  parseFloat(el.getAttribute('stroke-width') || '1.5'),
                        dashArray:    el.getAttribute('stroke-dasharray') || null,
                    });
                }
            });

            // Load outer outline
            const outlineEl = doc.getElementById('outline');
            if (outlineEl) {
                const d = outlineEl.getAttribute('d');
                if (d) this._outlinePath = new Path2D(d);
            }

            this._svgReady = true;
        } catch (err) {
            console.warn('ScalpMap: failed to load brain.svg', err);
        }
    }

    _resize() {
        const container = this.canvas.parentElement;
        if (!container) return;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(container.clientWidth  || 0, 80);
        const h = Math.max(container.clientHeight || 0, 80);
        if (w === this._W && h === this._H) return;
        this.canvas.width  = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width  = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._W = w;
        this._H = h;
    }

    _loop() {
        this._running = true;
        const tick = () => {
            if (!this._running) return;
            this._resize();
            this._phase += 0.022;
            this._draw();
            this._animId = requestAnimationFrame(tick);
        };
        tick();
    }

    /** Map SVG coords → canvas coords. Returns {scale, tx, ty}. */
    _getTransform(W, H) {
        const vw = this._svgViewBox.w;
        const vh = this._svgViewBox.h;
        const pad = 0.06;
        const availW = W * (1 - 2 * pad);
        const availH = H * (1 - 2 * pad);
        const scale  = Math.min(availW / vw, availH / vh);
        const tx = (W - vw * scale) / 2;
        const ty = (H - vh * scale) / 2;
        return { scale, tx, ty };
    }

    /** Normalise a channel value to [0,1] */
    _norm(v) {
        const range = this._max - this._min || 1;
        return Math.max(0, Math.min(1, (v - this._min) / range));
    }

    /** Compute the normalised activity [0,1] for a zone by averaging its electrodes. */
    _zoneActivity(zone) {
        if (!this._hasData) return 0;
        let sum = 0;
        for (const i of zone.elecs) sum += this._norm(this._smooth[i]);
        return sum / zone.elecs.length;
    }

    _draw() {
        const ctx = this.ctx;
        const W = this._W;
        const H = this._H;
        if (!W || !H) return;

        ctx.clearRect(0, 0, W, H);

        if (!this._svgReady) {
            this._drawFallback(ctx, W, H);
            return;
        }

        const { scale, tx, ty } = this._getTransform(W, H);

        // ── 1. Clipped zone layer (translate+scale once, clip to outline) ─
        ctx.save();
        ctx.translate(tx, ty);
        ctx.scale(scale, scale);

        // Clip all zone fills to the brain outline
        if (this._outlinePath) {
            ctx.clip(this._outlinePath, 'nonzero');
        }

        // ── 2. Draw each zone ────────────────────────────────────────────
        for (let zi = 0; zi < this._zones.length; zi++) {
            const zone = this._zones[zi];
            if (!zone.path2d) continue;

            const activity = this._zoneActivity(zone);

            // Per-zone pulsing offset so zones breathe at different rates
            const phaseOffset = zi * 0.72;
            const pulse = 0.5 + 0.5 * Math.sin(this._phase + phaseOffset);

            // Brightness: idle base + activity drive + pulse shimmer
            const brightness = 0.30 + activity * 0.60 + pulse * 0.10;
            const alpha      = 0.55 + activity * 0.40 + pulse * 0.05;

            const [r, g, b] = zone.color;

            // Base zone fill
            ctx.save();
            ctx.fillStyle = `rgba(${Math.round(r * brightness)},${Math.round(g * brightness)},${Math.round(b * brightness)},${alpha.toFixed(2)})`;
            ctx.fill(zone.path2d);
            ctx.restore();

            // Radial bloom glow when active
            if (activity > 0.15) {
                const glowAlpha = activity * 0.40 * (0.7 + 0.3 * pulse);
                const grad = this._createZoneGlow(ctx, zone, r, g, b, glowAlpha);
                if (grad) {
                    ctx.save();
                    ctx.fillStyle = grad;
                    ctx.fill(zone.path2d);
                    ctx.restore();
                }
            }
        }

        // ── 3. Sulci lines (zone separator strokes) ───────────────────────
        for (const s of this._sulciPaths) {
            ctx.save();
            ctx.strokeStyle = s.stroke;
            ctx.lineWidth   = s.strokeWidth;
            ctx.lineCap     = 'round';
            if (s.dashArray) {
                ctx.setLineDash(s.dashArray.split(/[\s,]+/).map(Number));
            }
            ctx.stroke(s.path2d);
            ctx.restore();
        }

        ctx.restore(); // pop translate+scale+clip

        // ── 4. Brain outline stroke (outside clip, on top) ────────────────
        ctx.save();
        ctx.translate(tx, ty);
        ctx.scale(scale, scale);
        if (this._outlinePath) {
            ctx.shadowColor = 'rgba(180,140,255,0.45)';
            ctx.shadowBlur  = 8 / scale;
            ctx.strokeStyle = 'rgba(210,185,255,0.70)';
            ctx.lineWidth   = 1.5 / scale;
            ctx.stroke(this._outlinePath);
        }
        ctx.restore();

        // ── 5. Zone labels ────────────────────────────────────────────────
        this._drawLabels(ctx, W, H, scale, tx, ty);
    }

    /**
     * Create a radial glow gradient centered on the zone's approximate centroid.
     * Operates in SVG coordinate space (caller is already translated+scaled).
     */
    _createZoneGlow(ctx, zone, r, g, b, alpha) {
        // Approximate centroids in SVG coords (viewBox 0 0 190.496 190.497)
        const centroids = {
            frontal:    { x: 95, y: 35  },
            parietal:   { x: 95, y: 88  },
            occipital:  { x: 95, y: 150 },
            temporal_l: { x: 32, y: 120 },
            temporal_r: { x: 158, y: 120 },
        };
        const c = centroids[zone.name];
        if (!c) return null;

        const radius = 45;
        const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, radius);
        grad.addColorStop(0,   `rgba(${r},${g},${b},${alpha.toFixed(2)})`);
        grad.addColorStop(0.5, `rgba(${r},${g},${b},${(alpha * 0.4).toFixed(2)})`);
        grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
        return grad;
    }

    /** Draw small zone name labels */
    _drawLabels(ctx, W, H, scale, tx, ty) {
        const labelDefs = [
            { zone: 'frontal',    x: 95,  y: 32,  label: 'Pensamiento',  rotate: 0   },
            { zone: 'parietal',   x: 95,  y: 88,  label: 'Sentidos',     rotate: 0   },
            { zone: 'occipital',  x: 95,  y: 152, label: 'Visión',       rotate: 0   },
            { zone: 'temporal_l', x: 30,  y: 120, label: 'Memoria',      rotate: -90 },
            { zone: 'temporal_r', x: 160, y: 120, label: 'Emoción',      rotate:  90 },
        ];

        // Font size in SVG units (~5px at full 190px scale)
        const fontSize = 5;

        ctx.save();
        ctx.translate(tx, ty);
        ctx.scale(scale, scale);

        for (const def of labelDefs) {
            const zoneObj = this._zones.find(z => z.name === def.zone);
            const activity = zoneObj ? this._zoneActivity(zoneObj) : 0;
            const [r, g, b] = zoneObj ? zoneObj.color : [255, 255, 255];

            ctx.save();
            ctx.translate(def.x, def.y);
            if (def.rotate) ctx.rotate(def.rotate * Math.PI / 180);

            // Text shadow for legibility
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur  = 2 / scale;

            const alpha = 0.55 + activity * 0.45;
            ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
            ctx.font = `bold ${fontSize}px Inter, system-ui`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(def.label, 0, 0);
            ctx.restore();
        }
        ctx.restore();
    }

    /** Fallback: simple coloured ellipse zones when SVG hasn't loaded yet */
    _drawFallback(ctx, W, H) {
        const cx = W / 2;
        const cy = H / 2;
        const rx = W * 0.38;
        const ry = H * 0.43;

        // Brain background
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(30,20,50,0.9)';
        ctx.fill();

        // Simple zone bands
        const bands = [
            { label: 'F', cx: cx, cy: cy - ry * 0.5, r: rx * 0.5, elecs: [1,2], color: [139,92,246] },
            { label: 'P', cx: cx, cy: cy,             r: rx * 0.45, elecs: [0,1,2,3], color: [34,197,94] },
            { label: 'O', cx: cx, cy: cy + ry * 0.55, r: rx * 0.4, elecs: [0,3], color: [236,72,153] },
        ];
        for (const b of bands) {
            let activity = 0;
            if (this._hasData) {
                for (const i of b.elecs) activity += this._norm(this._smooth[i]);
                activity /= b.elecs.length;
            }
            const brightness = 0.3 + activity * 0.7;
            const [r,g,bl] = b.color;
            ctx.beginPath();
            ctx.ellipse(b.cx, b.cy, b.r, b.r * 0.6, 0, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${Math.round(r*brightness)},${Math.round(g*brightness)},${Math.round(bl*brightness)},0.7)`;
            ctx.fill();
        }

        ctx.strokeStyle = 'rgba(200,170,255,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}
