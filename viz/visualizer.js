
// Main Visualization Logic

const canvas = document.getElementById('neuro-canvas');
const ctx = canvas.getContext('2d');
const statusElem = document.getElementById('connection-status');
const statusDot = document.querySelector('.status-dot');

// UI Elements
const btnPlay = document.getElementById('btn-play');
const btnPause = document.getElementById('btn-pause');
const speedSlider = document.getElementById('speed-slider');
const timeScrubber = document.getElementById('time-scrubber');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');

// Psycho Panel Elements
const psyTitle = document.getElementById('psy-state-title');
const psyDesc = document.getElementById('psy-state-desc');
const colorSwatch = document.getElementById('current-color');
const colorName = document.getElementById('color-name');
const ampVal = document.getElementById('amp-val');
const freqVal = document.getElementById('freq-val'); // Simulated frequency

// State
let isPlaying = false;
let playbackSpeed = 2; // Samples per frame
let curIndex = 0;
let windowSize = 400; // How many samples to show on screen
let dataLoader;
let animationId;

// Psychology Mappings based on Amplitude % (relative to global min/max)
// Vibrant palette from flower/style.css
const FLOWER_PALETTE = [
    { threshold: 0.20, color: '#8B5CF6', name: 'Delta', desc: 'Sueño profundo, relajación.' },
    { threshold: 0.40, color: '#22C55E', name: 'Theta', desc: 'Meditación, creatividad.' },
    { threshold: 0.60, color: '#EC4899', name: 'Alpha', desc: 'Calma, serenidad.' },
    { threshold: 0.80, color: '#F97316', name: 'Beta', desc: 'Concentración, alerta.' },
    { threshold: 1.01, color: '#EAB308', name: 'Gamma', desc: 'Procesamiento, cognición.' }
];

// Initialize
async function init() {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Load Data
    // NOTE: In a real scenario, this URL might be dynamic or relative
    // Assuming file is in parent directory, but fetch usually needs server.
    // For local file opening (file://), fetch won't work due to CORS.
    // We assume this runs on a local server or extension webview.
    // Trying relative path to the provided JSON example.
    const jsonPath = '../SAD 1.json'; 
    
    // Check if we are in expected environment
    try {
        statusElem.textContent = `Cargando ${jsonPath}...`;
        
        // Note: For VS Code extension we might need a different path strategy or direct injection.
        // But following standard web logic:
        dataLoader = new EEGDataLoader(jsonPath);
        await dataLoader.load(); // This calls the load method from data_loader.js

        // Setup UI ranges
        const totalSamples = dataLoader.getLength();
        timeScrubber.max = totalSamples;
        const totalSeconds = totalSamples / dataLoader.stats.sampleRate;
        totalTimeEl.textContent = formatTime(totalSeconds);

        statusElem.textContent = "Datos listos | Dale PLAY para iniciar";
        statusDot.classList.add('active');
        statusDot.style.backgroundColor = "#00FF00"; // Green for ready

        // Ensure we handle loop state if user clicks play
        // Don't auto-start loop here, wait for click
        // But draw first frame
        update(); 

    } catch (e) {
        statusElem.textContent = "Error: " + e.message;
        statusDot.style.backgroundColor = "#FF0000";
        console.error(e);
        
        // Fallback for demo if fetch fails (common in local file opening)
        alert("No se pudo cargar el JSON automáticamente (CORS/Ruta). Asegúrate de correr esto en un servidor local o ajusta la ruta.");
    }
}

function resizeCanvas() {
    // Canvas size should match its container size, not window
    const container = document.querySelector('.viz-container');
    if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
    } else {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Playback Controls
btnPlay.addEventListener('click', () => {
    isPlaying = true;
    btnPlay.classList.add('hidden');
    btnPause.classList.remove('hidden');
    loop();
});

btnPause.addEventListener('click', () => {
    isPlaying = false;
    btnPause.classList.add('hidden');
    btnPlay.classList.remove('hidden');
    cancelAnimationFrame(animationId);
});

speedSlider.addEventListener('input', (e) => {
    playbackSpeed = parseInt(e.target.value);
});

timeScrubber.addEventListener('input', (e) => {
    curIndex = parseInt(e.target.value);
    update(); // Update single frame
});

// Main Loop
function loop() {
    if (!isPlaying) return;
    
    update();
    
    // Advance time
    curIndex += playbackSpeed;
    if (curIndex >= dataLoader.getLength() - windowSize) {
        curIndex = 0; // Loop seamlessly
    }
    
    // Update scrubber UI occasionally
    timeScrubber.value = curIndex;

    animationId = requestAnimationFrame(loop);
}

// Logic & Render
function update() {
    if (!dataLoader || !dataLoader.isLoaded) return;

    // Clean white background, no animation
    ctx.fillStyle = '#FAFAF8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Update Stats UI
    const currentSample = dataLoader.getSample(curIndex + windowSize/2); // Sample at middle of window
    const avgAmp = currentSample.reduce((a, b) => a + b, 0) / 4;
    
    // Determine Psycho State
    // Normalize amplitude relative to min/max
    const range = dataLoader.stats.max - dataLoader.stats.min;
    const normalized = (avgAmp - dataLoader.stats.min) / (range || 1);
    
    // Clamp 0-1
    const clamped = Math.max(0, Math.min(1, normalized));

    // Find matching band color
    const state = FLOWER_PALETTE.find(s => clamped <= s.threshold) || FLOWER_PALETTE[FLOWER_PALETTE.length - 1];
    
    // Apply Psycho State to UI
    psyTitle.textContent = state.name;
    psyDesc.textContent = state.desc;
    colorSwatch.style.backgroundColor = state.color;
    colorName.textContent = state.name;
    ampVal.textContent = Math.round(avgAmp) + " µV";
    
    // Fake frequency for display (since we don't have FFT data readily available in raw time series without heavy computation)
    // We can map variability to "frequency" visually
    const approxFreq = 10 + (clamped * 30); // 10Hz - 40Hz range mapping
    freqVal.textContent = Math.round(approxFreq) + " Hz (Est.)";
    
    const uiSeconds = curIndex / dataLoader.stats.sampleRate;
    currentTimeEl.textContent = formatTime(uiSeconds);

    // --- DRAWING ---
    // No DJ/mandala animation
    drawWaveforms();
}

function drawBackground(color, intensity) {
    // No animation, just static background
    ctx.fillStyle = '#FAFAF8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawPulseAura(color, intensity) {
    // No aura/mandala effect
    // Function left empty intentionally
    return;
}

function drawWaveforms() {
    const channels = [
        { data: [], color: '#FF5A5F' }, // TP9
        { data: [], color: '#00A8E8' }, // AF7
        { data: [], color: '#A2D800' }, // AF8
        { data: [], color: '#F7B500' }  // TP10
    ];

    // Get slice of data for the window
    for (let i = 0; i < 4; i++) {
        const rawSlice = dataLoader.channels[i].slice(curIndex, curIndex + windowSize);
        channels[i].data = rawSlice;
    }

    const h = canvas.height;
    const w = canvas.width;
    const laneHeight = h / 4;
    
    channels.forEach((ch, idx) => {
        if (ch.data.length < 2) return;

        const centerY = (laneHeight * idx) + (laneHeight / 2);
        
        ctx.beginPath();
        // Dynamic line width based on signal variance?
        ctx.lineWidth = 3; 
        ctx.lineJoin = 'round';
        ctx.strokeStyle = ch.color;
        
        // Massive Glow for "Neon" look
        ctx.shadowBlur = 15;
        ctx.shadowColor = ch.color;

        for (let i = 0; i < ch.data.length; i++) {
            // Draw slightly past window for smoothness
            const x = (i / windowSize) * w;
            
            const val = ch.data[i];
            const range = dataLoader.stats.max - dataLoader.stats.min;
            const normalized = (val - dataLoader.stats.min) / (range || 1); 
            
            // Allow lines to overlap slightly for more organic look
            const yOffset = (normalized - 0.5) * (laneHeight * 1.5) * -1; 
            
            const y = centerY + yOffset;

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        
        ctx.stroke();
        
        // Reset shadow
        ctx.shadowBlur = 0;

        // Floating Label with background
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(10, centerY - 30, 50, 20);
        ctx.fillStyle = ch.color;
        ctx.font = "bold 14px monospace";
        ctx.fillText(`CH${idx+1}`, 15, centerY - 15);
    });
    
    // Beat Line (Scanline)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Center scanline style? Or right edge?
    // Let's do right edge as "current time"
    ctx.moveTo(w - 5, 0);
    ctx.lineTo(w - 5, h);
    ctx.stroke();
}

// Utility
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Start
// init() called at end of file.

// DJ Mode: Update canvas only if playing or scrubbing
// But we want an "Idle" animation if not playing?
// No, user said "arranque al darle play". So static until play.
// But we need to render the first frame.

// Add listener to window resize to fix particles
window.addEventListener('resize', () => {
    resizeCanvas(); // Use the dedicated resize function
    window.particles = null; // Reset particles
    if (!isPlaying) update(); // Redraw static frame
});

init();
