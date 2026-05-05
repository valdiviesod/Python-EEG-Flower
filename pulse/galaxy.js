/**
 * Galaxy Garden — Modern Vibrant 3D Galaxy Visualization
 *
 * Each pulse is a luminous, living star in a vibrant cosmic garden.
 * Background: multi-layer nebula + 25,000 particles in luminous spiral arms.
 * Pulse stars: shader-based animated spheres with surface displacement,
 *   multi-layer glowing halos, chromatic rim light, EEG-driven vibration.
 * Click star → opens existing garden modal.
 */

class GalaxyGarden {
    constructor(containerId, onPulseClick) {
        this.container = document.getElementById(containerId);
        this.onPulseClick = onPulseClick;

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.animationId = null;
        this.clock = new THREE.Clock();

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.stars = [];           // pulse-star objects
        this.bgParticles = null;   // galaxy dust
        this.farStars = null;      // distant colored stars
        this.nebula = null;        // large soft nebula clouds
        this.shootingStars = [];   // animated shooting stars

        this.hoveredStar = null;
        this._destroyed = false;
        this._loadToken = 0;

        // Band colours — same palette, more saturated
        this.bandColours = {
            delta: new THREE.Color('#A855F7'),
            theta: new THREE.Color('#34D399'),
            alpha: new THREE.Color('#F472B6'),
            beta:  new THREE.Color('#FB923C'),
            gamma: new THREE.Color('#FACC15'),
        };

        this._lastFrameTime = 0;
        this._elapsedOverride = 0;
        this._wasHidden = false;
    }

    init() {
        this._destroyed = false;
        const w = this.container.clientWidth || 800;
        const h = this.container.clientHeight || 600;

        this.scene = new THREE.Scene();
        // Richer deep space background with slight blue-purple tint
        this.scene.background = new THREE.Color('#05030a');
        // Lighter fog for more atmospheric depth
        this.scene.fog = new THREE.FogExp2(0x05030a, 0.008);

        this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 400);
        this.camera.position.set(0, 8, 26);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.6;
        this.renderer.outputEncoding = THREE.sRGBEncoding;

        this.container.innerHTML = '';
        this.container.appendChild(this.renderer.domElement);

        if (THREE.OrbitControls) {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.04;
            this.controls.minDistance = 5;
            this.controls.maxDistance = 100;
            this.controls.autoRotate = true;
            this.controls.autoRotateSpeed = 0.15;
            this.controls.target.set(0, 0, 0);
            this.controls.enablePan = false;
        }

        this._buildBackground();
        this._setupInteraction();

        window.addEventListener('resize', () => this._onResize());
        document.addEventListener('visibilitychange', () => this._onVisibilityChange());
        this._animate();
    }

    _onVisibilityChange() {
        if (document.hidden) this._wasHidden = true;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BACKGROUND — Multi-layer cosmic atmosphere
    // ═══════════════════════════════════════════════════════════════════════════

    _buildBackground() {
        // Layer 1: Large soft nebula clouds
        this._buildNebulaClouds();
        // Layer 2: Galaxy dust (coloured, spiral arms)
        this._buildGalaxyDust();
        // Layer 3: Far colored stars
        this._buildFarStars();
        // Layer 4: Nebula clouds (placeholder)

        // Ambient + colored point lights for atmosphere
        const ambient = new THREE.AmbientLight(0x302050, 0.5);
        this.scene.add(ambient);

        // Central warm glow
        const centreLight = new THREE.PointLight(0x8B5CF6, 1.2, 80);
        centreLight.position.set(0, 3, 0);
        this.scene.add(centreLight);

        // Rim lights for depth
        const rim1 = new THREE.PointLight(0xEC4899, 0.6, 60);
        rim1.position.set(20, -10, 20);
        this.scene.add(rim1);

        const rim2 = new THREE.PointLight(0x22C55E, 0.4, 60);
        rim2.position.set(-20, 5, -20);
        this.scene.add(rim2);
    }

    _buildNebulaClouds() {
        const COUNT = 800;
        const positions = new Float32Array(COUNT * 3);
        const colours = new Float32Array(COUNT * 3);
        const sizes = new Float32Array(COUNT);
        const opacities = new Float32Array(COUNT);

        const colorPalette = [
            new THREE.Color('#7C3AED'),
            new THREE.Color('#EC4899'),
            new THREE.Color('#3B82F6'),
            new THREE.Color('#8B5CF6'),
            new THREE.Color('#1E3A5F'),
        ];

        for (let i = 0; i < COUNT; i++) {
            const i3 = i * 3;
            const r = 5 + Math.random() * 35;
            const branch = (i % 4) / 4 * Math.PI * 2;
            const spin = r * 0.8;
            const spread = Math.pow(Math.random(), 2) * 3;

            positions[i3] = Math.cos(branch + spin) * r + (Math.random() - 0.5) * spread;
            positions[i3 + 1] = (Math.random() - 0.5) * 6;
            positions[i3 + 2] = Math.sin(branch + spin) * r + (Math.random() - 0.5) * spread;

            const c = colorPalette[Math.floor(Math.random() * colorPalette.length)];
            colours[i3] = c.r; colours[i3 + 1] = c.g; colours[i3 + 2] = c.b;
            sizes[i] = 3 + Math.random() * 8;
            opacities[i] = 0.3 + Math.random() * 0.4;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aColor', new THREE.BufferAttribute(colours, 3));
        geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geo.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uSize: { value: 120 * this.renderer.getPixelRatio() },
                uTime: { value: 0 }
            },
            vertexShader: `
                uniform float uSize; uniform float uTime;
                attribute float aSize; attribute vec3 aColor; attribute float aOpacity;
                varying vec3 vColor; varying float vOpacity; varying float vDist;
                void main() {
                    vec4 mp = modelMatrix * vec4(position, 1.0);
                    float dfc = length(mp.xz);
                    float ang = atan(mp.x, mp.z);
                    ang += (1.0 / max(dfc, 0.1)) * uTime * 0.015;
                    mp.x = sin(ang) * dfc;
                    mp.z = cos(ang) * dfc;
                    // Slow vertical drift
                    mp.y += sin(uTime * 0.2 + position.x * 0.1) * 0.3;
                    vDist = dfc;
                    vec4 vp = viewMatrix * mp;
                    gl_Position = projectionMatrix * vp;
                    gl_PointSize = uSize * aSize * (2.5 / -vp.z);
                    vColor = aColor;
                    vOpacity = aOpacity;
                }
            `,
            fragmentShader: `
                varying vec3 vColor; varying float vOpacity; varying float vDist;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    // Soft gaussian falloff for nebula clouds
                    float a = exp(-d * d * 4.0) * vOpacity * 0.35;
                    // Add color variation based on distance from center
                    vec3 col = vColor * (1.0 + 0.3 * sin(vDist * 0.5));
                    gl_FragColor = vec4(col, a);
                }
            `,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true
        });

        this.nebula = new THREE.Points(geo, mat);
        this.scene.add(this.nebula);
    }

    _buildGalaxyDust() {
        const COUNT = 20000;
        const R = 30;
        const positions = new Float32Array(COUNT * 3);
        const colours = new Float32Array(COUNT * 3);
        const scales = new Float32Array(COUNT);
        const randoms = new Float32Array(COUNT * 3);

        // Vibrant galaxy colors — warmer, more saturated
        const inside = new THREE.Color('#ffffff');
        const mid = new THREE.Color('#A78BFA');
        const outside = new THREE.Color('#4F46E5');

        for (let i = 0; i < COUNT; i++) {
            const i3 = i * 3;
            const r = Math.random() * R;
            const branch = (i % 5) / 5 * Math.PI * 2;
            const spin = r * 1.3;

            const rx = Math.pow(Math.random(), 3) * 0.8 * (Math.random() < 0.5 ? 1 : -1);
            const ry = Math.pow(Math.random(), 3) * 0.4 * (Math.random() < 0.5 ? 1 : -1);
            const rz = Math.pow(Math.random(), 3) * 0.8 * (Math.random() < 0.5 ? 1 : -1);

            positions[i3] = Math.cos(branch + spin) * r + rx;
            positions[i3 + 1] = ry;
            positions[i3 + 2] = Math.sin(branch + spin) * r + rz;

            randoms[i3] = rx;
            randoms[i3 + 1] = ry;
            randoms[i3 + 2] = rz;

            // Color gradient: white → purple → deep blue
            let c;
            if (r < R * 0.3) {
                c = inside.clone().lerp(mid, r / (R * 0.3));
            } else {
                c = mid.clone().lerp(outside, (r - R * 0.3) / (R * 0.7));
            }
            // Occasional colored stars from band palette
            if (Math.random() < 0.08) {
                const bandKeys = Object.keys(this.bandColours);
                const band = bandKeys[Math.floor(Math.random() * bandKeys.length)];
                c.lerp(this.bandColours[band], 0.6);
            }

            colours[i3] = c.r; colours[i3 + 1] = c.g; colours[i3 + 2] = c.b;
            scales[i] = 0.5 + Math.random() * 0.8;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aColor', new THREE.BufferAttribute(colours, 3));
        geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
        geo.setAttribute('aRandomness', new THREE.BufferAttribute(randoms, 3));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uSize: { value: 32 * this.renderer.getPixelRatio() },
                uTime: { value: 0 }
            },
            vertexShader: `
                uniform float uSize; uniform float uTime;
                attribute float aScale; attribute vec3 aRandomness; attribute vec3 aColor;
                varying vec3 vColor;
                void main() {
                    vec4 mp = modelMatrix * vec4(position, 1.0);
                    float dfc = length(mp.xz);
                    float ang = atan(mp.x, mp.z);
                    // Faster, more fluid rotation
                    ang += (1.0 / max(dfc, 0.1)) * uTime * 0.05;
                    mp.x = sin(ang) * dfc;
                    mp.z = cos(ang) * dfc;
                    mp.xyz += aRandomness - 0.5;
                    // Multi-frequency twinkle
                    float flicker = 0.7 + 0.3 * sin(uTime * 3.0 + aRandomness.x * 7.0)
                                        + 0.15 * sin(uTime * 7.0 + aRandomness.y * 13.0);
                    vec4 vp = viewMatrix * mp;
                    gl_Position = projectionMatrix * vp;
                    gl_PointSize = uSize * aScale * (5.0 / -vp.z) * flicker;
                    vColor = aColor;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    // Sharper core, softer halo
                    float a = 0.06 / d - 0.12;
                    if (a < 0.0) discard;
                    // Boost brightness
                    vec3 col = vColor * 1.4;
                    gl_FragColor = vec4(col, a);
                }
            `,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true
        });

        this.bgParticles = new THREE.Points(geo, mat);
        this.scene.add(this.bgParticles);
    }

    _buildFarStars() {
        const COUNT = 20000;
        const positions = new Float32Array(COUNT * 3);
        const scales = new Float32Array(COUNT);
        const twinkle = new Float32Array(COUNT);
        const starColors = new Float32Array(COUNT * 3);

        const tints = [
            new THREE.Color('#ffffff'),
            new THREE.Color('#E0E7FF'),
            new THREE.Color('#FBCFE8'),
            new THREE.Color('#DDD6FE'),
            new THREE.Color('#C7D2FE'),
        ];

        for (let i = 0; i < COUNT; i++) {
            const i3 = i * 3;
            const r = 35 + Math.random() * 150;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = r * Math.cos(phi);

            scales[i] = 0.2 + Math.random() * 0.8;
            twinkle[i] = Math.random() * 100;

            const tint = tints[Math.floor(Math.random() * tints.length)];
            starColors[i3] = tint.r;
            starColors[i3 + 1] = tint.g;
            starColors[i3 + 2] = tint.b;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
        geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 1));
        geo.setAttribute('aColor', new THREE.BufferAttribute(starColors, 3));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uSize: { value: 20 * this.renderer.getPixelRatio() },
                uTime: { value: 0 }
            },
            vertexShader: `
                uniform float uSize; uniform float uTime;
                attribute float aScale; attribute float aTwinkle; attribute vec3 aColor;
                varying float vAlpha; varying vec3 vColor;
                void main() {
                    vec4 vp = viewMatrix * modelMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * vp;
                    float t = sin(uTime * 2.0 + aTwinkle) * 0.5 + 0.5;
                    vAlpha = 0.2 + t * 0.8;
                    gl_PointSize = uSize * aScale * (3.5 / -vp.z);
                    vColor = aColor;
                }
            `,
            fragmentShader: `
                varying float vAlpha; varying vec3 vColor;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    float a = 0.07 / d - 0.14;
                    if (a < 0.0) discard;
                    gl_FragColor = vec4(vColor, a * vAlpha);
                }
            `,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true
        });

        this.farStars = new THREE.Points(geo, mat);
        this.scene.add(this.farStars);
    }

    _buildShootingStars() {
        // Create a few shooting star streaks using lines
        for (let i = 0; i < 3; i++) {
            const points = [];
            for (let j = 0; j < 20; j++) {
                points.push(new THREE.Vector3(0, 0, 0));
            }
            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const mat = new THREE.LineBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
            });
            const line = new THREE.Line(geo, mat);
            this.scene.add(line);
            this.shootingStars.push({
                line, mat, geo,
                active: false,
                timer: Math.random() * 8,
                speed: 15 + Math.random() * 10,
                dir: new THREE.Vector3(
                    Math.random() - 0.5,
                    Math.random() * 0.3 - 0.1,
                    Math.random() - 0.5
                ).normalize(),
                pos: new THREE.Vector3(),
                length: 3 + Math.random() * 4,
            });
        }
    }

    _updateShootingStars(dt, elapsed) {
        this.shootingStars.forEach(s => {
            if (!s.active) {
                s.timer -= dt;
                if (s.timer <= 0) {
                    s.active = true;
                    s.timer = 4 + Math.random() * 10;
                    // Start from somewhere in the sky
                    const r = 40 + Math.random() * 40;
                    const theta = Math.random() * Math.PI * 2;
                    const phi = Math.random() * Math.PI;
                    s.pos.set(
                        r * Math.sin(phi) * Math.cos(theta),
                        r * Math.sin(phi) * Math.sin(theta) * 0.5,
                        r * Math.cos(phi)
                    );
                    s.dir.set(
                        Math.random() - 0.5,
                        Math.random() * 0.2 - 0.1,
                        Math.random() - 0.5
                    ).normalize();
                }
                s.mat.opacity = Math.max(0, s.mat.opacity - dt * 3);
                return;
            }

            s.pos.addScaledVector(s.dir, s.speed * dt);
            const positions = s.geo.attributes.position.array;
            for (let i = 0; i < 20; i++) {
                const t = i / 19;
                const trailPos = s.pos.clone().addScaledVector(s.dir, -s.length * t);
                positions[i * 3] = trailPos.x;
                positions[i * 3 + 1] = trailPos.y;
                positions[i * 3 + 2] = trailPos.z;
            }
            s.geo.attributes.position.needsUpdate = true;

            // Fade in then out based on lifetime
            const dist = s.pos.length();
            if (dist > 120 || s.pos.y < -30) {
                s.active = false;
                s.mat.opacity = 0;
            } else {
                s.mat.opacity = Math.min(0.9, s.mat.opacity + dt * 4);
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PULSE STARS — Luminous, modern, vibrant
    // ═══════════════════════════════════════════════════════════════════════════

    clearPulses() {
        this.stars.forEach(s => {
            if (s.group) this.scene.remove(s.group);
            if (s.labelEl && s.labelEl.parentNode) s.labelEl.parentNode.removeChild(s.labelEl);
        });
        this.stars = [];
    }

    filterByName(query) {
        const q = (query || '').toLowerCase().trim();
        this.stars.forEach(star => {
            // Support both profile mode (star.data.profile_name) and legacy mode
            const name = (
                star.data?.profile_name ||
                star.data?.metadata?.user_name ||
                ''
            ).toLowerCase();
            const match = !q || name.includes(q);
            if (star.group) star.group.visible = match;
            if (star.labelEl) star.labelEl.style.display = match ? '' : 'none';
        });
    }

    async loadCaptures(capturesList, animateFilename = null) {
        this.clearPulses();
        this._hasAnimateFilename = !!animateFilename;
        capturesList.sort((a, b) => a.filename.localeCompare(b.filename));

        const items = [];
        for (const captureMeta of capturesList) {
            try {
                const resp = await fetch(`/api/garden/file?name=${encodeURIComponent(captureMeta.filename)}`);
                if (!resp.ok) continue;
                const data = await resp.json();
                data.filename = captureMeta.filename;
                const analyzer = new EEGBandAnalyzer(data);
                const report = analyzer.getReport();
                items.push({ data, report });
            } catch (err) {
                console.error('Galaxy load error:', err);
            }
        }

        const placed = [];
        const MAX_R = 14;
        const MIN_D = 3.0;

        for (let i = 0; i < items.length; i++) {
            let x, y, z, ok;
            let attempts = 0;
            do {
                ok = true;
                const r = Math.sqrt(Math.random()) * MAX_R;
                const theta = Math.random() * Math.PI * 2;
                x = Math.cos(theta) * r;
                z = Math.sin(theta) * r;
                y = (Math.random() - 0.5) * 5;

                for (const p of placed) {
                    const dx = x - p.x, dy = y - p.y, dz = z - p.z;
                    if (Math.sqrt(dx*dx + dy*dy + dz*dz) < MIN_D) { ok = false; break; }
                }
                attempts++;
            } while (!ok && attempts < 80);

            placed.push({ x, y, z });
            const isAnimate = items[i].data.filename === animateFilename;
            this._createPulseStar(items[i].data, items[i].report, x, y, z, i, isAnimate);
        }
    }

    /**
     * Load profiles list (one star per profile).
     * profilesList: array from /api/profiles/list
     * animateProfileName: profile_name to animate on entry (latest capture)
     */
    async loadProfiles(profilesList, animateProfileName = null) {
        this.clearPulses();
        const loadToken = ++this._loadToken;
        this._hasAnimateFilename = !!animateProfileName;

        const placed = [];
        const MAX_R = 14;
        const MIN_D = 3.0;
        const profiles = [...profilesList].sort((a, b) => {
            if (animateProfileName) {
                if (a.profile_name === animateProfileName) return -1;
                if (b.profile_name === animateProfileName) return 1;
            }
            return (b.latest_capture_timestamp || '').localeCompare(a.latest_capture_timestamp || '');
        });
        const positions = profiles.map(() => {
            let x, y, z, ok;
            let attempts = 0;
            do {
                ok = true;
                const r = Math.sqrt(Math.random()) * MAX_R;
                const theta = Math.random() * Math.PI * 2;
                x = Math.cos(theta) * r;
                z = Math.sin(theta) * r;
                y = (Math.random() - 0.5) * 5;

                for (const p of placed) {
                    const dx = x - p.x, dy = y - p.y, dz = z - p.z;
                    if (Math.sqrt(dx*dx + dy*dy + dz*dz) < MIN_D) { ok = false; break; }
                }
                attempts++;
            } while (!ok && attempts < 80);

            placed.push({ x, y, z });
            return { x, y, z };
        });

        const loadOne = async (prof, index) => {
            try {
                const repFilename = prof.representative && prof.representative.filename;
                const url = repFilename
                    ? `/api/garden/file?name=${encodeURIComponent(repFilename)}`
                    : `/api/profiles/representative?name=${encodeURIComponent(prof.profile_name)}`;
                const resp = await fetch(url);
                if (!resp.ok) return;
                const data = await resp.json();
                if (this._destroyed || loadToken !== this._loadToken) return;
                data._profileMeta = prof;
                data.profile_name = prof.profile_name;
                data.capture_count = prof.capture_count;

                const analyzer = new EEGBandAnalyzer(data);
                const report = analyzer.getReport();
                const pos = positions[index];
                const isAnimate = data.profile_name === animateProfileName;
                if (this._destroyed || loadToken !== this._loadToken) return;
                this._createPulseStar(data, report, pos.x, pos.y, pos.z, index, isAnimate);
            } catch (err) {
                console.error('Galaxy loadProfiles error:', err);
            }
        };

        const concurrency = 3;
        let next = 0;
        const workers = Array.from({ length: Math.min(concurrency, profiles.length) }, async () => {
            while (next < profiles.length) {
                if (this._destroyed || loadToken !== this._loadToken) return;
                const index = next++;
                await loadOne(profiles[index], index);
                await new Promise(resolve => requestAnimationFrame(resolve));
            }
        });

        await Promise.all(workers);
        if (this._destroyed || loadToken !== this._loadToken) return;
        this._hasAnimateFilename = false;
        this.stars.forEach(star => {
            star.labelHidden = false;
            if (star.labelEl) star.labelEl.style.display = '';
        });
    }

    async loadProfile(profile, animateProfileName = null) {
        return this.loadProfiles([profile], animateProfileName);
    }

    _getLavaPalette(report) {
        const bands = report.bands || [];
        const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
        const bandOrder = ['delta', 'theta', 'alpha', 'beta', 'gamma'];
        const baseColors = {
            delta: new THREE.Color('#A855F7'),
            theta: new THREE.Color('#34D399'),
            alpha: new THREE.Color('#F472B6'),
            beta:  new THREE.Color('#FB923C'),
            gamma: new THREE.Color('#FACC15'),
        };

        const stats = bandOrder.map((key, idx) => ({
            key,
            idx,
            v: Math.max(0, (bands.find(b => b.key === key) || {}).relativePower || 0),
        })).sort((a, b) => b.v - a.v);

        const dominant = stats[0] || { key: 'alpha', idx: 2, v: 1 };
        const secondary = stats[1] || dominant;
        const sumPower = stats.reduce((s, x) => s + x.v, 0) || 1;
        const dominanceGap = clamp(dominant.v - secondary.v, 0, 1);
        const focus = clamp(dominant.v / sumPower, 0, 1);

        // Secondary band influences tint to avoid same-color crowding while preserving dominant identity.
        const mixSecondary = clamp(0.32 - dominanceGap * 0.5, 0.08, 0.28);
        const centroid = stats.reduce((acc, x) => acc + (x.idx / (bandOrder.length - 1)) * x.v, 0) / sumPower;
        const dominantNorm = dominant.idx / (bandOrder.length - 1);
        const hueShift = (centroid - dominantNorm) * 0.09;

        const mainColor = baseColors[dominant.key].clone().lerp(baseColors[secondary.key], mixSecondary);
        const hsl = {};
        mainColor.getHSL(hsl);
        mainColor.setHSL(
            (hsl.h + hueShift + 1) % 1,
            clamp(hsl.s * (0.92 + focus * 0.2), 0.5, 1),
            clamp(hsl.l * (0.9 + (1 - focus) * 0.2), 0.42, 0.72)
        );

        const deepColor = mainColor.clone().multiplyScalar(0.58 + (1 - focus) * 0.1);
        const brightColor = mainColor.clone().lerp(new THREE.Color('#FFFFFF'), 0.14 + focus * 0.08);

        return {
            dominant: dominant.key,
            main: `#${mainColor.getHexString()}`,
            deep: `#${deepColor.getHexString()}`,
            bright: `#${brightColor.getHexString()}`,
        };
    }

    _createPulseStar(captureData, report, x, y, z, index, animate = false) {
        const group = new THREE.Group();
        group.position.set(x, y, z);
        if (animate) {
            group.scale.set(0, 0, 0);
            group.userData.vanishAnim = { active: true, t: 0, duration: 4.0 };
        }

        const baseSize = 0.42;

        const { dominant, main, deep, bright } = this._getLavaPalette(report);
        const starColor = new THREE.Color(main);
        const deepColor = new THREE.Color(deep);
        const brightColor = new THREE.Color(bright);

        const bands = report.bands;

        const bandVibes = {};
        bands.forEach(b => {
            bandVibes[b.key] = {
                freq: (b.low + b.high) * 0.5 * 0.1,
                amp: b.percentage / 100,
                phase: Math.random() * Math.PI * 2,
            };
        });

        const betaPower = (bands.find(b => b.key === 'beta') || {}).percentage || 0;
        const gammaPower = (bands.find(b => b.key === 'gamma') || {}).percentage || 0;
        const alphaPower = (bands.find(b => b.key === 'alpha') || {}).percentage || 0;
        const thetaPower = (bands.find(b => b.key === 'theta') || {}).percentage || 0;
        const animSpeed = 0.8 + (betaPower + gammaPower) / 100 * 1.5;
        const waveX = 3.5 + (betaPower / 40) * 3.5;
        const waveY = 3.0 + (alphaPower / 40) * 4.0;
        const waveZ = 2.5 + (gammaPower / 40) * 4.5;
        const waveSurface = 5.5 + (thetaPower / 40) * 5.5;

        const isProfileStar = !!captureData.profile_name;
        const coreDetail = isProfileStar ? 10 : 24;
        const glowDetail = isProfileStar ? 5 : 10;
        const coreGeo = new THREE.IcosahedronGeometry(baseSize, coreDetail);
        const coreMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: starColor },
                uColorB: { value: deepColor.clone().multiplyScalar(1.4) },
                uColorC: { value: brightColor },
                uSpeed: { value: animSpeed },
                uWaveX: { value: waveX },
                uWaveY: { value: waveY },
                uWaveZ: { value: waveZ },
                uWaveSurface: { value: waveSurface },
                uPulseAmp: { value: 0.16 },
            },
            vertexShader: `
                uniform float uTime; uniform float uSpeed;
                uniform float uWaveX; uniform float uWaveY; uniform float uWaveZ;
                uniform float uPulseAmp;
                varying vec3 vNormal; varying vec3 vPos; varying float vDisp;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vec3 p = position;
                    float n = sin(p.x * uWaveX + uTime * uSpeed) * cos(p.y * uWaveY + uTime * uSpeed * 0.7)
                            + sin(p.z * uWaveZ + uTime * uSpeed * 1.2) * 0.5
                            + sin((p.x + p.z) * 2.0 + uTime * uSpeed * 0.5) * 0.25;
                    float disp = n * uPulseAmp;
                    p += normal * disp;
                    vDisp = disp;
                    vPos = p;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor; uniform vec3 uColorB; uniform vec3 uColorC; uniform float uTime;
                uniform float uSpeed; uniform float uWaveSurface;
                varying vec3 vNormal; varying vec3 vPos; varying float vDisp;
                void main() {
                    float wave = sin(vPos.y * uWaveSurface + uTime * uSpeed * 2.0) * 0.5 + 0.5;
                    vec3 col = mix(uColor, uColorB, wave * 0.6);
                    col = mix(col, uColorC, wave * wave * 0.35);
                    float viewDot = abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)));
                    col *= 0.85 + viewDot * 0.15;
                    gl_FragColor = vec4(col, 1.0);
                }
            `,
            side: THREE.DoubleSide,
        });
        const core = new THREE.Mesh(coreGeo, coreMat);
        group.add(core);

        const glowGeo = new THREE.IcosahedronGeometry(baseSize * 1.8, glowDetail);
        const glowMat = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: starColor.clone().multiplyScalar(1.3) },
                uTime: { value: 0 },
                uSpeed: { value: animSpeed },
            },
            vertexShader: `
                varying vec3 vNormal;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor; uniform float uTime; uniform float uSpeed;
                varying vec3 vNormal;
                void main() {
                    vec3 viewDir = vec3(0.0, 0.0, 1.0);
                    float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.0);
                    float pulse = 0.8 + 0.2 * sin(uTime * uSpeed * 2.0);
                    gl_FragColor = vec4(uColor, fresnel * 0.35 * pulse);
                }
            `,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        group.add(glow);

        const labelEl = this._createLabel(captureData, starColor);
        // Hide labels for non-featured stars during transition
        if (!animate && this._hasAnimateFilename) {
            labelEl.style.display = 'none';
        }

        core.userData.starObj = {
            data: captureData, group, core, coreMat,
            glow, glowMat,
            labelEl,
            labelHidden: !animate && this._hasAnimateFilename,
            basePos: new THREE.Vector3(x, y, z),
            starSize: baseSize, index,
            timeOffset: Math.random() * 100,
            bandVibes,
            dominantBand: dominant,
        };

        this.stars.push(core.userData.starObj);
        this.scene.add(group);
    }

    _createLabel(captureData, color) {
        const div = document.createElement('div');
        div.className = 'galaxy-star-label';

        // Profile mode: show profile_name + capture count
        const isProfile = !!captureData.profile_name;
        const name = captureData.profile_name ||
                     captureData.metadata?.user_name || 'Anónimo';
        const captureCount = captureData.capture_count;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'galaxy-star-name';
        nameSpan.style.color = '#' + color.getHexString();
        nameSpan.textContent = name;
        div.appendChild(nameSpan);

        if (isProfile && captureCount > 0) {
            const countSpan = document.createElement('span');
            countSpan.className = 'galaxy-star-state';
            countSpan.textContent = `${captureCount} captura${captureCount !== 1 ? 's' : ''}`;
            div.appendChild(countSpan);
        } else {
            const state = captureData.metadata?.user_state || '';
            if (state) {
                const stateSpan = document.createElement('span');
                stateSpan.className = 'galaxy-star-state';
                stateSpan.textContent = state;
                div.appendChild(stateSpan);
            }
        }

        const wrap = document.getElementById('garden-3d-wrap');
        if (wrap) wrap.appendChild(div);
        return div;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTERACTION
    // ═══════════════════════════════════════════════════════════════════════════

    _setupInteraction() {
        this.container.addEventListener('pointermove', (e) => this._onPointerMove(e));
        this.container.addEventListener('click', (e) => this._onClick(e));
    }

    _onPointerMove(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        if (this.controls) this.controls.autoRotate = false;
        this._checkIntersection();
    }

    _onClick(e) {
        const hovered = this._checkIntersection();
        if (hovered && this.onPulseClick) {
            if (this.hoveredStar) this.hoveredStar.labelEl.classList.remove('hovered');
            this.onPulseClick(hovered.data);
        }
    }

    _checkIntersection() {
        if (!this.camera || !this.stars.length) return null;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const cores = this.stars.map(s => s.core).filter(Boolean);
        if (!cores.length) return null;
        const intersects = this.raycaster.intersectObjects(cores);

        if (intersects.length > 0) {
            this.container.style.cursor = 'pointer';
            const starObj = intersects[0].object.userData.starObj;
            if (this.hoveredStar && this.hoveredStar !== starObj) this._unhoverStar(this.hoveredStar);
            this._hoverStar(starObj);
            this.hoveredStar = starObj;
            return starObj;
        } else {
            this.container.style.cursor = 'default';
            if (this.hoveredStar) {
                this._unhoverStar(this.hoveredStar);
                this.hoveredStar = null;
            }
            if (this.controls) this.controls.autoRotate = true;
            return null;
        }
    }

    _hoverStar(star) {
        if (!star) return;
        if (star.labelEl) star.labelEl.classList.add('hovered');
        if (star.glowMat) star.glowMat.uniforms.uColor.value.multiplyScalar(1.3);
    }

    _unhoverStar(star) {
        if (!star) return;
        if (star.labelEl) star.labelEl.classList.remove('hovered');
        if (star.glowMat) star.glowMat.uniforms.uColor.value.multiplyScalar(1 / 1.3);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LABELS
    // ═══════════════════════════════════════════════════════════════════════════

    _updateLabels() {
        if (!this.renderer || !this.camera) return;
        const wH = this.renderer.domElement.clientWidth / 2;
        const hH = this.renderer.domElement.clientHeight / 2;
        const tempV = new THREE.Vector3();

        this.stars.forEach(star => {
            if (!star.labelEl || !star.group || !star.group.visible) return;
            if (star.labelHidden) { star.labelEl.classList.remove('visible'); return; }
            tempV.set(star.basePos.x, star.basePos.y - star.starSize * 3.5, star.basePos.z);
            const camToPt = tempV.clone().sub(this.camera.position);
            const front = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
            if (camToPt.dot(front) < 0) {
                star.labelEl.classList.remove('visible');
                return;
            }
            tempV.project(this.camera);
            const x = (tempV.x * wH) + wH;
            const y = -(tempV.y * hH) + hH;
            star.labelEl.style.left = `${x}px`;
            star.labelEl.style.top = `${y}px`;

            const dist = this.camera.position.distanceTo(star.basePos);
            if (dist > 55 || x < -100 || x > wH * 2 + 100 || y < -100 || y > hH * 2 + 100) {
                star.labelEl.classList.remove('visible');
            } else {
                star.labelEl.classList.add('visible');
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANIMATION LOOP
    // ═══════════════════════════════════════════════════════════════════════════

    _animate() {
        this.animationId = requestAnimationFrame(() => this._animate());

        if (document.hidden) return;

        const now = performance.now() / 1000;
        if (!this._lastFrameTime) this._lastFrameTime = now;
        const delta = now - this._lastFrameTime;
        this._lastFrameTime = now;

        if (this._wasHidden || delta > 0.25) {
            this._wasHidden = false;
            this._lastFrameTime = now;
            if (this.controls) this.controls.update();
            this.renderer.render(this.scene, this.camera);
            return;
        }

        this._elapsedOverride += delta;
        const elapsed = this._elapsedOverride;

        // Nebula drift
        if (this.nebula) {
            this.nebula.material.uniforms.uTime.value = elapsed;
            this.nebula.rotation.y = elapsed * 0.008;
        }
        // Galaxy dust rotation
        if (this.bgParticles) {
            this.bgParticles.material.uniforms.uTime.value = elapsed;
            this.bgParticles.rotation.y = elapsed * 0.018;
        }
        // Far stars
        if (this.farStars) {
            this.farStars.material.uniforms.uTime.value = elapsed;
            this.farStars.rotation.y = elapsed * 0.006;
            this.farStars.rotation.x = Math.sin(elapsed * 0.01) * 0.015;
        }
        // Animate each pulse star
        const hasActiveVanish = this.stars.some(s => s.group?.userData.vanishAnim?.active);
        this.stars.forEach(star => {
            if (!star.group || !star.core || !star.group.visible) return;
            const t = elapsed;
            const off = star.timeOffset;

            // Vanish animation: scale from 0 to 1 with elastic ease
            if (star.group.userData.vanishAnim && star.group.userData.vanishAnim.active) {
                const anim = star.group.userData.vanishAnim;
                anim.t += 0.016;
                const progress = Math.min(anim.t / anim.duration, 1);
                // Elastic ease out
                const elastic = progress === 1 ? 1 : Math.pow(2, -10 * progress) * Math.sin((progress * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
                const scale = elastic;
                star.group.scale.set(scale, scale, scale);
                if (progress >= 1) {
                    anim.active = false;
                    // Delay before other stars appear
                    const self = this;
                    setTimeout(() => {
                        self.stars.forEach(s => {
                            if (s !== star && s.group) {
                                s.labelHidden = false;
                                if (s.labelEl) s.labelEl.style.display = '';
                                s.group.userData.appearAnim = { active: true, t: 0, duration: 3.0 };
                            }
                        });
                    }, 3000);
                }
            }

            // Appear animation: other stars fade in after vanish completes
            if (star.group.userData.appearAnim && star.group.userData.appearAnim.active) {
                const anim = star.group.userData.appearAnim;
                anim.t += 0.016;
                const progress = Math.min(anim.t / anim.duration, 1);
                // Ease out cubic
                const ease = 1 - Math.pow(1 - progress, 3);
                star.group.scale.set(ease, ease, ease);
                if (progress >= 1) {
                    anim.active = false;
                }
            } else if (!star.group.userData.vanishAnim?.active && !star.group.userData.appearAnim?.active) {
                // Hide other stars while vanish is playing
                if (hasActiveVanish) {
                    star.group.scale.set(0, 0, 0);
                }
            }

            if (star.coreMat && star.coreMat.uniforms && star.coreMat.uniforms.uTime) {
                star.coreMat.uniforms.uTime.value = t;
            }
            if (star.glowMat && star.glowMat.uniforms && star.glowMat.uniforms.uTime) {
                star.glowMat.uniforms.uTime.value = t;
            }

            // 3D vibration from EEG bands
            let vx = 0, vy = 0, vz = 0;
            if (star.bandVibes) {
                Object.values(star.bandVibes).forEach(v => {
                    vx += Math.sin(t * v.freq + v.phase) * v.amp * 0.1;
                    vy += Math.cos(t * v.freq * 0.8 + v.phase) * v.amp * 0.1;
                    vz += Math.sin(t * v.freq * 1.2 + v.phase + 1.0) * v.amp * 0.08;
                });
            }
            star.group.position.x = star.basePos.x + vx;
            star.group.position.y = star.basePos.y + vy + Math.sin(t * 0.5 + off) * 0.15;
            star.group.position.z = star.basePos.z + vz;

            star.core.rotation.y = t * 0.2 + off;
            star.core.rotation.z = t * 0.1;

            if (star.glow) {
                star.glow.rotation.y = -t * 0.1;
                star.glow.rotation.x = Math.sin(t * 0.3 + off) * 0.1;
            }
        });

        if (this.controls) this.controls.update();
        this.renderer.render(this.scene, this.camera);
        this._updateLabels();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RESIZE / CLEANUP
    // ═══════════════════════════════════════════════════════════════════════════

    _onResize() {
        if (!this.container) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w === 0 || h === 0) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    destroy() {
        this._destroyed = true;
        this._loadToken++;
        if (this.animationId) cancelAnimationFrame(this.animationId);
        this.clearPulses();

        [this.bgParticles, this.farStars, this.nebula].forEach(p => {
            if (p) {
                this.scene.remove(p);
                p.geometry.dispose();
                p.material.dispose();
            }
        });

        this.shootingStars.forEach(s => {
            this.scene.remove(s.line);
            s.geo.dispose();
            s.mat.dispose();
        });
        this.shootingStars = [];

        this.scene.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });

        if (this.renderer) this.renderer.dispose();
        this.container.innerHTML = '';
    }
}
