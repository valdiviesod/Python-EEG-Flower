/**
 * Garden 3D — Full 3D Interactive Botanical Garden using Three.js
 * 
 * Replaces the 2D grid with a full 3D environment.
 * Each flower represents a saved EEG capture.
 */

class Garden3D {
    constructor(containerId, onFlowerClick) {
        this.container = document.getElementById(containerId);
        this.onFlowerClick = onFlowerClick; // Callback for when a flower is clicked

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.animationId = null;
        this.clock = new THREE.Clock();

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.flowers = []; // Stores objects containing { group, data, labelElement, stemHeight, timeOffset }
        this.interactables = []; // Meshes to test for raycasting

        this.hoveredFlowerLabel = null;
    }

    init() {
        const w = this.container.clientWidth || 800;
        const h = this.container.clientHeight || 600;

        // Scene setup
        this.scene = new THREE.Scene();
        // Give it a slightly foggy celestial atmosphere
        this.scene.fog = new THREE.FogExp2(0x0a0c10, 0.04);

        // Camera
        this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
        this.camera.position.set(0, 10, 20);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        this.renderer.setClearColor(0x0a0c10, 0); // Transparent to show CSS background

        if ('outputEncoding' in this.renderer && THREE.sRGBEncoding) {
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        }

        this.container.innerHTML = '';
        this.container.appendChild(this.renderer.domElement);

        // OrbitControls
        if (THREE.OrbitControls) {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.minDistance = 5;
            this.controls.maxDistance = 40;
            this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't go below ground
            this.controls.target.set(0, 2, 0);
            this.controls.autoRotate = true;
            this.controls.autoRotateSpeed = 0.5;
        }

        this._buildEnvironment();
        this._setupInteraction();

        // Resize handler
        this._resizeHandler = () => this._onResize();
        window.addEventListener('resize', this._resizeHandler);

        this._animate();
    }

    _buildEnvironment() {
        // Soft ambient light
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);

        // Main moonlight/sunlight
        const mainLight = new THREE.DirectionalLight(0xE8F0FF, 0.8);
        mainLight.position.set(10, 20, 10);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 2048;
        mainLight.shadow.mapSize.height = 2048;
        mainLight.shadow.camera.near = 0.5;
        mainLight.shadow.camera.far = 50;
        mainLight.shadow.camera.left = -15;
        mainLight.shadow.camera.right = 15;
        mainLight.shadow.camera.top = 15;
        mainLight.shadow.camera.bottom = -15;
        mainLight.shadow.bias = -0.001;
        this.scene.add(mainLight);

        // Magical rim lights from ground
        const fillLight = new THREE.PointLight(0xA8D8B9, 0.5, 30);
        fillLight.position.set(0, 2, 0);
        this.scene.add(fillLight);

        const fillLight2 = new THREE.PointLight(0xB4A5C9, 0.6, 30);
        fillLight2.position.set(0, -2, 0);
        this.scene.add(fillLight2);

        // Create the Garden Island
        const islandGeo = new THREE.CylinderGeometry(12, 11, 2, 64);

        // Material that looks like magical soil/grass
        const islandMat = new THREE.MeshStandardMaterial({
            color: 0x1E2B22, // Dark moss green
            roughness: 0.9,
            metalness: 0.1,
        });

        const island = new THREE.Mesh(islandGeo, islandMat);
        island.position.y = -1; // Top is at y=0
        island.receiveShadow = true;
        this.scene.add(island);

        // Add some glowing "fireflies" / spores around the island
        this._addFireflies();
    }

    _addFireflies() {
        const count = 200;
        const positions = new Float32Array(count * 3);
        const randoms = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            // Random point within radius 15, height 0 to 12
            const r = Math.random() * 15;
            const theta = Math.random() * Math.PI * 2;
            positions[i * 3] = r * Math.cos(theta);
            positions[i * 3 + 1] = Math.random() * 12;
            positions[i * 3 + 2] = r * Math.sin(theta);
            randoms[i] = Math.random();
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

        // Use standard particle material for fireflies
        const mat = new THREE.PointsMaterial({
            size: 0.15,
            color: 0xFFFFCC,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.fireflies = new THREE.Points(geo, mat);
        this.scene.add(this.fireflies);
    }

    _setupInteraction() {
        this.container.addEventListener('pointermove', (e) => this._onPointerMove(e));
        this.container.addEventListener('click', (e) => this._onClick(e));
    }

    _onPointerMove(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        // Stop auto rotation when hovering over map
        if (this.controls) {
            this.controls.autoRotate = false;
        }

        this._checkIntersection();
    }

    _onClick(e) {
        const hovered = this._checkIntersection();
        if (hovered && this.onFlowerClick) {
            // Un-hover current
            if (this.hoveredFlowerLabel) {
                this.hoveredFlowerLabel.labelElement.classList.remove('hovered');
            }
            this.onFlowerClick(hovered.data);
        }
    }

    _checkIntersection() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        // Intersect against invisible hitboxes for easier clicking
        const intersects = this.raycaster.intersectObjects(this.interactables);

        if (intersects.length > 0) {
            this.container.style.cursor = 'pointer';
            const flowerObj = intersects[0].object.userData.flowerObj;

            if (this.hoveredFlowerLabel && this.hoveredFlowerLabel !== flowerObj) {
                this.hoveredFlowerLabel.labelElement.classList.remove('hovered');
            }

            flowerObj.labelElement.classList.add('hovered');
            this.hoveredFlowerLabel = flowerObj;
            return flowerObj;
        } else {
            this.container.style.cursor = 'default';
            if (this.hoveredFlowerLabel) {
                this.hoveredFlowerLabel.labelElement.classList.remove('hovered');
                this.hoveredFlowerLabel = null;
            }
            // Resume autorotate if not hovering anything
            if (this.controls) this.controls.autoRotate = true;
            return null;
        }
    }

    // ── Flower Generation ────────────────────────────────────────────────────────

    clearFlowers() {
        this.flowers.forEach(f => {
            if (f.group) this.scene.remove(f.group);
            if (f.labelElement && f.labelElement.parentNode) {
                f.labelElement.parentNode.removeChild(f.labelElement);
            }
        });

        this.flowers = [];
        this.interactables = [];
    }

    async loadCaptures(capturesList) {
        this.clearFlowers();

        // Distribute flowers elegantly using Fermat's spiral (sunflower pattern)
        const c = 2.0; // scaling factor
        const total = capturesList.length;

        // Sort captures by date
        capturesList.sort((a, b) => {
            // Basic sort by whatever date is visible, fallback to order
            return a.filename.localeCompare(b.filename);
        });

        for (let i = 0; i < total; i++) {
            const captureMeta = capturesList[i];

            try {
                // Fetch the full JSON to build the flower correctly
                const resp = await fetch(`/api/garden/file?name=${encodeURIComponent(captureMeta.filename)}`);
                if (!resp.ok) continue;
                const fullCaptureData = await resp.json();

                // Spiral positioning
                // i = 0 is center. We shift i+1 so center isn't exactly at 0,0 
                const n = i + 1;
                const angle = n * 137.5 * (Math.PI / 180);
                const r = c * Math.sqrt(n);

                // Add some noise
                const x = r * Math.cos(angle) + (Math.random() - 0.5) * 1.5;
                const z = r * Math.sin(angle) + (Math.random() - 0.5) * 1.5;

                this._buildGardenFlower(fullCaptureData, x, z);
            } catch (err) {
                console.error("Error building garden flower for ", captureMeta, err);
            }
        }
    }

    _buildGardenFlower(captureData, px, pz) {
        // Initialize analyzer
        const analyzer = new EEGBandAnalyzer(captureData);
        // We reuse the styling logic from Flower3D but adapt it for the garden

        const flowerGroup = new THREE.Group();
        flowerGroup.position.set(px, 0, pz);

        // Random slight rotation so they don't look uniform
        flowerGroup.rotation.y = Math.random() * Math.PI * 2;

        const stemH = 2.0 + Math.random() * 1.5; // Randomize heights somewhat
        const timeOffset = Math.random() * 100; // For wind animation

        this._buildStem(flowerGroup, stemH);
        this._buildPetals(flowerGroup, analyzer, stemH);

        // Create an invisible taller cylinder around the flower for easy clicking
        const hitGeo = new THREE.CylinderGeometry(1.5, 1.5, stemH + 2, 8);
        const hitMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitMesh = new THREE.Mesh(hitGeo, hitMat);
        hitMesh.position.y = stemH / 2 + 1;

        const labelElem = this._createHtmlLabel(captureData.metadata || captureData);

        const flowerObj = {
            data: captureData,
            group: flowerGroup,
            hitMesh: hitMesh,
            stemHeight: stemH,
            timeOffset: timeOffset,
            labelElement: labelElem,
            basePos: new THREE.Vector3(px, 0, pz)
        };

        hitMesh.userData.flowerObj = flowerObj;
        flowerGroup.add(hitMesh);

        this.flowers.push(flowerObj);
        this.interactables.push(hitMesh);
        this.scene.add(flowerGroup);
    }

    _createHtmlLabel(meta) {
        const div = document.createElement('div');
        div.className = 'garden-3d-label';

        const name = meta.user_name || 'Anónimo';
        div.innerHTML = `<span class="garden-3d-label-name">${name}</span>`;

        // Append to wrap, not canvas, so it sits on top outside WebGL context
        const wrap = document.getElementById('garden-3d-wrap');
        if (wrap) wrap.appendChild(div);

        return div;
    }

    _buildStem(group, height) {
        const radius = 0.05 + Math.random() * 0.02;

        // CatmullRomCurve to give it a slight natural curve
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3((Math.random() - 0.5) * 0.2, height * 0.3, (Math.random() - 0.5) * 0.2),
            new THREE.Vector3((Math.random() - 0.5) * 0.3, height * 0.7, (Math.random() - 0.5) * 0.3),
            new THREE.Vector3(0, height, 0)
        ]);

        const geo = new THREE.TubeGeometry(curve, 16, radius, 8, false);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x4e8c2c,
            roughness: 0.8,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        group.add(mesh);
    }

    // Adapted from Flower3D, simplified for massive rendering
    _buildPetals(group, analyzer, stemTop) {
        const layers = analyzer.flowerParams.layers;
        const centerGroup = new THREE.Group();
        centerGroup.position.y = stemTop;

        const numLayers = layers.length;
        for (let i = 0; i < numLayers; i++) {
            const layer = layers[i];
            const band = layer.band;
            const petalCount = layer.petalCount;
            const t = i / (numLayers - 1);
            const pctNorm = Math.max(0, Math.min(1, band.percentage / 40));

            const color = new THREE.Color(band.color);
            const colorDeep = new THREE.Color(band.colorDeep);

            const ringRadius = 0.50 * (1 - t);
            const petalW = 0.38 - (0.38 - 0.14) * t;
            const petalH = 0.42 - (0.42 - 0.18) * t;
            const petalArch = Math.max(layer.petalHeight * 1.2, 0.15);
            const yBase = i * 0.04;
            const tiltAngle = 0.75 - (0.75 - 0.05) * t;
            const cupStrength = 0.35 + (0.7 - 0.35) * t;

            for (let j = 0; j < petalCount; j++) {
                const angle = (j / petalCount) * Math.PI * 2 + layer.rotation;
                const petal = this._createRosePetal(
                    petalW, petalH, petalArch, cupStrength,
                    color, colorDeep, pctNorm, t
                );

                petal.position.set(
                    ringRadius * Math.cos(angle),
                    yBase,
                    ringRadius * Math.sin(angle)
                );

                petal.rotation.y = -angle + Math.PI / 2;
                petal.rotation.z = tiltAngle;
                petal.castShadow = true;

                centerGroup.add(petal);
            }
        }

        // Add Center Disc
        const centerR = 0.55;
        const centerGeo = new THREE.SphereGeometry(centerR * 0.68, 16, 16);
        const centerMat = new THREE.MeshStandardMaterial({
            color: 0xFFE4C9,
            roughness: 0.5,
            emissive: 0xF5D0A9,
            emissiveIntensity: 0.15,
        });
        const center = new THREE.Mesh(centerGeo, centerMat);
        center.position.y = 0.14;
        center.scale.y = 0.7;
        centerGroup.add(center);

        group.add(centerGroup);
    }

    // Reused/simplified from Flower3D
    _createRosePetal(pw, ph, arch, cup, color, colorDeep, pctNorm, layerT) {
        const shape = new THREE.Shape();
        const w = pw * 0.5;
        const h = ph;
        const tipHalf = w * 0.45;
        const tipY = h * 0.95;

        shape.moveTo(0, 0);
        shape.bezierCurveTo(w * 1.5, h * 0.08, w * 1.3, h * 0.55, tipHalf, tipY);
        shape.bezierCurveTo(w * 0.18, h * 1.06, -w * 0.18, h * 1.06, -tipHalf, tipY);
        shape.bezierCurveTo(-w * 1.3, h * 0.55, -w * 1.5, h * 0.08, 0, 0);

        const thickness = Math.max(0.015, 0.04 - (0.04 - 0.025) * layerT);
        const extSettings = { depth: thickness, bevelEnabled: false, curveSegments: 8 };
        const geo = new THREE.ExtrudeGeometry(shape, extSettings);

        const safeH = Math.max(h, 0.001);
        const safeW = Math.max(w * 1.6, 0.001);
        const relief = Math.max(arch, 0.12);

        const pos = geo.attributes.position;
        for (let vi = 0; vi < pos.count; vi++) {
            const x = pos.getX(vi);
            const y = pos.getY(vi);
            let z = pos.getZ(vi);

            const tY = Math.max(0, Math.min(1, y / safeH));
            const tX = Math.max(0, Math.min(1, Math.abs(x) / safeW));

            const longArch = (tY * tY * 0.65 + tY * (1 - tY) * 0.35) * relief;
            const cupLift = tX * tX * cup * relief * 1.2;
            const tipCurl = Math.pow(tY, 3.0) * relief * 0.25;
            const edgeTwist = tX * tY * 0.03 * relief;

            z += longArch + cupLift + tipCurl + edgeTwist;
            pos.setZ(vi, z);
        }
        geo.computeVertexNormals();

        const satBoost = 0.22 + (0.48 - 0.22) * pctNorm;

        // Color boost logic
        const hsl = { h: 0, s: 0, l: 0 };
        const mixColor = color.clone().lerp(colorDeep, 0.28);
        mixColor.getHSL(hsl);
        const softAccent = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s + satBoost), Math.min(1, hsl.l + 0.02));

        const mat = new THREE.MeshStandardMaterial({
            color: softAccent,
            roughness: 0.4,
            side: THREE.DoubleSide
        });

        return new THREE.Mesh(geo, mat);
    }

    _updateLabels() {
        const widthHalf = this.renderer.domElement.clientWidth / 2;
        const heightHalf = this.renderer.domElement.clientHeight / 2;

        const tempV = new THREE.Vector3();

        this.flowers.forEach(f => {
            // Focus on the top of the flower for the label
            tempV.set(f.basePos.x, f.stemHeight + 1.2, f.basePos.z);

            // Check if behind camera
            const cameraToPoint = tempV.clone().sub(this.camera.position);
            const frontVec = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
            if (cameraToPoint.dot(frontVec) < 0) {
                f.labelElement.classList.remove('visible');
                return;
            }

            tempV.project(this.camera);

            const x = (tempV.x * widthHalf) + widthHalf;
            const y = -(tempV.y * heightHalf) + heightHalf;

            f.labelElement.style.left = `${x}px`;
            f.labelElement.style.top = `${y}px`;

            // Fade out if far away or edge
            const dist = this.camera.position.distanceTo(f.basePos);
            if (dist > 30 || x < -50 || x > widthHalf * 2 + 50 || y < -50 || y > heightHalf * 2 + 50) {
                f.labelElement.classList.remove('visible');
            } else {
                f.labelElement.classList.add('visible');
            }
        });
    }

    // ── Animation ─────────────────────────────────────────────────────────
    _animate() {
        this.animationId = requestAnimationFrame(() => this._animate());

        const elapsed = this.clock.getElapsedTime();

        // Animate flowers breeze
        this.flowers.forEach(f => {
            const wind = Math.sin(elapsed * 0.5 + f.timeOffset) * 0.04;
            const windZ = Math.cos(elapsed * 0.4 + f.timeOffset * 1.5) * 0.04;
            f.group.rotation.z = wind;
            f.group.rotation.x = windZ;
        });

        // Animate fireflies
        if (this.fireflies) {
            const pos = this.fireflies.geometry.attributes.position.array;
            const rands = this.fireflies.geometry.attributes.aRandom.array;

            for (let i = 0; i < rands.length; i++) {
                // move y slowly
                pos[i * 3 + 1] += Math.sin(elapsed + rands[i] * 100) * 0.01;
                // wrap around
                if (pos[i * 3 + 1] > 12) pos[i * 3 + 1] = 0;
            }
            this.fireflies.geometry.attributes.position.needsUpdate = true;
        }

        if (this.controls) this.controls.update();
        this.renderer.render(this.scene, this.camera);

        this._updateLabels();
    }

    // ── Resize ────────────────────────────────────────────────────────────
    _onResize() {
        if (!this.container) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w === 0 || h === 0) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    // ── Cleanup ───────────────────────────────────────────────────────────
    destroy() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        window.removeEventListener('resize', this._resizeHandler);

        this.clearFlowers();

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
