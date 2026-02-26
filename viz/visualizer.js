const api = new EEGApiClient('');

const canvas = document.getElementById('eeg-canvas');
const ctx = canvas.getContext('2d');
const flowerCanvas = document.getElementById('flower-canvas');

const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnDownloadJson = document.getElementById('btn-download-json');
const btnConvertMidi = document.getElementById('btn-convert-midi');
const durationInput = document.getElementById('duration-input');
const jsonFileInput = document.getElementById('json-file-input');
const flowerJsonInput = document.getElementById('flower-json-input');
const btnFlowerFile = document.getElementById('btn-flower-file');
const btnFlowerLatest = document.getElementById('btn-flower-latest');
const btnExportFlower = document.getElementById('btn-export-flower');
const flowerBandBar = document.getElementById('flower-band-bar');
const flowerAnalysis = document.getElementById('flower-analysis');

const tabs = document.querySelectorAll('.tab');
const views = {
    capture: document.getElementById('view-capture'),
    flower: document.getElementById('view-flower'),
};

const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const samplesVal = document.getElementById('samples-val');
const rateVal = document.getElementById('rate-val');
const durationVal = document.getElementById('duration-val');

const ch1Val = document.getElementById('ch1-val');
const ch2Val = document.getElementById('ch2-val');
const ch3Val = document.getElementById('ch3-val');
const ch4Val = document.getElementById('ch4-val');

const CHANNEL_COLORS = ['#C4B7D8', '#A8D8B9', '#FFD1DC', '#FFDAB9'];
const CHANNEL_NAMES = ['TP9', 'AF7', 'AF8', 'TP10'];

const state = {
    running: false,
    cursor: 0,
    maxPoints: 900,
    channels: [[], [], [], []],
    timestamps: [],
    animationId: null,
    pollTimer: null,
    latestStatus: null,
    flowerReport: null,
    flowerRenderer: null,
};

function setStatus(label, mode = 'idle') {
    statusText.textContent = label;
    const colorMap = {
        idle: '#B4B4B4',
        running: '#A8D8B9',
        success: '#FFDAB9',
        error: '#F2A5BE',
    };
    statusDot.style.background = colorMap[mode] || colorMap.idle;
}

function setButtons(capturing) {
    btnStart.disabled = capturing;
    btnStop.disabled = !capturing;
}

function formatNum(v) {
    return Number.isFinite(v) ? v.toFixed(3) : '0.000';
}

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(300, Math.floor(rect.width));
    canvas.height = Math.max(240, Math.floor(rect.height));
}

function resizeFlowerCanvas() {
    if (!state.flowerRenderer || !flowerCanvas.parentElement) return;
    const width = flowerCanvas.parentElement.clientWidth;
    const drawSize = Math.min(1800, Math.max(780, width * 2));
    state.flowerRenderer.draw(drawSize);
    flowerCanvas.style.width = '100%';
    flowerCanvas.style.height = 'auto';
}

function trimBuffers() {
    for (let i = 0; i < 4; i++) {
        if (state.channels[i].length > state.maxPoints) {
            state.channels[i] = state.channels[i].slice(-state.maxPoints);
        }
    }
    if (state.timestamps.length > state.maxPoints) {
        state.timestamps = state.timestamps.slice(-state.maxPoints);
    }
}

function appendStreamChunk(chunk) {
    const ch1 = chunk.eeg_channels.channel_1 || [];
    const ch2 = chunk.eeg_channels.channel_2 || [];
    const ch3 = chunk.eeg_channels.channel_3 || [];
    const ch4 = chunk.eeg_channels.channel_4 || [];

    if (ch1.length) state.channels[0].push(...ch1);
    if (ch2.length) state.channels[1].push(...ch2);
    if (ch3.length) state.channels[2].push(...ch3);
    if (ch4.length) state.channels[3].push(...ch4);
    if (chunk.timestamps && chunk.timestamps.length) state.timestamps.push(...chunk.timestamps);

    trimBuffers();

    const latest = chunk.latest || {};
    ch1Val.textContent = formatNum(latest.channel_1 || 0);
    ch2Val.textContent = formatNum(latest.channel_2 || 0);
    ch3Val.textContent = formatNum(latest.channel_3 || 0);
    ch4Val.textContent = formatNum(latest.channel_4 || 0);

    if (chunk.metadata) {
        samplesVal.textContent = String(chunk.metadata.total_samples || 0);
        rateVal.textContent = `${(chunk.metadata.sample_rate_hz || 0).toFixed(1)} Hz`;
        durationVal.textContent = `${(chunk.metadata.duration_seconds || 0).toFixed(1)} s`;
    }
}

function resetCaptureData() {
    state.cursor = 0;
    state.channels = [[], [], [], []];
    state.timestamps = [];
    samplesVal.textContent = '0';
    rateVal.textContent = '0.0 Hz';
    durationVal.textContent = '0.0 s';
    ch1Val.textContent = '0.000';
    ch2Val.textContent = '0.000';
    ch3Val.textContent = '0.000';
    ch4Val.textContent = '0.000';
}

async function startCapture() {
    try {
        const durationRaw = durationInput.value.trim();
        const durationSeconds = durationRaw ? Number(durationRaw) : null;
        if (durationRaw && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) {
            alert('Ingresa una duración válida en segundos.');
            return;
        }

        await api.startCapture(durationSeconds);
        resetCaptureData();
        state.running = true;
        setButtons(true);
        btnDownloadJson.disabled = true;
        setStatus('Capturando EEG en tiempo real...', 'running');
        ensurePolling();
    } catch (err) {
        console.error(err);
        setStatus(`Error al iniciar: ${err.message}`, 'error');
        alert(`No se pudo iniciar la captura: ${err.message}`);
    }
}

async function stopCapture() {
    try {
        await api.stopCapture();
        state.running = false;
        setButtons(false);
        btnDownloadJson.disabled = false;
        setStatus('Captura finalizada. Puedes guardar JSON.', 'success');
    } catch (err) {
        console.error(err);
        setStatus(`Error al detener: ${err.message}`, 'error');
        alert(`No se pudo detener la captura: ${err.message}`);
    }
}

async function pollStream() {
    try {
        const chunk = await api.getStream(state.cursor);
        if (!chunk || typeof chunk.endIndex !== 'number') return;

        state.cursor = chunk.endIndex;
        appendStreamChunk(chunk);

        if (chunk.running) {
            state.running = true;
            setButtons(true);
            btnDownloadJson.disabled = true;
            setStatus('Capturando EEG en tiempo real...', 'running');
        } else if (chunk.finished || state.running) {
            state.running = false;
            setButtons(false);
            btnDownloadJson.disabled = chunk.totalSamples <= 0;
            setStatus('Captura finalizada. Puedes guardar JSON.', 'success');
        }

        if (chunk.metadata?.total_samples > 0) {
            btnFlowerLatest.disabled = false;
        }
    } catch (err) {
        console.error(err);
        setStatus(`Error de conexión: ${err.message}`, 'error');
    }
}

function ensurePolling() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(pollStream, 130);
}

async function refreshStatus() {
    try {
        const status = await api.getStatus();
        state.latestStatus = status;
        const running = !!status.capture_running;
        state.running = running;

        const total = status.metadata?.total_samples || 0;
        samplesVal.textContent = String(total);
        rateVal.textContent = `${(status.metadata?.sample_rate_hz || 0).toFixed(1)} Hz`;
        durationVal.textContent = `${(status.metadata?.duration_seconds || 0).toFixed(1)} s`;

        if (running) {
            setStatus('Captura en curso...', 'running');
            setButtons(true);
            btnDownloadJson.disabled = true;
            ensurePolling();
        } else {
            setButtons(false);
            btnDownloadJson.disabled = total === 0;
            setStatus(total > 0 ? 'Listo para guardar JSON' : 'Listo', total > 0 ? 'success' : 'idle');
        }

        btnFlowerLatest.disabled = total === 0;
    } catch (err) {
        console.error(err);
        setStatus(`Sin conexión API: ${err.message}`, 'error');
    }
}

function drawGrid() {
    const w = canvas.width;
    const h = canvas.height;
    const laneH = h / 4;

    ctx.fillStyle = '#FBFAF8';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(138, 117, 176, 0.12)';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
        const y = i * laneH;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }

    for (let x = 0; x <= w; x += Math.max(32, Math.floor(w / 18))) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }
}

function drawWaveforms() {
    const w = canvas.width;
    const h = canvas.height;
    const laneH = h / 4;

    const all = state.channels.flat();
    let minVal = -1;
    let maxVal = 1;
    if (all.length) {
        minVal = Math.min(...all);
        maxVal = Math.max(...all);
        if (Math.abs(maxVal - minVal) < 1e-6) {
            minVal -= 1;
            maxVal += 1;
        }
    }
    const range = maxVal - minVal;

    for (let ch = 0; ch < 4; ch++) {
        const samples = state.channels[ch];
        const centerY = laneH * ch + laneH / 2;
        const amp = laneH * 0.36;

        ctx.fillStyle = 'rgba(74, 76, 88, 0.72)';
        ctx.font = '600 12px Inter';
        ctx.fillText(CHANNEL_NAMES[ch], 10, centerY - laneH * 0.32);

        if (samples.length < 2) continue;

        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = CHANNEL_COLORS[ch];
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        for (let i = 0; i < samples.length; i++) {
            const x = (i / (state.maxPoints - 1)) * w;
            const normalized = (samples[i] - minVal) / range;
            const y = centerY - ((normalized - 0.5) * 2 * amp);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }

        ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(138, 117, 176, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(w - 2, 0);
    ctx.lineTo(w - 2, h);
    ctx.stroke();
}

function renderLoop() {
    drawGrid();
    drawWaveforms();
    state.animationId = requestAnimationFrame(renderLoop);
}

function switchTab(tabName) {
    tabs.forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    Object.entries(views).forEach(([name, section]) => {
        section.classList.toggle('active', name === tabName);
    });
    if (tabName === 'flower') {
        resizeFlowerCanvas();
    } else {
        resizeCanvas();
    }
}

function metricBarWidth(value) {
    return Math.max(3, Math.min(100, Math.round((value / 2.2) * 100)));
}

function stateConfidenceLabel(score) {
    if (score >= 0.72) return 'alto';
    if (score >= 0.48) return 'medio';
    return 'bajo';
}

function renderBandBar(bands) {
    flowerBandBar.innerHTML = '';
    const sorted = [...bands].sort((a, b) => b.relativePower - a.relativePower);
    sorted.forEach((band) => {
        const chip = document.createElement('div');
        chip.className = 'band-chip';
        chip.innerHTML = `
            <span class="band-chip-dot" style="background:${band.color}"></span>
            <span>${band.emoji} ${band.name}</span>
            <span class="band-chip-pct">${band.percentage.toFixed(1)}%</span>
        `;
        flowerBandBar.appendChild(chip);
    });
}

function renderFlowerAnalysis(report) {
    const { bands, metrics, morphology, derivedStates } = report;
    const sortedBands = [...bands].sort((a, b) => b.relativePower - a.relativePower);

    const metricItems = [
        metrics.activation,
        metrics.internalLoad,
        metrics.immersion,
        metrics.regulation,
        metrics.experientialIntensity,
    ];

    flowerAnalysis.innerHTML = `
        <h2>Análisis final</h2>

        <section class="analysis-section">
            <h3>1) Qué puede leerse realmente de cada banda</h3>
            <ul>
                ${sortedBands.map((band) => `
                    <li>
                        <strong>${band.emoji} ${band.name} (${band.low}–${band.high} Hz):</strong>
                        ${band.defendable} <em>Lectura útil:</em> ${band.usefulRead} <strong>(${band.percentage.toFixed(1)}%)</strong>
                    </li>
                `).join('')}
            </ul>
        </section>

        <section class="analysis-section">
            <h3>2) Estados humanos = relaciones entre bandas</h3>
            <p>
                La lectura no se basa en una sola banda aislada. Los estados emergen de patrones compuestos entre Delta,
                Theta, Alpha, Beta y Gamma. Por eso la flor transforma relaciones en forma, no "una banda = una emoción".
            </p>
        </section>

        <section class="analysis-section">
            <h3>3) Métricas compuestas defendibles</h3>
            <div class="metric-grid">
                ${metricItems.map((item) => `
                    <article class="metric-card">
                        <div class="metric-title">
                            <strong>${item.label}</strong>
                            <span class="metric-formula">${item.formula}</span>
                        </div>
                        <div class="metric-title">
                            <span>${item.meaning}</span>
                            <strong>${item.value.toFixed(2)} (${item.level})</strong>
                        </div>
                        <div class="metric-bar">
                            <div class="metric-fill" style="width:${metricBarWidth(item.value)}%"></div>
                        </div>
                    </article>
                `).join('')}
            </div>
        </section>

        <section class="analysis-section">
            <h3>4) Estados humanos derivados (sin inventar emociones)</h3>
            <div class="state-tags">
                ${derivedStates.map((state) => `
                    <span class="state-tag">${state.label}<small>${stateConfidenceLabel(state.score)}</small></span>
                `).join('')}
            </div>
        </section>

        <section class="analysis-section">
            <h3>5) Traducción a la morfología floral</h3>
            <ul>
                <li><strong>Apertura total:</strong> ${(morphology.openness * 100).toFixed(0)}% (activación mental).</li>
                <li><strong>Peso / caída:</strong> ${(morphology.weight * 100).toFixed(0)}% (carga interna).</li>
                <li><strong>Curvatura orgánica:</strong> ${(morphology.curvature * 100).toFixed(0)}% (inmersión subjetiva).</li>
                <li><strong>Simetría:</strong> ${(morphology.symmetry * 100).toFixed(0)}% (equilibrio regulatorio).</li>
                <li><strong>Brillo / textura:</strong> ${(morphology.brightness * 100).toFixed(0)}% (intensidad experiencial).</li>
            </ul>
        </section>

        <section class="analysis-section">
            <h3>6) Lectura de estado desde la flor</h3>
            <p>
                Esta visualización permite lectura defendible del estado: combinaciones de apertura, caída, simetría,
                curvatura y brillo muestran patrones como calma, fatiga, tensión cognitiva, absorción o saturación,
                sin reducir la experiencia humana a una sola banda.
            </p>
        </section>
    `;
}

function buildFlowerFromJson(jsonData) {
    try {
        const analyzer = new FlowerEEGAnalyzer(jsonData);
        const report = analyzer.getReport();
        state.flowerReport = report;
        state.flowerRenderer = new Flower2DRenderer(flowerCanvas, report);
        resizeFlowerCanvas();
        renderBandBar(report.bands);
        renderFlowerAnalysis(report);
        btnExportFlower.disabled = false;
        switchTab('flower');
        setStatus('Flor 2D y análisis generados.', 'success');
    } catch (err) {
        console.error(err);
        alert(`No se pudo generar la flor: ${err.message}`);
    }
}

async function buildFlowerFromFile() {
    const file = flowerJsonInput.files && flowerJsonInput.files[0];
    if (!file) {
        alert('Selecciona un archivo JSON EEG primero.');
        return;
    }

    try {
        btnFlowerFile.disabled = true;
        btnFlowerFile.textContent = 'Analizando...';
        const text = await file.text();
        const data = JSON.parse(text);
        buildFlowerFromJson(data);
    } catch (err) {
        console.error(err);
        alert(`JSON inválido: ${err.message}`);
    } finally {
        btnFlowerFile.disabled = false;
        btnFlowerFile.textContent = '🌸 Analizar archivo y crear flor';
    }
}

function buildFlowerFromLatestCapture() {
    if (!state.latestStatus?.metadata?.total_samples) {
        alert('No hay captura disponible aún. Realiza una toma EEG primero.');
        return;
    }
    buildFlowerFromJson(state.latestStatus);
}

async function convertJsonFileToMidi() {
    try {
        const file = jsonFileInput.files && jsonFileInput.files[0];
        if (!file) {
            alert('Selecciona primero un archivo JSON.');
            return;
        }

        const text = await file.text();
        const jsonData = JSON.parse(text);

        btnConvertMidi.disabled = true;
        btnConvertMidi.textContent = 'Convirtiendo...';

        const midiBlob = await api.convertJsonToMidi(jsonData);
        const filename = `${file.name.replace(/\.json$/i, '') || 'eeg'}.mid`;
        downloadBlob(midiBlob, filename);
    } catch (err) {
        console.error(err);
        alert(`No se pudo convertir JSON a MIDI: ${err.message}`);
    } finally {
        btnConvertMidi.disabled = false;
        btnConvertMidi.textContent = '🎵 Convertir a MIDI';
    }
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

btnStart.addEventListener('click', startCapture);
btnStop.addEventListener('click', stopCapture);
btnDownloadJson.addEventListener('click', () => {
    window.location.href = '/api/capture/download-json';
});
btnConvertMidi.addEventListener('click', convertJsonFileToMidi);
btnFlowerFile.addEventListener('click', buildFlowerFromFile);
btnFlowerLatest.addEventListener('click', buildFlowerFromLatestCapture);
btnExportFlower.addEventListener('click', () => {
    if (!state.flowerRenderer) return;
    state.flowerRenderer.exportPNG('flor_neurofuncional_2d.png');
});

window.addEventListener('resize', () => {
    resizeCanvas();
    resizeFlowerCanvas();
});

async function init() {
    resizeCanvas();
    await refreshStatus();
    ensurePolling();
    renderLoop();
    switchTab('capture');
}

init();
