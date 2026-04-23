/**
 * Galaxy Garden — 3D Galaxy Visualization for EEG Captures
 *
 * Each pulse is a living, breathing 3D star in the galaxy.
 * Background: 20,000+ white particles in spiral arms.
 * Pulse stars: shader-based animated spheres with lava-like surface,
 *   multi-layer pulsing halos, 3D vibration per EEG band.
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
        this.farStars = null;      // distant white stars

        this.hoveredStar = null;

        // Band colours
        this.bandColours = {
            delta: new THREE.Color('#8B5CF6'),
            theta: new THREE.Color('#22C55E'),
            alpha: new THREE.Color('#EC4899'),
            beta:  new THREE.Color('#F97316'),
            gamma: new THREE.Color('#EAB308'),
        };
    }

    init() {
        const w = this.container.clientWidth || 800;
        const h = this.container.clientHeight || 600;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#030508');
        this.scene.fog = new THREE.FogExp2(0x030508, 0.012);

        this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 300);
        this.camera.position.set(0, 6, 22);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.3;

        this.container.innerHTML = '';
        this.container.appendChild(this.renderer.domElement);

        if (THREE.OrbitControls) {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.minDistance = 4;
            this.controls.maxDistance = 80;
            this.controls.autoRotate = true;
            this.controls.autoRotateSpeed = 0.2;
            this.controls.target.set(0, 0, 0);
        }

        this._buildBackground();
        this._setupInteraction();

        this._lastFrameTime = 0;
        this._elapsedOverride = 0;
        this._wasHidden = false;

        window.addEventListener('resize', () => this._onResize());
        document.addEventListener('visibilitychange', () => this._onVisibilityChange());
        this._animate();
    }

    _onVisibilityChange() {
        if (document.hidden) {
            this._wasHidden = true;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BACKGROUND
    // ═══════════════════════════════════════════════════════════════════════════

    _buildBackground() {
        // ── Layer 1: Galaxy dust (coloured, spiral arms) ──
        this._buildGalaxyDust();
        // ── Layer 2: Far white stars (simple, many) ──
        this._buildFarStars();

        const ambient = new THREE.AmbientLight(0x202040, 0.4);
        this.scene.add(ambient);

        const centreLight = new THREE.PointLight(0xffffff, 0.8, 60);
        centreLight.position.set(0, 2, 0);
        this.scene.add(centreLight);
    }

    _buildGalaxyDust() {
        const COUNT = 12000;
        const R = 25;
        const positions = new Float32Array(COUNT * 3);
        const colours = new Float32Array(COUNT * 3);
        const scales = new Float32Array(COUNT);
        const randoms = new Float32Array(COUNT * 3);

        const inside = new THREE.Color('#ffffff');
        const outside = new THREE.Color('#3b5db5');

        for (let i = 0; i < COUNT; i++) {
            const i3 = i * 3;
            const r = Math.random() * R;
            const branch = (i % 5) / 5 * Math.PI * 2;
            const spin = r * 1.2;

            const rx = Math.pow(Math.random(), 3) * 0.6 * (Math.random() < 0.5 ? 1 : -1);
            const ry = Math.pow(Math.random(), 3) * 0.3 * (Math.random() < 0.5 ? 1 : -1);
            const rz = Math.pow(Math.random(), 3) * 0.6 * (Math.random() < 0.5 ? 1 : -1);

            positions[i3] = Math.cos(branch + spin) * r + rx;
            positions[i3 + 1] = ry;
            positions[i3 + 2] = Math.sin(branch + spin) * r + rz;

            randoms[i3] = rx;
            randoms[i3 + 1] = ry;
            randoms[i3 + 2] = rz;

            const c = inside.clone().lerp(outside, r / R);
            colours[i3] = c.r; colours[i3 + 1] = c.g; colours[i3 + 2] = c.b;
            scales[i] = Math.random();
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
        geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
        geo.setAttribute('aRandomness', new THREE.BufferAttribute(randoms, 3));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uSize: { value: 28 * this.renderer.getPixelRatio() },
                uTime: { value: 0 }
            },
            vertexShader: `
                uniform float uSize; uniform float uTime;
                attribute float aScale; attribute vec3 aRandomness;
                varying vec3 vColor;
                void main() {
                    vec4 mp = modelMatrix * vec4(position, 1.0);
                    float dfc = length(mp.xz);
                    float ang = atan(mp.x, mp.z);
                    ang += (1.0 / max(dfc, 0.1)) * uTime * 0.04;
                    mp.x = sin(ang) * dfc;
                    mp.z = cos(ang) * dfc;
                    mp.xyz += aRandomness - 0.5;
                    float flicker = 0.8 + 0.3 * sin(uTime * 2.0 + aRandomness.x * 5.0);
                    vec4 vp = viewMatrix * mp;
                    gl_Position = projectionMatrix * vp;
                    gl_PointSize = uSize * aScale * (4.0 / -vp.z) * flicker;
                    vColor = color;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    float a = 0.05 / d - 0.15;
                    if (a < 0.0) discard;
                    gl_FragColor = vec4(vColor, a);
                }
            `,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true
        });

        this.bgParticles = new THREE.Points(geo, mat);
        this.scene.add(this.bgParticles);
    }

    _buildFarStars() {
        const COUNT = 15000;
        const positions = new Float32Array(COUNT * 3);
        const scales = new Float32Array(COUNT);
        const twinkle = new Float32Array(COUNT);

        for (let i = 0; i < COUNT; i++) {
            const i3 = i * 3;
            const r = 30 + Math.random() * 120;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = r * Math.cos(phi);

            scales[i] = 0.3 + Math.random() * 0.7;
            twinkle[i] = Math.random() * 100;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
        geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uSize: { value: 18 * this.renderer.getPixelRatio() },
                uTime: { value: 0 }
            },
            vertexShader: `
                uniform float uSize; uniform float uTime;
                attribute float aScale; attribute float aTwinkle;
                varying float vAlpha;
                void main() {
                    vec4 vp = viewMatrix * modelMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * vp;
                    float t = sin(uTime * 1.5 + aTwinkle) * 0.5 + 0.5;
                    vAlpha = 0.25 + t * 0.75;
                    gl_PointSize = uSize * aScale * (3.0 / -vp.z);
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    float a = 0.06 / d - 0.12;
                    if (a < 0.0) discard;
                    gl_FragColor = vec4(1.0, 1.0, 1.0, a * vAlpha);
                }
            `,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });

        this.farStars = new THREE.Points(geo, mat);
        this.scene.add(this.farStars);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PULSE STARS
    // ═══════════════════════════════════════════════════════════════════════════

    clearPulses() {
        this.stars.forEach(s => {
            if (s.group) this.scene.remove(s.group);
            if (s.labelEl && s.labelEl.parentNode) s.labelEl.parentNode.removeChild(s.labelEl);
        });
        this.stars = [];
    }

    async loadCaptures(capturesList) {
        this.clearPulses();
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
        const MAX_R = 12;      // keep inside visible galaxy
        const MIN_D = 2.8;     // breathing room between stars

        for (let i = 0; i < items.length; i++) {
            let x, y, z, ok;
            let attempts = 0;
            do {
                ok = true;
                // uniform disc distribution for density
                const r = Math.sqrt(Math.random()) * MAX_R;
                const theta = Math.random() * Math.PI * 2;
                x = Math.cos(theta) * r;
                z = Math.sin(theta) * r;
                y = (Math.random() - 0.5) * 4; // vertical spread

                for (const p of placed) {
                    const dx = x - p.x, dy = y - p.y, dz = z - p.z;
                    if (Math.sqrt(dx*dx + dy*dy + dz*dz) < MIN_D) { ok = false; break; }
                }
                attempts++;
            } while (!ok && attempts < 80);

            placed.push({ x, y, z });
            this._createPulseStar(items[i].data, items[i].report, x, y, z, i);
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
            delta: ['#0D0020', '#2A0060', '#5B21B6', '#8B5CF6', '#C4B5FD', '#FFFFFF', '#DDD6FE', '#6D28D9'],
            theta: ['#052E16', '#14532D', '#15803D', '#22C55E', '#86EFAC', '#FFFFFF', '#BBF7D0', '#166534'],
            alpha: ['#2D0018', '#7F1D4F', '#BE185D', '#EC4899', '#F9A8D4', '#FFFFFF', '#FBCFE8', '#9D174D'],
            beta:  ['#431407', '#9A3412', '#C2410C', '#F97316', '#FDBA74', '#FFFFFF', '#FED7AA', '#EA580C'],
            gamma: ['#422006', '#713F12', '#A16207', '#EAB308', '#FDE047', '#FFFFFF', '#FEF08A', '#CA8A04'],
        };
        return { dominant, colors: PALETTES[dominant] };
    }

    _createPulseStar(captureData, report, x, y, z, index) {
        const group = new THREE.Group();
        group.position.set(x, y, z);

        const baseSize = 0.38; // all stars same size

        // ── Colour from LavaPulse palette system ──
        const { dominant, colors } = this._getLavaPalette(report);
        const mainHex = colors[3]; // index 3 = primary band colour
        const deepHex = colors[2]; // index 2 = deeper shade
        const starColor = new THREE.Color(mainHex);
        const deepColor = new THREE.Color(deepHex);

        // Unique per-capture random shift (small, so palette still recognizable)
        const hsl = {};
        starColor.getHSL(hsl);
        const hueShift = ((Math.random() - 0.5) * 0.06 + 1) % 1; // ±22°
        const satShift = (Math.random() - 0.5) * 0.12;
        const lightShift = (Math.random() - 0.5) * 0.08;
        starColor.setHSL(
            (hsl.h + hueShift) % 1,
            Math.max(0.4, Math.min(1, hsl.s + satShift)),
            Math.max(0.4, Math.min(0.8, hsl.l + lightShift))
        );

        const bands = report.bands;

        // Vibration frequencies derived from each band — unique per capture
        const bandVibes = {};
        bands.forEach(b => {
            bandVibes[b.key] = {
                freq: (b.low + b.high) * 0.5 * 0.1,
                amp: b.percentage / 100,
                phase: Math.random() * Math.PI * 2,
            };
        });

        // Animation parameters driven by capture EEG — every star unique
        const betaPower = (bands.find(b => b.key === 'beta') || {}).percentage || 0;
        const gammaPower = (bands.find(b => b.key === 'gamma') || {}).percentage || 0;
        const alphaPower = (bands.find(b => b.key === 'alpha') || {}).percentage || 0;
        const thetaPower = (bands.find(b => b.key === 'theta') || {}).percentage || 0;
        const animSpeed = 0.6 + (betaPower + gammaPower) / 100 * 1.2;
        // Wave frequencies unique per capture (derived from band ratios)
        const waveX = 3.0 + (betaPower / 40) * 3.0;
        const waveY = 2.5 + (alphaPower / 40) * 3.5;
        const waveZ = 2.0 + (gammaPower / 40) * 4.0;
        const waveSurface = 5.0 + (thetaPower / 40) * 5.0;

        // ── Animated core sphere — pulses at EEG rhythm ──
        const coreGeo = new THREE.IcosahedronGeometry(baseSize, 32);
        const coreMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: starColor },
                uEmissive: { value: deepColor.clone().multiplyScalar(1.6) },
                uSpeed: { value: animSpeed },
                uWaveX: { value: waveX },
                uWaveY: { value: waveY },
                uWaveZ: { value: waveZ },
                uWaveSurface: { value: waveSurface },
                uPulseAmp: { value: 0.14 },
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
                            + sin(p.z * uWaveZ + uTime * uSpeed * 1.2) * 0.5;
                    float disp = n * 0.12;
                    p += normal * disp;
                    vDisp = disp;
                    vPos = p;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor; uniform vec3 uEmissive; uniform float uTime;
                uniform float uSpeed; uniform float uWaveSurface; uniform float uPulseAmp;
                varying vec3 vNormal; varying vec3 vPos; varying float vDisp;
                void main() {
                    vec3 viewDir = normalize(cameraPosition - vPos);
                    float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);
                    float wave = sin(vPos.y * uWaveSurface + uTime * uSpeed * 2.0) * 0.5 + 0.5;
                    vec3 col = mix(uColor, uEmissive, wave * 0.6 + fresnel * 0.8);
                    float rim = fresnel * 1.2;
                    gl_FragColor = vec4(col + rim * uEmissive, 1.0);
                }
            `,
            side: THREE.DoubleSide,
        });
        const core = new THREE.Mesh(coreGeo, coreMat);
        group.add(core);

        // ── Dynamic pulse ring (EEG-driven, replaces halo+sprite) ──
        const ringGeo = new THREE.RingGeometry(baseSize * 1.1, baseSize * 1.7, 48);
        const ringMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: starColor.clone().multiplyScalar(1.2) },
                uEmissive: { value: deepColor.clone() },
                uAnimSpeed: { value: animSpeed },
                uWaveX: { value: waveX },
                uWaveY: { value: waveY },
                uWaveZ: { value: waveZ },
                uPulseAmp: { value: 0.55 },
            },
            vertexShader: `
                uniform float uTime; uniform float uAnimSpeed; uniform float uPulseAmp;
                uniform float uWaveX; uniform float uWaveY; uniform float uWaveZ;
                varying float vPulse; varying vec2 vUv;
                void main() {
                    vUv = uv;
                    float pulse = sin(uTime * uAnimSpeed * 3.0) * uPulseAmp
                               + sin(uTime * uAnimSpeed * 5.5) * uPulseAmp * 0.5
                               + cos(uTime * uAnimSpeed * 1.8) * uPulseAmp * 0.3;
                    vec3 pos = position;
                    pos.xy *= (1.0 + pulse * 0.4);
                    vPulse = pulse;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor; uniform vec3 uEmissive; uniform float uTime;
                uniform float uAnimSpeed; uniform float uPulseAmp;
                varying float vPulse; varying vec2 vUv;
                void main() {
                    float alpha = (0.35 + vPulse * 0.25) * (1.0 - abs(vUv.y - 0.5) * 2.0);
                    vec3 col = mix(uColor, uEmissive, vPulse * 0.5 + 0.5);
                    gl_FragColor = vec4(col, max(0.0, alpha));
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.lookAt(this.camera.position);
        group.add(ring);

        const labelEl = this._createLabel(captureData, starColor);

        // Raycast target = visible core mesh (no oversized invisible hitbox)
        core.userData.starObj = {
            data: captureData, group, core, coreMat,
            ring, ringMat,
            labelEl,
            basePos: new THREE.Vector3(x, y, z),
            starSize: baseSize, index,
            timeOffset: Math.random() * 100,
            bandVibes,
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
        if (star.ringMat) star.ringMat.uniforms.uPulseAmp.value = 0.9;
    }

    _unhoverStar(star) {
        if (!star) return;
        if (star.labelEl) star.labelEl.classList.remove('hovered');
        if (star.ringMat) star.ringMat.uniforms.uPulseAmp.value = 0.55;
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
            if (!star.labelEl) return;
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
            if (dist > 50 || x < -100 || x > wH * 2 + 100 || y < -100 || y > hH * 2 + 100) {
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

        // Background dust rotation
        if (this.bgParticles) {
            this.bgParticles.material.uniforms.uTime.value = elapsed;
            this.bgParticles.rotation.y = elapsed * 0.015;
        }
        // Far stars slow rotation
        if (this.farStars) {
            this.farStars.material.uniforms.uTime.value = elapsed;
            this.farStars.rotation.y = elapsed * 0.005;
            this.farStars.rotation.x = Math.sin(elapsed * 0.01) * 0.02;
        }

        // Animate each pulse star
        this.stars.forEach(star => {
            if (!star.group || !star.core) return;
            const t = elapsed;
            const off = star.timeOffset;

            if (star.coreMat && star.coreMat.uniforms && star.coreMat.uniforms.uTime) {
                star.coreMat.uniforms.uTime.value = t;
            }

            // 3D vibration from EEG bands
            let vx = 0, vy = 0, vz = 0;
            if (star.bandVibes) {
                Object.values(star.bandVibes).forEach(v => {
                    vx += Math.sin(t * v.freq + v.phase) * v.amp * 0.08;
                    vy += Math.cos(t * v.freq * 0.8 + v.phase) * v.amp * 0.08;
                    vz += Math.sin(t * v.freq * 1.2 + v.phase + 1.0) * v.amp * 0.06;
                });
            }
            star.group.position.x = star.basePos.x + vx;
            star.group.position.y = star.basePos.y + vy + Math.sin(t * 0.4 + off) * 0.12;
            star.group.position.z = star.basePos.z + vz;

            star.core.rotation.y = t * 0.15 + off;
            star.core.rotation.z = t * 0.08;

            if (star.ring && star.ringMat) {
                star.ringMat.uniforms.uTime.value = t;
                star.ring.lookAt(this.camera.position);
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

        [this.bgParticles, this.farStars].forEach(p => {
            if (p) {
                this.scene.remove(p);
                p.geometry.dispose();
                p.material.dispose();
            }
        });

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
