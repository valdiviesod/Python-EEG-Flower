const FLOWER_BANDS = [
    {
        key: 'delta', name: 'Delta', emoji: '🌙', low: 0.5, high: 4,
        color: '#C4B7D8', colorDeep: '#9B8EC0', colorLight: '#E2DBF0',
        defendable: 'Presión fisiológica, fatiga y desconexión corporal.',
        usefulRead: 'Densidad corporal / peso interno.'
    },
    {
        key: 'theta', name: 'Theta', emoji: '🌿', low: 4, high: 8,
        color: '#A8D8B9', colorDeep: '#7CC496', colorLight: '#D4F0DE',
        defendable: 'Inmersión interna, memoria autobiográfica, imaginación y emoción interna.',
        usefulRead: 'Profundidad subjetiva / absorción.'
    },
    {
        key: 'alpha', name: 'Alpha', emoji: '🌸', low: 8, high: 13,
        color: '#FFD1DC', colorDeep: '#F2A5BE', colorLight: '#FFE8EF',
        defendable: 'Calma regulada, inhibición funcional y presencia sin esfuerzo.',
        usefulRead: 'Calma integrada / equilibrio.'
    },
    {
        key: 'beta', name: 'Beta', emoji: '☀️', low: 13, high: 30,
        color: '#FFDAB9', colorDeep: '#F5BD8E', colorLight: '#FFF0E0',
        defendable: 'Activación cognitiva, alerta sostenida, control ejecutivo y esfuerzo mental.',
        usefulRead: 'Tensión mental / activación.'
    },
    {
        key: 'gamma', name: 'Gamma', emoji: '✨', low: 30, high: 44,
        color: '#FFF3B0', colorDeep: '#F0E68C', colorLight: '#FFFBE0',
        defendable: 'Intensidad perceptiva e integración; en Muse-like se interpreta con cautela.',
        usefulRead: 'Intensidad / chispa / saturación.'
    },
];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function fft(re, im) {
    const n = re.length;
    if (n <= 1) return;

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

    for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1;
        const angle = -2 * Math.PI / len;
        const wRe = Math.cos(angle);
        const wIm = Math.sin(angle);

        for (let i = 0; i < n; i += len) {
            let curRe = 1;
            let curIm = 0;
            for (let j = 0; j < half; j++) {
                const uRe = re[i + j];
                const uIm = im[i + j];
                const vRe = re[i + j + half] * curRe - im[i + j + half] * curIm;
                const vIm = re[i + j + half] * curIm + im[i + j + half] * curRe;

                re[i + j] = uRe + vRe;
                im[i + j] = uIm + vIm;
                re[i + j + half] = uRe - vRe;
                im[i + j + half] = uIm - vIm;

                const nextRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = nextRe;
            }
        }
    }
}

class FlowerEEGAnalyzer {
    constructor(jsonData) {
        if (!jsonData?.eeg_channels) {
            throw new Error('Formato JSON inválido: falta eeg_channels.');
        }

        this.raw = jsonData;
        this.metadata = jsonData.metadata || {};
        this.timestamps = jsonData.timestamps || [];

        const ch = jsonData.eeg_channels;
        this.channels = {
            tp9: ch.channel_1 || [],
            af7: ch.channel_2 || [],
            af8: ch.channel_3 || [],
            tp10: ch.channel_4 || [],
        };

        const prep = this._preprocess();
        this.channels = prep.channels;
        this.sampleRate = prep.sampleRate;
        this.samples = prep.samples;

        this.bandPowers = this._computeBandPowers();
        this.bands = this._normalizeBands();
        this.metrics = this._computeCompositeMetrics();
        this.morphology = this._computeMorphology();
        this.derivedStates = this._computeDerivedStates();
    }

    _preprocess() {
        const ref = this.channels.af7.length ? this.channels.af7 : this.channels.tp9;
        if (!ref.length) {
            return { channels: this.channels, sampleRate: 256, samples: 0 };
        }

        let duplicateCount = 0;
        const check = Math.min(200, ref.length);
        for (let i = 1; i < check; i++) {
            if (ref[i] === ref[i - 1]) duplicateCount++;
        }
        const duplicateRatio = check > 1 ? duplicateCount / (check - 1) : 0;

        let channels = this.channels;
        if (duplicateRatio > 0.3) {
            const keep = [0];
            for (let i = 1; i < ref.length; i++) {
                if (ref[i] !== ref[i - 1]) keep.push(i);
            }
            channels = {
                tp9: keep.map(i => this.channels.tp9[i] ?? 0),
                af7: keep.map(i => this.channels.af7[i] ?? 0),
                af8: keep.map(i => this.channels.af8[i] ?? 0),
                tp10: keep.map(i => this.channels.tp10[i] ?? 0),
            };
        }

        let sampleRate = this.metadata.sample_rate_hz || 256;
        if (this.timestamps.length > 1) {
            const duration = this.timestamps[this.timestamps.length - 1] - this.timestamps[0];
            if (duration > 0.01) {
                sampleRate = (this.timestamps.length - 1) / duration;
            }
        }

        sampleRate = clamp(sampleRate, 64, 1024);
        const samples = channels.af7.length;
        return { channels, sampleRate, samples };
    }

    _nextPow2(n) {
        let p = 1;
        while (p < n) p <<= 1;
        return p;
    }

    _computeBandPowers() {
        const channelPowers = [];
        for (const data of Object.values(this.channels)) {
            if (!Array.isArray(data) || data.length < 32) continue;
            channelPowers.push(this._computeChannelBandPower(data));
        }

        if (!channelPowers.length) {
            return FLOWER_BANDS.map(() => 1);
        }

        return FLOWER_BANDS.map((_, bandIdx) => {
            let sum = 0;
            for (const powers of channelPowers) sum += powers[bandIdx];
            return sum / channelPowers.length;
        });
    }

    _computeChannelBandPower(data) {
        const n = data.length;
        const fftSize = this._nextPow2(Math.max(512, n * 4));

        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumX2 = 0;

        for (let i = 0; i < n; i++) {
            const v = data[i] || 0;
            sumX += i;
            sumY += v;
            sumXY += i * v;
            sumX2 += i * i;
        }

        const denom = n * sumX2 - sumX * sumX;
        const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
        const intercept = (sumY - slope * sumX) / n;

        const re = new Float64Array(fftSize);
        const im = new Float64Array(fftSize);

        for (let i = 0; i < n; i++) {
            const detrended = (data[i] || 0) - (slope * i + intercept);
            const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
            re[i] = detrended * hann;
        }

        fft(re, im);

        const freqRes = this.sampleRate / fftSize;
        return FLOWER_BANDS.map((band) => {
            const binLow = Math.max(1, Math.floor(band.low / freqRes));
            const binHigh = Math.min(fftSize / 2 - 1, Math.ceil(band.high / freqRes));
            let power = 0;
            for (let k = binLow; k <= binHigh; k++) {
                power += re[k] * re[k] + im[k] * im[k];
            }
            return power / n;
        });
    }

    _normalizeBands() {
        const total = this.bandPowers.reduce((acc, p) => acc + p, 0) || 1;
        return this.bandPowers.map((power, idx) => {
            const base = FLOWER_BANDS[idx];
            const relativePower = power / total;
            return {
                ...base,
                absolutePower: power,
                relativePower,
                percentage: relativePower * 100,
            };
        });
    }

    _computeCompositeMetrics() {
        const eps = 1e-6;
        const delta = this.bands[0].relativePower;
        const theta = this.bands[1].relativePower;
        const alpha = this.bands[2].relativePower;
        const beta = this.bands[3].relativePower;
        const gamma = this.bands[4].relativePower;

        const metrics = {
            activation: {
                label: 'Activación mental',
                formula: '(Beta + Gamma) / Alpha',
                value: (beta + gamma) / (alpha + eps),
                meaning: 'Agitación vs serenidad',
            },
            internalLoad: {
                label: 'Carga interna',
                formula: 'Delta / (Alpha + Beta)',
                value: delta / (alpha + beta + eps),
                meaning: 'Pesado vs ligero',
            },
            immersion: {
                label: 'Inmersión subjetiva',
                formula: 'Theta / Beta',
                value: theta / (beta + eps),
                meaning: 'Interno vs externo',
            },
            regulation: {
                label: 'Equilibrio regulatorio',
                formula: 'Alpha / (Theta + Beta)',
                value: alpha / (theta + beta + eps),
                meaning: 'Centrado vs disperso',
            },
            experientialIntensity: {
                label: 'Intensidad experiencial',
                formula: 'Gamma / Alpha',
                value: gamma / (alpha + eps),
                meaning: 'Saturado vs plano',
            },
        };

        metrics.activation.level = this._level(metrics.activation.value, 0.75, 1.25);
        metrics.internalLoad.level = this._level(metrics.internalLoad.value, 0.45, 0.9);
        metrics.immersion.level = this._level(metrics.immersion.value, 0.75, 1.25);
        metrics.regulation.level = this._level(metrics.regulation.value, 0.75, 1.25);
        metrics.experientialIntensity.level = this._level(metrics.experientialIntensity.value, 0.65, 1.15);

        return metrics;
    }

    _level(value, low, high) {
        if (value < low) return 'bajo';
        if (value > high) return 'alto';
        return 'medio';
    }

    _metricNorm(value, low, high) {
        return clamp((value - low) / (high - low), 0, 1);
    }

    _computeMorphology() {
        const m = this.metrics;
        return {
            openness: this._metricNorm(m.activation.value, 0.5, 2.0),
            weight: this._metricNorm(m.internalLoad.value, 0.2, 1.2),
            curvature: this._metricNorm(m.immersion.value, 0.45, 2.0),
            symmetry: this._metricNorm(m.regulation.value, 0.45, 1.6),
            brightness: this._metricNorm(m.experientialIntensity.value, 0.2, 1.4),
        };
    }

    _computeDerivedStates() {
        const m = this.metrics;
        const high = (x) => clamp((x - 1.0) / 0.8, 0, 1);
        const low = (x) => clamp((1.0 - x) / 0.8, 0, 1);

        const scores = [
            { key: 'calma-presente', label: 'Calma presente', score: (low(m.activation.value) + high(m.regulation.value) + low(m.internalLoad.value)) / 3 },
            { key: 'ansiedad', label: 'Ansiedad', score: (high(m.activation.value) + high(m.experientialIntensity.value) + low(m.regulation.value)) / 3 },
            { key: 'fatiga', label: 'Fatiga', score: (high(m.internalLoad.value) + low(m.activation.value)) / 2 },
            { key: 'absorcion', label: 'Absorción', score: (high(m.immersion.value) + low(m.activation.value)) / 2 },
            { key: 'flow', label: 'Flow', score: (high(m.immersion.value) + high(m.regulation.value) + low(m.internalLoad.value)) / 3 },
            { key: 'rumiacion', label: 'Rumiación', score: (high(m.activation.value) + low(m.immersion.value) + low(m.regulation.value)) / 3 },
            { key: 'saturacion-emocional', label: 'Saturación emocional', score: (high(m.experientialIntensity.value) + low(m.regulation.value)) / 2 },
            { key: 'claridad', label: 'Claridad', score: (high(m.regulation.value) + high(m.experientialIntensity.value) + low(m.internalLoad.value)) / 3 },
            { key: 'desconexion', label: 'Desconexión', score: (high(m.internalLoad.value) + low(m.experientialIntensity.value)) / 2 },
            { key: 'tension-cognitiva', label: 'Tensión cognitiva', score: (high(m.activation.value) + low(m.regulation.value)) / 2 },
        ];

        return scores.sort((a, b) => b.score - a.score).slice(0, 4);
    }

    getReport() {
        return {
            metadata: {
                duration: this.raw.metadata?.duration_seconds || 0,
                totalSamples: this.raw.metadata?.total_samples || this.samples,
                sampleRateHz: this.sampleRate,
                capturedAt: this.raw.metadata?.capture_timestamp || '',
            },
            bands: this.bands,
            metrics: this.metrics,
            morphology: this.morphology,
            derivedStates: this.derivedStates,
        };
    }
}
