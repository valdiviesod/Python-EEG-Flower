/**
 * NAD — Unified App Controller
 *
 * Manages two views:
 *   1. Captura EEG — setup → live capture → results (download JSON / MIDI / send to flower)
 *   2. Flor Neurofuncional — upload → 2D / 3D / Analysis
 *
 * Uses Flower's vibrant palette for EEG wave rendering.
 */

(function () {
    'use strict';

    // ── Channel colors (Flower vibrant palette) ──
    const CH_COLORS = ['#8B5CF6', '#22C55E', '#EC4899', '#F97316'];
    const CH_NAMES = ['TP9', 'AF7', 'AF8', 'TP10'];
    const GARDEN_PLAYBACK_MAX_NOTES_PER_TRACK = 300;
    const GARDEN_PLAYBACK_MIN_NOTE_DURATION = 0.15;
    const GARDEN_PLAYBACK_MAX_NOTE_DURATION = 2.0;
    const GARDEN_PLAYBACK_MIN_SPACING = 0.08;       // minimum seconds between notes
    const GARDEN_CHANNEL_PAN = [-0.55, -0.18, 0.18, 0.55];

    // Pentatonic major scale intervals from C (in semitones): C D E G A
    const GARDEN_PENTATONIC = [0, 2, 4, 7, 9];

    // GM instrument names for soundfont-player (one per channel for variety)
    const GARDEN_INSTRUMENTS = [
        'acoustic_guitar_nylon',    // ch 0 — warm nylon guitar
        'acoustic_guitar_nylon',    // ch 1 — same guitar for coherence
        'acoustic_guitar_nylon',    // ch 2
        'acoustic_guitar_nylon',    // ch 3
    ];

    // ══════════════════════════════════════════════════════════════════════
    // Global Tab Switching
    // ══════════════════════════════════════════════════════════════════════

    const globalTabs = document.querySelectorAll('.global-tab');
    const views = document.querySelectorAll('.view');

    globalTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const viewName = tab.dataset.view;
            globalTabs.forEach(t => t.classList.toggle('active', t.dataset.view === viewName));
            views.forEach(v => v.classList.toggle('active', v.id === `view-${viewName}`));

            // Trigger resize for flower 3D if switching to it
            if (viewName === 'flower' && flower3d) {
                setTimeout(() => flower3d._onResize(), 100);
            }

            // Re-show capture tour whenever user navigates to the capture tab
            // Only show if capture setup is visible (not mid-capture or results)
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
    const inputAge = document.getElementById('input-age');
    const inputDuration = document.getElementById('input-duration');
    const btnStart = document.getElementById('btn-start-capture');
    const btnStop = document.getElementById('btn-stop-capture');

    const liveUserLabel = document.getElementById('live-user-label');
    const liveTime = document.getElementById('live-time');

    const wavesCanvas = null; // replaced by scalp map

    const resultsSummary = document.getElementById('results-summary');
    const btnDownloadMidi = document.getElementById('btn-download-midi');
    const btnSendToFlower = document.getElementById('btn-send-to-flower');
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

    // ── ScalpMap + FocusTracker ──
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

    // ── Start Capture ──
    btnStart.addEventListener('click', async () => {
        const name = inputName.value.trim();
        const age = inputAge.value ? parseInt(inputAge.value) : null;
        const duration = inputDuration.value ? parseFloat(inputDuration.value) : null;

        btnStart.disabled = true;
        btnStart.textContent = 'Conectando...';

        try {
            const resp = await fetch('/api/capture/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userName: name,
                    userAge: age,
                    durationSeconds: duration,
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
                ? `${name}${age ? ' (' + age + ' años)' : ''}`
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
        stopMindfulness();
        showResults();
        btnStop.disabled = false;
    });

    // ── Polling ──
    function startPolling() {
        stopPolling();

        // Init ScalpMap
        const smCanvas = document.getElementById('scalp-map-canvas');
        if (smCanvas) {
            scalpMap = new ScalpMap(smCanvas);
        }

        // Init FocusTracker
        FocusTracker.reset();

        pollOnce(); // immediate first poll
        capturePollingId = setInterval(pollOnce, 150);
        startMindfulness();
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

            // Append new samples to wave buffer + feed ScalpMap + FocusTracker
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

                // Feed ScalpMap: use latest value per channel
                if (scalpMap) {
                    const latest = newSamplesPerCh.map(arr => arr.length ? arr[arr.length - 1] : 0);
                    scalpMap.update(latest);
                }

                // Feed FocusTracker: push sample-by-sample (interleaved across channels)
                const nSamples = newSamplesPerCh.reduce((mx, a) => Math.max(mx, a.length), 0);
                for (let s = 0; s < nSamples; s++) {
                    const sample4ch = newSamplesPerCh.map(arr => arr[s] ?? 0);
                    FocusTracker.push(sample4ch);
                }
            }

            captureStreamIdx = data.endIndex || captureStreamIdx;

            // Store latest full data
            lastCaptureData = data;

            // Auto-stop if finished
            if (data.finished) {
                stopPolling();
                stopMindfulness();
                showResults();
            }

        } catch (err) {
            console.warn('Poll error:', err);
        }
    }

    // ── Wave Drawing (kept for results preview only) ──
    function resizeWavesCanvas() {
        // No-op: live waves replaced by scalp map
    }

    window.addEventListener('resize', () => {
        if (liveSection.style.display !== 'none' && scalpMap) {
            scalpMap.resize();
        }
    });

    function drawWavesLoop() {
        // No-op: live waves replaced by scalp map
    }

    function drawWaves(ctx, canvas, buffers) {
        const W = canvas.width;
        const H = canvas.height;
        const laneH = H / 4;

        ctx.fillStyle = '#FAFAF8';
        ctx.fillRect(0, 0, W, H);

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

        for (let ch = 0; ch < 4; ch++) {
            const buf = buffers[ch];
            if (buf.length < 2) continue;

            const centerY = laneH * ch + laneH / 2;

            // Lane separator
            if (ch > 0) {
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, laneH * ch);
                ctx.lineTo(W, laneH * ch);
                ctx.stroke();
            }

            // Channel label
            ctx.fillStyle = CH_COLORS[ch];
            ctx.globalAlpha = 0.12;
            ctx.fillRect(0, laneH * ch, W, laneH);
            ctx.globalAlpha = 1;

            ctx.fillStyle = CH_COLORS[ch];
            ctx.font = `bold ${Math.max(11, H * 0.025)}px Inter, system-ui`;
            ctx.fillText(CH_NAMES[ch], 8, laneH * ch + 18);

            // Wave
            ctx.beginPath();
            ctx.lineWidth = 2;
            ctx.strokeStyle = CH_COLORS[ch];
            ctx.lineJoin = 'round';

            for (let i = 0; i < buf.length; i++) {
                const x = (i / (MAX_WAVE_POINTS - 1)) * W;
                const norm = (buf[i] - gMin) / range;
                const y = centerY + (0.5 - norm) * laneH * 0.85;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Current time line
        const xNow = W - 2;
        ctx.strokeStyle = 'rgba(232, 160, 191, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(xNow, 0);
        ctx.lineTo(xNow, H);
        ctx.stroke();
        ctx.setLineDash([]);
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
            const age = meta.user_age;

            let text = `Sesión completada · ${formatTime(dur)}`;
            if (name) text = `${name}${age ? ' (' + age + ')' : ''} — ` + text;
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

    // ── Send to Flower ──
    btnSendToFlower.addEventListener('click', async () => {
        try {
            const resp = await fetch('/api/capture/status');
            const captureJson = await resp.json();

            if (!captureJson.eeg_channels || !captureJson.metadata) {
                alert('No hay datos de captura disponibles');
                return;
            }

            // Switch to flower view and process data
            globalTabs.forEach(t => t.classList.toggle('active', t.dataset.view === 'flower'));
            views.forEach(v => v.classList.toggle('active', v.id === 'view-flower'));

            processFlowerData(captureJson);

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
        setTimeout(() => startTour(captureSetupTourSteps), 300);
    });

    // ══════════════════════════════════════════════════════════════════════
    // MINDFULNESS SLIDER (during capture)
    // ══════════════════════════════════════════════════════════════════════

    const mindfulnessMessages = [
        { icon: '🧘', text: 'Relájate y respira profundo... inhala por la nariz, exhala por la boca.' },
        { icon: '🌿', text: 'Siéntate cómodamente y deja que tus hombros se relajen.' },
        { icon: '🌊', text: 'Imagina olas suaves llegando a la orilla... calma y serenidad.' },
        { icon: '✨', text: 'Cierra los ojos suavemente y enfócate en tu respiración.' },
        { icon: '🦋', text: 'Deja ir cualquier pensamiento... solo observa sin juzgar.' },
        { icon: '🌸', text: 'Cada respiración te acerca más a tu centro interior.' },
        { icon: '🍃', text: 'Siente cómo tu cuerpo se vuelve más ligero con cada exhalación.' },
        { icon: '🌙', text: 'Permite que tu mente descanse... no hay prisa, solo presencia.' },
        { icon: '💫', text: 'Tu cerebro está creando patrones únicos en este momento.' },
        { icon: '🎵', text: 'Escucha el silencio entre tus pensamientos... ahí está la calma.' },
        { icon: '🌺', text: 'Cada onda cerebral es un pétalo de tu flor neurofuncional.' },
        { icon: '☁️', text: 'Deja que tus pensamientos pasen como nubes en el cielo.' },
        { icon: '🕊️', text: 'Estás haciendo un gran trabajo. Mantén esta calma.' },
        { icon: '🌈', text: 'Tu mente está pintando un jardín de frecuencias únicas.' },
        { icon: '💎', text: 'Cada segundo de calma revela más sobre tu mundo interior.' },
    ];

    let mindfulnessIntervalId = null;
    let mindfulnessIndex = 0;
    let mindfulnessCaptureStart = null;

    function startMindfulness() {
        mindfulnessIndex = 0;
        mindfulnessCaptureStart = Date.now();
        updateMindfulnessMessage();
        mindfulnessIntervalId = setInterval(() => {
            mindfulnessIndex = (mindfulnessIndex + 1) % mindfulnessMessages.length;
            updateMindfulnessMessage();
        }, 6000); // Change message every 6 seconds
        updateMindfulnessProgress();
    }

    function stopMindfulness() {
        if (mindfulnessIntervalId) {
            clearInterval(mindfulnessIntervalId);
            mindfulnessIntervalId = null;
        }
    }

    function updateMindfulnessMessage() {
        const msg = mindfulnessMessages[mindfulnessIndex];
        const iconEl = document.getElementById('mindfulness-icon');
        const textEl = document.getElementById('mindfulness-text');
        if (iconEl) iconEl.textContent = msg.icon;
        if (textEl) {
            textEl.style.animation = 'none';
            // Force reflow
            void textEl.offsetWidth;
            textEl.style.animation = 'mindfulness-text-fade 0.5s ease';
            textEl.textContent = msg.text;
        }
    }

    function updateMindfulnessProgress() {
        const progressBar = document.getElementById('mindfulness-progress-bar');
        if (!progressBar) return;

        function tick() {
            if (!mindfulnessCaptureStart || !mindfulnessIntervalId) return;
            const elapsed = (Date.now() - mindfulnessCaptureStart) / 1000;
            const duration = inputDuration.value ? parseFloat(inputDuration.value) : 0;

            if (duration > 0) {
                const pct = Math.min(100, (elapsed / duration) * 100);
                progressBar.style.width = pct + '%';
            } else {
                // Manual mode: oscillate
                const cycle = (elapsed % 10) / 10;
                const pct = Math.sin(cycle * Math.PI) * 100;
                progressBar.style.width = Math.abs(pct) + '%';
            }
            requestAnimationFrame(tick);
        }
        tick();
    }

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
            icon: '🌸',
            title: '¡Bienvenido a NAD!',
            desc: 'Esta herramienta captura tus ondas cerebrales con una diadema Muse 2 y las transforma en una flor neurofuncional única. Te guiaremos paso a paso.',
            target: null, // centered, no spotlight
        },
        {
            icon: '👤',
            title: 'Nombre del participante',
            desc: 'Escribe el nombre de quien realizará la captura. Esto ayuda a identificar cada sesión en el jardín de flores.',
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
            desc: 'Tus ondas cerebrales han sido registradas exitosamente. La captura se guardó automáticamente en tu jardín.',
            target: null,
        },
        {
            icon: '🌸',
            title: 'Visualiza tu Flor',
            desc: 'Presiona "Ver Flor" para transformar tus ondas cerebrales en una flor neurofuncional única. ¡Cada persona genera una flor diferente!',
            target: '#btn-send-to-flower',
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

    // Start the capture tour on page load
    maybeStartCaptureTour();

    // ── Utils ──
    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    // ══════════════════════════════════════════════════════════════════════
    // FLOWER VIEW
    // ══════════════════════════════════════════════════════════════════════

    let flowerAnalyzer = null;
    let flower2d = null;
    let flower3d = null;
    let currentFlowerTab = 'flower2d';

    const flowerUploadSection = document.getElementById('flower-upload-section');
    const flowerMainContent = document.getElementById('flower-main-content');
    const flowerFileInput = document.getElementById('flower-file-input');
    const flowerBtnUpload = document.getElementById('flower-btn-upload');
    const flowerUploadArea = document.getElementById('flower-upload-area');
    const flowerBtnBack = document.getElementById('flower-btn-back');

    const flowerTabs = document.querySelectorAll('#flower-tabs .tab');
    const flowerPanels = document.querySelectorAll('.tab-panel');
    const canvas2d = document.getElementById('flower-2d-canvas');
    const container3d = document.getElementById('flower-3d-container');
    const analysisContent = document.getElementById('analysis-content');
    const bandBar = document.getElementById('band-bar');

    const btnExport2d = document.getElementById('btn-export-2d');
    const btnExport3d = document.getElementById('btn-export-3d');
    const printSizeSelect = document.getElementById('print-size-mm');
    const printExportFormat = document.getElementById('print-export-format');

    // ── File upload ──
    flowerBtnUpload.addEventListener('click', () => flowerFileInput.click());
    flowerFileInput.addEventListener('change', (e) => {
        if (e.target.files.length) loadFlowerFile(e.target.files[0]);
    });

    // Drag & Drop
    flowerUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        flowerUploadArea.classList.add('drag-over');
    });
    flowerUploadArea.addEventListener('dragleave', () => {
        flowerUploadArea.classList.remove('drag-over');
    });
    flowerUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        flowerUploadArea.classList.remove('drag-over');
        if (e.dataTransfer.files.length) loadFlowerFile(e.dataTransfer.files[0]);
    });

    function loadFlowerFile(file) {
        if (!file.name.endsWith('.json')) {
            alert('Por favor selecciona un archivo .json');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                processFlowerData(data);
            } catch (err) {
                alert('Error leyendo el JSON: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    // ── Process Flower Data ──
    function processFlowerData(jsonData) {
        if (!jsonData.eeg_channels || !jsonData.metadata) {
            alert('El archivo JSON no tiene el formato esperado (requiere eeg_channels y metadata).');
            return;
        }

        // Use the Flower's analyzer (loaded from /flower/eeg_band_analyzer.js)
        flowerAnalyzer = new EEGBandAnalyzer(jsonData);
        const report = flowerAnalyzer.getReport();

        // Show main content
        flowerUploadSection.style.display = 'none';
        flowerMainContent.style.display = 'flex';

        renderBandBar(report.bands);
        renderAnalysis(report);
        drawFlower2D();
        switchFlowerTab('flower2d');
    }

    // ── Draw 2D (LavaPulse) ──
    function drawFlower2D() {
        if (!flowerAnalyzer) return;
        if (flower2d) flower2d.stop();
        const containerW = canvas2d.parentElement.clientWidth;
        const size = Math.min(1200, Math.max(600, containerW));
        canvas2d.width = size;
        canvas2d.height = size;
        canvas2d.style.width = '100%';
        canvas2d.style.height = 'auto';
        flower2d = new LavaPulse(canvas2d, flowerAnalyzer);
        flower2d.start();
    }

    // ── Init 3D Flower ──
    function initFlower3D() {
        if (!flowerAnalyzer) return;
        if (flower3d) flower3d.destroy();
        flower3d = new Flower3D(container3d, flowerAnalyzer);
        flower3d.init();
    }

    // ── Flower Tabs ──
    flowerTabs.forEach(tab => {
        tab.addEventListener('click', () => switchFlowerTab(tab.dataset.tab));
    });

    function switchFlowerTab(tabName) {
        // Pause/resume LavaPulse on tab changes
        if (currentFlowerTab === 'flower2d' && tabName !== 'flower2d' && flower2d) {
            flower2d.stop();
        }
        if (tabName === 'flower2d' && flower2d) {
            flower2d.start();
        }
        currentFlowerTab = tabName;
        flowerTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        flowerPanels.forEach(p => p.classList.toggle('active', p.id === `panel-${tabName}`));

        if (tabName === 'flower3d' && flowerAnalyzer && !flower3d) {
            setTimeout(() => initFlower3D(), 100);
        }
        if (tabName === 'flower3d' && flower3d) {
            flower3d._onResize();
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
                <h3>🌸 Anatomía de tu Flor</h3>
                <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:1rem;line-height:1.6">
                    Cada capa de pétalos representa una banda de frecuencia cerebral.
                    El tamaño de los pétalos es proporcional a la potencia relativa de cada banda.
                </p>
                <div class="band-detail-grid">
                    ${bands.map(band => renderBandCard(band)).join('')}
                </div>
            </div>
            <div class="analysis-card flower-meaning-card">
                <h3>🌺 Lectura de tu Flor</h3>
                <div class="flower-meaning-text">
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

    // ── Export 2D ──
    if (btnExport2d) {
        btnExport2d.addEventListener('click', () => {
            if (flower2d) flower2d.exportPNG('flor_neurofuncional_2d.png');
        });
    }

    // ── Export 3D ──
    if (btnExport3d) {
        btnExport3d.addEventListener('click', async () => {
            if (!flower3d) {
                showExportStatus('⚠️ Primero carga un archivo EEG y abre la pestaña 3D.', 'warn');
                return;
            }

            const selectedSize = Number(printSizeSelect?.value || 120);
            const format = printExportFormat?.value || 'glb+3mf';

            btnExport3d.disabled = true;
            btnExport3d.innerHTML = '<span class="spinner"></span> Convirtiendo con Python local…';
            showExportStatus('⏳ Generando modelo y enviando a Python local…', 'info');

            try {
                const geometry = flower3d.exportGeometryJSON(selectedSize);

                const response = await fetch('/api/convert-flower', {
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
                const filename = `flor_neurofuncional_${selectedSize}mm_${format.replace('+', '_')}.zip`;
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

    // ── Back Button ──
    if (flowerBtnBack) {
        flowerBtnBack.addEventListener('click', () => {
            if (flower3d) { flower3d.destroy(); flower3d = null; }
            if (flower2d) { flower2d.stop(); flower2d = null; }
            flowerAnalyzer = null;
            flowerMainContent.style.display = 'none';
            flowerUploadSection.style.display = 'flex';
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
    const gardenBtnRefresh = document.getElementById('btn-garden-refresh');

    let gardenLoaded = false;
    let gardenFlower2d = null;
    let gardenFlowerModal3d = null;
    let gardenAnalyzer = null;
    let gardenCurrentFile = null;
    let gardenCurrentJson = null;
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

    // The main garden environment
    // Auto-load garden when switching to it
    globalTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.view === 'garden') {
                if (!gardenLoaded) loadGarden();
            }
        });
    });

    if (gardenBtnRefresh) {
        gardenBtnRefresh.addEventListener('click', () => {
            gardenLoaded = false;
            loadGarden();
        });
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

    async function loadGarden() {
        showGardenStatus('🌱', 'Analizando capturas para tu jardín...');

        try {
            const resp = await fetch('/api/garden/list');
            const data = await resp.json();

            if (!data.ok || !data.captures || data.captures.length === 0) {
                showGardenStatus('🌱', 'Tu jardín está vacío.<br><br>Realiza tu primera captura EEG para plantar la primera flor.');
                return;
            }

            hideGardenStatus();

            // Render beautiful 2D flowers
            await renderGarden2D(data.captures);

            gardenLoaded = true;
        } catch (err) {
            console.error('Error loading garden:', err);
            showGardenStatus('⚠️', 'Error al cargar el jardín. Intenta actualizar.');
        }
    }

    async function renderGarden2D(capturesList) {
        const container = document.getElementById('garden-2d-scene');
        container.innerHTML = '';

        // Sort captures alphabetically
        capturesList.sort((a, b) => a.filename.localeCompare(b.filename));

        for (let i = 0; i < capturesList.length; i++) {
            const captureMeta = capturesList[i];
            try {
                const resp = await fetch(`/api/garden/file?name=${encodeURIComponent(captureMeta.filename)}`);
                if (!resp.ok) continue;
                const fullCaptureData = await resp.json();

                // Keep the original filename for downloading if needed
                fullCaptureData.filename = captureMeta.filename;

                // Create item wrapper
                const item = document.createElement('div');
                item.className = 'garden-2d-item';

                // Canvas for 2D flower
                const canvasWrapper = document.createElement('div');
                canvasWrapper.className = 'garden-2d-canvas-wrap';
                const canvas = document.createElement('canvas');
                canvasWrapper.appendChild(canvas);

                // Label
                const label = document.createElement('div');
                label.className = 'garden-2d-label';
                const userName = fullCaptureData.metadata?.user_name || 'Anónimo';
                label.innerHTML = `<span class="garden-2d-label-name">${userName}</span>`;

                item.appendChild(canvasWrapper);
                item.appendChild(label);

                container.appendChild(item);

                // Draw LavaPulse thumbnail (static single frame)
                const analyzer = new EEGBandAnalyzer(fullCaptureData);
                canvas.width = 600;
                canvas.height = 600;
                const pulse = new LavaPulse(canvas, analyzer);
                pulse._draw(); // single static frame — no animation loop

                // Click handler
                item.addEventListener('click', () => {
                    openGardenModalFromData(fullCaptureData);
                });

            } catch (e) {
                console.error("Error drawing garden 2D item:", e);
            }
        }
    }

    // This handles clicks from the 3D garden raycaster which gives full capture data
    function openGardenModalFromData(captureData) {
        if (!captureData) return;

        const filename = captureData.filename || 'capture.json';

        gardenCurrentJson = captureData;
        gardenCurrentFile = filename;
        void playGardenMidi(captureData);

        const userName = captureData.metadata?.user_name || 'Anónimo';

        gardenModalTitle.textContent = `Flor de ${userName}`;

        const dur = captureData.metadata?.duration_seconds ? formatTime(captureData.metadata.duration_seconds) : '—';
        gardenModalMeta.textContent = dur !== '—' ? `Sesión de ${dur}` : 'Sesión EEG';

        // Initialize Analyzer for Modal Views
        gardenAnalyzer = new EEGBandAnalyzer(captureData);

        // 1. Draw 2D (LavaPulse animated)
        const canvas2dGarden = document.getElementById('garden-flower-2d-canvas');
        if (gardenFlower2d) { gardenFlower2d.stop(); gardenFlower2d = null; }
        const containerW = canvas2dGarden.parentElement.clientWidth;
        const size = Math.min(1200, Math.max(600, containerW));
        canvas2dGarden.width = size;
        canvas2dGarden.height = size;
        canvas2dGarden.style.width = '100%';
        canvas2dGarden.style.height = 'auto';
        gardenFlower2d = new LavaPulse(canvas2dGarden, gardenAnalyzer);
        gardenFlower2d.start();

        // 2. Prepare 3D (will init on tab click to avoid layout issues)
        if (gardenFlowerModal3d) {
            gardenFlowerModal3d.destroy();
            gardenFlowerModal3d = null;
        }

        // 3. Render Analysis Report
        const report = gardenAnalyzer.getReport();
        const gardenAnalysisContent = document.getElementById('garden-analysis-content');
        gardenAnalysisContent.innerHTML = renderGardenAnalysisHTML(report);

        // Reset tabs to 2D
        gardenModalTabs.forEach(t => t.classList.toggle('active', t.dataset.gtab === 'garden-2d'));
        gardenPanels.forEach(p => p.classList.toggle('active', p.id === 'gpanel-garden-2d'));

        gardenModal.style.display = 'flex';
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
        gardenMidiLoopId += 1;

        gardenMidiTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        gardenMidiTimeouts = [];

        gardenMidiNodes.forEach(node => {
            try { node.stop(); } catch (_) { }
            try { node.disconnect(); } catch (_) { }
        });
        gardenMidiNodes = [];
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
        return { notes, totalDuration };
    }

    function scheduleGardenMidiLoop(ctx, playbackPlan, playbackId) {
        if (!playbackPlan || !Array.isArray(playbackPlan.notes) || !playbackPlan.notes.length) return;
        if (playbackId !== gardenMidiLoopId) return;

        const notes = playbackPlan.notes;
        const loopDuration = playbackPlan.totalDuration;
        const baseTime = ctx.currentTime + 0.05;
        gardenMidiTimeouts = [];

        // Resolve the instrument name used for all channels (currently all the same)
        const instrumentName = GARDEN_INSTRUMENTS[0] || 'acoustic_guitar_nylon';
        const instrument = gardenInstruments[instrumentName];

        // Fallback: if instruments failed to load, skip silently
        if (!instrument) {
            console.warn('Garden MIDI: instrument not loaded, skipping playback');
            return;
        }

        notes.forEach(note => {
            const delayMs = Math.max(0, (baseTime - ctx.currentTime + note.time) * 1000);

            const timeoutId = setTimeout(() => {
                if (playbackId !== gardenMidiLoopId) return;

                const channelIdx = Math.max(0, note.channel % 4);
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

        // Loop: restart playback after the full plan finishes
        gardenMidiLoopTimeout = setTimeout(() => {
            scheduleGardenMidiLoop(ctx, playbackPlan, playbackId);
        }, Math.max(250, (loopDuration + 0.5) * 1000));
    }

    /**
     * Create (or resume) the AudioContext, set up the reverb/dry/master bus,
     * and pre-load all soundfont instruments needed for playback.
     * Returns { ctx, instruments } so callers can await everything.
     */
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
                try {
                    const inst = await Soundfont.instrument(ctx, name, {
                        soundfont: 'MusyngKite',
                        gain: 1.0,
                    });
                    gardenInstruments[name] = inst;
                } catch (e) {
                    console.warn(`Failed to load soundfont "${name}":`, e);
                }
            });
            await Promise.all(loadPromises);
        }

        return ctx;
    }

    async function playGardenMidi(captureData) {
        if (!captureData || typeof Midi === 'undefined') return;

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

            const midi = new Midi(await resp.arrayBuffer());
            const playbackPlan = buildGardenPlaybackPlan(midi);
            if (!playbackPlan) return;

            // Init audio context, reverb bus, and load soundfont instruments
            const ctx = await getGardenAudioContext();

            // Verify at least one instrument loaded
            const instrumentName = GARDEN_INSTRUMENTS[0] || 'acoustic_guitar_nylon';
            if (!gardenInstruments[instrumentName]) {
                console.warn('Garden MIDI: soundfont instruments not available. Playback skipped.');
                return;
            }

            stopGardenMidiPlayback();
            const playbackId = gardenMidiLoopId;
            scheduleGardenMidiLoop(ctx, playbackPlan, playbackId);
        } catch (err) {
            console.error('Error reproduciendo MIDI del jardín:', err);
        }
    }

    function renderGardenAnalysisHTML(report) {
        const bands = report.bands;
        return `
        <div class="analysis-card">
            <h3>🌸 Anatomía de tu Flor</h3>
            <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:1rem;line-height:1.6">
                Cada capa de pétalos representa una banda de frecuencia cerebral calculada con precisión desde tu captura.
            </p>
            <div class="band-detail-grid">
                ${bands.map(band => renderBandCard(band)).join('')}
            </div>
        </div>
        <div class="analysis-card flower-meaning-card">
            <h3>🌺 Lectura de tu Flor</h3>
            <div class="flower-meaning-text">
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
        gardenModal.style.display = 'none';
        if (gardenFlower2d) { gardenFlower2d.stop(); gardenFlower2d = null; }
        if (gardenFlowerModal3d) {
            gardenFlowerModal3d.destroy();
            gardenFlowerModal3d = null;
        }
    }

    // Modal tabs
    gardenModalTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.gtab;
            gardenModalTabs.forEach(t => t.classList.toggle('active', t.dataset.gtab === tabName));
            gardenPanels.forEach(p => p.classList.toggle('active', p.id === `gpanel-${tabName}`));

            // Init 3D on first switch
            if (tabName === 'garden-3d' && gardenAnalyzer && !gardenFlowerModal3d) {
                const container = document.getElementById('garden-flower-3d-container');
                setTimeout(() => {
                    gardenFlowerModal3d = new Flower3D(container, gardenAnalyzer);
                    gardenFlowerModal3d.init();
                }, 100);
            }
            if (tabName === 'garden-3d' && gardenFlowerModal3d) {
                gardenFlowerModal3d._onResize();
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

    // ── Garden: Rename flower ──
    const gardenBtnRename = document.getElementById('garden-btn-rename');
    const renameModal = document.getElementById('rename-modal');
    const renameInput = document.getElementById('rename-input');
    const renameBtnCancel = document.getElementById('rename-btn-cancel');
    const renameBtnConfirm = document.getElementById('rename-btn-confirm');

    if (gardenBtnRename) {
        gardenBtnRename.addEventListener('click', () => {
            if (!gardenCurrentJson) return;
            const currentName = gardenCurrentJson.metadata?.user_name || '';
            renameInput.value = currentName;
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
            if (!gardenCurrentFile) return;

            renameBtnConfirm.disabled = true;
            renameBtnConfirm.textContent = 'Guardando...';
            try {
                const resp = await fetch('/api/garden/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: gardenCurrentFile, newName }),
                });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || 'Error al renombrar');

                // Update in-memory data and UI
                if (gardenCurrentJson?.metadata) gardenCurrentJson.metadata.user_name = newName;
                gardenModalTitle.textContent = `Flor de ${newName}`;
                renameModal.style.display = 'none';

                // Refresh garden to show updated name
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

    // ── Garden: Delete flower ──
    const gardenBtnDelete = document.getElementById('garden-btn-delete');
    const deleteModal = document.getElementById('delete-modal');
    const deleteModalName = document.getElementById('delete-modal-name');
    const deleteBtnCancel = document.getElementById('delete-btn-cancel');
    const deleteBtnConfirm = document.getElementById('delete-btn-confirm');

    if (gardenBtnDelete) {
        gardenBtnDelete.addEventListener('click', () => {
            if (!gardenCurrentJson) return;
            const name = gardenCurrentJson.metadata?.user_name || gardenCurrentFile || 'esta flor';
            if (deleteModalName) deleteModalName.textContent = name;
            deleteModal.style.display = 'flex';
        });
    }

    if (deleteBtnCancel) {
        deleteBtnCancel.addEventListener('click', () => {
            deleteModal.style.display = 'none';
        });
    }

    deleteModal?.addEventListener('click', (e) => {
        if (e.target === deleteModal) deleteModal.style.display = 'none';
    });

    if (deleteBtnConfirm) {
        deleteBtnConfirm.addEventListener('click', async () => {
            if (!gardenCurrentFile) return;
            deleteBtnConfirm.disabled = true;
            deleteBtnConfirm.textContent = 'Eliminando...';
            try {
                const resp = await fetch('/api/garden/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: gardenCurrentFile }),
                });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || 'Error al eliminar');

                deleteModal.style.display = 'none';
                closeGardenModal();
                gardenLoaded = false;
                loadGarden();
            } catch (err) {
                alert('Error al eliminar: ' + err.message);
            } finally {
                deleteBtnConfirm.disabled = false;
                deleteBtnConfirm.textContent = 'Sí, eliminar';
            }
        });
    }

    function formatTime(secs) {
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    // ── Utility: Escape HTML ──
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

})();
