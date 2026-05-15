/**
 * NAD — Unified App Controller
 *
 * Manages three views:
 *   1. Captura EEG — setup → live capture → results (download JSON / MIDI / send to pulse)
 *   2. Pulso Neurofuncional — upload → 2D / 3D / Analysis
 *   3. Campo resonante — saved captures as 3D profile field
 *
 * Uses Pulse's vibrant palette for EEG wave rendering.
 */

(function () {
    'use strict';

    // ── Channel colors (Pulse vibrant palette) ──
    const CH_COLORS = ['#8B5CF6', '#22C55E', '#EC4899', '#F97316'];
    const CH_NAMES = ['TP9', 'AF7', 'AF8', 'TP10'];
    const GARDEN_PLAYBACK_MAX_NOTES_PER_TRACK = 300;
    const GARDEN_PLAYBACK_MIN_NOTE_DURATION = 0.15;
    const GARDEN_PLAYBACK_MAX_NOTE_DURATION = 2.0;
    const GARDEN_PLAYBACK_MIN_SPACING = 0.08;       // minimum seconds between notes
    const GARDEN_PLAYBACK_SPEED = 1;            
    const GARDEN_CHANNEL_PAN = [-0.55, -0.18, 0.18, 0.55];

    // Pentatonic major scale intervals from C (in semitones): C D E G A
    const GARDEN_PENTATONIC = [0, 2, 4, 7, 9];

    // GM instrument names for soundfont-player (MusyngKite CDN naming) — one per EEG channel
    // Deep + hard brutal soundscape. No drums. No soft pads.
    // Only resonant, profound, body-shaking timbres.
    // ch0 TP9  left-temporal  → Tuba             deepest brass, sub frequencies
    // ch1 AF7  left-frontal   → Slap Bass 1      aggressive hard attack bass
    // ch2 AF8  right-frontal  → Overdriven Guitar  brutal distorted timbre
    // ch3 TP10 right-temporal → French Horn      deep powerful brass
    const GARDEN_INSTRUMENTS = [
        'tuba',              // ch 0 — TP9  left temporal
        'slap_bass_1',       // ch 1 — AF7  left frontal
        'overdriven_guitar', // ch 2 — AF8  right frontal
        'french_horn',       // ch 3 — TP10 right temporal
    ];
    const GARDEN_INSTRUMENT_FALLBACKS = {
        overdriven_guitar: ['distortion_guitar', 'lead_2_sawtooth', 'electric_guitar_jazz'],
    };
    const GARDEN_DEFAULT_INSTRUMENT_FALLBACKS = ['acoustic_grand_piano'];

    // ── Plasma WebGL2 (React Bits Plasma — pulse color palette) ──
    const _PLASMA_VERT = `#version 300 es
        precision highp float;
        in vec2 position;
        in vec2 uv;
        out vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position, 0.0, 1.0);
        }
    `;

    const _PLASMA_FRAG = `#version 300 es
        precision highp float;
        uniform vec2 iResolution;
        uniform float iTime;
        uniform float uSpeed;
        uniform float uDirection;
        uniform float uScale;
        uniform float uOpacity;
        uniform vec2 uMouse;
        uniform float uMouseInteractive;
        out vec4 fragColor;

        void mainImage(out vec4 o, vec2 C) {
            vec2 center = iResolution.xy * 0.5;
            C = (C - center) / uScale + center;
            vec2 mouseOffset = (uMouse - center) * 0.0002;
            C += mouseOffset * length(C - center) * step(0.5, uMouseInteractive);
            float i, d, z, T = iTime * uSpeed * uDirection;
            vec3 O, p, S;
            for (vec2 r = iResolution.xy, Q; ++i < 60.; O += o.w / d * o.xyz) {
                p = z * normalize(vec3(C - .5 * r, r.y));
                p.z -= 4.;
                S = p;
                d = p.y - T;
                p.x += .4 * (1. + p.y) * sin(d + p.x * 0.1) * cos(.34 * d + p.x * 0.05);
                Q = p.xz *= mat2(cos(p.y + vec4(0, 11, 33, 0) - T));
                z += d = abs(sqrt(length(Q * Q)) - .25 * (5. + S.y)) / 3. + 8e-4;
                o = 1. + sin(S.y + p.z * .5 + S.z - length(S - p) + vec4(2, 1, 0, 8));
            }
            o.xyz = tanh(O / 1e4);
        }

        bool finite1(float x) { return !(isnan(x) || isinf(x)); }
        vec3 sanitize(vec3 c) {
            return vec3(
                finite1(c.r) ? c.r : 0.0,
                finite1(c.g) ? c.g : 0.0,
                finite1(c.b) ? c.b : 0.0
            );
        }

        void main() {
            vec4 o = vec4(0.0);
            mainImage(o, gl_FragCoord.xy);
            vec3 rgb = sanitize(o.rgb);
            float alpha = length(rgb) * uOpacity;
            fragColor = vec4(rgb, alpha);
        }
    `;

    class JellyGalaxy {
        constructor(canvas) {
            this.canvas = canvas;
            this.running = false;
            this.rafId = null;
            this._t0 = null;
            this._mouse = { x: 0, y: 0 };

            if (!canvas) return;
            this.gl = canvas.getContext('webgl2', { alpha: true, antialias: false,
                premultipliedAlpha: false });
            if (!this.gl) return;

            this._initGL();
            this._bindMouse();
            this._ro = new ResizeObserver(() => this.resize());
            this._ro.observe(canvas.parentElement || canvas);
            this.resize();
            this.start();
        }

        _initGL() {
            const gl = this.gl;
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.clearColor(0, 0, 0, 0);

            const compile = (type, src) => {
                const sh = gl.createShader(type);
                gl.shaderSource(sh, src);
                gl.compileShader(sh);
                if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                    console.error('Plasma shader error:', gl.getShaderInfoLog(sh));
                }
                return sh;
            };
            const prog = gl.createProgram();
            gl.attachShader(prog, compile(gl.VERTEX_SHADER, _PLASMA_VERT));
            gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, _PLASMA_FRAG));
            gl.linkProgram(prog);
            this._prog = prog;
            gl.useProgram(prog);

            // Full-screen triangle
            const pos = new Float32Array([-1, -1, 3, -1, -1, 3]);
            const uvs = new Float32Array([0, 0, 2, 0, 0, 2]);

            const pbuf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
            gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
            const aPos = gl.getAttribLocation(prog, 'position');
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

            const ubuf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, ubuf);
            gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
            const aUv = gl.getAttribLocation(prog, 'uv');
            gl.enableVertexAttribArray(aUv);
            gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

            this._u = {};
            ['iResolution','iTime','uSpeed','uDirection','uScale',
             'uOpacity','uMouse','uMouseInteractive'
            ].forEach(n => { this._u[n] = gl.getUniformLocation(prog, n); });

            // Pulse palette defaults: natural plasma colors, slow speed
            gl.uniform1f(this._u.uSpeed, 0.4);
            gl.uniform1f(this._u.uDirection, 1.0);
            gl.uniform1f(this._u.uScale, 1.0);
            gl.uniform1f(this._u.uOpacity, 0.92);
            gl.uniform1f(this._u.uMouseInteractive, 1.0);
            gl.uniform2f(this._u.uMouse, 0, 0);
        }

        _bindMouse() {
            const parent = this.canvas.closest('.view') || document.body;
            parent.addEventListener('mousemove', e => {
                const r = parent.getBoundingClientRect();
                this._mouse.x = e.clientX - r.left;
                this._mouse.y = e.clientY - r.top;
            });
        }

        resize() {
            if (!this.gl) return;
            const canvas = this.canvas;
            const p = canvas.parentElement;
            const w = Math.max(1, Math.floor(p ? p.clientWidth : canvas.clientWidth));
            const h = Math.max(1, Math.floor(p ? p.clientHeight : canvas.clientHeight));
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            this.gl.viewport(0, 0, canvas.width, canvas.height);
        }

        start() {
            if (!this.gl || this.running) return;
            this.running = true;
            this._t0 = this._t0 ?? performance.now();
            const loop = ts => {
                if (!this.running) return;
                this._render(ts);
                this.rafId = requestAnimationFrame(loop);
            };
            this.rafId = requestAnimationFrame(loop);
        }

        stop() {
            this.running = false;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        _render(ts) {
            const gl = this.gl;
            const u = this._u;
            const t = (ts - this._t0) * 0.001;
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform2f(u.iResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.uniform1f(u.iTime, t);
            gl.uniform2f(u.uMouse, this._mouse.x, this._mouse.y);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // Global Tab Switching
    // ══════════════════════════════════════════════════════════════════════

    // ── GSAP micro-animations: stepper + select ──
    (function initFormAnimations() {
        const dec = document.querySelector('.stepper-dec');
        const inc = document.querySelector('.stepper-inc');
        const durInput = document.getElementById('input-duration');
        const stepper  = document.querySelector('.num-stepper');

        function stepperClick(btn, delta) {
            if (!durInput) return;
            const cur  = parseInt(durInput.value, 10) || 30;
            const next = Math.max(1, Math.min(3600, cur + delta));
            durInput.value = next;
            durInput.dispatchEvent(new Event('input', { bubbles: true }));
            if (typeof gsap !== 'undefined') {
                gsap.fromTo(btn, { scale: 0.72 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' });
                gsap.fromTo(durInput, { color: delta > 0 ? '#e945f5' : '#8B5CF6' }, { color: '#E8DFFF', duration: 0.5, ease: 'power2.out' });
            }
        }

        if (dec) dec.addEventListener('click', () => stepperClick(dec, -10));
        if (inc) inc.addEventListener('click', () => stepperClick(inc, +10));

        if (durInput && stepper && typeof gsap !== 'undefined') {
            durInput.addEventListener('focus', () => {
                gsap.fromTo(stepper, { boxShadow: '0 0 0 0px rgba(139,92,246,0)' },
                    { boxShadow: '0 0 0 5px rgba(139,92,246,0.22)', duration: 0.3, ease: 'power2.out' });
            });
            durInput.addEventListener('blur', () => {
                gsap.to(stepper, { boxShadow: '0 0 0 0px rgba(139,92,246,0)', duration: 0.4 });
            });
        }

        const stateInput = document.getElementById('input-state');
        if (stateInput && typeof gsap !== 'undefined') {
            stateInput.addEventListener('focus', () => {
                gsap.fromTo(stateInput, { boxShadow: '0 0 0 0px rgba(139,92,246,0)' },
                    { boxShadow: '0 0 0 5px rgba(139,92,246,0.22)', duration: 0.3, ease: 'power2.out' });
            });
            stateInput.addEventListener('blur', () => {
                gsap.to(stateInput, { boxShadow: '0 0 0 0px rgba(139,92,246,0)', duration: 0.4 });
            });
        }
    })();

    const globalTabs = document.querySelectorAll('.global-tab');
    const views = document.querySelectorAll('.view');
    const floatingLinesBg = document.getElementById('floating-lines-bg');

    const FL_OPTS = {
        enabledWaves:    ['top', 'middle', 'bottom'],
        lineCount:       8,
        lineDistance:    8,
        bendRadius:      8.0,
        bendStrength:    -2.0,
        mouseDamping:    0.05,
        interactive:     true,
        parallax:        true,
        parallaxStrength: 0.3,
        animationSpeed:  1.0,
        mixBlendMode:    'screen',
        linesGradient:   ['#e945f5', '#8B5CF6', '#2F4BA2', '#6f6f6f'],
    };

    let floatingLines = null;

    function spawnFloatingLines() {
        if (floatingLines) {
            try { floatingLines.destroy(); } catch (e) {}
            floatingLines = null;
        }
        // Clear any leftover canvas children
        floatingLinesBg.innerHTML = '';
        floatingLines = new FloatingLines(floatingLinesBg, FL_OPTS);
    }

    // Initial spawn only when capture is the active entry view.
    if (document.getElementById('view-capture')?.classList.contains('active')) {
        spawnFloatingLines();
    }

    document.addEventListener('visibilitychange', () => {
        if (!floatingLines) return;
        if (document.hidden) floatingLines.stop();
        else floatingLines.start();
    });

    globalTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const viewName = tab.dataset.view;
            const previousView = Array.from(views).find(v => v.classList.contains('active'));
            const previousViewName = previousView ? previousView.id.replace('view-', '') : null;

            if (previousViewName === 'pulse' && viewName !== 'pulse') {
                stopGardenMidiPlayback();
                if (midiLinkedPulse) { midiLinkedPulse.stop(); midiLinkedPulse = null; }
                if (gardenAudioContext && gardenAudioContext.state === 'running') {
                    gardenAudioContext.suspend().catch(() => {});
                }
            }

            globalTabs.forEach(t => t.classList.toggle('active', t.dataset.view === viewName));
            views.forEach(v => v.classList.toggle('active', v.id === `view-${viewName}`));

            if (viewName === 'pulse') {
                showManualUploadView();
            }

            // Trigger resize for pulse 3D if switching to it
            if (viewName === 'pulse' && pulse3d) {
                setTimeout(() => pulse3d._onResize(), 100);
            }

            // FloatingLines: destroy+recreate when returning to capture
            if (viewName === 'capture') {
                setTimeout(() => spawnFloatingLines(), 60);
            } else {
                if (floatingLines) floatingLines.stop();
            }

            // Stop MIDI when leaving pulse detail from any route.
            if (viewName !== 'pulse' && viewName !== 'garden') {
                stopGardenMidiPlayback();
                if (midiLinkedPulse) { midiLinkedPulse.stop(); midiLinkedPulse = null; }
                if (gardenAudioContext && gardenAudioContext.state === 'running') {
                    gardenAudioContext.suspend().catch(() => {});
                }
            }

            // Close garden modal when leaving garden view
            if (viewName !== 'garden') {
                closeGardenModal();
            }

            // Galaxy: destroy when leaving garden to free GPU memory
            if (viewName === 'garden') {
                if (!gardenLoaded) void loadGarden();
            } else {
                gardenLoadRequestId += 1;
                if (galaxyGarden) {
                    galaxyGarden.destroy();
                    galaxyGarden = null;
                    gardenLoaded = false;
                }
                const searchInput = document.getElementById('garden-search-input');
                if (searchInput) searchInput.value = '';
            }

            // Re-show capture tour whenever user navigates to the capture tab
            if (viewName === 'capture') {
                setTimeout(() => {
                    const setup = document.getElementById('capture-setup');
                    const live  = document.getElementById('capture-live');
                    const res   = document.getElementById('capture-results');
                    const setupVisible = setup && setup.style.display !== 'none';
                    const liveVisible  = live  && live.style.display  !== 'none';
                    const resVisible   = res   && res.style.display   !== 'none';
                    if (setupVisible && !liveVisible && !resVisible) {
                        startTour(captureSetupTourSteps);
                    }
                }, 400);
            }
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // CAPTURE VIEW
    // ══════════════════════════════════════════════════════════════════════

    const setupSection = document.getElementById('capture-setup');
    const liveSection = document.getElementById('capture-live');
    const resultsSection = document.getElementById('capture-results');

    const inputName = document.getElementById('input-name');
    const inputState = document.getElementById('input-state');
    const inputDuration = document.getElementById('input-duration');
    const btnStart = document.getElementById('btn-start-capture');
    const btnStop = document.getElementById('btn-stop-capture');

    const liveUserLabel = document.getElementById('live-user-label');
    const liveTime = document.getElementById('live-time');

    const wavesCanvas = null; // replaced by live butterfly renderer

    const resultsSummary = document.getElementById('results-summary');
    const btnDownloadMidi = document.getElementById('btn-download-midi');
    const btnSendToPulse = document.getElementById('btn-send-to-pulse');
    const btnNewCapture = document.getElementById('btn-new-capture');
    const resultsWavesCanvas = document.getElementById('results-waves-canvas');
    const resultsWavesCtx = resultsWavesCanvas.getContext('2d');

    // Capture state
    let capturePollingId = null;
    let captureStreamIdx = 0;
    let captureWaveBuffer = { 0: [], 1: [], 2: [], 3: [] };
    const MAX_WAVE_POINTS = 800;
    let lastCaptureData = null;
    let captureAnimId = null;

    // ── Live butterfly renderer + FocusTracker ──
    let scalpMap = null;

    // FocusTracker: detects Beta (Trazo) threshold crossings
    const FocusTracker = {
        // Configuration
        SAMPLE_RATE: 256,        // Muse 2 nominal rate
        WINDOW_SECS: 1.0,        // FFT window
        BETA_LO: 13,             // Hz
        BETA_HI: 30,             // Hz
        CALIBRATION_SECS: 3,     // seconds to collect baseline
        THRESHOLD_FACTOR: 0.8,   // mean + factor * std

        // State
        buffer: [],              // ring buffer of raw samples (all 4 ch averaged)
        calibrationBuffer: [],
        threshold: null,
        wasAbove: false,
        birds: 0,
        recoveries: 0,
        calibrationDone: false,
        waitingForRecovery: false,  // true when below threshold after a bird

        reset() {
            this.buffer = [];
            this.calibrationBuffer = [];
            this.threshold = null;
            this.wasAbove = false;
            this.birds = 0;
            this.recoveries = 0;
            this.calibrationDone = false;
            this.waitingForRecovery = false;
            document.getElementById('bird-count').textContent = '0';
            document.getElementById('recovery-count').textContent = '0';
        },

        push(samples4ch) {
            // Average across channels for a single signal
            const avg = samples4ch.reduce((s, v) => s + v, 0) / samples4ch.length;
            this.buffer.push(avg);

            const winLen = Math.round(this.SAMPLE_RATE * this.WINDOW_SECS);

            // Trim ring buffer
            if (this.buffer.length > winLen * 4) {
                this.buffer = this.buffer.slice(-winLen * 4);
            }

            // Calibration phase
            if (!this.calibrationDone) {
                this.calibrationBuffer.push(avg);
                const calLen = Math.round(this.SAMPLE_RATE * this.CALIBRATION_SECS);
                if (this.calibrationBuffer.length >= calLen) {
                    this._calibrate();
                }
                return;
            }

            // Compute Beta power every ~window
            if (this.buffer.length >= winLen) {
                const win = this.buffer.slice(-winLen);
                const power = this._betaPower(win);
                this._detectCrossing(power);
            }
        },

        _calibrate() {
            const calLen = Math.round(this.SAMPLE_RATE * this.CALIBRATION_SECS);
            const slice = this.calibrationBuffer.slice(-calLen);
            // Compute Beta powers over 1-second windows in calibration data
            const winLen = Math.round(this.SAMPLE_RATE * this.WINDOW_SECS);
            const powers = [];
            for (let i = 0; i + winLen <= slice.length; i += winLen) {
                powers.push(this._betaPower(slice.slice(i, i + winLen)));
            }
            if (powers.length === 0) {
                this.threshold = 1;
                this.calibrationDone = true;
                return;
            }
            const mean = powers.reduce((s, v) => s + v, 0) / powers.length;
            const std = Math.sqrt(powers.reduce((s, v) => s + (v - mean) ** 2, 0) / powers.length);
            this.threshold = mean + this.THRESHOLD_FACTOR * std;
            this.calibrationDone = true;
            console.log(`[FocusTracker] threshold calibrated: ${this.threshold.toFixed(4)} (mean=${mean.toFixed(4)}, std=${std.toFixed(4)})`);
        },

        _betaPower(samples) {
            // Simple FFT-based beta power
            const N = samples.length;
            const freqRes = this.SAMPLE_RATE / N;
            const loIdx = Math.ceil(this.BETA_LO / freqRes);
            const hiIdx = Math.floor(this.BETA_HI / freqRes);
            // Hann window
            const windowed = samples.map((v, i) => v * 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1))));
            const spectrum = this._fft(windowed);
            let power = 0;
            for (let k = loIdx; k <= Math.min(hiIdx, spectrum.length - 1); k++) {
                const re = spectrum[k * 2];
                const im = spectrum[k * 2 + 1];
                power += re * re + im * im;
            }
            return power / (hiIdx - loIdx + 1);
        },

        _detectCrossing(power) {
            if (this.threshold === null) return;
            const above = power > this.threshold;
            if (above && !this.wasAbove) {
                // Crossed upward
                if (!this.waitingForRecovery) {
                    // First crossing: it's a bird
                    this.birds++;
                    this.waitingForRecovery = true;
                    this._flashCounter('bird-count', this.birds, 'bird-badge', 'counter-birds');
                } else {
                    // Was below, now above again: it's a recovery
                    this.recoveries++;
                    this.waitingForRecovery = false;
                    this._flashCounter('recovery-count', this.recoveries, 'recovery-badge', 'counter-recoveries');
                }
            }
            if (!above && this.wasAbove && this.waitingForRecovery) {
                // Dropped below threshold — waiting for recovery
                // (no action needed, just track state)
            }
            this.wasAbove = above;
        },

        _flashCounter(valueId, value, badgeId, wrapperId) {
            const valEl   = document.getElementById(valueId);
            const badgeEl = document.getElementById(badgeId);
            const iconEl  = document.querySelector(`#${wrapperId} .focus-counter-icon`);
            if (valEl)   valEl.textContent = value;
            if (iconEl) {
                iconEl.classList.remove('pop');
                void iconEl.offsetWidth; // reflow
                iconEl.classList.add('pop');
                setTimeout(() => iconEl.classList.remove('pop'), 500);
            }
            if (badgeEl) {
                badgeEl.style.display = 'inline';
                badgeEl.style.animation = 'none';
                void badgeEl.offsetWidth;
                badgeEl.style.animation = '';
                setTimeout(() => { badgeEl.style.display = 'none'; }, 1300);
            }
        },

        // Cooley-Tukey FFT — returns flat [re0,im0, re1,im1, …] array
        _fft(x) {
            const N = x.length;
            if (N <= 1) return [x[0] || 0, 0];
            // Zero-pad to next power of 2
            let n = 1;
            while (n < N) n <<= 1;
            const re = new Float64Array(n);
            const im = new Float64Array(n);
            for (let i = 0; i < N; i++) re[i] = x[i];
            // Bit-reverse permutation
            for (let i = 0, j = 0; i < n; i++) {
                if (i < j) {
                    [re[i], re[j]] = [re[j], re[i]];
                    [im[i], im[j]] = [im[j], im[i]];
                }
                let bit = n >> 1;
                for (; j & bit; bit >>= 1) j ^= bit;
                j ^= bit;
            }
            // Butterfly
            for (let len = 2; len <= n; len <<= 1) {
                const ang = -2 * Math.PI / len;
                const wRe = Math.cos(ang), wIm = Math.sin(ang);
                for (let i = 0; i < n; i += len) {
                    let curRe = 1, curIm = 0;
                    for (let k = 0; k < len / 2; k++) {
                        const uRe = re[i + k], uIm = im[i + k];
                        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
                        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
                        re[i + k]           = uRe + vRe;
                        im[i + k]           = uIm + vIm;
                        re[i + k + len / 2] = uRe - vRe;
                        im[i + k + len / 2] = uIm - vIm;
                        const newCurRe = curRe * wRe - curIm * wIm;
                        curIm = curRe * wIm + curIm * wRe;
                        curRe = newCurRe;
                    }
                }
            }
            const out = new Float64Array(n * 2);
            for (let i = 0; i < n; i++) { out[i * 2] = re[i]; out[i * 2 + 1] = im[i]; }
            return out;
        },
    };

    // ── Profile autocomplete ──
    let profileSuggestions = [];
    const profileSuggestionsEl = document.getElementById('profile-suggestions');
    const PROFILE_SUGGESTION_LIMIT = 8;

    if (inputName && profileSuggestionsEl) {
        inputName.setAttribute('role', 'combobox');
        inputName.setAttribute('aria-autocomplete', 'list');
        inputName.setAttribute('aria-expanded', 'false');
        inputName.setAttribute('aria-controls', 'profile-suggestions');
        profileSuggestionsEl.setAttribute('role', 'listbox');
        profileSuggestionsEl.hidden = true;
    }

    async function loadProfileSuggestions() {
        try {
            const resp = await fetch('/api/profiles/list');
            const data = await resp.json();
            if (data.ok) profileSuggestions = data.profiles || [];
        } catch (_) {}
    }

    function normalizeName(n) {
        return (n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    }

    if (inputName) {
        inputName.addEventListener('focus', async () => {
            await loadProfileSuggestions();
            showSuggestions(inputName.value);
        });
        inputName.addEventListener('input', () => showSuggestions(inputName.value));
        inputName.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hideSuggestions();
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.name-input-wrap')) hideSuggestions();
        });
    }

    function showSuggestions(query) {
        if (!profileSuggestionsEl) return;
        const q = normalizeName(query);
        const matches = profileSuggestions.filter(p =>
            !q || normalizeName(p.profile_name).includes(q)
        );
        if (!matches.length) { hideSuggestions(); return; }
        profileSuggestionsEl.replaceChildren();

        matches.slice(0, PROFILE_SUGGESTION_LIMIT).forEach(p => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'profile-suggestion-item';
            item.setAttribute('role', 'option');
            item.setAttribute('aria-label', `Usar perfil ${p.profile_name}`);

            const name = document.createElement('span');
            name.className = 'suggestion-name';
            name.textContent = p.profile_name;

            const count = document.createElement('span');
            count.className = 'suggestion-count';
            count.textContent = `${p.capture_count} captura${p.capture_count !== 1 ? 's' : ''}`;

            item.append(name, count);
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                inputName.value = p.profile_name;
                hideSuggestions();
            });
            profileSuggestionsEl.appendChild(item);
        });

        if (matches.length > PROFILE_SUGGESTION_LIMIT) {
            const more = document.createElement('div');
            more.className = 'profile-suggestion-more';
            more.textContent = `+${matches.length - PROFILE_SUGGESTION_LIMIT} perfiles más. Escribe para filtrar.`;
            profileSuggestionsEl.appendChild(more);
        }

        profileSuggestionsEl.hidden = false;
        profileSuggestionsEl.style.display = 'block';
        if (inputName) inputName.setAttribute('aria-expanded', 'true');
    }

    function hideSuggestions() {
        if (profileSuggestionsEl) {
            profileSuggestionsEl.hidden = true;
            profileSuggestionsEl.style.display = 'none';
        }
        if (inputName) inputName.setAttribute('aria-expanded', 'false');
    }

    // ── Start Capture ──
    btnStart.addEventListener('click', async () => {
        const name = inputName.value.trim();
        const state = inputState.value.trim();
        const duration = inputDuration.value ? parseFloat(inputDuration.value) : null;

        if (!state) {
            alert('Por favor escribe tu estado emocional.');
            return;
        }

        btnStart.disabled = true;
        btnStart.textContent = 'Conectando...';
        hideSuggestions();

        // Resolve profile name: if input matches existing profile (case-insensitive), use canonical name
        let profileName = name;
        const matchedProfile = profileSuggestions.find(
            p => normalizeName(p.profile_name) === normalizeName(name)
        );
        if (matchedProfile) profileName = matchedProfile.profile_name;

        try {
            const resp = await fetch('/api/capture/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userName: name,
                    userState: state,
                    durationSeconds: duration,
                    profileName: profileName,
                }),
            });

            const data = await resp.json();
            if (!resp.ok) {
                alert('Error: ' + (data.error || 'No se pudo iniciar'));
                return;
            }

            // Switch to live view
            setupSection.style.display = 'none';
            liveSection.style.display = 'flex';
            resultsSection.style.display = 'none';

            liveUserLabel.textContent = name
                ? `${name}${state ? ' — ' + state : ''}`
                : 'Captura EEG';

            // Reset wave buffer
            captureStreamIdx = 0;
            captureWaveBuffer = { 0: [], 1: [], 2: [], 3: [] };

            // Start polling (outside try/catch so UI errors don't look like network errors)
            setTimeout(startPolling, 0);

        } catch (err) {
            alert('Error de conexión: ' + err.message);
        } finally {
            btnStart.disabled = false;
            btnStart.innerHTML = '<span>▶</span> Iniciar Captura';
        }
    });

    // ── Stop Capture ──
    btnStop.addEventListener('click', async () => {
        btnStop.disabled = true;
        try {
            await fetch('/api/capture/stop', { method: 'POST' });
        } catch (_) { }
        stopPolling();
        showResults();
        btnStop.disabled = false;
    });

    // ── Polling ──
    function startPolling() {
        stopPolling();

        // Init live butterfly renderer
        const smCanvas = document.getElementById('scalp-map-canvas');
        if (smCanvas) {
            scalpMap = new ScalpMap(smCanvas);
        }

        // Init FocusTracker
        FocusTracker.reset();

        pollOnce(); // immediate first poll
        capturePollingId = setInterval(pollOnce, 150);
    }

    function stopPolling() {
        if (capturePollingId) {
            clearInterval(capturePollingId);
            capturePollingId = null;
        }
        if (scalpMap) {
            scalpMap.stop();
            scalpMap = null;
        }
    }

    async function pollOnce() {
        try {
            const resp = await fetch(`/api/capture/stream?from=${captureStreamIdx}`);
            const data = await resp.json();

            // Update stats
            if (data.metadata) {
                const dur = data.metadata.duration_seconds || 0;
                liveTime.textContent = formatTime(dur);
            }

            // Append new samples to wave buffer + feed live butterfly + FocusTracker
            if (data.eeg_channels) {
                const newSamplesPerCh = [];
                for (let ch = 0; ch < 4; ch++) {
                    const key = `channel_${ch + 1}`;
                    const newSamples = data.eeg_channels[key] || [];
                    captureWaveBuffer[ch].push(...newSamples);
                    // Trim to keep only last MAX_WAVE_POINTS
                    if (captureWaveBuffer[ch].length > MAX_WAVE_POINTS) {
                        captureWaveBuffer[ch] = captureWaveBuffer[ch].slice(-MAX_WAVE_POINTS);
                    }
                    newSamplesPerCh.push(newSamples);
                }

                // Feed renderer + FocusTracker sample by sample for more fluid motion
                const nSamples = newSamplesPerCh.reduce((mx, a) => Math.max(mx, a.length), 0);
                for (let s = 0; s < nSamples; s++) {
                    const sample4ch = newSamplesPerCh.map(arr => arr[s] ?? 0);
                    if (scalpMap) {
                        scalpMap.update(sample4ch);
                    }
                    FocusTracker.push(sample4ch);
                }
            }

            captureStreamIdx = data.endIndex || captureStreamIdx;

            // Store latest full data
            lastCaptureData = data;

            // Auto-stop if finished
            if (data.finished) {
                stopPolling();
                showResults();
            }

        } catch (err) {
            console.warn('Poll error:', err);
        }
    }

    // ── Butterfly Drawing (results preview only) ──
    function resizeWavesCanvas() {
        // No-op: live renderer handles its own resize
    }

    window.addEventListener('resize', () => {
        if (liveSection.style.display !== 'none' && scalpMap) {
            scalpMap.resize();
        }
        if (pulse2d && canvas2d) fitPulseCanvas(canvas2d);
        const gCanvas = document.getElementById('garden-pulse-2d-canvas');
        if (gardenPulse2d && gCanvas) fitPulseCanvas(gCanvas);
    });

    function drawWavesLoop() {
        // No-op: live renderer handles its own animation
    }

    function drawWaves(ctx, canvas, buffers) {
        const W = canvas.width;
        const H = canvas.height;
        const midY = H * 0.5;

        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#03050A');
        bg.addColorStop(0.5, '#08101C');
        bg.addColorStop(1, '#020307');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        ctx.strokeStyle = 'rgba(150, 170, 255, 0.08)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 10; i++) {
            const x = (W / 10) * i;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
        }
        for (let i = 1; i < 6; i++) {
            const y = (H / 6) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.beginPath();
        ctx.moveTo(0, midY);
        ctx.lineTo(W, midY);
        ctx.stroke();

        // Find global min/max for normalization
        let gMin = Infinity, gMax = -Infinity;
        for (let ch = 0; ch < 4; ch++) {
            const buf = buffers[ch];
            for (let i = 0; i < buf.length; i++) {
                if (buf[i] < gMin) gMin = buf[i];
                if (buf[i] > gMax) gMax = buf[i];
            }
        }
        if (gMin === Infinity) { gMin = -100; gMax = 100; }
        const range = (gMax - gMin) || 1;
        const channelOffsets = [-0.17, -0.06, 0.06, 0.17].map(v => v * H);
        const lineColors = [
            { solid: '#8BF0FF', glow: '139,240,255' },
            { solid: '#C7F284', glow: '199,242,132' },
            { solid: '#FFD36E', glow: '255,211,110' },
            { solid: '#FF8A5B', glow: '255,138,91' },
        ];

        for (let ch = 0; ch < 4; ch++) {
            const buf = buffers[ch];
            if (buf.length < 2) continue;
            const bandHeight = H * 0.34;
            const baseY = midY + channelOffsets[ch];
            const energy = estimateChannelEnergy(buf);
            const amp = bandHeight * (0.22 + energy * 0.52);

            for (let trail = 0; trail < 4; trail++) {
                ctx.beginPath();
                const trailMix = trail / 3;
                for (let i = 0; i < buf.length; i++) {
                    const x = (i / Math.max(1, buf.length - 1)) * W;
                    const norm = ((buf[i] - gMin) / range) - 0.5;
                    const y = baseY - norm * amp + (trailMix - 0.5) * (12 + energy * 24);
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.strokeStyle = `rgba(${lineColors[ch].glow}, ${0.08 + trailMix * 0.08})`;
                ctx.lineWidth = 8 - trailMix * 2.5;
                ctx.shadowBlur = 12 + trailMix * 8;
                ctx.shadowColor = `rgba(${lineColors[ch].glow}, 0.24)`;
                ctx.stroke();
            }

            ctx.beginPath();
            for (let i = 0; i < buf.length; i++) {
                const x = (i / Math.max(1, buf.length - 1)) * W;
                const norm = ((buf[i] - gMin) / range) - 0.5;
                const y = baseY - norm * amp;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = lineColors[ch].solid;
            ctx.lineWidth = 2.2;
            ctx.shadowBlur = 16;
            ctx.shadowColor = `rgba(${lineColors[ch].glow}, 0.36)`;
            ctx.stroke();
            ctx.shadowBlur = 0;

            ctx.fillStyle = lineColors[ch].solid;
            ctx.font = `600 ${Math.max(11, H * 0.065)}px Inter, system-ui`;
            ctx.fillText(CH_NAMES[ch], 12, 18 + ch * 16);
        }

        ctx.fillStyle = 'rgba(235,242,255,0.62)';
        ctx.font = `600 ${Math.max(11, H * 0.07)}px Inter, system-ui`;
        ctx.textAlign = 'right';
        ctx.fillText('Butterfly EEG', W - 12, 18);
        ctx.textAlign = 'start';
    }

    function estimateChannelEnergy(buf) {
        const len = Math.min(48, buf.length - 1);
        if (len <= 1) return 0.35;
        let delta = 0;
        for (let i = buf.length - len; i < buf.length; i++) {
            delta += Math.abs(buf[i] - buf[i - 1]);
        }
        return Math.max(0.12, Math.min(1, delta / len / 22));
    }

    // ── Results ──
    function showResults() {
        liveSection.style.display = 'none';
        resultsSection.style.display = 'flex';

        // Mark garden as needing refresh so new capture appears
        gardenLoaded = false;

        if (lastCaptureData && lastCaptureData.metadata) {
            const meta = lastCaptureData.metadata;
            const dur = meta.duration_seconds || 0;
            const name = meta.user_name || '';
            const state = meta.user_state;

            let text = `Sesión completada · ${formatTime(dur)}`;
            if (name) text = `${name}${state ? ' (' + state + ')' : ''} — ` + text;
            resultsSummary.textContent = text;
        }

        // Draw static preview of waves
        drawResultsPreview();

        // Show post-capture tour
        showPostCaptureTour();
    }

    function drawResultsPreview() {
        const container = resultsWavesCanvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        resultsWavesCanvas.width = container.clientWidth * dpr;
        resultsWavesCanvas.height = 180 * dpr;
        resultsWavesCanvas.style.width = container.clientWidth + 'px';
        resultsWavesCanvas.style.height = '180px';
        drawWaves(resultsWavesCtx, resultsWavesCanvas, captureWaveBuffer);
    }

    // ── Download MIDI ──
    btnDownloadMidi.addEventListener('click', async () => {
        btnDownloadMidi.disabled = true;
        btnDownloadMidi.textContent = 'Generando MIDI...';

        try {
            // Get full capture data
            const statusResp = await fetch('/api/capture/status');
            const captureJson = await statusResp.json();

            const resp = await fetch('/api/json-to-midi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonData: captureJson }),
            });

            if (!resp.ok) {
                const err = await resp.json();
                alert('Error: ' + (err.error || 'No se pudo generar MIDI'));
                return;
            }

            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const disposition = resp.headers.get('Content-Disposition') || '';
            const match = disposition.match(/filename="?([^"]+)"?/);
            a.download = match ? match[1] : `eeg_${Date.now()}.mid`;
            a.click();
            URL.revokeObjectURL(url);

        } catch (err) {
            alert('Error: ' + err.message);
        } finally {
            btnDownloadMidi.disabled = false;
            btnDownloadMidi.innerHTML = '<span>🎵</span> Descargar MIDI';
        }
    });

    // ── Replay MIDI (capture results) ──
    const btnReplayMidi = document.getElementById('btn-replay-midi');
    if (btnReplayMidi) {
        btnReplayMidi.addEventListener('click', () => {
            if (currentPlaybackCaptureData) {
                startLinkedPulseForMidiReplay();
                playGardenMidi(currentPlaybackCaptureData);
            }
        });
    }

    // ── Send to Pulse ──
    btnSendToPulse.addEventListener('click', async () => {
        try {
            const resp = await fetch('/api/capture/status');
            const captureJson = await resp.json();

            if (!captureJson.eeg_channels || !captureJson.metadata) {
                alert('No hay datos de captura disponibles');
                return;
            }

            // Switch to pulse view and process data
            globalTabs.forEach(t => t.classList.toggle('active', t.dataset.view === 'pulse'));
            views.forEach(v => v.classList.toggle('active', v.id === 'view-pulse'));

            processPulseData(captureJson);

        } catch (err) {
            alert('Error: ' + err.message);
        }
    });

    // ── New Capture ──
    btnNewCapture.addEventListener('click', () => {
        resultsSection.style.display = 'none';
        setupSection.style.display = 'flex';
        lastCaptureData = null;
        captureWaveBuffer = { 0: [], 1: [], 2: [], 3: [] };
        setTimeout(() => {
            spawnFloatingLines();
            startTour(captureSetupTourSteps);
        }, 60);
    });

    // ══════════════════════════════════════════════════════════════════════
    // INTERACTIVE TOUR
    // ══════════════════════════════════════════════════════════════════════

    const tourOverlay = document.getElementById('tour-overlay');
    const tourBackdrop = document.getElementById('tour-backdrop');
    const tourSpotlight = document.getElementById('tour-spotlight');
    const tourTooltip = document.getElementById('tour-tooltip');
    const tourIcon = document.getElementById('tour-tooltip-icon');
    const tourStep = document.getElementById('tour-tooltip-step');
    const tourTitle = document.getElementById('tour-tooltip-title');
    const tourDesc = document.getElementById('tour-tooltip-desc');
    const tourBtnSkip = document.getElementById('tour-btn-skip');
    const tourBtnPrev = document.getElementById('tour-btn-prev');
    const tourBtnNext = document.getElementById('tour-btn-next');

    let tourCurrentStep = 0;
    let tourSteps = [];
    let tourActive = false;

    // Setup tour steps (shown when entering capture view)
    const captureSetupTourSteps = [
        {
            icon: '💫',
            title: '¡Bienvenido a NAD!',
            desc: 'Esta herramienta captura tus ondas cerebrales con una diadema Muse 2 y las transforma en una pulso neurofuncional única. Te guiaremos paso a paso.',
            target: null, // centered, no spotlight
        },
        {
            icon: '👤',
            title: 'Nombre del participante',
            desc: 'Escribe el nombre de quien realizará la captura. Esto ayuda a identificar cada sesión en el campo resonante de pulsos.',
            target: '#input-name',
        },
        {
            icon: '⏱️',
            title: 'Duración de la captura',
            desc: 'Define cuántos segundos durará la grabación. Si lo dejas vacío, la captura será manual y deberás presionar "Detener" cuando termines.',
            target: '#input-duration',
        },
        {
            icon: '▶️',
            title: 'Iniciar la captura',
            desc: 'Cuando estés listo, presiona este botón para comenzar a registrar tus ondas cerebrales. ¡Relájate y disfruta el proceso!',
            target: '#btn-start-capture',
        },
    ];

    // Post-capture tour step
    const postCaptureTourSteps = [
        {
            icon: '🎉',
            title: '¡Captura completada!',
            desc: 'Tus ondas cerebrales han sido registradas exitosamente. La captura se guardó automáticamente en tu campo resonante.',
            target: null,
        },
        {
            icon: '💫',
            title: 'Visualiza tu Pulso',
            desc: 'Presiona "Ver Pulso" para transformar tus ondas cerebrales en una pulso neurofuncional única. ¡Cada persona genera una pulso diferente!',
            target: '#btn-send-to-pulse',
        },
    ];

    function startTour(steps) {
        tourSteps = steps;
        tourCurrentStep = 0;
        tourActive = true;
        tourOverlay.style.display = 'block';
        renderTourStep();
    }

    function endTour() {
        tourActive = false;
        tourOverlay.style.display = 'none';
        tourSpotlight.style.display = 'none';
    }

    function renderTourStep() {
        if (tourCurrentStep < 0 || tourCurrentStep >= tourSteps.length) {
            endTour();
            return;
        }

        const step = tourSteps[tourCurrentStep];
        tourIcon.textContent = step.icon;
        tourStep.textContent = `${tourCurrentStep + 1}/${tourSteps.length}`;
        tourTitle.textContent = step.title;
        tourDesc.textContent = step.desc;

        // Prev/Next button states
        tourBtnPrev.style.display = tourCurrentStep > 0 ? 'inline-flex' : 'none';
        tourBtnNext.textContent = tourCurrentStep === tourSteps.length - 1 ? '¡Entendido! ✓' : 'Siguiente →';

        if (step.target) {
            const targetEl = document.querySelector(step.target);
            if (targetEl) {
                const rect = targetEl.getBoundingClientRect();
                const pad = 8;

                // Position spotlight
                tourSpotlight.style.display = 'block';
                tourBackdrop.style.display = 'none'; // spotlight creates its own backdrop via box-shadow
                tourSpotlight.style.top = (rect.top - pad) + 'px';
                tourSpotlight.style.left = (rect.left - pad) + 'px';
                tourSpotlight.style.width = (rect.width + pad * 2) + 'px';
                tourSpotlight.style.height = (rect.height + pad * 2) + 'px';

                // Position tooltip below or above the target
                tourTooltip.classList.remove('tour-tooltip--center');
                const tooltipH = 220; // approximate
                const spaceBelow = window.innerHeight - rect.bottom;
                const spaceAbove = rect.top;

                let tooltipTop, tooltipLeft;
                tooltipLeft = Math.max(10, Math.min(rect.left, window.innerWidth - 400));

                if (spaceBelow > tooltipH + 30) {
                    tooltipTop = rect.bottom + 16;
                } else if (spaceAbove > tooltipH + 30) {
                    tooltipTop = rect.top - tooltipH - 16;
                } else {
                    tooltipTop = Math.max(10, (window.innerHeight - tooltipH) / 2);
                }

                tourTooltip.style.top = tooltipTop + 'px';
                tourTooltip.style.left = tooltipLeft + 'px';

                // Scroll target into view if needed
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                // Target not found, center tooltip
                showCenteredTooltip();
            }
        } else {
            // No target — center the tooltip
            showCenteredTooltip();
        }
    }

    function showCenteredTooltip() {
        tourSpotlight.style.display = 'none';
        tourBackdrop.style.display = 'block';
        tourTooltip.classList.add('tour-tooltip--center');
        tourTooltip.style.top = '';
        tourTooltip.style.left = '';
    }

    // Tour navigation
    if (tourBtnNext) {
        tourBtnNext.addEventListener('click', () => {
            tourCurrentStep++;
            if (tourCurrentStep >= tourSteps.length) {
                endTour();
            } else {
                renderTourStep();
            }
        });
    }

    if (tourBtnPrev) {
        tourBtnPrev.addEventListener('click', () => {
            if (tourCurrentStep > 0) {
                tourCurrentStep--;
                renderTourStep();
            }
        });
    }

    if (tourBtnSkip) {
        tourBtnSkip.addEventListener('click', () => {
            endTour();
        });
    }

    if (tourBackdrop) {
        tourBackdrop.addEventListener('click', (e) => {
            // Only close if clicking the backdrop itself
            if (e.target === tourBackdrop) {
                endTour();
            }
        });
    }

    // Start the capture setup tour unconditionally
    function maybeStartCaptureTour() {
        setTimeout(() => {
            startTour(captureSetupTourSteps);
        }, 600);
    }

    // Show post-capture tour
    function showPostCaptureTour() {
        setTimeout(() => {
            startTour(postCaptureTourSteps);
        }, 800);
    }

    // Capture tour starts only when user enters capture view.

    // ── Utils ──
    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    // ══════════════════════════════════════════════════════════════════════
    // PULSE VIEW
    // ══════════════════════════════════════════════════════════════════════

    let pulseAnalyzer = null;
    let pulse2d = null;
    let pulse3d = null;
    let currentPulseTab = 'pulse2d';

    const pulseUploadSection = document.getElementById('pulse-upload-section');
    const pulseMainContent = document.getElementById('pulse-main-content');
    const pulseFileInput = document.getElementById('pulse-file-input');
    const pulseBtnUpload = document.getElementById('pulse-btn-upload');
    const pulseUploadArea = document.getElementById('pulse-upload-area');
    const pulseUploadStatus = document.getElementById('pulse-upload-status');

    const pulseTabs = document.querySelectorAll('#pulse-tabs .tab');
    const pulsePanels = document.querySelectorAll('.tab-panel');
    const canvas2d = document.getElementById('pulse-2d-canvas');
    const container3d = document.getElementById('pulse-3d-container');
    const analysisContent = document.getElementById('analysis-content');
    const bandBar = document.getElementById('band-bar');

    const btnExport3d = document.getElementById('btn-export-3d');
    const printSizeSelect = document.getElementById('print-size-mm');
    const printExportFormat = document.getElementById('print-export-format');

    // ── File upload ──
    pulseBtnUpload.addEventListener('click', () => pulseFileInput.click());
    pulseFileInput.addEventListener('change', (e) => {
        if (e.target.files.length) loadPulseFile(e.target.files[0]);
    });

    // Drag & Drop
    pulseUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        pulseUploadArea.classList.add('drag-over');
    });
    pulseUploadArea.addEventListener('dragleave', () => {
        pulseUploadArea.classList.remove('drag-over');
    });
    pulseUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        pulseUploadArea.classList.remove('drag-over');
        if (e.dataTransfer.files.length) loadPulseFile(e.dataTransfer.files[0]);
    });

    function showManualUploadView() {
        stopGardenMidiPlayback();
        if (midiLinkedPulse) { midiLinkedPulse.stop(); midiLinkedPulse = null; }
        if (gardenAudioContext && gardenAudioContext.state === 'running') {
            gardenAudioContext.suspend().catch(() => {});
        }
        if (pulse3d) { pulse3d.destroy(); pulse3d = null; }
        if (pulse2d) { pulse2d.stop(); pulse2d = null; }
        pulseAnalyzer = null;
        pulseMainContent.style.display = 'none';
        pulseUploadSection.style.display = 'flex';
        if (pulseFileInput) pulseFileInput.value = '';
        if (pulseUploadStatus) pulseUploadStatus.style.display = 'none';
    }

    function setPulseUploadStatus(message, type = '') {
        if (!pulseUploadStatus) return;
        pulseUploadStatus.textContent = message;
        pulseUploadStatus.className = `upload-status ${type}`.trim();
        pulseUploadStatus.style.display = message ? 'block' : 'none';
    }

    async function saveManualCapture(jsonData, sourceFilename) {
        setPulseUploadStatus('Guardando captura en campo resonante...', 'loading');
        const resp = await fetch('/api/garden/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonData, sourceFilename }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.ok) {
            throw new Error(data.error || 'No se pudo guardar la captura JSON');
        }
        gardenLoaded = false;
        setPulseUploadStatus(`Captura subida: ${data.filename}`, 'success');
        return data.capture || jsonData;
    }

    function loadPulseFile(file) {
        if (!file.name.endsWith('.json')) {
            alert('Por favor selecciona un archivo .json');
            return;
        }
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.eeg_channels || !data.metadata) {
                    alert('El archivo JSON no tiene el formato esperado (requiere eeg_channels y metadata).');
                    return;
                }
                const savedData = await saveManualCapture(data, file.name);
                processPulseData(savedData);
            } catch (err) {
                setPulseUploadStatus('Error: ' + err.message, 'error');
                alert('Error leyendo o subiendo el JSON: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    // ── Process Pulse Data ──
    function processPulseData(jsonData) {
        if (!jsonData.eeg_channels || !jsonData.metadata) {
            alert('El archivo JSON no tiene el formato esperado (requiere eeg_channels y metadata).');
            return;
        }

        stopGardenMidiPlayback();
        if (midiLinkedPulse) { midiLinkedPulse.stop(); midiLinkedPulse = null; }
        if (pulse3d) { pulse3d.destroy(); pulse3d = null; }
        if (pulse2d) { pulse2d.stop(); pulse2d = null; }

        // Use the Pulse's analyzer (loaded from /pulse/eeg_band_analyzer.js)
        pulseAnalyzer = new EEGBandAnalyzer(jsonData);
        const report = pulseAnalyzer.getReport();

        // Show main content
        pulseUploadSection.style.display = 'none';
        pulseMainContent.style.display = 'flex';

        renderBandBar(report.bands);
        renderAnalysis(report);
        drawPulse2D();
        switchPulseTab('pulse2d');
        midiLinkedPulse = pulse2d;

        // Play MIDI automatically when entering pulse detail from capture
        void playGardenMidi(jsonData);
    }

    // ── Fit canvas to wrapper (responsive DPR) ──
    function fitPulseCanvas(canvas) {
        const wrap = canvas && canvas.parentElement;
        if (!wrap) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = wrap.getBoundingClientRect();
        const w = wrap.clientWidth || rect.width || 700;
        const h = wrap.clientHeight || rect.height || w;
        const size = Math.max(320, Math.min(w, h) || w || 700);
        const nw = Math.round(size);
        const nh = Math.round(size);
        const bitmapW = Math.round(nw * dpr);
        const bitmapH = Math.round(nh * dpr);
        if (canvas.width !== bitmapW || canvas.height !== bitmapH) {
            canvas.width = bitmapW;
            canvas.height = bitmapH;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
    }

    // ── Draw 2D (LavaPulse) ──
    function drawPulse2D() {
        if (!pulseAnalyzer) return;
        if (pulse2d) pulse2d.stop();
        fitPulseCanvas(canvas2d);
        pulse2d = new LavaPulse(canvas2d, pulseAnalyzer);
        pulse2d.start();
    }

    // ── Init 3D Pulse ──
    function initPulse3D() {
        if (!pulseAnalyzer) return;
        if (pulse3d) pulse3d.destroy();
        pulse3d = new Pulse3D(container3d, pulseAnalyzer);
        pulse3d.init();
    }

    // ── Pulse Tabs ──
    pulseTabs.forEach(tab => {
        tab.addEventListener('click', () => switchPulseTab(tab.dataset.tab));
    });

    function switchPulseTab(tabName) {
        // Pause/resume LavaPulse on tab changes
        if (currentPulseTab === 'pulse2d' && tabName !== 'pulse2d' && pulse2d) {
            pulse2d.stop();
        }
        if (tabName === 'pulse2d' && pulse2d) {
            pulse2d.start();
        }
        currentPulseTab = tabName;
        pulseTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        pulsePanels.forEach(p => p.classList.toggle('active', p.id === `panel-${tabName}`));

        if (tabName === 'pulse3d' && pulseAnalyzer && !pulse3d) {
            setTimeout(() => initPulse3D(), 100);
        }
        if (tabName === 'pulse3d' && pulse3d) {
            pulse3d._onResize();
        }
    }

    // ── Band Bar ──
    function renderBandBar(bands) {
        bandBar.innerHTML = '';
        const sorted = [...bands].sort((a, b) => b.relativePower - a.relativePower);
        sorted.forEach(band => {
            const chip = document.createElement('div');
            chip.className = 'band-chip';
            chip.innerHTML = `
                <span class="band-chip-dot" style="background:${band.color}"></span>
                <span>${band.emoji} ${band.name}</span>
                <span class="band-chip-pct">${band.percentage.toFixed(1)}%</span>
            `;
            bandBar.appendChild(chip);
        });
    }

    // ── Analysis ──
    function renderAnalysis(report) {
        const bands = report.bands;
        const html = `
            <div class="analysis-card">
                <h3>💫 Anatomía de tu Pulso</h3>
                <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:1rem;line-height:1.6">
                    Cada capa de pétalos representa una banda de frecuencia cerebral.
                    El tamaño de los pétalos es proporcional a la potencia relativa de cada banda.
                </p>
                <div class="band-detail-grid">
                    ${bands.map(band => renderBandCard(band)).join('')}
                </div>
            </div>
            <div class="analysis-card pulse-meaning-card">
                <h3>🌺 Lectura de tu Pulso</h3>
                <div class="pulse-meaning-text">
                    ${report.interpretation || 'Carga un archivo EEG para ver la interpretación.'}
                </div>
            </div>
        `;
        analysisContent.innerHTML = html;
        if (report.emotionMetrics && report.emotionMetrics.length) {
            renderEmotionChart(report.emotionMetrics);
        }
    }

    // ── Emotion Bar Chart ──
    function renderEmotionChart(emotions) {
        // Insert before the first .analysis-card inside analysisContent
        const container = document.createElement('div');
        container.className = 'emotion-chart';
        container.innerHTML = `
            <div class="emotion-chart-title">✨ Tu Estado Emocional</div>
            ${emotions.map((e, i) => `
                <div class="emotion-row" style="--delay:${i * 60}ms">
                    <span class="emotion-emoji" title="${e.description}">${e.emoji}</span>
                    <span class="emotion-label">${e.label}</span>
                    <div class="emotion-bar-track">
                        <div class="emotion-bar-fill" data-target="${Math.round(e.value * 100)}"
                             style="background:linear-gradient(90deg,${e.color},${e.colorDeep})">
                        </div>
                    </div>
                    <span class="emotion-value">${Math.round(e.value * 100)}%</span>
                </div>
            `).join('')}
        `;
        analysisContent.insertBefore(container, analysisContent.firstChild);

        // Animate bars after a short paint delay
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                container.querySelectorAll('.emotion-bar-fill').forEach((fill, i) => {
                    const target = fill.dataset.target;
                    setTimeout(() => {
                        fill.style.width = target + '%';
                    }, i * 60);
                });
            });
        });
    }

    function renderBandCard(band) {
        return `
            <div class="band-detail-card" data-band="${band.key}">
                <div class="band-header">
                    <div class="band-color-circle" style="background: linear-gradient(135deg, ${band.colorLight}, ${band.color}, ${band.colorDeep})"></div>
                    <div>
                        <div class="band-title">${band.emoji} ${band.name}</div>
                        <div class="band-range">${band.low}–${band.high} Hz</div>
                    </div>
                    <div class="band-pct" style="margin-left:auto">${band.percentage.toFixed(1)}%</div>
                </div>
                <div class="band-power-bar">
                    <div class="band-power-fill" style="width:${Math.max(3, band.percentage)}%;background:linear-gradient(90deg, ${band.color}, ${band.colorDeep})"></div>
                </div>
                <div class="band-meaning">
                    <strong>${band.meaning}</strong><br>
                    ${band.petalMeaning || ''}
                </div>
            </div>
        `;
    }



    // ── Export 3D ──
    if (btnExport3d) {
        btnExport3d.addEventListener('click', async () => {
            if (!pulse3d) {
                showExportStatus('⚠️ Primero carga un archivo EEG y abre la pestaña 3D.', 'warn');
                return;
            }

            const selectedSize = Number(printSizeSelect?.value || 120);
            const format = printExportFormat?.value || 'glb+3mf';

            btnExport3d.disabled = true;
            btnExport3d.innerHTML = '<span class="spinner"></span> Convirtiendo con Python local…';
            showExportStatus('⏳ Generando modelo y enviando a Python local…', 'info');

            try {
                const geometry = pulse3d.exportGeometryJSON(selectedSize);

                const response = await fetch('/api/convert-pulse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        geometry,
                        format,
                        targetHeightMm: selectedSize,
                    }),
                });

                if (!response.ok) {
                    let message = `Error HTTP ${response.status}`;
                    try {
                        const errData = await response.json();
                        if (errData?.error) message = errData.error;
                    } catch (_) { }
                    throw new Error(message);
                }

                const blob = await response.blob();
                const filename = `pulso_neurofuncional_${selectedSize}mm_${format.replace('+', '_')}.zip`;
                downloadBlob(blob, filename);

                const instrEl = document.getElementById('export-instructions');
                if (instrEl) instrEl.style.display = 'none';

                showExportStatus('✅ Conversión completada con Python. ZIP descargado.', 'success');
            } catch (err) {
                console.error('Export error:', err);
                const instrEl = document.getElementById('export-instructions');
                if (instrEl) instrEl.style.display = 'flex';
                showExportStatus(
                    '❌ No se pudo conectar al convertidor Python local.',
                    'error'
                );
            } finally {
                btnExport3d.disabled = false;
                btnExport3d.innerHTML = '🖨️ Exportar y convertir para impresión 3D';
            }
        });
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function showExportStatus(message, type) {
        const el = document.getElementById('export-status');
        if (!el) return;
        el.textContent = message;
        el.className = 'export-status export-status--' + type;
        el.style.display = 'block';
        if (type === 'info') {
            clearTimeout(el._timer);
            el._timer = setTimeout(() => { el.style.display = 'none'; }, 8000);
        }
    }

    // ── Back Button (now New Capture in pulse detail) ──
    const pulseNewCaptureBtn = document.getElementById('pulse-btn-new-capture');
    if (pulseNewCaptureBtn) {
        pulseNewCaptureBtn.addEventListener('click', () => {
            stopGardenMidiPlayback();
            if (midiLinkedPulse) { midiLinkedPulse.stop(); midiLinkedPulse = null; }
            if (gardenAudioContext && gardenAudioContext.state === 'running') {
                gardenAudioContext.suspend().catch(() => {});
            }
            if (pulse3d) { pulse3d.destroy(); pulse3d = null; }
            if (pulse2d) { pulse2d.stop(); pulse2d = null; }
            pulseAnalyzer = null;
            pulseMainContent.style.display = 'none';
            pulseUploadSection.style.display = 'none';
            resultsSection.style.display = 'none';
            setupSection.style.display = 'flex';
            lastCaptureData = null;
            captureWaveBuffer = { 0: [], 1: [], 2: [], 3: [] };
            // Switch view to capture + respawn animation
            globalTabs.forEach(t => t.classList.toggle('active', t.dataset.view === 'capture'));
            views.forEach(v => v.classList.toggle('active', v.id === 'view-capture'));
            setTimeout(() => {
                spawnFloatingLines();
                startTour(captureSetupTourSteps);
            }, 60);
        });
    }

    // ── Go to Garden from Pulse Detail ──
    const pulseGoGardenBtn = document.getElementById('pulse-btn-go-garden');
    if (pulseGoGardenBtn) {
        pulseGoGardenBtn.addEventListener('click', async () => {
            stopGardenMidiPlayback();
            if (midiLinkedPulse) { midiLinkedPulse.stop(); midiLinkedPulse = null; }
            if (gardenAudioContext && gardenAudioContext.state === 'running') {
                gardenAudioContext.suspend().catch(() => {});
            }

            // Stop current pulse animations
            if (pulse3d) { pulse3d.destroy(); pulse3d = null; }
            if (pulse2d) { pulse2d.stop(); pulse2d = null; }
            pulseAnalyzer = null;

            // Get latest capture to know which one to animate
            let latestFilename = null;
            try {
                const resp = await fetch('/api/garden/latest');
                const data = await resp.json();
                if (data.ok && data.capture) {
                    latestFilename = data.capture.filename;
                }
            } catch (err) {
                console.warn('Could not fetch latest capture:', err);
            }

            // Switch to garden view
            globalTabs.forEach(t => t.classList.toggle('active', t.dataset.view === 'garden'));
            views.forEach(v => v.classList.toggle('active', v.id === 'view-garden'));

            // Load garden with animation for the latest profile
            let animateProfile = null;
            if (latestFilename) {
                try {
                    const latestResp = await fetch(`/api/garden/file?name=${encodeURIComponent(latestFilename)}`);
                    if (latestResp.ok) {
                        const latestData = await latestResp.json();
                        animateProfile = latestData.metadata?.profile_name || latestData.metadata?.user_name || null;
                    }
                } catch (err) {
                    console.warn('Could not fetch latest capture data:', err);
                }
            }
            gardenLoaded = false;
            await loadGarden(animateProfile);
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    // GARDEN VIEW
    // ══════════════════════════════════════════════════════════════════════

    const gardenStatus = document.getElementById('garden-status');
    const gardenStatusContent = document.getElementById('garden-status-content');
    const gardenModal = document.getElementById('garden-modal');
    const gardenModalClose = document.getElementById('garden-modal-close');
    const gardenModalTitle = document.getElementById('garden-modal-title');
    const gardenModalMeta = document.getElementById('garden-modal-meta');
    const gardenBtnDownloadMidi = document.getElementById('garden-btn-download-midi');
    const gardenModalTabs = document.querySelectorAll('#garden-modal-tabs .tab');
    const gardenPanels = document.querySelectorAll('.garden-modal-panel');
    let gardenLoaded = false;
    let gardenLoadRequestId = 0;
    let galaxyGarden = null;
    let gardenPulse2d = null;
    let gardenPulseModal3d = null;
    let midiLinkedPulse = null;
    let gardenAnalyzer = null;
    let gardenCurrentFile = null;
    let gardenCurrentJson = null;
    let gardenCurrentProfileName = null;
    let gardenCurrentProfileData = null;
    let gardenAudioContext    = null;
    let gardenMidiTimeouts   = [];
    let gardenMidiNodes      = [];      // active AudioNodes for cleanup
    let gardenMidiLoopTimeout = null;
    let gardenMidiLoopId     = 0;
    let gardenInstruments    = {};      // loaded soundfont instruments by name
    let gardenReverbNode     = null;    // ConvolverNode for ambient reverb
    let gardenReverbGain     = null;    // reverb wet level
    let gardenDryGain        = null;    // dry level
    let gardenMasterGain     = null;    // master output
    let gardenMidiFinished   = false;   // true when MIDI playback finished
    let gardenMidiPlaying   = false;   // true when MIDI is playing
    let gardenMidiEndTimeout = null;    // timeout to detect MIDI end
    let currentPlaybackCaptureData = null; // capture data for replay
    const gardenSoundfontFallbackLogged = new Set();

    function startLinkedPulseForMidiReplay() {
        const garden2DActive = document.getElementById('gpanel-garden-2d')?.classList.contains('active');
        const gardenVisible = gardenModal && gardenModal.style.display !== 'none';
        const pulseVisible = pulseMainContent && pulseMainContent.style.display !== 'none';
        let activePulse = null;

        if (gardenVisible && garden2DActive && gardenPulse2d) {
            activePulse = gardenPulse2d;
        } else if (pulseVisible && currentPulseTab === 'pulse2d' && pulse2d) {
            activePulse = pulse2d;
        } else {
            activePulse = midiLinkedPulse || gardenPulse2d || pulse2d;
        }

        if (!activePulse) return;
        midiLinkedPulse = activePulse;
        activePulse.start();
    }

    // Helper to toggle overlay messages
    function showGardenStatus(icon, text) {
        gardenStatus.style.display = 'flex';
        gardenStatusContent.innerHTML = `
            <div class="garden-loading-icon">${icon}</div>
            <p>${text}</p>
        `;
    }

    function hideGardenStatus() {
        gardenStatus.style.display = 'none';
    }

    function waitForNextFrame() {
        return new Promise(resolve => requestAnimationFrame(resolve));
    }

    async function waitForGardenLayout() {
        const container = document.getElementById('garden-2d-scene');
        if (!container) return;
        for (let i = 0; i < 4; i++) {
            await waitForNextFrame();
            const rect = container.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return;
        }
    }

    async function loadGarden(animateProfileName = null) {
        const requestId = ++gardenLoadRequestId;
        showGardenStatus('🌌', 'Analizando capturas para tu campo resonante...');

        try {
            const resp = await fetch('/api/profiles/list');
            const data = await resp.json();
            if (requestId !== gardenLoadRequestId) return;

            if (!data.ok || !data.profiles || data.profiles.length === 0) {
                showGardenStatus('🌌', 'Tu campo resonante está vacío.<br><br>Realiza tu primera captura EEG para plantar la primera pulso.');
                return;
            }

            hideGardenStatus();

            const container = document.getElementById('garden-2d-scene');
            container.innerHTML = '';

            if (galaxyGarden) { galaxyGarden.destroy(); galaxyGarden = null; }
            await waitForGardenLayout();
            if (requestId !== gardenLoadRequestId) return;

            galaxyGarden = new GalaxyGarden('garden-2d-scene', (profileData) => {
                openProfileModal(profileData);
            });
            galaxyGarden.init();
            requestAnimationFrame(() => {
                if (galaxyGarden && !galaxyGarden._destroyed) galaxyGarden._onResize();
            });

            gardenLoaded = true;
            await galaxyGarden.loadProfiles(data.profiles, animateProfileName);
        } catch (err) {
            console.error('Error loading garden:', err);
            if (requestId === gardenLoadRequestId) {
                gardenLoaded = false;
                showGardenStatus('⚠️', 'Error al cargar el campo resonante. Intenta actualizar.');
            }
        }
    }

    // ─── Garden search filter ──────────────────────────────────────────────
    const gardenSearchInput = document.getElementById('garden-search-input');
    if (gardenSearchInput) {
        gardenSearchInput.addEventListener('input', () => {
            if (galaxyGarden) galaxyGarden.filterByName(gardenSearchInput.value);
        });
        // Clear filter on focus if user presses Escape
        gardenSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                gardenSearchInput.value = '';
                if (galaxyGarden) galaxyGarden.filterByName('');
                gardenSearchInput.blur();
            }
        });
    }

    // ── Open Profile Modal (new main entry point) ──
    async function openProfileModal(profileData) {
        if (!profileData) return;

        const profileName = profileData.profile_name || profileData.metadata?.user_name || 'Anónimo';
        gardenCurrentProfileName = profileName;
        gardenCurrentProfileData = profileData;

        // Reset capture-specific state
        gardenCurrentJson = null;
        gardenCurrentFile = null;

        gardenModalTitle.textContent = `Perfil de ${profileName}`;
        gardenModalMeta.textContent = 'Cargando capturas...';

        // Disable tabs/actions until capture is selected
        const tab2d = document.getElementById('gtab-2d');
        const tabAnalysis = document.getElementById('gtab-analysis');
        if (tab2d) tab2d.disabled = true;
        if (tabAnalysis) tabAnalysis.disabled = true;

        const gardenBtnDlMidi = document.getElementById('garden-btn-download-midi');
        if (gardenBtnDlMidi) gardenBtnDlMidi.disabled = true;

        // Switch tabs to captures
        gardenModalTabs.forEach(t => t.classList.toggle('active', t.dataset.gtab === 'garden-captures'));
        gardenPanels.forEach(p => p.classList.toggle('active', p.id === 'gpanel-garden-captures'));

        gardenModal.style.display = 'flex';

        // Stop previous pulse
        if (gardenPulse2d) { gardenPulse2d.stop(); gardenPulse2d = null; }
        stopGardenMidiPlayback();

        const embeddedCaptures = profileData._profileMeta?.captures || profileData.captures || [];
        if (embeddedCaptures.length) {
            const captureCount = embeddedCaptures.length;
            gardenModalMeta.textContent = `${captureCount} captura${captureCount !== 1 ? 's' : ''} · última: ${embeddedCaptures[0]?.capture_timestamp || '—'}`;
            renderProfileCapturesList(embeddedCaptures);
            return;
        }

        // Fallback for old profile payloads.
        try {
            const resp = await fetch(`/api/profiles/captures?name=${encodeURIComponent(profileName)}`);
            const data = await resp.json();
            if (!data.ok) throw new Error(data.error);

            const captureCount = data.captures.length;
            gardenModalMeta.textContent = `${captureCount} captura${captureCount !== 1 ? 's' : ''} · última: ${data.captures[0]?.capture_timestamp || '—'}`;

            renderProfileCapturesList(data.captures);
        } catch (err) {
            console.error('Error loading profile captures:', err);
            const listEl = document.getElementById('profile-captures-list');
            if (listEl) listEl.innerHTML = '<p class="captures-loading">Error al cargar capturas.</p>';
        }
    }

    function renderProfileCapturesList(captures) {
        const listEl = document.getElementById('profile-captures-list');
        if (!listEl) return;

        if (!captures || !captures.length) {
            listEl.innerHTML = '<p class="captures-loading">No hay capturas en este perfil.</p>';
            return;
        }

        listEl.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'capture-thumb-grid';
        listEl.appendChild(grid);

        captures.forEach((cap, idx) => {
            const ts = cap.capture_timestamp || '—';
            const state = cap.user_state || '';

            const card = document.createElement('div');
            card.className = 'capture-thumb-card';
            card.dataset.filename = cap.filename;

            const canvasWrap = document.createElement('div');
            canvasWrap.className = 'capture-thumb-canvas-wrap';
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 200;
            canvas.className = 'capture-thumb-canvas';
            canvasWrap.appendChild(canvas);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'capture-thumb-delete';
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.title = 'Eliminar captura';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                confirmDeleteCapture(cap.filename);
            });
            canvasWrap.appendChild(deleteBtn);

            const label = document.createElement('div');
            label.className = 'capture-thumb-label';
            label.innerHTML = `<span class="capture-thumb-date">${escapeHtml(ts)}</span>`
                + (state ? `<span class="capture-thumb-state">${escapeHtml(state)}</span>` : '');

            card.appendChild(canvasWrap);
            card.appendChild(label);
            grid.appendChild(card);

            card.addEventListener('click', () => loadCaptureIntoModal(cap.filename));

            renderCaptureThumbnail(canvas, cap.filename, idx);
        });
    }

    async function renderCaptureThumbnail(canvas, filename, idx) {
        try {
            const resp = await fetch(`/api/garden/file?name=${encodeURIComponent(filename)}`);
            if (!resp.ok) return;
            const data = await resp.json();
            const analyzer = new EEGBandAnalyzer(data);
            const pulse = new LavaPulse(canvas, analyzer);
            pulse.t = pulse._startFrame + idx * 137;
            for (let i = 0; i < 5; i++) pulse._drawSafe();
            pulse.stop();
        } catch (err) {
            console.error('Thumbnail render error:', err);
        }
    }

    async function loadCaptureIntoModal(filename) {
        try {
            const resp = await fetch(`/api/garden/file?name=${encodeURIComponent(filename)}`);
            if (!resp.ok) throw new Error('No se pudo cargar la captura');
            const data = await resp.json();
            data.filename = filename;
            openGardenModalFromData(data, true);
        } catch (err) {
            console.error(err);
            alert('Error al cargar la captura: ' + err.message);
        }
    }

    // This handles clicks from the 3D garden raycaster which gives full capture data.
    // When fromProfileList=true it's called from the captures list inside an open profile modal.
    function openGardenModalFromData(captureData, fromProfileList = false) {
        if (!captureData) return;

        const filename = captureData.filename || 'capture.json';

        gardenCurrentJson = captureData;
        gardenCurrentFile = filename;

        if (!fromProfileList) {
            // Legacy/direct entry: profile_name may or may not exist
            const profileName = captureData.profile_name ||
                                captureData.metadata?.profile_name ||
                                captureData.metadata?.user_name || 'Anónimo';
            gardenCurrentProfileName = profileName;
            gardenModalTitle.textContent = `Perfil de ${profileName}`;
        }

        // Enable tabs
        const tab2d = document.getElementById('gtab-2d');
        const tabAnalysis = document.getElementById('gtab-analysis');
        if (tab2d) tab2d.disabled = false;
        if (tabAnalysis) tabAnalysis.disabled = false;

        const gardenBtnDlMidi = document.getElementById('garden-btn-download-midi');
        if (gardenBtnDlMidi) gardenBtnDlMidi.disabled = false;

        // Initialize Analyzer for Modal Views
        gardenAnalyzer = new EEGBandAnalyzer(captureData);

        // Prepare 2D (LavaPulse animated)
        const canvas2dGarden = document.getElementById('garden-pulse-2d-canvas');
        if (gardenPulse2d) { gardenPulse2d.stop(); gardenPulse2d = null; }
        gardenPulse2d = new LavaPulse(canvas2dGarden, gardenAnalyzer);

        if (gardenPulseModal3d) {
            gardenPulseModal3d.destroy();
            gardenPulseModal3d = null;
        }

        // Render Analysis Report
        const report = gardenAnalyzer.getReport();
        const gardenAnalysisContent = document.getElementById('garden-analysis-content');
        gardenAnalysisContent.innerHTML = renderGardenAnalysisHTML(report);

        // Switch to 2D tab
        gardenModalTabs.forEach(t => t.classList.toggle('active', t.dataset.gtab === 'garden-2d'));
        gardenPanels.forEach(p => p.classList.toggle('active', p.id === 'gpanel-garden-2d'));

        gardenModal.style.display = 'flex';
        fitPulseCanvas(canvas2dGarden);
        gardenPulse2d.start();
        midiLinkedPulse = gardenPulse2d;

        void playGardenMidi(captureData);
    }

    // Keep the old signature but redirect
    async function openGardenModal(captureMeta) {
        try {
            const resp = await fetch(`/api/garden/file?name=${encodeURIComponent(captureMeta.filename)}`);
            if (!resp.ok) throw new Error('Failed to load JSON');
            const data = await resp.json();
            data.filename = captureMeta.filename; // Inject for consistency
            openGardenModalFromData(data);
        } catch (err) {
            console.error(err);
        }
    }

    function stopGardenMidiPlayback() {
        if (gardenMidiLoopTimeout !== null) {
            clearTimeout(gardenMidiLoopTimeout);
            gardenMidiLoopTimeout = null;
        }
        if (gardenMidiEndTimeout !== null) {
            clearTimeout(gardenMidiEndTimeout);
            gardenMidiEndTimeout = null;
        }
        gardenMidiLoopId += 1;

        gardenMidiTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        gardenMidiTimeouts = [];

        gardenMidiNodes.forEach(node => {
            try { node.stop(); } catch (_) { }
            try { node.disconnect(); } catch (_) { }
        });
        gardenMidiNodes = [];

        gardenMidiFinished = false;
        gardenMidiPlaying = false;
        showReplayButtons(false);
    }

    function showReplayButtons(show) {
        const btnReplayMidi = document.getElementById('btn-replay-midi');
        const gardenBtnReplayMidi = document.getElementById('garden-btn-replay-midi');
        if (btnReplayMidi) btnReplayMidi.style.display = show ? 'inline-flex' : 'none';
        if (gardenBtnReplayMidi) gardenBtnReplayMidi.style.display = show ? 'inline-flex' : 'none';
    }

    function reduceTrackNotes(trackNotes, maxNotes) {
        if (trackNotes.length <= maxNotes) return trackNotes;
        if (maxNotes <= 1) return [trackNotes[0]];

        const reduced = [];
        const step = (trackNotes.length - 1) / (maxNotes - 1);
        for (let i = 0; i < maxNotes; i++) {
            const idx = Math.round(i * step);
            reduced.push(trackNotes[idx]);
        }
        return reduced;
    }

    /**
     * Snap a MIDI note number to the nearest note in C-major pentatonic scale.
     * Pentatonic intervals: C(0) D(2) E(4) G(7) A(9)
     */
    function quantizeToPentatonic(midiNote) {
        const octave = Math.floor(midiNote / 12);
        const pc     = midiNote % 12;                        // pitch class 0–11
        // find the nearest pentatonic pitch class
        let bestPc = 0, bestDist = 99;
        for (const p of GARDEN_PENTATONIC) {
            const dist = Math.min(Math.abs(pc - p), 12 - Math.abs(pc - p));
            if (dist < bestDist) { bestDist = dist; bestPc = p; }
        }
        return octave * 12 + bestPc;
    }

    function buildGardenPlaybackPlan(midi) {
        const tracks = Array.isArray(midi?.tracks) ? midi.tracks : [];
        const playableTracks = tracks
            .map((track, trackIdx) => {
                const channel = Number.isInteger(track?.channel) ? track.channel : (trackIdx % 4);
                const notes = Array.isArray(track?.notes) ? track.notes : [];
                if (!notes.length) return null;

                const normalizedNotes = notes.map(note => ({
                    time: Math.max(0, Number(note.time) || 0),
                    duration: Math.max(0.01, Number(note.duration) || 0.25),
                    velocity: Math.max(0.05, Number(note.velocity) || 0.24),
                    midi: Number(note.midi) || 60,
                    channel,
                }));

                return reduceTrackNotes(normalizedNotes, GARDEN_PLAYBACK_MAX_NOTES_PER_TRACK);
            })
            .filter(Boolean);

        if (!playableTracks.length) return null;

        let notes = playableTracks.flat().sort((a, b) => a.time - b.time);
        if (!notes.length) return null;

        // ── Musical post-processing ──────────────────────────────────────
        // 1) Quantize all pitches to pentatonic scale, clamp to warm range
        notes = notes.map(n => ({
            ...n,
            midi:     Math.max(48, Math.min(84, quantizeToPentatonic(n.midi))),  // C3–C6
            duration: Math.max(GARDEN_PLAYBACK_MIN_NOTE_DURATION,
                      Math.min(GARDEN_PLAYBACK_MAX_NOTE_DURATION, n.duration * 3)),
            velocity: Math.max(0.15, Math.min(0.55, n.velocity * 0.85)),  // balanced
        }));

        // 2) Enforce minimum spacing: drop notes too close together per-channel
        const lastTimeByChannel = {};
        notes = notes.filter(n => {
            const key = n.channel;
            const prev = lastTimeByChannel[key] ?? -Infinity;
            if (n.time - prev < GARDEN_PLAYBACK_MIN_SPACING) return false;
            lastTimeByChannel[key] = n.time;
            return true;
        });

        const fallbackDuration = notes.reduce((mx, n) => Math.max(mx, n.time + n.duration), 0);
        const totalDuration = Math.max(Number(midi?.duration) || 0, fallbackDuration, 0.5);

        // Apply speed factor: compress note times and total duration
        const speedFactor = GARDEN_PLAYBACK_SPEED;
        const speedNotes = notes.map(n => ({ ...n, time: n.time / speedFactor }));
        return { notes: speedNotes, totalDuration: totalDuration / speedFactor };
    }

    function scheduleGardenMidiLoop(ctx, playbackPlan, playbackId) {
        if (!playbackPlan || !Array.isArray(playbackPlan.notes) || !playbackPlan.notes.length) return;
        if (playbackId !== gardenMidiLoopId) return;

        const notes = playbackPlan.notes;
        const loopDuration = playbackPlan.totalDuration;
        const baseTime = ctx.currentTime + 0.05;
        gardenMidiTimeouts = [];

        // Resolve instrument per channel
        const resolvedInstruments = GARDEN_INSTRUMENTS.map(
            name => gardenInstruments[name] || gardenInstruments[GARDEN_INSTRUMENTS[0]]
        );

        // Fallback: if no instruments loaded, skip silently
        if (!resolvedInstruments[0]) {
            console.warn('Garden MIDI: instrument not loaded, skipping playback');
            return;
        }

        notes.forEach(note => {
            const delayMs = Math.max(0, (baseTime - ctx.currentTime + note.time) * 1000);

            const timeoutId = setTimeout(() => {
                if (playbackId !== gardenMidiLoopId) return;

                const channelIdx = Math.max(0, note.channel % 4);
                const instrument = resolvedInstruments[channelIdx];
                const gain       = note.velocity || 0.12;      // already processed by buildGardenPlaybackPlan
                const duration   = note.duration  || 0.5;      // already clamped/stretched
                const midiValue  = note.midi || 60;
                const pan        = GARDEN_CHANNEL_PAN[channelIdx];

                try {
                    // soundfont-player .play() returns an AudioNode we can route
                    const player = instrument.play(midiValue, ctx.currentTime, {
                        duration: duration,
                        gain:     gain,
                    });

                    if (player) {
                        // Route through panner → dry + reverb buses
                        // Disconnect from default destination first
                        try { player.disconnect(); } catch (_) {}

                        if (typeof ctx.createStereoPanner === 'function' && gardenDryGain) {
                            const panner = ctx.createStereoPanner();
                            panner.pan.setValueAtTime(pan, ctx.currentTime);
                            player.connect(panner);
                            panner.connect(gardenDryGain);
                            if (gardenReverbNode) {
                                panner.connect(gardenReverbNode);
                            }
                        } else if (gardenDryGain) {
                            player.connect(gardenDryGain);
                        }
                        // else: player stays connected to destination (soundfont default)

                        gardenMidiNodes.push(player);

                        // Cleanup reference after note ends
                        const cleanupId = setTimeout(() => {
                            const idx = gardenMidiNodes.indexOf(player);
                            if (idx >= 0) gardenMidiNodes.splice(idx, 1);
                        }, (duration + 0.5) * 1000);
                        gardenMidiTimeouts.push(cleanupId);
                    }
                } catch (e) {
                    console.warn('Garden MIDI note error:', e);
                }

            }, delayMs);

            gardenMidiTimeouts.push(timeoutId);
        });

        // No loop - MIDI plays once. Set timeout to detect end and show replay button
        const endTimeMs = (loopDuration + 1.0) * 1000;
        gardenMidiEndTimeout = setTimeout(() => {
            if (playbackId === gardenMidiLoopId) {
                gardenMidiFinished = true;
                gardenMidiPlaying = false;
                showReplayButtons(true);
                if (midiLinkedPulse) { midiLinkedPulse.stop(); midiLinkedPulse = null; }
            }
        }, endTimeMs);
        gardenMidiTimeouts.push(gardenMidiEndTimeout);
    }

    /**
     * Create (or resume) the AudioContext, set up the reverb/dry/master bus,
     * and pre-load all soundfont instruments needed for playback.
     * Returns { ctx, instruments } so callers can await everything.
     */
    async function loadGardenSoundfontInstrument(ctx, name) {
        const candidates = [...new Set([
            name,
            ...(GARDEN_INSTRUMENT_FALLBACKS[name] || []),
            ...GARDEN_DEFAULT_INSTRUMENT_FALLBACKS,
        ])];
        let lastError = null;

        for (const candidate of candidates) {
            try {
                const inst = await Soundfont.instrument(ctx, candidate, {
                    soundfont: 'MusyngKite',
                    gain: 1.0,
                });
                if (candidate !== name && !gardenSoundfontFallbackLogged.has(name)) {
                    gardenSoundfontFallbackLogged.add(name);
                    console.warn(`Garden MIDI: soundfont "${name}" unavailable, using "${candidate}".`);
                }
                return inst;
            } catch (e) {
                lastError = e;
            }
        }

        console.warn(`Garden MIDI: no soundfont available for "${name}".`, lastError);
        return null;
    }

    async function getGardenAudioContext() {
        if (!gardenAudioContext) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) throw new Error('Web Audio API no disponible');
            gardenAudioContext = new Ctx();
        }
        if (gardenAudioContext.state === 'suspended') {
            await gardenAudioContext.resume();
        }

        const ctx = gardenAudioContext;

        // ── Build audio bus (once) ─────────────────────────────────────────
        if (!gardenMasterGain) {
            gardenMasterGain = ctx.createGain();
            gardenMasterGain.gain.value = 1.3;
            gardenMasterGain.connect(ctx.destination);

            // Dry path
            gardenDryGain = ctx.createGain();
            gardenDryGain.gain.value = 0.85;
            gardenDryGain.connect(gardenMasterGain);

            // Reverb path (ConvolverNode with synthetic impulse response)
            try {
                gardenReverbNode = ctx.createConvolver();
                const irLength = ctx.sampleRate * 2.2;   // 2.2-second reverb tail
                const irBuffer = ctx.createBuffer(2, irLength, ctx.sampleRate);
                for (let ch = 0; ch < 2; ch++) {
                    const data = irBuffer.getChannelData(ch);
                    for (let i = 0; i < irLength; i++) {
                        // Exponential decay with slight randomness for natural diffusion
                        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLength, 2.8);
                    }
                }
                gardenReverbNode.buffer = irBuffer;

                gardenReverbGain = ctx.createGain();
                gardenReverbGain.gain.value = 0.45;      // wet level
                gardenReverbNode.connect(gardenReverbGain);
                gardenReverbGain.connect(gardenMasterGain);
            } catch (e) {
                console.warn('Garden reverb creation failed, using dry only:', e);
                gardenReverbNode = null;
                gardenReverbGain = null;
            }
        }

        // ── Load soundfont instruments (once) ──────────────────────────────
        if (typeof Soundfont !== 'undefined' && Object.keys(gardenInstruments).length === 0) {
            const uniqueNames = [...new Set(GARDEN_INSTRUMENTS)];
            const loadPromises = uniqueNames.map(async (name) => {
                const inst = await loadGardenSoundfontInstrument(ctx, name);
                if (inst) gardenInstruments[name] = inst;
            });
            await Promise.all(loadPromises);
        }

        return ctx;
    }

    async function playGardenMidi(captureData) {
        if (!captureData || typeof Midi === 'undefined') return;

        // Snapshot the generation counter so we can detect cancellation during awaits
        const startLoopId = gardenMidiLoopId;

        // Store capture data for replay and reset state
        currentPlaybackCaptureData = captureData;
        gardenMidiFinished = false;
        gardenMidiPlaying = true;
        showReplayButtons(false);

        try {
            // Fetch MIDI binary from the server
            const resp = await fetch('/api/json-to-midi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonData: captureData }),
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.error || 'No se pudo generar MIDI');
            }

            // If modal was closed (or a newer playback started) while fetching, abort
            if (startLoopId !== gardenMidiLoopId) return;

            const midi = new Midi(await resp.arrayBuffer());
            const playbackPlan = buildGardenPlaybackPlan(midi);
            if (!playbackPlan) return;

            // Init audio context, reverb bus, and load soundfont instruments
            const ctx = await getGardenAudioContext();

            // Check again after the async context init
            if (startLoopId !== gardenMidiLoopId) return;

            // Verify at least one instrument loaded
            const instrumentName = GARDEN_INSTRUMENTS[0];
            if (!gardenInstruments[instrumentName]) {
                console.warn('Garden MIDI: soundfont instruments not available. Playback skipped.');
                return;
            }

            stopGardenMidiPlayback();
            const playbackId = gardenMidiLoopId;
            gardenMidiPlaying = true;
            scheduleGardenMidiLoop(ctx, playbackPlan, playbackId);
        } catch (err) {
            console.error('Error reproduciendo MIDI del campo resonante:', err);
        }
    }

    function renderGardenAnalysisHTML(report) {
        const bands = report.bands;
        return `
        <div class="analysis-card">
            <h3>💫 Anatomía de tu Pulso</h3>
            <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:1rem;line-height:1.6">
                Cada capa de pétalos representa una banda de frecuencia cerebral calculada con precisión desde tu captura.
            </p>
            <div class="band-detail-grid">
                ${bands.map(band => renderBandCard(band)).join('')}
            </div>
        </div>
        <div class="analysis-card pulse-meaning-card">
            <h3>🌺 Lectura de tu Pulso</h3>
            <div class="pulse-meaning-text">
                ${report.interpretation || 'Sin interpretación disponible.'}
            </div>
        </div>
        `;
    }

    // Close modal
    if (gardenModalClose) {
        gardenModalClose.addEventListener('click', closeGardenModal);
    }
    gardenModal?.addEventListener('click', (e) => {
        if (e.target === gardenModal) closeGardenModal();
    });

    function closeGardenModal() {
        stopGardenMidiPlayback();
        if (gardenAudioContext && gardenAudioContext.state === 'running') {
            gardenAudioContext.suspend().catch(() => {});
        }
        gardenModal.style.display = 'none';
        if (midiLinkedPulse === gardenPulse2d) midiLinkedPulse = null;
        if (gardenPulse2d) { gardenPulse2d.stop(); gardenPulse2d = null; }
        if (gardenPulseModal3d) {
            gardenPulseModal3d.destroy();
            gardenPulseModal3d = null;
        }
        gardenCurrentProfileName = null;
        gardenCurrentProfileData = null;
        gardenCurrentFile = null;
        gardenCurrentJson = null;
        // Re-disable tabs
        const tab2d = document.getElementById('gtab-2d');
        const tabAnalysis = document.getElementById('gtab-analysis');
        if (tab2d) tab2d.disabled = true;
        if (tabAnalysis) tabAnalysis.disabled = true;
    }

    // Modal tabs
    gardenModalTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.disabled) return;
            const tabName = tab.dataset.gtab;
            gardenModalTabs.forEach(t => t.classList.toggle('active', t.dataset.gtab === tabName));
            gardenPanels.forEach(p => p.classList.toggle('active', p.id === `gpanel-${tabName}`));

            // Resume/pause LavaPulse depending on tab
            if (tabName === 'garden-2d') {
                if (gardenPulse2d) {
                    fitPulseCanvas(document.getElementById('garden-pulse-2d-canvas'));
                    gardenPulse2d.start();
                }
            } else {
                if (gardenPulse2d) gardenPulse2d.stop();
            }

            // Stop MIDI when leaving current pulse detail back to captures
            if (tabName === 'garden-captures') {
                stopGardenMidiPlayback();
                if (gardenAudioContext && gardenAudioContext.state === 'running') {
                    gardenAudioContext.suspend().catch(() => {});
                }
            }
        });
    });

    if (gardenBtnDownloadMidi) {
        gardenBtnDownloadMidi.addEventListener('click', async () => {
            if (!gardenCurrentJson) return;
            gardenBtnDownloadMidi.disabled = true;
            gardenBtnDownloadMidi.textContent = 'Generando MIDI...';

            try {
                const resp = await fetch('/api/json-to-midi', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonData: gardenCurrentJson }),
                });

                if (!resp.ok) {
                    const err = await resp.json();
                    alert('Error: ' + (err.error || 'No se pudo generar MIDI'));
                    return;
                }

                const blob = await resp.blob();
                const safeName = (gardenCurrentFile || 'eeg').replace('.json', '');
                downloadBlob(blob, `${safeName}.mid`);
            } catch (err) {
                alert('Error: ' + err.message);
            } finally {
                gardenBtnDownloadMidi.disabled = false;
                gardenBtnDownloadMidi.innerHTML = '<span>🎵</span> Descargar MIDI';
            }
        });
    }

    // ── Garden: Replay MIDI ──
    const gardenBtnReplayMidi = document.getElementById('garden-btn-replay-midi');
    if (gardenBtnReplayMidi) {
        gardenBtnReplayMidi.addEventListener('click', () => {
            if (currentPlaybackCaptureData) {
                startLinkedPulseForMidiReplay();
                playGardenMidi(currentPlaybackCaptureData);
            }
        });
    }

    // ── Garden: Rename pulse ──
    const gardenBtnRename = document.getElementById('garden-btn-rename');
    const renameModal = document.getElementById('rename-modal');
    const renameInput = document.getElementById('rename-input');
    const renameBtnCancel = document.getElementById('rename-btn-cancel');
    const renameBtnConfirm = document.getElementById('rename-btn-confirm');

    if (gardenBtnRename) {
        gardenBtnRename.addEventListener('click', () => {
            if (!gardenCurrentProfileName) return;
            renameInput.value = gardenCurrentProfileName;
            renameModal.style.display = 'flex';
            setTimeout(() => renameInput.focus(), 100);
        });
    }

    if (renameBtnCancel) {
        renameBtnCancel.addEventListener('click', () => {
            renameModal.style.display = 'none';
        });
    }

    renameModal?.addEventListener('click', (e) => {
        if (e.target === renameModal) renameModal.style.display = 'none';
    });

    renameInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') renameBtnConfirm?.click();
        if (e.key === 'Escape') renameModal.style.display = 'none';
    });

    if (renameBtnConfirm) {
        renameBtnConfirm.addEventListener('click', async () => {
            const newName = renameInput.value.trim();
            if (!newName) {
                renameInput.focus();
                return;
            }
            if (!gardenCurrentProfileName) return;

            renameBtnConfirm.disabled = true;
            renameBtnConfirm.textContent = 'Guardando...';
            try {
                const resp = await fetch('/api/profiles/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ oldName: gardenCurrentProfileName, newName }),
                });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || 'Error al renombrar');

                gardenCurrentProfileName = newName;
                gardenModalTitle.textContent = `Perfil de ${newName}`;
                renameModal.style.display = 'none';

                // Refresh garden
                gardenLoaded = false;
                loadGarden();
            } catch (err) {
                alert('Error al renombrar: ' + err.message);
            } finally {
                renameBtnConfirm.disabled = false;
                renameBtnConfirm.textContent = 'Guardar nombre';
            }
        });
    }

    // ── Garden: Delete capture (individual, from captures list) ──
    const deleteModal = document.getElementById('delete-modal');
    const deleteBtnCancel = document.getElementById('delete-btn-cancel');
    const deleteBtnConfirm = document.getElementById('delete-btn-confirm');
    let pendingDeleteFilename = null;

    function confirmDeleteCapture(filename) {
        pendingDeleteFilename = filename;
        deleteModal.style.display = 'flex';
    }

    if (deleteBtnCancel) {
        deleteBtnCancel.addEventListener('click', () => {
            deleteModal.style.display = 'none';
            pendingDeleteFilename = null;
        });
    }

    deleteModal?.addEventListener('click', (e) => {
        if (e.target === deleteModal) { deleteModal.style.display = 'none'; pendingDeleteFilename = null; }
    });

    if (deleteBtnConfirm) {
        deleteBtnConfirm.addEventListener('click', async () => {
            if (!pendingDeleteFilename) return;
            deleteBtnConfirm.disabled = true;
            deleteBtnConfirm.textContent = 'Eliminando...';
            try {
                const resp = await fetch('/api/profiles/capture/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: pendingDeleteFilename }),
                });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || 'Error al eliminar');

                deleteModal.style.display = 'none';
                pendingDeleteFilename = null;
                gardenLoaded = false;

                // If the capture we deleted was the currently shown one, clear 2D
                if (gardenCurrentFile === pendingDeleteFilename) {
                    gardenCurrentFile = null;
                    gardenCurrentJson = null;
                    if (gardenPulse2d) { gardenPulse2d.stop(); gardenPulse2d = null; }
                }

                // Reload captures list for current profile
                if (gardenCurrentProfileName) {
                    const resp2 = await fetch(`/api/profiles/captures?name=${encodeURIComponent(gardenCurrentProfileName)}`);
                    const data2 = await resp2.json();
                    if (data2.ok && data2.captures.length > 0) {
                        renderProfileCapturesList(data2.captures);
                        gardenModalMeta.textContent = `${data2.captures.length} captura${data2.captures.length !== 1 ? 's' : ''}`;
                    } else {
                        // Profile is now empty
                        closeGardenModal();
                        loadGarden();
                    }
                }
            } catch (err) {
                alert('Error al eliminar: ' + err.message);
            } finally {
                deleteBtnConfirm.disabled = false;
                deleteBtnConfirm.textContent = 'Sí, eliminar';
            }
        });
    }

    // ── Garden: Delete entire profile ──
    const gardenBtnDeleteProfile = document.getElementById('garden-btn-delete-profile');
    const deleteProfileModal = document.getElementById('delete-profile-modal');
    const deleteProfileModalName = document.getElementById('delete-profile-modal-name');
    const deleteProfileCount = document.getElementById('delete-profile-count');
    const deleteProfileBtnCancel = document.getElementById('delete-profile-btn-cancel');
    const deleteProfileBtnConfirm = document.getElementById('delete-profile-btn-confirm');

    if (gardenBtnDeleteProfile) {
        gardenBtnDeleteProfile.addEventListener('click', async () => {
            if (!gardenCurrentProfileName) return;
            // Show count
            try {
                const resp = await fetch(`/api/profiles/captures?name=${encodeURIComponent(gardenCurrentProfileName)}`);
                const data = await resp.json();
                const count = data.captures?.length || 0;
                if (deleteProfileCount) deleteProfileCount.textContent = `${count} captura${count !== 1 ? 's' : ''}`;
            } catch (_) {
                if (deleteProfileCount) deleteProfileCount.textContent = 'todas las capturas';
            }
            if (deleteProfileModalName) deleteProfileModalName.textContent = gardenCurrentProfileName;
            if (deleteProfileModal) deleteProfileModal.style.display = 'flex';
        });
    }

    if (deleteProfileBtnCancel) {
        deleteProfileBtnCancel.addEventListener('click', () => {
            if (deleteProfileModal) deleteProfileModal.style.display = 'none';
        });
    }

    deleteProfileModal?.addEventListener('click', (e) => {
        if (e.target === deleteProfileModal) deleteProfileModal.style.display = 'none';
    });

    if (deleteProfileBtnConfirm) {
        deleteProfileBtnConfirm.addEventListener('click', async () => {
            if (!gardenCurrentProfileName) return;
            deleteProfileBtnConfirm.disabled = true;
            deleteProfileBtnConfirm.textContent = 'Eliminando...';
            try {
                const resp = await fetch('/api/profiles/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: gardenCurrentProfileName }),
                });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || 'Error al eliminar');

                if (deleteProfileModal) deleteProfileModal.style.display = 'none';
                closeGardenModal();
                gardenLoaded = false;
                loadGarden();
            } catch (err) {
                alert('Error al eliminar perfil: ' + err.message);
            } finally {
                deleteProfileBtnConfirm.disabled = false;
                deleteProfileBtnConfirm.textContent = 'Sí, eliminar todo';
            }
        });
    }

    function formatTime(secs) {
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function bootstrapInitialView() {
        const activeView = Array.from(views).find(v => v.classList.contains('active'));
        const viewName = activeView ? activeView.id.replace('view-', '') : 'garden';

        if (viewName === 'garden') {
            void loadGarden();
        } else if (viewName === 'capture') {
            maybeStartCaptureTour();
        } else if (viewName === 'pulse') {
            showManualUploadView();
        }
    }

    bootstrapInitialView();

    // ── Utility: Escape HTML ──
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

})();
