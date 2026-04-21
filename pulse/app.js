/**
 * App Controller — Pulso Neurofuncional
 * Ties EEG band analysis, 2D pulse, 3D pulse, and UI together
 */

(function () {
    'use strict';

    // ── State ─────────────────────────────────────────────────────────────
    let analyzer = null;
    let pulse2d = null;
    let pulse3d = null;
    let currentTab = 'pulse2d';

    // ── DOM Elements ──────────────────────────────────────────────────────
    const uploadSection = document.getElementById('upload-section');
    const mainContent = document.getElementById('main-content');
    const fileInput = document.getElementById('file-input');
    const btnUpload = document.getElementById('btn-upload');
    const btnDemo = document.getElementById('btn-demo');
    const uploadArea = document.getElementById('upload-area');

    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.tab-panel');
    const canvas2d = document.getElementById('pulse-2d-canvas');
    const container3d = document.getElementById('pulse-3d-container');
    const analysisContent = document.getElementById('analysis-content');
    const bandBar = document.getElementById('band-bar');

    const btnExport2d = document.getElementById('btn-export-2d');
    const btnExport3d = document.getElementById('btn-export-3d');
    const printSizeSelect = document.getElementById('print-size-mm');
    const printExportFormat = document.getElementById('print-export-format');

    // ── File Upload ───────────────────────────────────────────────────────
    btnUpload.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) loadFile(e.target.files[0]);
    });

    // Drag & Drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
    });

    // Demo button: load ../SAD 1.json
    btnDemo.addEventListener('click', async () => {
        try {
            btnDemo.textContent = 'Cargando...';
            const resp = await fetch('../SAD%201.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            processData(data);
        } catch (err) {
            alert('No se pudo cargar el archivo de ejemplo.\n' +
                  'Asegúrate de correr esto en un servidor local (ej: Live Server).\n\n' +
                  'Error: ' + err.message);
            btnDemo.textContent = '💫 Usar datos de ejemplo';
        }
    });

    function loadFile(file) {
        if (!file.name.endsWith('.json')) {
            alert('Por favor selecciona un archivo .json');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                processData(data);
            } catch (err) {
                alert('Error leyendo el JSON: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    // ── Process Data ──────────────────────────────────────────────────────
    function processData(jsonData) {
        if (!jsonData.eeg_channels || !jsonData.metadata) {
            alert('El archivo JSON no tiene el formato esperado (requiere eeg_channels y metadata).');
            return;
        }

        // Analyze
        analyzer = new EEGBandAnalyzer(jsonData);
        const report = analyzer.getReport();

        // Show main content
        uploadSection.style.display = 'none';
        mainContent.style.display = 'flex';

        const btnBack = document.getElementById('btn-back');
        if (btnBack) btnBack.style.display = 'inline-flex';

        // Render band bar
        renderBandBar(report.bands);

        // Render analysis
        renderAnalysis(report);

        // Draw 2D pulse
        draw2DPulse();

        // Switch to 2D tab
        switchTab('pulse2d');
    }

    // ── 2D Pulse (replaces Pulse2D — REVERT: change LavaPulse → Pulse2D and use pulse2d.draw(size)) ──
    function draw2DPulse() {
        if (!analyzer) return;
        if (pulse2d) pulse2d.stop();
        const containerW = canvas2d.parentElement.clientWidth;
        const size = Math.min(1200, Math.max(600, containerW));
        canvas2d.width = size;
        canvas2d.height = size;
        canvas2d.style.width = '100%';
        canvas2d.style.height = 'auto';
        pulse2d = new LavaPulse(canvas2d, analyzer);
        pulse2d.start();
    }

    // ── 3D Pulse ─────────────────────────────────────────────────────────
    function init3DPulse() {
        if (!analyzer) return;
        if (pulse3d) pulse3d.destroy();
        pulse3d = new Pulse3D(container3d, analyzer);
        pulse3d.init();
    }

    // ── Tabs ──────────────────────────────────────────────────────────────
    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    function switchTab(tabName) {
        // Pause/resume pulse animation on tab changes
        if (currentTab === 'pulse2d' && tabName !== 'pulse2d' && pulse2d) {
            pulse2d.stop();
        }
        if (tabName === 'pulse2d' && pulse2d) {
            pulse2d.start();
        }

        currentTab = tabName;
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        panels.forEach(p => p.classList.toggle('active', p.id === `panel-${tabName}`));

        if (tabName === 'pulse3d' && analyzer && !pulse3d) {
            setTimeout(() => init3DPulse(), 100);
        }
        if (tabName === 'pulse3d' && pulse3d) {
            pulse3d._onResize();
        }
    }

    // ── Band Bar (bottom summary) ─────────────────────────────────────────
    function renderBandBar(bands) {
        bandBar.innerHTML = '';
        // Sort by power for display
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

    // ── Analysis Panel ────────────────────────────────────────────────────
    function renderAnalysis(report) {
        const profile = report.profile;
        const bands = report.bands;

        const html = `
            <!-- Band Detail Cards -->
            <div class="analysis-card">
                <h3>🌋 Anatomía de tu Pulso</h3>
                <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:1rem;line-height:1.6">
                    Cada banda de frecuencia cerebral moldea la forma, color y velocidad del pulso.
                    El tamaño y complejidad de la curva refleja la potencia relativa de cada banda.
                </p>
                <div class="band-detail-grid">
                    ${bands.map(band => renderBandCard(band)).join('')}
                </div>
            </div>

            <!-- Pulse Interpretation -->
            <div class="analysis-card pulse-meaning-card">
                <h3>🌋 Lectura de tu Pulso</h3>
                <div class="pulse-meaning-text">
                    ${report.interpretation}
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
                    ${band.petalMeaning}
                </div>
            </div>
        `;
    }

    function renderMetric(label, value, textLabel) {
        const barWidth = clamp(value * 100, 2, 98);
        return `
            <div class="metric-item">
                <span class="metric-label">${label}</span>
                <span class="metric-value">${textLabel}</span>
                <div class="metric-bar">
                    <div class="metric-fill" style="width:${barWidth}%"></div>
                </div>
            </div>
        `;
    }

    // ── Export ─────────────────────────────────────────────────────────────
    if (btnExport2d) {
        btnExport2d.addEventListener('click', () => {
            if (pulse2d) pulse2d.exportPNG('pulso_lava_eeg.png');
        });
    }
    if (btnExport3d) {
        btnExport3d.addEventListener('click', async () => {
            // Guard: pulse must be ready
            if (!pulse3d) {
                showExportStatus('⚠️ Primero carga un archivo EEG y abre la pestaña 3D.', 'warn');
                return;
            }

            const selectedSize = Number(printSizeSelect?.value || 120);
            const format = printExportFormat?.value || 'glb+3mf';

            // Show loading state
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
                    } catch (_) {
                        // ignore JSON parse failures
                    }
                    throw new Error(message);
                }

                const blob = await response.blob();
                const filename = `pulso_neurofuncional_${selectedSize}mm_${format.replace('+', '_')}.zip`;
                downloadBlob(blob, filename);

                const instrEl = document.getElementById('export-instructions');
                if (instrEl) instrEl.style.display = 'none';

                showExportStatus('✅ Conversión completada con Python. ZIP descargado listo para tu slicer.', 'success');
            } catch (err) {
                console.error('Export error:', err);

                // Fallback instructions if local API is not running
                const cmdEl = document.getElementById('export-cmd');
                if (cmdEl) cmdEl.textContent = 'python pulse_local_server.py';
                const instrEl = document.getElementById('export-instructions');
                if (instrEl) instrEl.style.display = 'flex';

                showExportStatus(
                    '❌ No se pudo conectar al convertidor Python local. Inicia: python pulse_local_server.py',
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
        let statusEl = document.getElementById('export-status');
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.className = 'export-status export-status--' + type;
        statusEl.style.display = 'block';
        if (type === 'info') {
            clearTimeout(statusEl._timer);
            statusEl._timer = setTimeout(() => { statusEl.style.display = 'none'; }, 8000);
        }
    }

    // ── Back Button ───────────────────────────────────────────────────────
    const btnBack = document.getElementById('btn-back');
    if (btnBack) {
        btnBack.addEventListener('click', () => {
            if (pulse3d) { pulse3d.destroy(); pulse3d = null; }
            if (pulse2d) { pulse2d.stop(); pulse2d = null; }
            analyzer = null;
            mainContent.style.display = 'none';
            uploadSection.style.display = 'flex';
            btnDemo.innerHTML = '<span>💫</span> Usar datos de ejemplo';
        });
    }

})();
