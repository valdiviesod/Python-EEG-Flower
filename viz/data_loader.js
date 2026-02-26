
class EEGDataLoader {
    constructor(url) {
        this.url = url;
        this.data = null;
        this.metadata = null;
        this.isLoaded = false;
    }

    async load() {
        try {
            const response = await fetch(this.url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const json = await response.json();
            
            // Validate structure
            if (!json.eeg_channels || !json.metadata) {
                throw new Error("Invalid EEG JSON format");
            }

            this.metadata = json.metadata;
            
            // Convert object to array of arrays for easier iteration
            // json.eeg_channels is structured like { "channel_1": [...], "channel_2": [...] }
            this.channels = [
                json.eeg_channels.channel_1 || [],
                json.eeg_channels.channel_2 || [],
                json.eeg_channels.channel_3 || [],
                json.eeg_channels.channel_4 || []
            ];

            // Normalize timestamp if available, otherwise synthetic
            this.timestamps = json.timestamps || [];

            // Calculate global stats for scaling
            this.stats = this.calculateStats();
            
            this.isLoaded = true;
            console.log("EEG Data Loaded", this.stats);
            return this;
        } catch (e) {
            console.error("Failed to load EEG data:", e);
            throw e;
        }
    }

    calculateStats() {
        let min = Infinity;
        let max = -Infinity;
        let total = 0;
        let count = 0;

        this.channels.forEach(ch => {
            if (!ch) return;
            ch.forEach(val => {
                if (val !== null && !isNaN(val)) {
                    if (val < min) min = val;
                    if (val > max) max = val;
                    total += val;
                    count++;
                }
            });
        });

        // If data is empty or invalid
        if (min === Infinity) { min = 0; max = 1; }

        return {
            min, 
            max, 
            mean: total / count,
            range: max - min,
            duration: this.metadata.duration_seconds,
            sampleRate: this.metadata.sample_rate_hz || (count / 4 / 120) // Fallback estimation
        };
    }
    
    // Get sample at specific index
    getSample(index) {
        if (!this.isLoaded) return [0,0,0,0];
        return this.channels.map(ch => (index < ch.length ? ch[index] : 0));
    }

    getLength() {
        if (!this.channels[0]) return 0;
        return this.channels[0].length;
    }
}
