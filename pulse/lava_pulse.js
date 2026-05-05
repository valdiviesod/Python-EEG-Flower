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
        LavaPulse._instanceCounter = (LavaPulse._instanceCounter || 0) + 1;
        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        this._seed = (
            (Date.now() & 0xffffffff) ^
            Math.floor(nowMs * 1000) ^
            Math.floor(Math.random() * 0xffffffff) ^
            (LavaPulse._instanceCounter * 2654435761)
        ) >>> 0;
        if (!this._seed) this._seed = 1;
        this._randState = this._seed;
        this._phaseSeed = this._rand() * Math.PI * 2;
        this._instanceHueOffset = (this._rand() - 0.5) * 28;
        this._radiusJitter = 0.94 + this._rand() * 0.16;
        this._ampJitter = 0.92 + this._rand() * 0.22;
        this._speedJitter = 0.88 + this._rand() * 0.30;
        this._startFrame = 360 + Math.floor(this._rand() * 7200);
        this.t  = this._startFrame;       // never starts from frame zero
        this.ft = this.t / 60;            // float time (seconds, 60fps basis)

        // ── Smoothed reactive state (lerped each frame) ──
        this._energy   = 0;   // 0–1 overall EEG energy
        this._beatFlash = 0;  // 0–1 beat flash envelope (decays fast)
        this._chromShift = 0; // 0–1 chromatic split intensity
        this._hueDrift  = 0;  // continuous hue rotation (degrees)
        this._scale     = 1;  // ring scale (beats push > 1 then decay)
        this._noiseAmp  = 0;  // extra perturbation on beats
        this._brightness = 1; // overall brightness multiplier
        this._particleBurst = 0; // burst counter for beat particles

        this._baseR = 0;
        this.maxRingFrac = 0.80;
        this.ringScale = 0.55;

        // Visual center offset as fraction of minD (negative = left/up)
        this.offsetX = 0.0;
        this.offsetY = -0.08;

        this._buildParams();
        this._initParticles();
        this._initStarfield();
        this._initOrbitalHalos();
    }

    _rand() {
        this._randState = (1664525 * this._randState + 1013904223) >>> 0;
        return this._randState / 4294967296;
    }

    _normalizeCanvasState() {
        const { canvas, ctx } = this;
        if (!canvas.width || !canvas.height) {
            const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
            const parent = canvas.parentElement;
            const fallbackW = rect.width || parent?.clientWidth || 720;
            const fallbackH = rect.height || parent?.clientHeight || fallbackW || 720;
            const size = Math.max(320, Math.round(Math.min(fallbackW, fallbackH) || fallbackW || 720));
            const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
            canvas.width = Math.round(size * dpr);
            canvas.height = Math.round(size * dpr);
            canvas.style.width = '100%';
            canvas.style.height = '100%';
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
        ctx.lineCap = 'round';
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
        this.shapeMode = dominant; // drives shape math + decorations

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
        this.baseHue = this.pal.hue + this._instanceHueOffset;

        // ── Palette cycle: all 5 bands cycle through animation, order + speed = EEG-driven ──
        const allBands = [
            { v: d,  pal: PALETTES.delta },
            { v: th, pal: PALETTES.theta },
            { v: a,  pal: PALETTES.alpha },
            { v: b,  pal: PALETTES.beta  },
            { v: g,  pal: PALETTES.gamma },
        ].sort((x, y) => y.v - x.v); // dominant band first
        const MIN_W = 0.07;
        const rawW  = allBands.map(x => Math.max(x.v, MIN_W));
        const sumW  = rawW.reduce((s, w) => s + w, 0);
        this.palSequence    = allBands.map((x, i) => ({ ...x.pal, _w: rawW[i] / sumW }));
        let _cum = 0;
        this.palBreakpoints = this.palSequence.map(x => { _cum += x._w; return _cum; });
        // Cycle period: calmer EEG (delta/theta) = slower transitions; active = faster
        this.palCyclePeriod = 8 + d * 6 + th * 4 - b * 2 - g * 1;

        // ── Ring base radius fraction — larger base so shape is always prominent ──
        this.baseRadiusFrac = (0.30 + d * 0.10 + th * 0.06 + a * 0.04) * this._radiusJitter;

        // ══════════════════════════════════════════════════════════════════════
        // SPEED CONFIG — tweak these 4 values to make the pulse faster/slower
        // ══════════════════════════════════════════════════════════════════════
        // 1) PALETTE_CYCLE_BASE: seconds for one full palette loop (lower = faster)
        // 2) BPM_BASE: base tempo of beat flashes (higher = faster)
        // 3) PULSE_FREQ_BASE: breathing oscillation speed (higher = faster)
        // 4) PERTURB_SPEED_MULT: multiplier for all ring morph speeds
        const PALETTE_CYCLE_BASE = 5.0;   // default 8 → now 5 (faster)
        const BPM_BASE             = 70;   // default 55 → now 70 (faster)
        const PULSE_FREQ_BASE      = 0.018;// default 0.012 → now 0.018 (faster)
        const PERTURB_SPEED_MULT   = 1.5;  // 1.0 = normal, 1.5 = 50% faster
        // ══════════════════════════════════════════════════════════════════════

        // Cycle period: calmer EEG (delta/theta) = slower transitions; active = faster
        this.palCyclePeriod = (PALETTE_CYCLE_BASE + d * 4 + th * 3 - b * 1.5 - g * 0.8) * this._speedJitter;

        // ── Shape-specific perturbation personalities ──
        // sm = dominant band value, minor fine-tune (base amps already large)
        // breathSpeed = how fast THIS layer's amplitude oscillates (keeps shape alive)
        const sm = Math.max(0.35, { delta: d, theta: th, alpha: a, beta: b, gamma: g }[dominant]);

        const SHAPE_PERTURBS = {
            // ── DELTA: Deep breathing orb — large slow deformations, always morphing ──
            delta: [
                { h: 1,  amp: 0.14 + sm * 0.12, speed: (0.0004 + sm * 0.0002) * PERTURB_SPEED_MULT, phase: 0.0,  breathSpeed: 0.006 },
                { h: 2,  amp: 0.10 + sm * 0.09, speed: (0.0007 + sm * 0.0004) * PERTURB_SPEED_MULT, phase: 1.7,  breathSpeed: 0.009 },
                { h: 3,  amp: 0.07 + sm * 0.06, speed: (0.0012 + sm * 0.0005) * PERTURB_SPEED_MULT, phase: 3.2,  breathSpeed: 0.012 },
                { h: 4,  amp: 0.04 + sm * 0.04, speed: (0.0018 + sm * 0.0007) * PERTURB_SPEED_MULT, phase: 0.9,  breathSpeed: 0.015 },
            ],
            // ── THETA: Clear 5-petal rose — strong petal lobes, slow rotation ──
            theta: [
                { h: 5,  amp: 0.32 + sm * 0.12, speed: (0.0004 + sm * 0.0002) * PERTURB_SPEED_MULT, phase: 0.0,  breathSpeed: 0.005 },
                { h: 10, amp: 0.10 + sm * 0.06, speed: (0.0003 + sm * 0.0001) * PERTURB_SPEED_MULT, phase: 0.6,  breathSpeed: 0.008 },
                { h: 3,  amp: 0.06 + sm * 0.04, speed: (0.0008 + sm * 0.0004) * PERTURB_SPEED_MULT, phase: 2.1,  breathSpeed: 0.011 },
                { h: 15, amp: 0.03 + sm * 0.02, speed: (0.0002)               * PERTURB_SPEED_MULT, phase: 4.0,  breathSpeed: 0.014 },
            ],
            // ── ALPHA: Flowing arcs — elegant multi-harmonic oscillations ──
            alpha: [
                { h: 3,  amp: 0.18 + sm * 0.10, speed: (0.0022 + sm * 0.0012) * PERTURB_SPEED_MULT, phase: 0.0,  breathSpeed: 0.018 },
                { h: 5,  amp: 0.13 + sm * 0.08, speed: (0.0032 + sm * 0.0016) * PERTURB_SPEED_MULT, phase: 1.3,  breathSpeed: 0.023 },
                { h: 7,  amp: 0.08 + sm * 0.05, speed: (0.0044 + sm * 0.0020) * PERTURB_SPEED_MULT, phase: 2.6,  breathSpeed: 0.029 },
                { h: 9,  amp: 0.05 + sm * 0.03, speed: (0.0058 + sm * 0.0025) * PERTURB_SPEED_MULT, phase: 0.9,  breathSpeed: 0.035 },
                { h: 11, amp: 0.03 + sm * 0.02, speed: (0.0075 + sm * 0.0030) * PERTURB_SPEED_MULT, phase: 4.1,  breathSpeed: 0.040 },
            ],
            // ── BETA: Aggressive 7-star — very pronounced spikes, fast movement ──
            beta: [
                { h: 7,  amp: 0.30 + sm * 0.14, speed: (0.0070 + sm * 0.0050) * PERTURB_SPEED_MULT, phase: 0.0,  breathSpeed: 0.035 },
                { h: 14, amp: 0.18 + sm * 0.10, speed: (0.0115 + sm * 0.0075) * PERTURB_SPEED_MULT, phase: 0.5,  breathSpeed: 0.050 },
                { h: 21, amp: 0.10 + sm * 0.06, speed: (0.0165 + sm * 0.0100) * PERTURB_SPEED_MULT, phase: 1.2,  breathSpeed: 0.065 },
                { h: 9,  amp: 0.12 + sm * 0.07, speed: (0.0090 + sm * 0.0055) * PERTURB_SPEED_MULT, phase: 2.3,  breathSpeed: 0.042 },
                { h: 5,  amp: 0.07 + sm * 0.04, speed: (0.0040 + sm * 0.0025) * PERTURB_SPEED_MULT, phase: 3.7,  breathSpeed: 0.028 },
            ],
            // ── GAMMA: Violent crackle — many fast high harmonics, extreme jagged chaos ──
            gamma: [
                { h: 11, amp: 0.22 + sm * 0.12, speed: (0.0240 + sm * 0.0140) * PERTURB_SPEED_MULT, phase: 0.0,  breathSpeed: 0.080 },
                { h: 17, amp: 0.16 + sm * 0.09, speed: (0.0420 + sm * 0.0240) * PERTURB_SPEED_MULT, phase: 0.8,  breathSpeed: 0.095 },
                { h: 23, amp: 0.11 + sm * 0.06, speed: (0.0620 + sm * 0.0340) * PERTURB_SPEED_MULT, phase: 1.6,  breathSpeed: 0.110 },
                { h: 31, amp: 0.07 + sm * 0.04, speed: (0.1000 + sm * 0.0500) * PERTURB_SPEED_MULT, phase: 2.4,  breathSpeed: 0.130 },
                { h: 7,  amp: 0.10 + sm * 0.06, speed: (0.0180 + sm * 0.0100) * PERTURB_SPEED_MULT, phase: 3.2,  breathSpeed: 0.070 },
                { h: 13, amp: 0.08 + sm * 0.05, speed: (0.0330 + sm * 0.0190) * PERTURB_SPEED_MULT, phase: 4.7,  breathSpeed: 0.088 },
            ],
        };
        this.perturbs = SHAPE_PERTURBS[dominant].map((p, i) => ({
            ...p,
            amp: p.amp * this._ampJitter * (0.90 + this._rand() * 0.22),
            speed: p.speed * this._speedJitter * (0.86 + this._rand() * 0.32),
            phase: p.phase + this._phaseSeed + i * 0.731 + this._rand() * Math.PI * 0.75,
            breathSpeed: p.breathSpeed * (0.86 + this._rand() * 0.36),
        }));

        // ── Shape rotation speed (prevents static look) ──
        const ROT_SPEED = { delta: 0.00025, theta: 0.00040, alpha: 0.00090, beta: 0.00200, gamma: 0.00380 };
        this.rotSpeed = (ROT_SPEED[dominant] ?? 0.001) * this._speedJitter * (0.85 + this._rand() * 0.35);

        // ── Amplitude breath: global morph cycle speed per shape ──
        const BREATH_FREQ = { delta: 0.010, theta: 0.013, alpha: 0.020, beta: 0.032, gamma: 0.050 };
        this.ampBreathFreq = (BREATH_FREQ[dominant] ?? 0.018) * (0.82 + this._rand() * 0.42);

        // ── BPM / beat engine ──
        // Derive BPM from beta (active thinking = faster tempo) and alpha (calm = slower)
        const rawBpm   = BPM_BASE + b * 80 + a * 25 + g * 40;
        this.bpm       = Math.max(40, Math.min(180, rawBpm));
        this.beatPeriod = (60 / this.bpm) * 60; // frames per beat (at 60fps)
        this._lastBeatT = -this.beatPeriod;

        // ── Breathing pulse — bigger amp so shape always noticeably breathes ──
        this.pulseFreq = (PULSE_FREQ_BASE + a * 0.028 + b * 0.009) * this._speedJitter;
        this.pulseAmp  = (0.12 + a * 0.18 + b * 0.10 + d * 0.14) * this._ampJitter;

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

        // ── Trail fade: per-shape personality ──
        const TRAIL_BY_SHAPE = { delta: 0.06, theta: 0.09, alpha: 0.16, beta: 0.24, gamma: 0.30 };
        this.trailAlpha = TRAIL_BY_SHAPE[dominant] ?? 0.18;

        // ── Particle count boosted for active bands ──
        if (dominant === 'gamma') {
            this.maxParticles  = Math.round(this.maxParticles * 1.8);
            this.particleSpeed *= 1.5;
        } else if (dominant === 'beta') {
            this.maxParticles  = Math.round(this.maxParticles * 1.3);
            this.particleSpeed *= 1.2;
        } else if (dominant === 'delta') {
            this.maxParticles  = Math.max(20, Math.round(this.maxParticles * 0.5));
            this.particleSpeed *= 0.5;
        }
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

        // Continuous rotation — shape never looks static
        const rotAngle = angle + this.rotSpeed * t + this._phaseSeed;

        // Global amplitude breath — range 0.78→1.28 (safe but still dramatic)
        const globalBreath = 0.78 + 0.50 * (0.5 + 0.5 * Math.sin(t * this.ampBreathFreq + this._phaseSeed));

        switch (this.shapeMode) {
            case 'delta':
                for (const p of this.perturbs) {
                    // Layer breath range: 0.72→1.28
                    const lb = 0.72 + 0.56 * (0.5 + 0.5 * Math.sin(t * p.breathSpeed + p.phase * 0.8));
                    r += this._baseR * p.amp * globalBreath * lb
                        * Math.sin(p.h * rotAngle + p.speed * t + p.phase);
                }
                break;

            case 'theta':
                for (const p of this.perturbs) {
                    // Layer breath range: 0.68→1.28
                    const lb = 0.68 + 0.60 * (0.5 + 0.5 * Math.sin(t * p.breathSpeed + p.phase * 1.1));
                    r += this._baseR * p.amp * globalBreath * lb
                        * Math.cos(p.h * rotAngle + p.speed * t + p.phase);
                }
                break;

            case 'alpha':
                for (const p of this.perturbs) {
                    // Layer breath range: 0.65→1.30
                    const lb = 0.65 + 0.65 * (0.5 + 0.5 * Math.sin(t * p.breathSpeed + p.phase * 0.9));
                    const s = Math.sin(p.h * rotAngle + p.speed * t + p.phase);
                    const c = Math.cos(p.h * 0.618 * rotAngle + p.speed * 0.75 * t + p.phase + 0.9);
                    r += this._baseR * p.amp * globalBreath * lb * (s * 0.72 + c * 0.28);
                }
                break;

            case 'beta':
                for (const p of this.perturbs) {
                    // Layer breath range: 0.60→1.30
                    const lb = 0.60 + 0.70 * (0.5 + 0.5 * Math.sin(t * p.breathSpeed + p.phase * 1.2));
                    const raw = Math.sin(p.h * rotAngle + p.speed * t + p.phase);
                    // Power sharpening: pointy outward tips, flat inward valleys
                    const sharp = raw >= 0
                        ? Math.pow(raw, 0.38)
                        : -Math.pow(-raw, 2.8) * 0.20;
                    r += this._baseR * p.amp * globalBreath * lb * sharp;
                }
                break;

            case 'gamma':
                for (const p of this.perturbs) {
                    // Layer breath range: 0.55→1.30
                    const lb = 0.55 + 0.75 * (0.5 + 0.5 * Math.sin(t * p.breathSpeed + p.phase * 1.4));
                    const a1 = Math.sin(p.h * rotAngle + p.speed * t + p.phase);
                    const a2 = Math.sin(p.h * 1.618 * rotAngle - p.speed * 0.55 * t + p.phase + 1.4);
                    const tri = 2 * Math.abs(a1) - 1; // triangle wave: jagged spikes
                    r += this._baseR * p.amp * globalBreath * lb * (tri * 0.68 + a2 * 0.32);
                }
                // Permanent micro-crackle
                r += this._baseR * 0.022 * Math.sin(53 * rotAngle + t * 0.29);
                r += this._baseR * 0.015 * Math.cos(79 * rotAngle - t * 0.37);
                break;
        }

        // Beat-driven extra perturbation (all shapes)
        if (this._noiseAmp > 0.001) {
            r += this._baseR * this._noiseAmp * Math.sin(7 * rotAngle + t * 0.1);
            r += this._baseR * this._noiseAmp * 0.5 * Math.cos(13 * rotAngle - t * 0.07);
        }

        // Hard clamp — shape never escapes canvas bounds
        // Max safe = 1.9x baseR keeps points within the ~0.45*minD canvas radius
        return Math.max(this._baseR * 0.05, Math.min(r, this._baseR * 1.90));
    }

    _getPoints(t) {
        // Higher resolution for complex shapes, lower for smooth ones
        const N_BY_SHAPE = { delta: 160, theta: 260, alpha: 300, beta: 400, gamma: 520 };
        const n = N_BY_SHAPE[this.shapeMode] || 320;
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
            // Main beat: cap scale so outer ring never exceeds maxRingFrac * 0.5 of canvas
        const maxScale = (0.5 * this.maxRingFrac) / Math.max(this.baseRadiusFrac, 0.01);
        this._scale      = Math.min(1.0 + 0.10 + this.eeg.b * 0.12 + this.eeg.g * 0.08, maxScale);
            this._noiseAmp   = 0.08 + this.eeg.b * 0.10;
            this._brightness = 1.0 + 0.3 + this.eeg.g * 0.3;
            this._particleBurst += Math.round(6 + this.eeg.b * 10 + this.eeg.g * 8);
        } else if (subBeat && sinceLast > this.beatPeriod * 0.45) {
            // Sub-beat pulse (softer)
            this._beatFlash  = Math.max(this._beatFlash, 0.45);
            const maxScale = (0.5 * this.maxRingFrac) / Math.max(this.baseRadiusFrac, 0.01);
            this._scale      = Math.max(this._scale, Math.min(1.0 + 0.05 + this.eeg.b * 0.05, maxScale));
        }

        // ── Smooth decay each frame ──
        const df = 0.92 - this.eeg.b * 0.02;
        this._beatFlash  *= 0.88;
        this._chromShift *= 0.82;
        this._scale       = 1.0 + (this._scale - 1.0) * 0.90;
        this._noiseAmp   *= 0.85;
        this._brightness  = 1.0 + (this._brightness - 1.0) * 0.88;

        // Breathing energy (alpha-band slow oscillator, always active)
        const breathe = 1.0 + this.pulseAmp * Math.sin(this.t * this.pulseFreq + this._phaseSeed);
        this._energy  = 0.3 + breathe * 0.4 + this._beatFlash * 0.3;

        // Continuous hue drift (faster when beta high)
        this._hueDrift = (this._hueDrift + 0.08 + this.eeg.b * 0.12 + this._beatFlash * 0.5) % 360;
    }

    // ══════════════════════════════════════════════════════════════════════
    // ANIMATION LOOP
    // ══════════════════════════════════════════════════════════════════════

    start() {
        if (this.animationId) return;
        this._normalizeCanvasState();
        const loop = () => {
            this.t  += 1;
            this.ft += 1 / 60;
            this._drawSafe();
            this.animationId = requestAnimationFrame(loop);
        };
        loop();
    }

    _drawSafe() {
        try {
            this._draw();
        } catch (err) {
            console.error('LavaPulse draw error:', err);
            this._drawFallback();
        }
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
        this._normalizeCanvasState();
        const { canvas, ctx } = this;
        const W  = canvas.width;
        const H  = canvas.height;
        const minD = Math.min(W, H);
        if (minD < 2) return;
        const cx = W / 2 + minD * this.offsetX;
        const cy = H / 2 + minD * this.offsetY;
        const t = this.t;

        // Update reactive state
        this._updateCyclePalette();
        this._updateBeat();

        // Spawn burst particles from beats
        if (this._particleBurst > 0) {
            const n = Math.min(this._particleBurst, 12);
            for (let i = 0; i < n; i++) this.particles.push(this._spawnParticle(false));
            this._particleBurst = Math.max(0, this._particleBurst - n);
        }

        // Set base ring radius with beat scale + breathing
        const breathe  = 1.0 + this.pulseAmp * Math.sin(t * this.pulseFreq + this._phaseSeed);
        const rawR     = this.baseRadiusFrac * breathe * this._scale;
        const maxFrac  = 0.5 * this.maxRingFrac * this.ringScale;
        const scaledR  = Math.min(rawR, maxFrac);
        this._baseR    = minD * scaledR;
        const rs       = this.ringScale;
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

        // ── Layer 7.5: Shape-specific decorations ──
        try { this._drawShapeDecorations(cx, cy, minD, t); } catch (_) {}

        // ── Layer 7.6: Particles for active bands ──
        if (this.shapeMode === 'beta' || this.shapeMode === 'gamma') {
            this._updateAndDrawParticles(cx, cy, t);
            this._updateAndDrawComets(cx, cy, t);
        } else if (this.shapeMode === 'theta') {
            this._updateAndDrawParticles(cx, cy, t);
        }

        // ── Layer 8: Beat flash overlay ──
        if (this._beatFlash > 0.05) {
            ctx.save();
            ctx.globalAlpha = this._beatFlash * 0.07;
            ctx.fillStyle = this._huedColor(this.pal.c[4], this._hueDrift * 0.5);
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
        }

    }

    _drawFallback() {
        this._normalizeCanvasState();
        const { canvas, ctx } = this;
        const W = canvas.width || 720;
        const H = canvas.height || 720;
        const minD = Math.min(W, H);
        const cx = W / 2 + minD * this.offsetX;
        const cy = H / 2 + minD * this.offsetY;
        const r = Math.max(80, minD * 0.24);

        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = this._rgba(this.pal?.bg || '#05020C', 1);
        ctx.fillRect(0, 0, W, H);

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2);
        grad.addColorStop(0, this._rgba(this.pal?.c?.[4] || '#FFFFFF', 0.35));
        grad.addColorStop(0.35, this._rgba(this.pal?.c?.[3] || '#EC4899', 0.18));
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(cx - r * 2.2, cy - r * 2.2, r * 4.4, r * 4.4);

        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(cx, cy, r * (0.72 + i * 0.25), 0, Math.PI * 2);
            ctx.strokeStyle = this._rgba(this.pal?.c?.[3 + i] || '#FFFFFF', 0.85 - i * 0.22);
            ctx.lineWidth = Math.max(2, minD * (0.012 - i * 0.002));
            ctx.stroke();
        }
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
        const rs = this.ringScale;
        const b  = this._brightness;
        const bf = this._beatFlash;
        // Outermost (very dim, very wide)
        this._strokeRing(cx, cy, pts, ringW * 28 * b * rs,  0.016 + bf * 0.008, this.pal.c[0], t);
        this._strokeRing(cx, cy, pts, ringW * 18 * b * rs,  0.036 + bf * 0.015, this.pal.c[0], t);
        this._strokeRing(cx, cy, pts, ringW * 12 * b * rs,  0.075 + bf * 0.025, this.pal.c[1], t);
        this._strokeRing(cx, cy, pts, ringW *  8 * b * rs,  0.140 + bf * 0.060, this.pal.c[1], t);
        this._strokeRing(cx, cy, pts, ringW *  5 * b * rs,  0.280 + bf * 0.100, this.pal.c[2], t);
    }

    // ══════════════════════════════════════════════════════════════════════
    // LAYER: CORE RING (normal — no chromatic split)
    // ══════════════════════════════════════════════════════════════════════

    _drawCoreRing(cx, cy, pts, ringW, t) {
        const b = this._brightness;
        const rs = this.ringScale;
        this._strokeRing(cx, cy, pts, ringW * 3.0 * b * rs, 0.55 + this._beatFlash * 0.15, this.pal.c[2], t);
        this._strokeRing(cx, cy, pts, ringW * 1.7 * b * rs, 0.80 + this._beatFlash * 0.10, this.pal.c[3], t);
        this._strokeRing(cx, cy, pts, ringW * 0.90 * rs,    0.95,                           this.pal.c[3], t);
        this._strokeRing(cx, cy, pts, ringW * 0.35 * rs,    1.00,                           this.pal.c[4], t);
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
            const rs = this.ringScale;
            this._strokeRing(cx, cy, shiftedPts, ringW * 3.0 * b * rs,
                (0.55 + this._beatFlash * 0.15) * o.aMult, o.color, t);
            this._strokeRing(cx, cy, shiftedPts, ringW * 1.6 * b * rs,
                (0.80 + this._beatFlash * 0.10) * o.aMult, o.color, t);
        }
        // Bright center (no split)
        const rs = this.ringScale;
        this._strokeRing(cx, cy, pts, ringW * 0.80 * rs, 0.96, this.pal.c[3], t);
        this._strokeRing(cx, cy, pts, ringW * 0.30 * rs, 1.00, this.pal.c[4], t);
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
    // SHAPE DECORATIONS — unique visual per EEG dominant band
    // ══════════════════════════════════════════════════════════════════════

    _drawShapeDecorations(cx, cy, minD, t) {
        switch (this.shapeMode) {
            case 'delta': this._drawDeltaSonar(cx, cy, t);       break;
            case 'theta': this._drawThetaPetals(cx, cy, t);      break;
            case 'alpha': this._drawAlphaRipples(cx, cy, t);     break;
            case 'beta':  this._drawBetaLightning(cx, cy, t);    break;
            case 'gamma': this._drawGammaStatic(cx, cy, t);      break;
        }
    }

    // ── DELTA: Concentric sonar rings expanding slowly outward ──────────
    // Like a heartbeat echo — pure, flat, circular.
    _drawDeltaSonar(cx, cy, t) {
        const ctx = this.ctx;
        const numRings = 5;
        const cyclePeriod = 320; // very slow — delta is slow-wave sleep

        for (let i = 0; i < numRings; i++) {
            const phase = ((t / cyclePeriod) + (i / numRings)) % 1;
            const eased  = phase * phase; // ease-in: slow start, then expands
            const radius = this._baseR * (1.05 + eased * 2.2);
            const alpha  = (1 - phase) * 0.20 * (0.6 + 0.4 * Math.sin(t * 0.008 + i));

            if (alpha < 0.006) continue;

            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.strokeStyle = this._huedRgba(this.pal.c[2], this._hueDrift * 0.2, alpha);
            ctx.lineWidth   = (1 - phase) * 3.0 + 0.5;
            ctx.stroke();
            ctx.restore();
        }

        // Inner gentle aurora shimmer — stationary soft band
        const auroraA = 0.025 + 0.015 * Math.sin(t * 0.006);
        const grad = this.ctx.createRadialGradient(cx, cy, this._baseR * 0.7, cx, cy, this._baseR * 1.3);
        grad.addColorStop(0,   this._rgba(this.pal.c[1], 0));
        grad.addColorStop(0.4, this._rgba(this.pal.c[2], auroraA));
        grad.addColorStop(1,   this._rgba(this.pal.c[1], 0));
        ctx.save();
        ctx.fillStyle = grad;
        ctx.fillRect(cx - this._baseR * 1.5, cy - this._baseR * 1.5, this._baseR * 3, this._baseR * 3);
        ctx.restore();
    }

    // ── THETA: Floating mandala petals rotating around ring ─────────────
    // Soft translucent petals that drift and breathe — lotus effect.
    _drawThetaPetals(cx, cy, t) {
        const ctx = this.ctx;
        const petalCount = 5;
        const rotationSpeed = 0.00025; // very slow rotation
        const rotation      = t * rotationSpeed;
        const outerR  = this._baseR * 1.15;
        const petalLen = this._baseR * 0.90;
        const petalW   = this._baseR * 0.28;

        ctx.save();
        ctx.translate(cx, cy);

        for (let i = 0; i < petalCount; i++) {
            const angle   = (i / petalCount) * Math.PI * 2 + rotation;
            const breathe = 0.82 + 0.18 * Math.sin(t * 0.007 + i * 1.257);

            ctx.save();
            ctx.rotate(angle);

            // Teardrop petal from ring outward
            const y0  = outerR * breathe;
            const y1  = (outerR + petalLen) * breathe;
            const bw  = petalW * breathe;

            ctx.beginPath();
            ctx.moveTo(0, y0);
            ctx.bezierCurveTo( bw, y0 + petalLen * 0.22,  bw * 0.55, y0 + petalLen * 0.78,  0, y1);
            ctx.bezierCurveTo(-bw * 0.55, y0 + petalLen * 0.78, -bw, y0 + petalLen * 0.22,  0, y0);
            ctx.closePath();

            const grad = ctx.createLinearGradient(0, y0, 0, y1);
            grad.addColorStop(0, this._huedRgba(this.pal.c[3], this._hueDrift * 0.3, 0.28));
            grad.addColorStop(0.5, this._huedRgba(this.pal.c[2], this._hueDrift * 0.2, 0.14));
            grad.addColorStop(1,   this._huedRgba(this.pal.c[1], this._hueDrift * 0.1, 0.02));
            ctx.fillStyle = grad;
            ctx.fill();

            // Subtle petal vein
            ctx.beginPath();
            ctx.moveTo(0, y0 + petalLen * 0.05);
            ctx.lineTo(0, y1 - petalLen * 0.08);
            ctx.strokeStyle = this._huedRgba(this.pal.c[4], this._hueDrift * 0.2, 0.18);
            ctx.lineWidth   = 0.8;
            ctx.stroke();

            ctx.restore();
        }

        ctx.restore();
    }

    // ── ALPHA: Smooth expanding ripple rings — calm water surface ────────
    // Graceful sine ripples, medium speed, zen aesthetic.
    _drawAlphaRipples(cx, cy, t) {
        const ctx = this.ctx;
        const numRipples  = 6;
        const cyclePeriod = 180; // medium speed

        for (let i = 0; i < numRipples; i++) {
            const phase = ((t / cyclePeriod) + (i / numRipples)) % 1;
            // Smoothstep: slow-in, fast-out
            const eased = phase * phase * (3 - 2 * phase);
            const radius = this._baseR * (0.35 + eased * 2.5);
            const alpha  = Math.sin(phase * Math.PI) * 0.14;

            if (alpha < 0.005) continue;

            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.strokeStyle = this._huedRgba(this.pal.c[3], this._hueDrift * 0.28, alpha);
            ctx.lineWidth   = (1 - eased) * 4.0 + 0.4;
            ctx.stroke();
            ctx.restore();
        }

        // Subtle inner glow shimmer
        const shimmerA = 0.018 + 0.012 * Math.sin(t * 0.022);
        const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, this._baseR * 0.9);
        sg.addColorStop(0,   this._rgba(this.pal.c[4], shimmerA));
        sg.addColorStop(0.6, this._rgba(this.pal.c[2], shimmerA * 0.5));
        sg.addColorStop(1,   'transparent');
        ctx.save();
        ctx.fillStyle = sg;
        ctx.fillRect(cx - this._baseR, cy - this._baseR, this._baseR * 2, this._baseR * 2);
        ctx.restore();
    }

    // ── BETA: Electric lightning arcs from ring tips ─────────────────────
    // Sharp branching bolts shooting outward — focused electric energy.
    _drawBetaLightning(cx, cy, t) {
        const ctx = this.ctx;
        const numArcs = 7; // matches 7-pointed star harmonics
        const arcLen  = this._baseR * 0.70;

        for (let i = 0; i < numArcs; i++) {
            const baseAngle = (i / numArcs) * Math.PI * 2 + t * 0.0018;
            const peakR     = this._getRadius(baseAngle, t);

            if (peakR < this._baseR * 1.03) continue;

            const flash = 0.45 + 0.55 * Math.sin(t * 0.18 + i * 2.618 + 0.5);
            if (flash < 0.30) continue;

            const alpha = flash * (0.50 + this._beatFlash * 0.45);

            ctx.save();
            ctx.lineWidth   = 1.2 + this._beatFlash * 0.8;
            ctx.strokeStyle = this._huedRgba(this.pal.c[5], this._hueDrift * 0.35, alpha);

            let bx = cx + peakR * Math.cos(baseAngle - Math.PI * 0.5);
            let by = cy + peakR * Math.sin(baseAngle - Math.PI * 0.5);

            const segments = 3 + (this._beatFlash > 0.3 ? 1 : 0);
            const segLen   = arcLen / segments;

            for (let s = 0; s < segments; s++) {
                // Jitter perpendicular to bolt direction
                const jitterAng = baseAngle + Math.PI * 0.5;
                const jitter    = Math.sin(t * 0.32 + i * 4.9 + s * 7.3) * segLen * 0.65;
                const nx = bx + Math.cos(baseAngle - Math.PI * 0.5) * segLen + Math.cos(jitterAng) * jitter;
                const ny = by + Math.sin(baseAngle - Math.PI * 0.5) * segLen + Math.sin(jitterAng) * jitter;

                ctx.beginPath();
                ctx.moveTo(bx, by);
                ctx.lineTo(nx, ny);
                ctx.stroke();

                // Branch bolt (25% chance per segment)
                if (Math.sin(t * 0.1 + i * 3.1 + s * 5.7) > 0.6) {
                    const branchLen = segLen * 0.5;
                    const branchAng = baseAngle - Math.PI * 0.5 + (Math.random() > 0.5 ? 0.6 : -0.6);
                    ctx.save();
                    ctx.globalAlpha *= 0.5;
                    ctx.beginPath();
                    ctx.moveTo(nx, ny);
                    ctx.lineTo(nx + Math.cos(branchAng) * branchLen, ny + Math.sin(branchAng) * branchLen);
                    ctx.stroke();
                    ctx.restore();
                }

                bx = nx; by = ny;
            }
            ctx.restore();
        }
    }

    // ── GAMMA: Electric static micro-sparks scattered around ring ────────
    // Chaotic point cloud, ultra-fast flicker — hyper-focused plasma.
    _drawGammaStatic(cx, cy, t) {
        const ctx   = this.ctx;
        const count = 100;

        for (let i = 0; i < count; i++) {
            // Pseudo-random positions shifting rapidly per frame
            const s1 = Math.sin(i * 127.1 + t * 0.09)  * 43758.5453;
            const s2 = Math.sin(i * 311.7 + t * 0.13)  * 43758.5453;
            const s3 = Math.sin(i * 74.31 + t * 0.06)  * 43758.5453;
            const s4 = Math.sin(i * 188.9 + t * 0.17)  * 43758.5453;

            const rand1 = s1 - Math.floor(s1);
            const rand2 = s2 - Math.floor(s2);
            const rand3 = s3 - Math.floor(s3);
            const rand4 = s4 - Math.floor(s4);

            const angle       = rand1 * Math.PI * 2;
            const radialOff   = (rand2 - 0.5) * 0.75;
            const r           = this._baseR * (0.80 + radialOff);
            const rawAlpha    = rand3;
            const brightBurst = (rawAlpha > 0.7) ? (rawAlpha - 0.7) * 2.5 : 0;

            if (rawAlpha < 0.35) continue;

            const alpha = Math.min(1, rawAlpha * 0.75 + brightBurst * 0.5 + this._beatFlash * 0.3);
            const px    = cx + r * Math.cos(angle - Math.PI * 0.5);
            const py    = cy + r * Math.sin(angle - Math.PI * 0.5);
            const size  = 0.7 + rand4 * 2.8 + brightBurst * 3;

            // Core dot
            ctx.beginPath();
            ctx.arc(px, py, size, 0, Math.PI * 2);
            const colorIdx = Math.floor(rand4 * 3);
            const colors   = [this.pal.c[4], this.pal.c[5], this.pal.c[3]];
            ctx.fillStyle  = this._huedRgba(colors[colorIdx], this._hueDrift * 0.25, alpha);
            ctx.fill();

            // Bright sparks get a tiny glow halo
            if (brightBurst > 0.1) {
                const gr = ctx.createRadialGradient(px, py, 0, px, py, size * 3.5);
                gr.addColorStop(0, this._rgba(this.pal.c[5], alpha * 0.5));
                gr.addColorStop(1, 'transparent');
                ctx.fillStyle = gr;
                ctx.beginPath();
                ctx.arc(px, py, size * 3.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
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
        const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
        if (!hex || hex[0] !== '#') return `rgba(0,0,0,${a.toFixed(3)})`;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${a.toFixed(3)})`;
    }

    /**
     * Apply a hue rotation to a hex color, then produce rgba string.
     * Uses lightweight HSL rotation for real-time use.
     */
    _huedRgba(hex, hueDelta, alpha) {
        if (!hueDelta || Math.abs(hueDelta) < 0.5) return this._rgba(hex, alpha);
        const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
        if (!hex || hex[0] !== '#') return this._rgba(hex, a);
        const [h, s, l] = this._hexToHsl(hex);
        const nh = ((h + hueDelta) % 360 + 360) % 360;
        const [r, g, b] = this._hslToRgb(nh, s, l);
        return `rgba(${r},${g},${b},${a.toFixed(3)})`;
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
    // PALETTE CYCLE — all colors flow through every pulse
    // ══════════════════════════════════════════════════════════════════════

    _updateCyclePalette() {
        const period = Math.max(4, this.palCyclePeriod);
        const phase  = (this.ft % period) / period; // 0..1
        const n      = this.palSequence.length;
        let seg = n - 1, prevBp = 0;
        for (let i = 0; i < n; i++) {
            if (phase <= this.palBreakpoints[i]) { seg = i; break; }
            prevBp = this.palBreakpoints[i];
        }
        const segLen = this.palBreakpoints[seg] - prevBp;
        const localT = segLen > 0 ? (phase - prevBp) / segLen : 0;
        const t      = localT * localT * (3 - 2 * localT); // smoothstep
        this.pal = this._lerpPalette(
            this.palSequence[seg],
            this.palSequence[(seg + 1) % n],
            t
        );
    }

    _lerpPalette(a, b, t) {
        if (t <= 0) return a;
        if (t >= 1) return b;
        return {
            bg:  this._lerpHex(a.bg, b.bg, t),
            c:   a.c.map((ca, i) => this._lerpHex(ca, b.c[i] ?? ca, t)),
            hue: a.hue + (b.hue - a.hue) * t,
        };
    }

    _lerpHex(hexA, hexB, t) {
        const ra = parseInt(hexA.slice(1,3),16), ga = parseInt(hexA.slice(3,5),16), ba = parseInt(hexA.slice(5,7),16);
        const rb = parseInt(hexB.slice(1,3),16), gb = parseInt(hexB.slice(3,5),16), bb = parseInt(hexB.slice(5,7),16);
        const r  = Math.round(ra + (rb - ra) * t);
        const g  = Math.round(ga + (gb - ga) * t);
        const bl = Math.round(ba + (bb - ba) * t);
        return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${bl.toString(16).padStart(2,'0')}`;
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
