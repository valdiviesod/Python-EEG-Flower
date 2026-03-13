/**
 * NAD — Unified App Controller
 *
 * Manages two views:
 *   1. Captura EEG — setup → live capture → results (download JSON / MIDI / send to flower)
 *   2. Flor Neurofuncional — upload → 2D / 3D / Analysis
 *
 * Uses Flower's pastel palette for EEG wave rendering.
 */

(function () {
    'use strict';

    // ── Channel colors (Flower pastel palette) ──
    const CH_COLORS = ['#C4B7D8', '#A8D8B9', '#FFD1DC', '#FFDAB9'];
    const CH_NAMES = ['TP9', 'AF7', 'AF8', 'TP10'];

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
    const liveSamples = document.getElementById('live-samples');
    const liveTime = document.getElementById('live-time');
    const liveRate = document.getElementById('live-rate');

    const wavesCanvas = document.getElementById('waves-canvas');
    const wavesCtx = wavesCanvas.getContext('2d');

    const resultsSummary = document.getElementById('results-summary');
    const btnDownloadJson = document.getElementById('btn-download-json');
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

            // Start polling
            startPolling();

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
        pollOnce(); // immediate first poll
        capturePollingId = setInterval(pollOnce, 150);
        resizeWavesCanvas();
        drawWavesLoop();
        startMindfulness();
    }

    function stopPolling() {
        if (capturePollingId) {
            clearInterval(capturePollingId);
            capturePollingId = null;
        }
        if (captureAnimId) {
            cancelAnimationFrame(captureAnimId);
            captureAnimId = null;
        }
    }

    async function pollOnce() {
        try {
            const resp = await fetch(`/api/capture/stream?from=${captureStreamIdx}`);
            const data = await resp.json();

            // Update stats
            liveSamples.textContent = data.totalSamples.toLocaleString();
            if (data.metadata) {
                const dur = data.metadata.duration_seconds || 0;
                liveTime.textContent = formatTime(dur);
                liveRate.textContent = Math.round(data.metadata.sample_rate_hz || 0);
            }

            // Append new samples to wave buffer
            if (data.eeg_channels) {
                for (let ch = 0; ch < 4; ch++) {
                    const key = `channel_${ch + 1}`;
                    const newSamples = data.eeg_channels[key] || [];
                    captureWaveBuffer[ch].push(...newSamples);
                    // Trim to keep only last MAX_WAVE_POINTS
                    if (captureWaveBuffer[ch].length > MAX_WAVE_POINTS) {
                        captureWaveBuffer[ch] = captureWaveBuffer[ch].slice(-MAX_WAVE_POINTS);
                    }
                }
            }

            captureStreamIdx = data.endIndex || captureStreamIdx;

            // Update channel stats
            if (data.statistics) {
                for (let ch = 1; ch <= 4; ch++) {
                    const stats = data.statistics[`channel_${ch}`];
                    const el = document.getElementById(`ch${ch}-val`);
                    if (el && stats) {
                        el.textContent = `${stats.last?.toFixed(1) || '—'} µV`;
                    }
                }
            }

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

    // ── Wave Drawing ──
    function resizeWavesCanvas() {
        const container = wavesCanvas.parentElement;
        wavesCanvas.width = container.clientWidth * (window.devicePixelRatio || 1);
        wavesCanvas.height = container.clientHeight * (window.devicePixelRatio || 1);
        wavesCanvas.style.width = container.clientWidth + 'px';
        wavesCanvas.style.height = container.clientHeight + 'px';
    }

    window.addEventListener('resize', () => {
        if (liveSection.style.display !== 'none') {
            resizeWavesCanvas();
        }
    });

    function drawWavesLoop() {
        drawWaves(wavesCtx, wavesCanvas, captureWaveBuffer);
        captureAnimId = requestAnimationFrame(drawWavesLoop);
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
            const samples = lastCaptureData.totalSamples || meta.total_samples || 0;
            const hz = Math.round(meta.sample_rate_hz || 0);
            const name = meta.user_name || '';
            const age = meta.user_age;

            let text = `${samples.toLocaleString()} muestras · ${formatTime(dur)} · ${hz} Hz`;
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

    // ── Download JSON ──
    btnDownloadJson.addEventListener('click', () => {
        window.location.href = '/api/capture/download-json';
    });

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

    const TOUR_STORAGE_KEY = 'nad_tour_seen';
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
            localStorage.setItem(TOUR_STORAGE_KEY, 'true');
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

    // Auto-start tour on first visit to capture view
    function maybeStartCaptureTour() {
        if (!localStorage.getItem(TOUR_STORAGE_KEY)) {
            setTimeout(() => {
                // Only start if we're on the capture setup view
                if (setupSection.style.display !== 'none' || setupSection.offsetParent !== null) {
                    startTour(captureSetupTourSteps);
                    localStorage.setItem(TOUR_STORAGE_KEY, 'true');
                }
            }, 600);
        }
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
    const flowerBtnDemo = document.getElementById('flower-btn-demo');
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

    // Demo button
    flowerBtnDemo.addEventListener('click', async () => {
        try {
            flowerBtnDemo.textContent = 'Cargando...';
            // Try to load from any nearby JSON file
            const resp = await fetch('../SAD%201.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            processFlowerData(data);
        } catch (err) {
            alert('No se pudo cargar el archivo de ejemplo.\n' +
                'Asegúrate de que exista un archivo JSON EEG en el directorio raíz.\n\n' +
                'Error: ' + err.message);
            flowerBtnDemo.innerHTML = '<span>🌸</span> Datos de ejemplo';
        }
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

    // ── Draw 2D Flower ──
    function drawFlower2D() {
        if (!flowerAnalyzer) return;
        flower2d = new Flower2D(canvas2d, flowerAnalyzer);
        const containerW = canvas2d.parentElement.clientWidth;
        const size = Math.min(2048, Math.max(800, containerW * 2));
        flower2d.draw(size);
        canvas2d.style.width = '100%';
        canvas2d.style.height = 'auto';
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
            flower2d = null;
            flowerAnalyzer = null;
            flowerMainContent.style.display = 'none';
            flowerUploadSection.style.display = 'flex';
            flowerBtnDemo.innerHTML = '<span>🌸</span> Datos de ejemplo';
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
    const gardenBtnDownloadJson = document.getElementById('garden-btn-download-json');
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
    let gardenAudioContext = null;
    let gardenMidiTimeouts = [];
    let gardenMidiOscillators = [];

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

                // Draw 2D flower
                const analyzer = new EEGBandAnalyzer(fullCaptureData);
                const flower2d = new Flower2D(canvas, analyzer);

                // Set sizes
                canvas.width = 600;
                canvas.height = 600;
                flower2d.draw(600, { transparentBackground: true, gardenMode: true });

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
        const samples = captureData.metadata?.total_samples ? captureData.metadata.total_samples.toLocaleString() : '0';
        const hz = captureData.metadata?.sample_rate_hz ? Math.round(captureData.metadata.sample_rate_hz) : '—';
        gardenModalMeta.textContent = `${samples} muestras · ${dur} · ${hz} Hz`;

        // Initialize Analyzer for Modal Views
        gardenAnalyzer = new EEGBandAnalyzer(captureData);

        // 1. Draw 2D
        const canvas2dGarden = document.getElementById('garden-flower-2d-canvas');
        if (!gardenFlower2d) {
            gardenFlower2d = new Flower2D(canvas2dGarden, gardenAnalyzer);
        } else {
            gardenFlower2d.analyzer = gardenAnalyzer;
            gardenFlower2d.params = gardenAnalyzer.flowerParams;
            gardenFlower2d.bands = gardenAnalyzer.normalizedBands;
            gardenFlower2d.profile = gardenAnalyzer.profile;
        }
        const containerW = canvas2dGarden.parentElement.clientWidth;
        const size = Math.min(2048, Math.max(600, containerW * 2));
        gardenFlower2d.draw(size);
        canvas2dGarden.style.width = '100%';
        canvas2dGarden.style.height = 'auto';

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
        gardenMidiTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        gardenMidiTimeouts = [];

        gardenMidiOscillators.forEach(osc => {
            try { osc.stop(); } catch (_) { }
            try { osc.disconnect(); } catch (_) { }
        });
        gardenMidiOscillators = [];
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
        return gardenAudioContext;
    }

    async function playGardenMidi(captureData) {
        if (!captureData || typeof Midi === 'undefined') return;

        try {
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
            const notes = midi.tracks.flatMap(track => track.notes || []).sort((a, b) => a.time - b.time);
            const playableNotes = notes.slice(0, 320);
            if (!playableNotes.length) return;

            const ctx = await getGardenAudioContext();
            stopGardenMidiPlayback();
            const baseTime = ctx.currentTime + 0.05;

            playableNotes.forEach(note => {
                const timeoutId = setTimeout(() => {
                    const now = ctx.currentTime;
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    const velocity = Math.max(0.08, Math.min(0.45, note.velocity || 0.24));
                    const duration = Math.max(0.08, Math.min(1.2, note.duration || 0.25));
                    const midiValue = note.midi || 60;
                    const frequency = 440 * (2 ** ((midiValue - 69) / 12));

                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(frequency, now);

                    gain.gain.setValueAtTime(0.0001, now);
                    gain.gain.exponentialRampToValueAtTime(velocity, now + 0.015);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now);
                    osc.stop(now + duration + 0.02);
                    gardenMidiOscillators.push(osc);
                }, Math.max(0, (baseTime - ctx.currentTime + note.time) * 1000));

                gardenMidiTimeouts.push(timeoutId);
            });
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

    // Garden downloads
    if (gardenBtnDownloadJson) {
        gardenBtnDownloadJson.addEventListener('click', () => {
            if (!gardenCurrentJson || !gardenCurrentFile) return;
            const blob = new Blob(
                [JSON.stringify(gardenCurrentJson, null, 2)],
                { type: 'application/json' }
            );
            downloadBlob(blob, gardenCurrentFile);
        });
    }

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
