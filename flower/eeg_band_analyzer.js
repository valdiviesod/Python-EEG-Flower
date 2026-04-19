/**
 * EEG Band Analyzer — Frequency Band Power Extraction Engine
 *
 * Analyzes raw Muse 2 EEG data and decomposes it into 5 frequency bands:
 *   • Base     (0.5–4 Hz)   → Nivel de inmersión corporal / profundidad
 *   • Flujo    (4–8 Hz)     → Movimiento interno, deriva, asociación
 *   • Pulso    (8–13 Hz)    → Estabilidad y continuidad de la atención
 *   • Trazo    (13–30 Hz)   → Dirección, intención, acción
 *   • Destello (30–44 Hz)   → Momentos de intensidad o claridad
 *
 * Each band becomes a petal layer in the flower visualization.
 *
 * Why these colors (vibrant, botanical):
 *   Base     → Lavender (#8B5CF6)  — Noche, descanso profundo, quietud del crepúsculo
 *   Flujo    → Sage (#22C55E)      — Crecimiento, brotes nuevos, germinación creativa
 *   Pulso    → Rose (#EC4899)      — Florecimiento, conciencia suave, apertura gentil
 *   Trazo    → Peach (#F97316)     — Calor, energía activa, vitalidad diurna
 *   Destello → Lemon (#EAB308)     — Luz solar, iluminación, claridad suprema
 *
 * Muse 2 channels:
 *   Channel 1 = TP9  (left temporal)
 *   Channel 2 = AF7  (left frontal)
 *   Channel 3 = AF8  (right frontal)
 *   Channel 4 = TP10 (right temporal)
 */

// ─── Band Constants ──────────────────────────────────────────────────────────
const BANDS = [
    {
        name: 'Base', key: 'delta',
        low: 0.5, high: 4,
        color: '#8B5CF6', colorDeep: '#6D28D9', colorLight: '#C4B5FD',
        emoji: '🌙',
        meaning: 'Nivel de inmersión corporal / profundidad',
        description: 'La onda Base representa los procesos inconscientes más profundos — ' +
            'la inmersión total del cuerpo, la regeneración celular y la sanación desde lo invisible. ' +
            'Como las raíces de una flor, nutren todo lo que crece desde las profundidades.',
        petalMeaning: 'Los pétalos de Base forman la capa envolvente de la flor, ' +
            'anchos y suaves como la noche que abraza el descanso más profundo. ' +
            'Su tono lavanda evoca la quietud del crepúsculo y la inmersión total.'
    },
    {
        name: 'Flujo', key: 'theta',
        low: 4, high: 8,
        color: '#22C55E', colorDeep: '#15803D', colorLight: '#86EFAC',
        emoji: '🌿',
        meaning: 'Movimiento interno, deriva, asociación',
        description: 'Flujo es el puente entre lo consciente y lo inconsciente — ' +
            'el espacio del movimiento interno, la deriva libre y la asociación creativa. ' +
            'Como un brote verde que emerge, conecta la semilla con la luz del día.',
        petalMeaning: 'Los pétalos de Flujo son alargados y elegantes, como hojas nuevas ' +
            'que se mueven suavemente con la brisa. Su verde representa el movimiento ' +
            'interno y la frescura de las asociaciones emergentes.'
    },
    {
        name: 'Pulso', key: 'alpha',
        low: 8, high: 13,
        color: '#EC4899', colorDeep: '#BE185D', colorLight: '#F9A8D4',
        emoji: '🌸',
        meaning: 'Estabilidad y continuidad de la atención',
        description: 'Pulso es el estado de relajación alerta — ' +
            'la estabilidad de la presencia, la atención que fluye sin esfuerzo. ' +
            'Es la flor en su máximo esplendor, abierta y continua en su ritmo propio.',
        petalMeaning: 'Los pétalos de Pulso son los más prominentes y abiertos, ' +
            'como una rosa en plena floración que late con ritmo constante. ' +
            'Su color rosado vibrante transmite la dulzura de la atención sostenida.'
    },
    {
        name: 'Trazo', key: 'beta',
        low: 13, high: 30,
        color: '#F97316', colorDeep: '#C2410C', colorLight: '#FDBA74',
        emoji: '☀️',
        meaning: 'Dirección, intención, acción',
        description: 'Trazo refleja la mente consciente en acción dirigida — ' +
            'la resolución de problemas, la intención clara, la acción con propósito. ' +
            'Es la energía del mediodía, trazando caminos con precisión y vitalidad.',
        petalMeaning: 'Los pétalos de Trazo son más agudos y definidos, ' +
            'como rayos de sol que se extienden con dirección e intención. ' +
            'Su tono durazno cálido representa la energía de la acción consciente.'
    },
    {
        name: 'Destello', key: 'gamma',
        low: 30, high: 44,
        color: '#EAB308', colorDeep: '#A16207', colorLight: '#FDE047',
        emoji: '✨',
        meaning: 'Momentos de intensidad o claridad',
        description: 'Destello es la frecuencia más alta — ' +
            'momentos de insight súbito, claridad intensa, instantes de conciencia expandida. ' +
            'Es el destello dorado que ilumina el centro de todo lo que somos.',
        petalMeaning: 'Los pétalos de Destello son delicados y luminosos, ' +
            'como destellos de luz solar que aparecen y desaparecen con intensidad. ' +
            'Su dorado captura esos instantes de claridad y brillo absoluto.'
    },
];

// ─── Helper Utilities ────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 100) / 100;
    l = clamp(l, 0, 100) / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToRGB(hex) {
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16)
    };
}

// ─── Simple FFT Implementation (radix-2 Cooley-Tukey) ────────────────────────
function fft(re, im) {
    const n = re.length;
    if (n <= 1) return;

    // Bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        while (j & bit) {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }

    // Cooley-Tukey butterfly
    for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1;
        const angle = -2 * Math.PI / len;
        const wRe = Math.cos(angle);
        const wIm = Math.sin(angle);

        for (let i = 0; i < n; i += len) {
            let curRe = 1, curIm = 0;
            for (let j = 0; j < half; j++) {
                const uRe = re[i + j];
                const uIm = im[i + j];
                const vRe = re[i + j + half] * curRe - im[i + j + half] * curIm;
                const vIm = re[i + j + half] * curIm + im[i + j + half] * curRe;
                re[i + j] = uRe + vRe;
                im[i + j] = uIm + vIm;
                re[i + j + half] = uRe - vRe;
                im[i + j + half] = uIm - vIm;
                const newCurRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = newCurRe;
            }
        }
    }
}

// ─── Main Band Analyzer Class ────────────────────────────────────────────────
class EEGBandAnalyzer {
    constructor(jsonData) {
        this.raw = jsonData;
        this.metadata = jsonData.metadata || {};
        this.statistics = jsonData.statistics || {};
        this.timestamps = jsonData.timestamps || [];

        // Extract raw channel arrays
        const ch = jsonData.eeg_channels || {};
        const rawChannels = {
            tp9:  ch.channel_1 || [],
            af7:  ch.channel_2 || [],
            af8:  ch.channel_3 || [],
            tp10: ch.channel_4 || [],
        };

        // ── Preprocess: remove OSC duplicate artifacts, compute true sample rate
        const prep = this._preprocessData(rawChannels, this.timestamps, this.metadata);
        this.channels = prep.channels;
        this.sampleRate = prep.sampleRate;
        this.effectiveDuration = prep.duration;
        this.dataQuality = prep.quality;

        // ── Run analysis pipeline
        this.channelStats = this._computeChannelStats();
        this.bandPowers = this._computeBandPowers();
        this.normalizedBands = this._normalizeBands();
        this.emotionMetrics = this.computeEmotionMetrics();
        this.profile = this._computeFlowerProfile();
        this.flowerParams = this._computeFlowerParams();
    }

    // ── Data Preprocessing ────────────────────────────────────────────────
    //    Muse OSC capture often records each sample twice because both the
    //    specific /muse/eeg handler AND the wildcard "*" debug_handler fire.
    //    The metadata sample_rate_hz = total_samples / total_duration reflects
    //    the full capture session — not the last 1000 stored samples.
    //    This method fixes both issues so FFT frequency bins map correctly
    //    to the 5 EEG bands (Delta, Theta, Alpha, Beta, Gamma).
    _preprocessData(rawChannels, timestamps, metadata) {
        const channelNames = Object.keys(rawChannels);
        const refChannel = Object.values(rawChannels).find(ch => ch.length > 0);

        if (!refChannel || refChannel.length < 4) {
            return {
                channels: rawChannels,
                sampleRate: metadata.sample_rate_hz || 256,
                duration: metadata.duration_seconds || 0,
                quality: { deduplicated: false, duplicateRatio: 0,
                           samplesUsed: refChannel ? refChannel.length : 0,
                           originalSamples: refChannel ? refChannel.length : 0 },
            };
        }

        const origLen = refChannel.length;

        // 1. Detect consecutive duplicate samples
        let dupCount = 0;
        const checkLen = Math.min(origLen, 200);
        for (let i = 1; i < checkLen; i++) {
            if (refChannel[i] === refChannel[i - 1]) dupCount++;
        }
        const dupRatio = dupCount / (checkLen - 1);

        // 2. Deduplicate if >30% consecutive duplicates detected
        let channels = {};
        let keepIndices = null;

        if (dupRatio > 0.3) {
            keepIndices = [0];
            for (let i = 1; i < origLen; i++) {
                if (refChannel[i] !== refChannel[i - 1]) {
                    keepIndices.push(i);
                }
            }
            for (const name of channelNames) {
                const src = rawChannels[name];
                channels[name] = keepIndices.map(idx => idx < src.length ? src[idx] : 0);
            }
        } else {
            for (const name of channelNames) {
                channels[name] = [...rawChannels[name]];
            }
        }

        // 3. Compute actual sample rate from stored timestamps
        let sampleRate = metadata.sample_rate_hz || 256;
        let duration = metadata.duration_seconds || 0;

        if (timestamps.length >= 2) {
            const ts = keepIndices
                ? keepIndices.filter(i => i < timestamps.length).map(i => timestamps[i])
                : timestamps;
            if (ts.length >= 2) {
                const tDuration = ts[ts.length - 1] - ts[0];
                if (tDuration > 0.01) {
                    sampleRate = (ts.length - 1) / tDuration;
                    duration = tDuration;
                }
            }
        }

        // Clamp to reasonable EEG range (Muse 2 native ≈ 256 Hz)
        sampleRate = clamp(sampleRate, 64, 1024);

        const samplesUsed = Object.values(channels)[0]?.length || 0;

        return {
            channels,
            sampleRate,
            duration,
            quality: {
                deduplicated: dupRatio > 0.3,
                duplicateRatio: dupRatio,
                samplesUsed,
                originalSamples: origLen,
                computedSampleRate: Math.round(sampleRate * 10) / 10,
            },
        };
    }

    // ── Channel Statistics ────────────────────────────────────────────────
    _computeChannelStats() {
        const result = {};
        for (const [name, data] of Object.entries(this.channels)) {
            if (!data.length) {
                result[name] = { mean: 0, std: 0, min: 0, max: 0, range: 0, energy: 0 };
                continue;
            }
            const n = data.length;
            let sum = 0, sumSq = 0, mn = Infinity, mx = -Infinity;
            for (let i = 0; i < n; i++) {
                const v = data[i];
                if (v == null || isNaN(v)) continue;
                sum += v;
                sumSq += v * v;
                if (v < mn) mn = v;
                if (v > mx) mx = v;
            }
            const mean = sum / n;
            const variance = sumSq / n - mean * mean;
            const std = Math.sqrt(Math.max(0, variance));
            result[name] = { mean, std, min: mn, max: mx, range: mx - mn, energy: Math.sqrt(sumSq / n) };
        }
        return result;
    }

    // ── Band Power Extraction via FFT ─────────────────────────────────────
    //    Two strategies depending on data length:
    //    • Short (<1024 samples): single zero-padded FFT for maximum frequency resolution
    //    • Long  (≥1024 samples): Welch's method (averaged overlapping windows)
    //    Both use linear detrend + Hann window to prevent DC/drift inflating Delta.
    _computeBandPowers() {
        const allChannelBands = [];

        for (const [chName, data] of Object.entries(this.channels)) {
            if (data.length < 32) continue;

            let bandPowers;
            if (data.length >= 1024) {
                bandPowers = this._welchBandPower(data);
            } else {
                bandPowers = this._singleWindowBandPower(data);
            }

            if (bandPowers) allChannelBands.push(bandPowers);
        }

        if (allChannelBands.length === 0) {
            return BANDS.map(() => 1); // fallback
        }

        return BANDS.map((_, b) => {
            let sum = 0;
            for (const chBands of allChannelBands) sum += chBands[b];
            return sum / allChannelBands.length;
        });
    }

    // ── Single-window FFT with zero-padding (short recordings) ────────────
    //    Zero-padding to 4× interpolates the spectrum for finer frequency
    //    resolution, critical for resolving Delta (0.5–4 Hz) in ~2 s recordings.
    //    Linear detrend removes DC offset + slow drift artifacts.
    _singleWindowBandPower(data) {
        const n = data.length;
        const fftSize = this._nextPow2(Math.max(512, n * 4));

        // Linear detrend: remove slope + intercept
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        for (let i = 0; i < n; i++) {
            const v = data[i] || 0;
            sumX += i; sumY += v; sumXY += i * v; sumX2 += i * i;
        }
        const denom = n * sumX2 - sumX * sumX;
        const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
        const intercept = (sumY - slope * sumX) / n;

        const re = new Float64Array(fftSize);
        const im = new Float64Array(fftSize);

        for (let i = 0; i < n; i++) {
            const detrended = (data[i] || 0) - (slope * i + intercept);
            const hann = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
            re[i] = detrended * hann;
        }
        // Remaining indices stay 0 (zero-padding)

        fft(re, im);

        const freqRes = this.sampleRate / fftSize;
        const powers = [];

        for (let b = 0; b < BANDS.length; b++) {
            const band = BANDS[b];
            const binLow = Math.max(1, Math.floor(band.low / freqRes));
            const binHigh = Math.min(fftSize / 2 - 1, Math.ceil(band.high / freqRes));

            let power = 0;
            for (let k = binLow; k <= binHigh; k++) {
                power += re[k] * re[k] + im[k] * im[k];
            }
            // Normalize by actual sample count, not padded size
            powers.push(power / n);
        }

        return powers;
    }

    // ── Welch's method: averaged overlapping windows (longer recordings) ──
    //    Each window is linearly detrended, Hann-tapered, and zero-padded 2×.
    _welchBandPower(data) {
        const windowSize = this._prevPow2(Math.min(2048, data.length));
        if (windowSize < 128) return null;

        const fftSize = this._nextPow2(windowSize * 2); // 2× zero-pad
        const overlap = Math.floor(windowSize * 0.5);
        const step = windowSize - overlap;
        const numWindows = Math.max(1, Math.floor((data.length - windowSize) / step) + 1);

        const bandAccum = BANDS.map(() => 0);
        let validWindows = 0;

        for (let w = 0; w < numWindows; w++) {
            const start = w * step;
            const end = start + windowSize;
            if (end > data.length) break;

            // Linear detrend within window
            let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
            for (let i = 0; i < windowSize; i++) {
                const v = data[start + i] || 0;
                sumX += i; sumY += v; sumXY += i * v; sumX2 += i * i;
            }
            const denom = windowSize * sumX2 - sumX * sumX;
            const slope = denom !== 0 ? (windowSize * sumXY - sumX * sumY) / denom : 0;
            const intercept = (sumY - slope * sumX) / windowSize;

            const re = new Float64Array(fftSize);
            const im = new Float64Array(fftSize);

            for (let i = 0; i < windowSize; i++) {
                const detrended = (data[start + i] || 0) - (slope * i + intercept);
                const hann = 0.5 * (1 - Math.cos(2 * Math.PI * i / (windowSize - 1)));
                re[i] = detrended * hann;
            }

            fft(re, im);

            const freqRes = this.sampleRate / fftSize;

            for (let b = 0; b < BANDS.length; b++) {
                const band = BANDS[b];
                const binLow = Math.max(1, Math.floor(band.low / freqRes));
                const binHigh = Math.min(fftSize / 2 - 1, Math.ceil(band.high / freqRes));

                let power = 0;
                for (let k = binLow; k <= binHigh; k++) {
                    power += re[k] * re[k] + im[k] * im[k];
                }
                bandAccum[b] += power / windowSize;
            }
            validWindows++;
        }

        if (validWindows === 0) return null;
        return bandAccum.map(p => p / validWindows);
    }

    _nextPow2(n) {
        let p = 1;
        while (p < n) p <<= 1;
        return p;
    }

    _prevPow2(n) {
        let p = 1;
        while ((p << 1) <= n) p <<= 1;
        return p;
    }

    // ── Normalize band powers to percentages ──────────────────────────────
    // EEG follows ~1/f² spectrum: Delta has 10–100× more raw power than Gamma
    // by physics, not brain state. We apply per-band spectral compensation
    // (center_freq²) so all bands get equal visual weight at baseline, and
    // deviations from baseline — which encode the actual brain state — become
    // visible as distinct shapes and proportions.
    _normalizeBands() {
        // Center frequencies (geometric mean of band edges)
        const centerFreqs = BANDS.map(b => Math.sqrt(b.low * b.high));
        // Compensation: multiply raw power by f_center² to flatten 1/f² spectrum
        const compensated = this.bandPowers.map((p, i) => p * centerFreqs[i] * centerFreqs[i]);
        const compTotal = compensated.reduce((a, b) => a + b, 0) || 1;
        const rawTotal  = this.bandPowers.reduce((a, b) => a + b, 0) || 1;

        return this.bandPowers.map((p, i) => ({
            ...BANDS[i],
            absolutePower: p,
            relativePower: p / rawTotal,                          // true physics ratio (for emotion metrics)
            percentage: (compensated[i] / compTotal) * 100,       // perceptually balanced for display
            visualSize: Math.sqrt(compensated[i] / compTotal),    // sqrt for gentle visual scaling
        }));
    }

    // ── Emotion Metrics (composite sensations from band ratios) ─────────────
    // Values are normalized so the sum of all emotions equals 1 (100%).
    computeEmotionMetrics() {
        const bands = this.normalizedBands || [];
        const getRel = (key) => {
            const band = bands.find(b => b.key === key);
            return band ? band.relativePower : 0;
        };

        const d = getRel('delta');
        const t = getRel('theta');
        const a = getRel('alpha');
        const b = getRel('beta');
        const g = getRel('gamma');

        // Raw ratio clamped to [0,1] — represents relative intensity before normalization
        const clamp01 = (v, min, max) => {
            const norm = (v - min) / (max - min || 1);
            return Math.max(0, Math.min(1, norm));
        };

        const definitions = [
            { key: 'serenity',   label: 'Serenidad',           raw: clamp01(a / (b + g + 0.001), 0, 3),   color: '#EC4899', colorDeep: '#BE185D', emoji: '🕊️', description: 'Calma profunda y presencia' },
            { key: 'agitation',  label: 'Agitación',           raw: clamp01((b + g) / (a + 0.001), 0, 3), color: '#F97316', colorDeep: '#C2410C', emoji: '⚡',  description: 'Mente acelerada y activa' },
            { key: 'heaviness',  label: 'Pesadez',             raw: clamp01(d / (a + b + 0.001), 0, 3),   color: '#8B5CF6', colorDeep: '#6D28D9', emoji: '🪨',  description: 'Cansancio o densidad corporal' },
            { key: 'lightness',  label: 'Ligereza',            raw: clamp01((a + b) / (d + 0.001), 0, 5), color: '#EC4899', colorDeep: '#F97316', emoji: '🪶',  description: 'Sensación liviana y despejada' },
            { key: 'absorption', label: 'Absorción interna',   raw: clamp01(t / (b + 0.001), 0, 3),       color: '#22C55E', colorDeep: '#15803D', emoji: '🌀',  description: 'Ensimismamiento e imaginación' },
            { key: 'focus',      label: 'Enfoque externo',     raw: clamp01(b / (t + 0.001), 0, 3),       color: '#F97316', colorDeep: '#C2410C', emoji: '🎯',  description: 'Atención analítica dirigida' },
            { key: 'balance',    label: 'Equilibrio',          raw: clamp01(a / (t + b + 0.001), 0, 2),   color: '#EC4899', colorDeep: '#BE185D', emoji: '⚖️',  description: 'Regulación estable y centrada' },
            { key: 'dispersion', label: 'Dispersión',          raw: clamp01((t + b) / (a + 0.001), 0, 4), color: '#22C55E', colorDeep: '#F97316', emoji: '💨',  description: 'Desorganización mental' },
            { key: 'intensity',  label: 'Intensidad vivencial',raw: clamp01(g / (a + 0.001), 0, 2),       color: '#EAB308', colorDeep: '#A16207', emoji: '✨',  description: 'Experiencia vívida y saturada' },
            { key: 'neutrality', label: 'Neutralidad',         raw: clamp01(a / (g + 0.001), 0, 5),       color: '#F9A8D4', colorDeep: '#EC4899', emoji: '🫧',  description: 'Estado plano y neutro' },
        ];

        // Normalize so all values sum to 1 (proportional share of 100%)
        const total = definitions.reduce((sum, e) => sum + e.raw, 0) || 1;

        return definitions.map(({ raw, ...rest }) => ({
            ...rest,
            value: raw / total,
        }));
    }

    // ── Flower Profile (psychological mapping) ────────────────────────────
    _computeFlowerProfile() {
        const bands = this.normalizedBands;
        const s = this.channelStats;

        // Dominant band
        let maxIdx = 0;
        for (let i = 1; i < bands.length; i++) {
            if (bands[i].relativePower > bands[maxIdx].relativePower) maxIdx = i;
        }
        const dominant = bands[maxIdx];

        // Relaxation index: (alpha + theta) / (alpha + beta)
        const alphaP = bands[2].relativePower;
        const thetaP = bands[1].relativePower;
        const betaP = bands[3].relativePower;
        const deltaP = bands[0].relativePower;
        const gammaP = bands[4].relativePower;
        const relaxation = clamp((alphaP + thetaP) / (alphaP + betaP + 0.001), 0, 2);

        // Focus index: beta / (alpha + theta)
        const focus = clamp(betaP / (alphaP + thetaP + 0.001), 0, 2);

        // Meditation depth: theta / (beta + gamma)
        const meditation = clamp(thetaP / (betaP + gammaP + 0.001), 0, 2);

        // Creativity: theta * gamma relative
        const creativity = clamp((thetaP * gammaP) * 20, 0, 1);

        // Frontal asymmetry (valence)
        const af7 = s.af7 || { mean: 0 };
        const af8 = s.af8 || { mean: 0 };
        const fSum = Math.abs(af7.mean) + Math.abs(af8.mean) || 1;
        const valence = clamp((af7.mean - af8.mean) / fSum, -1, 1);

        // Overall arousal
        const overallMean = Object.values(s).reduce((a, ch) => a + ch.mean, 0) / 4;
        const maxExpected = 1650;
        const arousal = clamp(overallMean / maxExpected, 0, 1);

        // Determine dominant mental state
        let state;
        if (dominant.key === 'delta') {
            state = { label: 'Inmersión Profunda', icon: '🌙', desc: 'Tu cerebro muestra predominancia de Base — un estado de inmersión corporal y descanso en las profundidades.' };
        } else if (dominant.key === 'theta') {
            state = { label: 'Estado de Flujo', icon: '🧘', desc: 'Las ondas Flujo dominan — un estado de movimiento interno, deriva libre y asociación creativa.' };
        } else if (dominant.key === 'alpha') {
            state = { label: 'Pulso Consciente', icon: '🌸', desc: 'Pulso predomina — estás en un estado de atención estable y continua, presencia y equilibrio interior.' };
        } else if (dominant.key === 'beta') {
            state = { label: 'Trazo Activo', icon: '💡', desc: 'Trazo domina tu actividad cerebral — dirección clara, intención y acción con propósito.' };
        } else {
            state = { label: 'Destello de Claridad', icon: '✨', desc: 'Destello sobresale — momentos de intensidad, claridad súbita y conciencia expandida.' };
        }

        return {
            dominant,
            relaxation,
            focus,
            meditation,
            creativity,
            valence,
            arousal,
            state,
        };
    }

    // ── Flower Structural Parameters ──────────────────────────────────────
    _computeFlowerParams() {
        const bands = this.normalizedBands;
        const profile = this.profile;

        // Each band = a layer of petals
        // Petal count per layer based on band characteristics:
        //   Delta: 5 (broad waves = fewer, wider petals)
        //   Theta: 6 (moderate)
        //   Alpha: 8 (rhythmic, balanced)
        //   Beta:  10 (fast, many)
        //   Gamma: 12 (very fast, thin and numerous)
        const petalCounts = [8, 10, 13, 16, 20];

        const layers = bands.map((band, i) => {
            const power = band.relativePower;
            const vis = band.visualSize;
            const petalLength = lerp(0.15, 0.45, clamp(vis * 1.5, 0, 1));
            const lengthBoost = lerp(1.0, 1.32, clamp((petalLength - 0.28) / 0.17, 0, 1));

            return {
                band: band,
                petalCount: petalCounts[i],
                // Petal length: proportional to relative power
                petalLength: petalLength,
                // Petal width: delta=wide, gamma=narrow + extra width for longer petals
                petalWidth: lerp(0.12, 0.04, i / 4) * lengthBoost,
                // Petal height (3D): proportional to power
                petalHeight: lerp(0.1, 0.8, clamp(power * 3, 0, 1)),
                // Inner radius: layers from center outward
                innerRadius: lerp(0.08, 0.04, i / 4),
                // Rotation offset
                rotation: (i * Math.PI) / (BANDS.length * 2),
                // Opacity based on power
                opacity: clamp(lerp(0.4, 0.95, vis * 2), 0.35, 0.95),
            };
        });

        // Stem size: taller for more relaxed states
        const stemHeight = lerp(0.3, 0.5, profile.relaxation / 2);

        // Center size: larger for alpha-dominant (the bloom)
        const centerSize = lerp(0.04, 0.08, bands[2].visualSize);

        return {
            layers,
            stemHeight,
            centerSize,
            dominantBand: profile.dominant,
        };
    }

    // ── Public: Full Report ───────────────────────────────────────────────
    getReport() {
        const m = this.metadata;
        const q = this.dataQuality || {};

        return {
            metadata: {
                duration: m.duration_seconds || 0,
                samples: m.total_samples || 0,
                sampleRate: m.sample_rate_hz || 0,
                captureDate: m.capture_timestamp || 'N/A',
                // Corrected values from actual stored data analysis
                effectiveDuration: this.effectiveDuration || 0,
                effectiveSampleRate: this.sampleRate || 0,
                samplesAnalyzed: q.samplesUsed || 0,
                deduplicated: q.deduplicated || false,
            },
            bands: this.normalizedBands,
            emotionMetrics: this.emotionMetrics,
            profile: this.profile,
            flowerParams: this.flowerParams,
            channelStats: this.channelStats,
            interpretation: this._generateInterpretation(),
        };
    }

    // ── Generate Human-Readable Flower Interpretation ─────────────────────
    _generateInterpretation() {
        const bands = this.normalizedBands;
        const profile = this.profile;
        const dominant = profile.dominant;
        const lines = [];

        lines.push('<strong>Tu Flor Neurofuncional</strong>');
        lines.push('');
        lines.push(`Tu flor cerebral está dominada por <em>${dominant.name}</em> (${dominant.percentage.toFixed(1)}%), ` +
            `lo que le da su forma característica: ${dominant.petalMeaning}`);
        lines.push('');

        // Describe each petal layer
        lines.push('<strong>Significado de cada pétalo:</strong>');
        lines.push('');

        // Sort by power to describe from most to least prominent
        const sorted = [...bands].sort((a, b) => b.relativePower - a.relativePower);

        sorted.forEach((band, i) => {
            const prominence = i === 0 ? '(dominante)' :
                               i === 1 ? '(secundario)' : '';
            lines.push(`${band.emoji} <strong>${band.name}</strong> — ${band.percentage.toFixed(1)}% ${prominence}`);
            lines.push(`<em>${band.meaning}</em>`);
            lines.push(`${band.petalMeaning}`);
            lines.push('');
        });

        // Overall flower meaning
        lines.push('<strong>🌺 Lectura general de tu flor:</strong>');
        lines.push('');

        if (profile.relaxation > 1.2) {
            lines.push('Tu flor se abre amplia y suave — los pétalos de Alpha y Theta son prominentes, ' +
                'indicando un estado profundo de relajación y receptividad. Es una flor nocturna, ' +
                'que florece en la calma.');
        } else if (profile.focus > 1.2) {
            lines.push('Tu flor tiene pétalos definidos y angulares — Beta domina, mostrando una mente ' +
                'activa y enfocada. Es una flor diurna, orientada al sol del pensamiento consciente.');
        } else if (profile.meditation > 1.2) {
            lines.push('Tu flor tiene raíces profundas en Theta — una flor meditativa que crece ' +
                'desde el interior. Sus pétalos sugieren un puente entre lo consciente y lo inconsciente.');
        } else {
            lines.push('Tu flor muestra un equilibrio orgánico entre todas las bandas — ' +
                'como una flor silvestre que integra todas las frecuencias de la luz. ' +
                'Esta armonía sugiere un estado mental balanceado y adaptativo.');
        }

        return lines.join('<br>');
    }
}
