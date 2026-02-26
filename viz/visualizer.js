
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
// Based on psicologia_musica_color.md
const PSY_MAP = [
    { threshold: 0.20, color: '#FF80AB', name: 'Rosa (Calma)', desc: 'Amor, bondad, romance. Alivia estados depresivos.' },
    { threshold: 0.40, color: '#00C853', name: 'Verde (Relax)', desc: 'Relajación, elimina emociones negativas. Promueve el sueño.' },
    { threshold: 0.60, color: '#2962FF', name: 'Azul (Profundo)', desc: 'Introspección, tristeza o calma profunda. Alivia tensión.' },
    { threshold: 0.80, color: '#FF6D00', name: 'Naranja (Euforia)', desc: 'Equilibrio, euforia. Estado energético positivo.' },
    { threshold: 1.01, color: '#D50000', name: 'Rojo (Excitación)', desc: 'Agresión, excitación intensa, sistema nervioso activado.' }
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

    // Use partial transparency for trail effect ("DJ Style")
    ctx.fillStyle = 'rgba(5, 5, 10, 0.15)'; 
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

    // Find matching state
    const state = PSY_MAP.find(s => clamped <= s.threshold) || PSY_MAP[PSY_MAP.length - 1];
    
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
    drawBackground(state.color, clamped);
    drawPulseAura(state.color, clamped);
    drawWaveforms();
}

function drawBackground(color, intensity) {
    // DJ Style Background Animation: Floating Particles
    if (!window.particles) {
        window.particles = Array(60).fill().map(() => ({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 4,
            speed: Math.random() * 2 + 0.5
        }));
    }

    ctx.fillStyle = hexToRgba(color, 0.4 + (intensity * 0.6));
    
    window.particles.forEach(p => {
        if (isPlaying) {
             // Stats based movement
            p.y -= p.speed * (1 + intensity * 3);
            
            // Loop particles
            if (p.y < 0) {
                p.y = canvas.height;
                p.x = Math.random() * canvas.width;
            }
        }

        ctx.beginPath();
        // Pulsing size
        const pulse = isPlaying ? Math.sin(Date.now() * 0.01) * 2 : 0;
        ctx.arc(p.x, p.y, Math.max(0.5, p.size + (intensity * 3)), 0, Math.PI * 2);
        ctx.fill();
    });
}

function drawPulseAura(color, intensity) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const time = Date.now() * 0.002; // Slower rotation
    
    // Smooth Liquid Blob effect using Sine waves
    const baseRadius = 200 + (intensity * 60);
    const numPoints = 120; // More points for smoothness
    
    ctx.beginPath();
    ctx.strokeStyle = hexToRgba(color, 0.6);
    ctx.lineWidth = 3;
    // Glow
    ctx.shadowBlur = 20 + intensity * 20;
    ctx.shadowColor = color;
    
    // We'll store points to close the loop smoothly
    // Use multiple sine waves to create organic "blob" shape
    for (let i = 0; i <= numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        
        // Organic modulation:
        // Wave 1: Slow breathing (3 peaks)
        const wave1 = Math.sin(angle * 3 + time) * 20;
        // Wave 2: Faster ripple based on intensity (5 peaks)
        const wave2 = Math.sin(angle * 5 - time * 2) * (10 + intensity * 40);
        // Wave 3: Subtle detail
        const wave3 = Math.cos(angle * 2 + time * 1.5) * 15;

        const r = baseRadius + wave1 + wave2 + wave3;
        
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    
    ctx.closePath(); // Connects last point to first
    ctx.stroke();
    
    // Reset shadow
    ctx.shadowBlur = 0;
    
    // Inner filled blob (smoother, smaller)
    ctx.beginPath();
    const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, baseRadius * 1.5);
    grad.addColorStop(0, hexToRgba(color, 0.3 + intensity * 0.4));
    grad.addColorStop(0.6, hexToRgba(color, 0.1));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    
    ctx.fillStyle = grad;
    
    for (let i = 0; i <= numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        // Slightly different phase for inner blob
        const r = (baseRadius * 0.7) + Math.sin(angle * 3 - time) * 15 + Math.cos(angle * 4 + time) * 10;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.fill();
    ctx.closePath();
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
