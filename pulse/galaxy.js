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
            const name = (star.data?.metadata?.user_name || '').toLowerCase();
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

    _getLavaPalette(report) {
        const bands = report.bands;
        const v = (key) => (bands.find(b => b.key === key) || {}).relativePower || 0;
        const d = v('delta'), th = v('theta'), a = v('alpha'), b = v('beta'), g = v('gamma');
        const dominant = [
            { key: 'delta', v: d }, { key: 'theta', v: th }, { key: 'alpha', v: a },
            { key: 'beta',  v: b }, { key: 'gamma', v: g },
        ].reduce((best, x) => x.v > best.v ? x : best).key;
        const PALETTES = {
            delta: ['#0D0020', '#2A0060', '#5B21B6', '#A855F7', '#C4B5FD', '#FFFFFF', '#DDD6FE', '#7C3AED'],
            theta: ['#052E16', '#14532D', '#15803D', '#34D399', '#86EFAC', '#FFFFFF', '#BBF7D0', '#10B981'],
            alpha: ['#2D0018', '#7F1D4F', '#BE185D', '#F472B6', '#F9A8D4', '#FFFFFF', '#FBCFE8', '#DB2777'],
            beta:  ['#431407', '#9A3412', '#C2410C', '#FB923C', '#FDBA74', '#FFFFFF', '#FED7AA', '#EA580C'],
            gamma: ['#422006', '#713F12', '#A16207', '#FACC15', '#FDE047', '#FFFFFF', '#FEF08A', '#EAB308'],
        };
        return { dominant, colors: PALETTES[dominant] };
    }

    /**
     * Build a cycling palette sequence from all 5 bands, weighted by power.
     * Similar to LavaPulse._buildParams() palSequence.
     */
    _buildPaletteCycle(report) {
        const bands = report.bands;
        const v = (key) => (bands.find(b => b.key === key) || {}).relativePower || 0;
        const PALETTES = {
            delta: { c: ['#0D0020', '#2A0060', '#5B21B6', '#A855F7', '#C4B5FD', '#FFFFFF', '#DDD6FE', '#7C3AED'] },
            theta: { c: ['#052E16', '#14532D', '#15803D', '#34D399', '#86EFAC', '#FFFFFF', '#BBF7D0', '#10B981'] },
            alpha: { c: ['#2D0018', '#7F1D4F', '#BE185D', '#F472B6', '#F9A8D4', '#FFFFFF', '#FBCFE8', '#DB2777'] },
            beta:  { c: ['#431407', '#9A3412', '#C2410C', '#FB923C', '#FDBA74', '#FFFFFF', '#FED7AA', '#EA580C'] },
            gamma: { c: ['#422006', '#713F12', '#A16207', '#FACC15', '#FDE047', '#FFFFFF', '#FEF08A', '#EAB308'] },
        };
        const allBands = [
            { v: v('delta'), pal: PALETTES.delta },
            { v: v('theta'), pal: PALETTES.theta },
            { v: v('alpha'), pal: PALETTES.alpha },
            { v: v('beta'),  pal: PALETTES.beta  },
            { v: v('gamma'), pal: PALETTES.gamma },
        ].sort((x, y) => y.v - x.v);
        const MIN_W = 0.07;
        const rawW = allBands.map(x => Math.max(x.v, MIN_W));
        const sumW = rawW.reduce((s, w) => s + w, 0);
        const seq = allBands.map((x, i) => ({ ...x.pal, _w: rawW[i] / sumW }));
        let _cum = 0;
        const breakpoints = seq.map(x => { _cum += x._w; return _cum; });
        const cyclePeriod = 24 + v('delta') * 4 + v('theta') * 3 - v('beta') * 1.5;
        return { seq, breakpoints, cyclePeriod: Math.max(3, cyclePeriod) };
    }

    _lerpHex(a, b, t) {
        const ra = parseInt(a.slice(1, 3), 16), ga = parseInt(a.slice(3, 5), 16), ba = parseInt(a.slice(5, 7), 16);
        const rb = parseInt(b.slice(1, 3), 16), gb = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
        const r = Math.round(ra + (rb - ra) * t);
        const g = Math.round(ga + (gb - ga) * t);
        const bl = Math.round(ba + (bb - ba) * t);
        return new THREE.Color(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`);
    }

    _cyclePaletteColor(palCycle, elapsed) {
        const period = palCycle.cyclePeriod;
        const phase = ((elapsed + palCycle.timeOffset * 0.1) % period) / period;
        const n = palCycle.seq.length;
        let seg = n - 1, prevBp = 0;
        for (let i = 0; i < n; i++) {
            if (phase <= palCycle.breakpoints[i]) { seg = i; break; }
            prevBp = palCycle.breakpoints[i];
        }
        const segLen = palCycle.breakpoints[seg] - prevBp;
        const localT = segLen > 0 ? (phase - prevBp) / segLen : 0;
        const t = localT * localT * (3 - 2 * localT); // smoothstep
        const a = palCycle.seq[seg];
        const b = palCycle.seq[(seg + 1) % n];
        return {
            main: this._lerpHex(a.c[3], b.c[3], t),
            deep: this._lerpHex(a.c[2], b.c[2], t),
            bright: this._lerpHex(a.c[4], b.c[4], t),
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

        const { dominant, colors } = this._getLavaPalette(report);
        const mainHex = colors[3];
        const deepHex = colors[2];
        const brightHex = colors[4];
        const starColor = new THREE.Color(mainHex);
        const deepColor = new THREE.Color(deepHex);
        const brightColor = new THREE.Color(brightHex);

        // Slight randomization for variety
        const hsl = {};
        starColor.getHSL(hsl);
        starColor.setHSL(
            (hsl.h + (Math.random() - 0.5) * 0.04 + 1) % 1,
            Math.max(0.5, Math.min(1, hsl.s + (Math.random() - 0.5) * 0.1)),
            Math.max(0.45, Math.min(0.75, hsl.l + (Math.random() - 0.5) * 0.06))
        );

        const palCycle = this._buildPaletteCycle(report);
        palCycle.timeOffset = Math.random() * 100;

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
            palCycle,
        };

        this.stars.push(core.userData.starObj);
        this.scene.add(group);
    }

    _createLabel(captureData, color) {
        const div = document.createElement('div');
        div.className = 'galaxy-star-label';
        const name = captureData.metadata?.user_name || 'Anónimo';
        const state = captureData.metadata?.user_state || '';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'galaxy-star-name';
        nameSpan.style.color = '#' + color.getHexString();
        nameSpan.textContent = name;
        div.appendChild(nameSpan);

        if (state) {
            const stateSpan = document.createElement('span');
            stateSpan.className = 'galaxy-star-state';
            stateSpan.textContent = state;
            div.appendChild(stateSpan);
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

            // Cycle palette colors through all 5 bands like 2D pulse
            if (star.palCycle) {
                const c = this._cyclePaletteColor(star.palCycle, t);
                if (star.coreMat) {
                    star.coreMat.uniforms.uColor.value.copy(c.main);
                    star.coreMat.uniforms.uColorB.value.copy(c.deep);
                    star.coreMat.uniforms.uColorC.value.copy(c.bright);
                }
                if (star.glowMat) {
                    star.glowMat.uniforms.uColor.value.copy(c.main).multiplyScalar(1.3);
                }
                if (star.labelEl) {
                    const nameSpan = star.labelEl.querySelector('.galaxy-star-name');
                    if (nameSpan) nameSpan.style.color = '#' + c.main.getHexString();
                }
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
