class EEGApiClient {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl;
    }

    async _json(method, path, body) {
        const response = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
        }
        return payload;
    }

    async startCapture(durationSeconds = null) {
        return this._json('POST', '/api/capture/start', {
            durationSeconds,
        });
    }

    async stopCapture() {
        return this._json('POST', '/api/capture/stop', {});
    }

    async getStatus() {
        const response = await fetch(`${this.baseUrl}/api/capture/status`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        return payload;
    }

    async getStream(fromIndex = 0) {
        const response = await fetch(`${this.baseUrl}/api/capture/stream?from=${encodeURIComponent(fromIndex)}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        return payload;
    }

    async convertJsonToMidi(jsonData) {
        const response = await fetch(`${this.baseUrl}/api/json-to-midi`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ jsonData }),
        });

        if (!response.ok) {
            let message = `HTTP ${response.status}`;
            try {
                const payload = await response.json();
                message = payload.error || payload.message || message;
            } catch (err) {
                // ignore parse error
            }
            throw new Error(message);
        }

        return response.blob();
    }
}
