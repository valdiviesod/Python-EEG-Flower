/**
 * LavaPulse v2 — Galactic EEG Reactive Visualizer
 *
 * A living, breathing plasma nebula ring driven by EEG band analysis.
 * Reacts in real-time to EEG frequency bands like a DJ visualizer —
 * BPM-synced beat jumps, chromatic flashes, orbital halos, nebula clouds,
 * particle storms, and continuous galactic color drift.
 *
 * ─── Architecture ──────────────────────────────────────────────────────────
 *  • EEG bands → base visual parameters (computed once at construction)
 *  • Internal oscillators simulate live reactivity (tempo, energy envelopes)
 *  • BPM engine: BPM derived from MIDI/EEG → periodic beat events
 *  • Beat events: scale spike, chromatic split, particle burst, hue flash
 *  • 5 animation layers (back to front):
 *      1. Deep space background  — starfield + nebula haze
 *      2. Outer glow bloom        — wide feathered ring halos
 *      3. Orbital halos           — concentric ghost rings (beat-reactive)
 *      4. Core plasma ring        — main organic morphing body
 *      5. Particle system         — sparks, comets, orbital debris
 *  • Afterglow: semi-transparent clear each frame → neon motion trail
 *
 * ─── EEG → Visual Mapping ──────────────────────────────────────────────────
 *  delta  → ring mass / base radius / slow nebula breathing
 *  theta  → undulation depth / dreamy wave count / trail fade speed
 *  alpha  → breathing pulse speed & amplitude / inner warmth haze
 *  beta   → perturbation speed / chromatic intensity / BPM multiplier
 *  gamma  → particle count / flash frequency / micro-ripple density
 *
 * ─── Color Palettes (per dominant EEG band) ───────────────────────────────
 *  delta  → deep violet/magenta nebula (galactic core)
 *  theta  → bioluminescent emerald jade (deep ocean)
 *  alpha  → classic lava (orange-red → molten gold)
 *  beta   → solar fire (deep crimson → electric gold)
 *  gamma  → electric blue-white plasma (cosmic ray)
 *
 * Public API: new LavaPulse(canvas, analyzer) → .start() .stop() ._draw() .exportPNG()
 */
class LavaPulse {
    constructor(canvas, analyzer) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');
        this.analyzer = analyzer;
        this.animationId = null;
        this.t  = 0;       // frame counter (integer)
        this.ft = 0;       // float time (seconds, 60fps basis)

        // ── Smoothed reactive state (lerped each frame) ──
        this._energy   = 0;   // 0–1 overall EEG energy
        this._beatFlash = 0;  // 0–1 beat flash envelope (decays fast)
        this._chromShift = 0; // 0–1 chromatic split intensity
        this._hueDrift  = 0;  // continuous hue rotation (degrees)
        this._scale     = 1;  // ring scale (beats push > 1 then decay)
        this._noiseAmp  = 0;  // extra perturbation on beats
        this._brightness = 1; // overall brightness multiplier
        this._particleBurst = 0; // burst counter for beat particles

        this._baseR = 0;      // computed each frame from canvas size

        // ── Spatial perlin-like noise seeds (stable across frames) ──
        this._noiseSeeds = Array.from({ length: 8 }, () => Math.random() * 1000);

        this._buildParams();
        this._initParticles();
        this._initStarfield();
        this._initOrbitalHalos();
    }

    // ══════════════════════════════════════════════════════════════════════
    // PARAMETER BUILD — EEG → Visual constants
    // ══════════════════════════════════════════════════════════════════════

    _buildParams() {
        const bands = this.analyzer.normalizedBands;
        const v = (key) => (bands.find(b => b.key === key) || {}).relativePower || 0;
        const d  = v('delta');
        const th = v('theta');
        const a  = v('alpha');
        const b  = v('beta');
        const g  = v('gamma');
        this.eeg = { d, th, a, b, g };

        // ── Dominant band → color palette ──
        const dominant = [
            { key: 'delta', v: d }, { key: 'theta', v: th }, { key: 'alpha', v: a },
            { key: 'beta',  v: b }, { key: 'gamma', v: g },
        ].reduce((best, x) => x.v > best.v ? x : best).key;
        this.dominant = dominant;

        // Extended palettes: [space, rimFar, rim, mid, inner, core, spark, halo]
        // Colors aligned with botanical EEG band palette (eeg_band_analyzer.js)
        const PALETTES = {
            delta: {
                // Base 🌙 lavanda — #8B5CF6
                bg:    '#04010D',
                c: ['#0D0020', '#2A0060', '#5B21B6', '#8B5CF6', '#C4B5FD', '#FFFFFF', '#DDD6FE', '#6D28D9'],
                hue:   265,
            },
            theta: {
                // Flujo 🌌 verde — #22C55E
                bg:    '#010D04',
                c: ['#052E16', '#14532D', '#15803D', '#22C55E', '#86EFAC', '#FFFFFF', '#BBF7D0', '#166534'],
                hue:   145,
            },
            alpha: {
                // Pulso 💫 rosa — #EC4899
                bg:    '#0D0106',
                c: ['#2D0018', '#7F1D4F', '#BE185D', '#EC4899', '#F9A8D4', '#FFFFFF', '#FBCFE8', '#9D174D'],
                hue:   330,
            },
            beta: {
                // Trazo ☀️ durazno — #F97316
                bg:    '#0D0400',
                c: ['#431407', '#9A3412', '#C2410C', '#F97316', '#FDBA74', '#FFFFFF', '#FED7AA', '#EA580C'],
                hue:   25,
            },
            gamma: {
                // Destello ✨ limón — #EAB308
                bg:    '#0A0900',
                c: ['#422006', '#713F12', '#A16207', '#EAB308', '#FDE047', '#FFFFFF', '#FEF08A', '#CA8A04'],
                hue:   50,
            },
        };
        this.pal = PALETTES[dominant];
        this.baseHue = this.pal.hue;

        // ── Ring base radius fraction ──
        this.baseRadiusFrac = 0.24 + d * 0.10 + th * 0.04;

        // ── Perturbation layers — richer than v1 ──
        // { h, amp, speed, phase }  — phase shifts make them less symmetric
        this.perturbs = [
            { h: 2  + Math.round(d  * 3), amp: 0.07 + d  * 0.22, speed: 0.0025 + d  * 0.003,  phase: 0.0 },
            { h: 3  + Math.round(th * 4), amp: 0.05 + th * 0.15, speed: 0.0055 + th * 0.005,  phase: 1.1 },
            { h: 4  + Math.round(a  * 5), amp: 0.04 + a  * 0.12, speed: 0.0090 + a  * 0.010,  phase: 2.3 },
            { h: 6  + Math.round(b  * 8), amp: 0.03 + b  * 0.09, speed: 0.0180 + b  * 0.018,  phase: 0.7 },
            { h: 10 + Math.round(g  * 10),amp: 0.01 + g  * 0.06, speed: 0.0400 + g  * 0.040,  phase: 3.7 },
            // Extra high-freq micro-ripple for galactic texture
            { h: 18 + Math.round(g  * 6), amp: 0.005 + g * 0.025, speed: 0.08 + g * 0.06,     phase: 1.8 },
        ];

        // ── BPM / beat engine ──
        // Derive BPM from beta (active thinking = faster tempo) and alpha (calm = slower)
        const rawBpm   = 55 + b * 60 + a * 20 + g * 30;
        this.bpm       = Math.max(40, Math.min(160, rawBpm));
        this.beatPeriod = (60 / this.bpm) * 60; // frames per beat (at 60fps)
        this._lastBeatT = -this.beatPeriod;

        // ── Breathing pulse ──
        this.pulseFreq = 0.012 + a * 0.020 + b * 0.006;
        this.pulseAmp  = 0.055 + a * 0.130 + b * 0.040;

        // ── Ring stroke width ──
        this.ringWidthFrac = 0.020 + d * 0.016 + th * 0.010;

        // ── Particle system ──
        this.maxParticles  = 50  + Math.round(g * 120) + Math.round(b * 80);
        this.particleSpeed = 0.25 + b * 1.4 + g * 2.0;

        // ── Nebula layers: slow large blobs behind the ring ──
        this.nebulaLayers = [
            { angle: 0.0,  radiusFrac: 0.55, sizeFrac: 0.45, speed: 0.0008, alpha: 0.06 + d * 0.06 },
            { angle: 2.1,  radiusFrac: 0.48, sizeFrac: 0.38, speed: -0.0011, alpha: 0.04 + th * 0.05 },
            { angle: 4.2,  radiusFrac: 0.60, sizeFrac: 0.50, speed: 0.0006, alpha: 0.03 + a * 0.04 },
        ];

        // ── Chromatic aberration intensity ──
        this.chromaticBase = 0.008 + b * 0.020 + g * 0.015;

        // ── Trail fade: theta = dreamier = more trail ──
        this.trailAlpha = 0.18 + (1 - th) * 0.12;
        this.trailAlpha = Math.max(0.12, Math.min(0.35, this.trailAlpha));
    }

    // ══════════════════════════════════════════════════════════════════════
    // STARFIELD (deep space background dots)
    // ══════════════════════════════════════════════════════════════════════

    _initStarfield() {
        const count = 120 + Math.round(this.eeg.g * 80);
        this.stars = Array.from({ length: count }, () => ({
            angle:    Math.random() * Math.PI * 2,
            dist:     0.05 + Math.random() * 0.95,  // fraction of halfMin
            size:     0.3 + Math.random() * 1.8,
            alpha:    0.2 + Math.random() * 0.7,
            twinkle:  Math.random() * Math.PI * 2,  // twinkle phase offset
            speed:    0.003 + Math.random() * 0.012, // twinkle speed
        }));
    }

    // ══════════════════════════════════════════════════════════════════════
    // ORBITAL HALOS (ghost rings — beat-reactive)
    // ══════════════════════════════════════════════════════════════════════

    _initOrbitalHalos() {
        this.halos = [
            { radiusMult: 1.35, baseAlpha: 0.06, width: 2.5, beatGain: 0.25 },
            { radiusMult: 1.65, baseAlpha: 0.04, width: 1.5, beatGain: 0.18 },
            { radiusMult: 1.95, baseAlpha: 0.025, width: 1.0, beatGain: 0.12 },
        ];
    }

    // ══════════════════════════════════════════════════════════════════════
    // PARTICLE SYSTEM
    // ══════════════════════════════════════════════════════════════════════

    _initParticles() {
        this.particles = [];
        for (let i = 0; i < this.maxParticles; i++) {
            this.particles.push(this._spawnParticle(true));
        }
        // Comet particles (faster, longer trail)
        this.comets = Array.from({ length: 3 + Math.round(this.eeg.g * 8) }, () =>
            this._spawnComet(true)
        );
    }

    _spawnParticle(randomAge = false) {
        // Mix: some orbit on ring, some fly outward, some float inward
        const type = Math.random();
        return {
            angle:      Math.random() * Math.PI * 2,
            radialOff:  (Math.random() - 0.5) * 0.06,
            radialVel:  (0.001 + Math.random() * 0.005) * this.particleSpeed * (type < 0.3 ? -1 : 1),
            angularVel: (Math.random() - 0.5) * 0.002 * (0.5 + this.eeg.b),
            size:       0.6 + Math.random() * 2.8,
            baseAlpha:  0.35 + Math.random() * 0.65,
            age:        randomAge ? Math.random() : 0,
            maxAge:     0.4 + Math.random() * 1.8,
            colorIdx:   Math.floor(Math.random() * 3),  // which palette color to use
        };
    }

    _spawnComet(randomAge = false) {
        const angle = Math.random() * Math.PI * 2;
        return {
            angle,
            radialOff:  (Math.random() - 0.3) * 0.15,
            radialVel:  (0.008 + Math.random() * 0.015) * (Math.random() < 0.5 ? 1 : -1),
            angularVel: (Math.random() * 0.003) * (Math.random() < 0.5 ? 1 : -1),
            size:       1.5 + Math.random() * 3.5,
            alpha:      0.5 + Math.random() * 0.5,
            age:        randomAge ? Math.random() : 0,
            maxAge:     0.3 + Math.random() * 0.8,
        };
    }

    // ══════════════════════════════════════════════════════════════════════
    // SHAPE MATH
    // ══════════════════════════════════════════════════════════════════════

    _getRadius(angle, t) {
        let r = this._baseR;
        for (const p of this.perturbs) {
            r += this._baseR * p.amp * Math.sin(p.h * angle + p.speed * t + p.phase);
        }
        // Beat-driven extra perturbation
        if (this._noiseAmp > 0.001) {
            r += this._baseR * this._noiseAmp * Math.sin(7 * angle + t * 0.1);
            r += this._baseR * this._noiseAmp * 0.5 * Math.cos(13 * angle - t * 0.07);
        }
        return r;
    }

    _getPoints(t, n = 320) {
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const angle = (i / n) * Math.PI * 2;
            const r = this._getRadius(angle, t);
            pts.push({
                x: r * Math.cos(angle - Math.PI * 0.5),
                y: r * Math.sin(angle - Math.PI * 0.5),
            });
        }
        return pts;
    }

    // ══════════════════════════════════════════════════════════════════════
    // BEAT ENGINE
    // ══════════════════════════════════════════════════════════════════════

    _updateBeat() {
        const { t } = this;
        const sinceLast = t - this._lastBeatT;

        // Sub-beats: secondary micro-pulses between main beats
        const subBeat = sinceLast % (this.beatPeriod * 0.5) < 2;

        if (sinceLast >= this.beatPeriod) {
            // MAIN BEAT
            this._lastBeatT = t;
            this._beatFlash  = 1.0;
            this._chromShift = 1.0;
            this._scale      = 1.0 + 0.10 + this.eeg.b * 0.12 + this.eeg.g * 0.08;
            this._noiseAmp   = 0.08 + this.eeg.b * 0.10;
            this._brightness = 1.0 + 0.3 + this.eeg.g * 0.3;
            this._particleBurst += Math.round(6 + this.eeg.b * 10 + this.eeg.g * 8);
        } else if (subBeat && sinceLast > this.beatPeriod * 0.45) {
            // Sub-beat pulse (softer)
            this._beatFlash  = Math.max(this._beatFlash, 0.45);
            this._scale      = Math.max(this._scale, 1.0 + 0.05 + this.eeg.b * 0.05);
        }

        // ── Smooth decay each frame ──
        const df = 0.92 - this.eeg.b * 0.02;
        this._beatFlash  *= 0.88;
        this._chromShift *= 0.82;
        this._scale       = 1.0 + (this._scale - 1.0) * 0.90;
        this._noiseAmp   *= 0.85;
        this._brightness  = 1.0 + (this._brightness - 1.0) * 0.88;

        // Breathing energy (alpha-band slow oscillator, always active)
        const breathe = 1.0 + this.pulseAmp * Math.sin(this.t * this.pulseFreq);
        this._energy  = 0.3 + breathe * 0.4 + this._beatFlash * 0.3;

        // Continuous hue drift (faster when beta high)
        this._hueDrift = (this._hueDrift + 0.08 + this.eeg.b * 0.12 + this._beatFlash * 0.5) % 360;
    }

    // ══════════════════════════════════════════════════════════════════════
    // ANIMATION LOOP
    // ══════════════════════════════════════════════════════════════════════

    start() {
        if (this.animationId) return;
        const loop = () => {
            this.t  += 1;
            this.ft += 1 / 60;
            this._draw();
            this.animationId = requestAnimationFrame(loop);
        };
        loop();
    }

    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // MAIN DRAW — orchestrates all layers
    // ══════════════════════════════════════════════════════════════════════

    _draw() {
        const { canvas, ctx } = this;
        const W  = canvas.width;
        const H  = canvas.height;
        const cx = W / 2;
        const cy = H / 2;
        const minD = Math.min(W, H);
        const t = this.t;

        // Update reactive state
        this._updateBeat();

        // Spawn burst particles from beats
        if (this._particleBurst > 0) {
            const n = Math.min(this._particleBurst, 12);
            for (let i = 0; i < n; i++) this.particles.push(this._spawnParticle(false));
            this._particleBurst = Math.max(0, this._particleBurst - n);
        }

        // Set base ring radius with beat scale + breathing
        const breathe  = 1.0 + this.pulseAmp * Math.sin(t * this.pulseFreq);
        const scaledR  = this.baseRadiusFrac * breathe * this._scale;
        this._baseR    = minD * scaledR;
        const ringW    = minD * this.ringWidthFrac * (0.9 + this._beatFlash * 0.4);

        // ── Layer 1: Afterglow trail (fade previous frame) ──
        ctx.fillStyle = this._rgba(this.pal.bg, this.trailAlpha);
        ctx.fillRect(0, 0, W, H);

        // ── Layer 2: Deep space starfield ──
        this._drawStarfield(cx, cy, minD, t);

        // ── Layer 3: Nebula haze clouds ──
        this._drawNebula(cx, cy, minD, t);

        // ── Layer 4: Orbital ghost halos (outer wide rings) ──
        const pts = this._getPoints(t);
        this._drawOrbitalHalos(cx, cy, minD, pts);

        // ── Layer 5: Outer bloom glow ──
        this._drawBloom(cx, cy, pts, ringW, t);

        // ── Layer 6: Core plasma ring (optionally with chromatic split) ──
        if (this._chromShift > 0.05) {
            this._drawChromaticRing(cx, cy, pts, ringW, t);
        } else {
            this._drawCoreRing(cx, cy, pts, ringW, t);
        }

        // ── Layer 7: Inner ambient haze ──
        this._drawInnerHaze(cx, cy);

        // ── Layer 8: Beat flash overlay ──
        if (this._beatFlash > 0.05) {
            ctx.save();
            ctx.globalAlpha = this._beatFlash * 0.07;
            ctx.fillStyle = this._huedColor(this.pal.c[4], this._hueDrift * 0.5);
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
        }

        // ── Layer 9: Particles ──
        this._updateAndDrawParticles(cx, cy, t);
        this._updateAndDrawComets(cx, cy, t);
    }

    // ══════════════════════════════════════════════════════════════════════
    // LAYER: STARFIELD
    // ══════════════════════════════════════════════════════════════════════

    _drawStarfield(cx, cy, minD, t) {
        const ctx = this.ctx;
        const halfMin = minD * 0.52;
        ctx.save();
        for (const s of this.stars) {
            const twinkle = 0.5 + 0.5 * Math.sin(s.twinkle + t * s.speed);
            const alpha   = s.alpha * twinkle * (0.6 + this._beatFlash * 0.6);
            const dist    = s.dist * halfMin;
            const x = cx + Math.cos(s.angle) * dist;
            const y = cy + Math.sin(s.angle) * dist;

            // Avoid drawing stars on top of ring center (ring occupies ~0.28–0.45 of halfMin)
            // Stars at dist < 0.22*halfMin or > 0.92*halfMin are fine; ring zone: dim them
            const ringZone = Math.abs(s.dist - this.baseRadiusFrac) < 0.10;
            const a = ringZone ? alpha * 0.3 : alpha;

            ctx.beginPath();
            ctx.arc(x, y, s.size, 0, Math.PI * 2);
            ctx.fillStyle = this._rgba('#FFFFFF', a);
            ctx.fill();
        }
        ctx.restore();
    }

    // ══════════════════════════════════════════════════════════════════════
    // LAYER: NEBULA HAZE
    // ══════════════════════════════════════════════════════════════════════

    _drawNebula(cx, cy, minD, t) {
        const ctx = this.ctx;
        for (const nl of this.nebulaLayers) {
            const angle  = nl.angle + t * nl.speed;
            const radius = minD * nl.radiusFrac;
            const nx     = cx + Math.cos(angle) * radius * 0.3;
            const ny     = cy + Math.sin(angle) * radius * 0.3;
            const size   = minD * nl.sizeFrac * (0.8 + this._energy * 0.4);
            const a      = nl.alpha * (0.7 + this._beatFlash * 0.5);

            const grad = ctx.createRadialGradient(nx, ny, 0, nx, ny, size);
            grad.addColorStop(0,   this._huedRgba(this.pal.c[2], this._hueDrift, a * 0.8));
            grad.addColorStop(0.4, this._huedRgba(this.pal.c[1], this._hueDrift * 0.5, a * 0.4));
            grad.addColorStop(1,   'transparent');

            ctx.save();
            ctx.fillStyle = grad;
            ctx.fillRect(cx - minD, cy - minD, minD * 2, minD * 2);
            ctx.restore();
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // LAYER: ORBITAL HALOS
    // ══════════════════════════════════════════════════════════════════════

    _drawOrbitalHalos(cx, cy, minD, pts) {
        const ctx = this.ctx;
        for (const h of this.halos) {
            const a    = h.baseAlpha + this._beatFlash * h.beatGain;
            const hPts = pts.map(p => ({
                x: p.x * h.radiusMult,
                y: p.y * h.radiusMult,
            }));
            ctx.save();
            ctx.translate(cx, cy);
            ctx.beginPath();
            for (let i = 0; i < hPts.length; i++) {
                const { x, y } = hPts[i];
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.strokeStyle = this._huedRgba(this.pal.c[1], this._hueDrift * 0.3, a);
            ctx.lineWidth   = h.width * (1 + this._beatFlash * 0.6);
            ctx.stroke();
            ctx.restore();
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // LAYER: OUTER BLOOM
    // ══════════════════════════════════════════════════════════════════════

    _drawBloom(cx, cy, pts, ringW, t) {
        const b  = this._brightness;
        const bf = this._beatFlash;
        // Outermost (very dim, very wide)
        this._strokeRing(cx, cy, pts, ringW * 28 * b,  0.016 + bf * 0.008, this.pal.c[0], t);
        this._strokeRing(cx, cy, pts, ringW * 18 * b,  0.036 + bf * 0.015, this.pal.c[0], t);
        this._strokeRing(cx, cy, pts, ringW * 12 * b,  0.075 + bf * 0.025, this.pal.c[1], t);
        // Mid bloom
        this._strokeRing(cx, cy, pts, ringW *  8 * b,  0.140 + bf * 0.060, this.pal.c[1], t);
        this._strokeRing(cx, cy, pts, ringW *  5 * b,  0.280 + bf * 0.100, this.pal.c[2], t);
    }

    // ══════════════════════════════════════════════════════════════════════
    // LAYER: CORE RING (normal — no chromatic split)
    // ══════════════════════════════════════════════════════════════════════

    _drawCoreRing(cx, cy, pts, ringW, t) {
        const b = this._brightness;
        this._strokeRing(cx, cy, pts, ringW * 3.0 * b, 0.55 + this._beatFlash * 0.15, this.pal.c[2], t);
        this._strokeRing(cx, cy, pts, ringW * 1.7 * b, 0.80 + this._beatFlash * 0.10, this.pal.c[3], t);
        this._strokeRing(cx, cy, pts, ringW * 0.90,    0.95,                           this.pal.c[3], t);
        this._strokeRing(cx, cy, pts, ringW * 0.35,    1.00,                           this.pal.c[4], t);
    }

    // ══════════════════════════════════════════════════════════════════════
    // LAYER: CHROMATIC SPLIT RING (beat flash)
    // ══════════════════════════════════════════════════════════════════════

    _drawChromaticRing(cx, cy, pts, ringW, t) {
        const shift = this._baseR * this.chromaticBase * this._chromShift;
        const b     = this._brightness;

        // Draw RGB splits slightly offset
        const offsets = [
            { dx: -shift, dy: -shift * 0.3, color: this.pal.c[2], aMult: 0.70 },
            { dx:  shift, dy:  shift * 0.3, color: this.pal.c[4], aMult: 0.70 },
            { dx:  0,     dy:  0,           color: this.pal.c[3], aMult: 1.00 },
        ];

        for (const o of offsets) {
            const shiftedPts = pts.map(p => ({ x: p.x + o.dx, y: p.y + o.dy }));
            this._strokeRing(cx, cy, shiftedPts, ringW * 3.0 * b,
                (0.55 + this._beatFlash * 0.15) * o.aMult, o.color, t);
            this._strokeRing(cx, cy, shiftedPts, ringW * 1.6 * b,
                (0.80 + this._beatFlash * 0.10) * o.aMult, o.color, t);
        }
        // Bright center (no split)
        this._strokeRing(cx, cy, pts, ringW * 0.80, 0.96, this.pal.c[3], t);
        this._strokeRing(cx, cy, pts, ringW * 0.30, 1.00, this.pal.c[4], t);
    }

    // ══════════════════════════════════════════════════════════════════════
    // LAYER: INNER AMBIENT HAZE
    // ══════════════════════════════════════════════════════════════════════

    _drawInnerHaze(cx, cy) {
        const ctx  = this.ctx;
        const r    = this._baseR;
        const a    = 0.035 + this.eeg.a * 0.040 + this._beatFlash * 0.020;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.88);
        grad.addColorStop(0,    'transparent');
        grad.addColorStop(0.50, this._rgba(this.pal.c[1], a * 0.4));
        grad.addColorStop(0.80, this._rgba(this.pal.c[2], a));
        grad.addColorStop(1,    'transparent');
        ctx.save();
        ctx.fillStyle = grad;
        ctx.fillRect(cx - r * 1.1, cy - r * 1.1, r * 2.2, r * 2.2);
        ctx.restore();
    }

    // ══════════════════════════════════════════════════════════════════════
    // RING STROKE HELPER
    // ══════════════════════════════════════════════════════════════════════

    _strokeRing(cx, cy, pts, lineWidth, alpha, color, _t) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
            const { x, y } = pts[i];
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = this._huedRgba(color, this._hueDrift * 0.15, alpha);
        ctx.lineWidth   = lineWidth;
        ctx.lineJoin    = 'round';
        ctx.stroke();
        ctx.restore();
    }

    // ══════════════════════════════════════════════════════════════════════
    // PARTICLES: sparks on ring
    // ══════════════════════════════════════════════════════════════════════

    _updateAndDrawParticles(cx, cy, t) {
        const ctx = this.ctx;
        // Trim to max count + burst
        const maxCount = this.maxParticles + 80;
        while (this.particles.length > maxCount) this.particles.shift();

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.age       += 0.008 + this.eeg.b * 0.004;
            p.radialOff += p.radialVel;
            p.angle     += p.angularVel;

            if (p.age >= p.maxAge) {
                this.particles[i] = this._spawnParticle();
                continue;
            }

            const lifeFrac = p.age / p.maxAge;
            const alpha    = p.baseAlpha * Math.pow(1 - lifeFrac, 1.5) * (0.7 + this._beatFlash * 0.5);
            const r        = this._getRadius(p.angle, t) + p.radialOff * this._baseR;
            const px       = cx + r * Math.cos(p.angle - Math.PI * 0.5);
            const py       = cy + r * Math.sin(p.angle - Math.PI * 0.5);

            const colorKeys = [4, 3, 5];
            const col = this.pal.c[colorKeys[p.colorIdx % colorKeys.length]];
            const glowR = p.size * (2.5 + this._beatFlash * 2.0);
            const grad  = ctx.createRadialGradient(px, py, 0, px, py, glowR);
            grad.addColorStop(0,   this._huedRgba(col, this._hueDrift * 0.2, alpha));
            grad.addColorStop(0.35, this._huedRgba(this.pal.c[3], this._hueDrift * 0.1, alpha * 0.4));
            grad.addColorStop(1,   'transparent');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(px, py, glowR, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // COMETS: fast bright streaks
    // ══════════════════════════════════════════════════════════════════════

    _updateAndDrawComets(cx, cy, t) {
        const ctx = this.ctx;
        for (let i = 0; i < this.comets.length; i++) {
            const c = this.comets[i];
            c.age       += 0.012 + this.eeg.g * 0.008;
            c.radialOff += c.radialVel;
            c.angle     += c.angularVel;

            if (c.age >= c.maxAge) {
                this.comets[i] = this._spawnComet();
                continue;
            }

            const lifeFrac = c.age / c.maxAge;
            // Fade in then fade out
            const alpha = c.alpha * Math.sin(lifeFrac * Math.PI) * (0.6 + this._beatFlash * 0.6);
            const r     = this._getRadius(c.angle, t) + c.radialOff * this._baseR;
            const px    = cx + r * Math.cos(c.angle - Math.PI * 0.5);
            const py    = cy + r * Math.sin(c.angle - Math.PI * 0.5);

            // Draw comet as a small filled circle with bright core
            const glowR = c.size * (1.8 + this._beatFlash * 1.5);
            const grad  = ctx.createRadialGradient(px, py, 0, px, py, glowR);
            grad.addColorStop(0,   this._rgba(this.pal.c[5], alpha));
            grad.addColorStop(0.2, this._rgba(this.pal.c[4], alpha * 0.7));
            grad.addColorStop(1,   'transparent');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(px, py, glowR, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // COLOR UTILITIES
    // ══════════════════════════════════════════════════════════════════════

    _rgba(hex, alpha) {
        if (!hex || hex[0] !== '#') return `rgba(0,0,0,${alpha.toFixed(3)})`;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    }

    /**
     * Apply a hue rotation to a hex color, then produce rgba string.
     * Uses lightweight HSL rotation for real-time use.
     */
    _huedRgba(hex, hueDelta, alpha) {
        if (!hueDelta || Math.abs(hueDelta) < 0.5) return this._rgba(hex, alpha);
        const [h, s, l] = this._hexToHsl(hex);
        const nh = ((h + hueDelta) % 360 + 360) % 360;
        const [r, g, b] = this._hslToRgb(nh, s, l);
        return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    }

    _huedColor(hex, hueDelta) {
        if (!hueDelta || Math.abs(hueDelta) < 0.5) return hex;
        const [h, s, l] = this._hexToHsl(hex);
        const nh = ((h + hueDelta) % 360 + 360) % 360;
        const [r, g, b] = this._hslToRgb(nh, s, l);
        return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    }

    _hexToHsl(hex) {
        let r = parseInt(hex.slice(1,3),16)/255;
        let g = parseInt(hex.slice(3,5),16)/255;
        let b = parseInt(hex.slice(5,7),16)/255;
        const max = Math.max(r,g,b), min = Math.min(r,g,b);
        let h=0, s=0, l=(max+min)/2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d/(2-max-min) : d/(max+min);
            if (max===r) h = ((g-b)/d + (g<b?6:0))/6;
            else if (max===g) h = ((b-r)/d + 2)/6;
            else h = ((r-g)/d + 4)/6;
        }
        return [h*360, s*100, l*100];
    }

    _hslToRgb(h, s, l) {
        h/=360; s/=100; l/=100;
        let r,g,b;
        if (s===0) { r=g=b=l; }
        else {
            const q = l<0.5 ? l*(1+s) : l+s-l*s;
            const p = 2*l - q;
            const hue2rgb = (p,q,t) => {
                if (t<0) t+=1; if (t>1) t-=1;
                if (t<1/6) return p+(q-p)*6*t;
                if (t<1/2) return q;
                if (t<2/3) return p+(q-p)*(2/3-t)*6;
                return p;
            };
            r = hue2rgb(p,q,h+1/3);
            g = hue2rgb(p,q,h);
            b = hue2rgb(p,q,h-1/3);
        }
        return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
    }

    // ══════════════════════════════════════════════════════════════════════
    // EXPORT
    // ══════════════════════════════════════════════════════════════════════

    exportPNG(filename) {
        this._draw();
        const link = document.createElement('a');
        link.download = filename || 'pulso_lava_eeg.png';
        link.href = this.canvas.toDataURL('image/png');
        link.click();
    }
}
