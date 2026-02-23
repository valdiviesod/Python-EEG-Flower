/**
 * Flower 3D — Three.js Botanical Flower Sculpture
 *
 * Creates a 3D flower from EEG band analysis:
 *   • 5 petal layers (one per frequency band) growing in height by power
 *   • Organic stem with leaves
 *   • Pistil center with tiny spheres
 *   • Soft pastel materials with subsurface scattering feel
 *   • Gentle particle pollen effects
 *   • Printable solid continuous mesh with stable circular base
 *   • Auto-rotation + orbit controls
 *
 * Requires Three.js (r128+) loaded globally as THREE
 */

class Flower3D {
    constructor(container, analyzer) {
        this.container = container;
        this.analyzer = analyzer;
        this.params = analyzer.flowerParams;
        this.bands = analyzer.normalizedBands;
        this.profile = analyzer.profile;

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.animationId = null;
        this.clock = null;
        this.flowerGroup = null;
        this.particles = null;
        this.printSpec = [];
    }

    init() {
        const w = this.container.clientWidth || 800;
        const h = this.container.clientHeight || 600;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#F5F0F8');

        // Camera
        this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
        this.camera.position.set(0, 3.5, 6);
        this.camera.lookAt(0, 1.5, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        if ('outputEncoding' in this.renderer && THREE.sRGBEncoding) {
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        }
        this.container.innerHTML = '';
        this.container.appendChild(this.renderer.domElement);

        // Controls
        if (THREE.OrbitControls) {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.minDistance = 3;
            this.controls.maxDistance = 15;
            this.controls.maxPolarAngle = Math.PI * 0.85;
            this.controls.target.set(0, 1.5, 0);
            this.controls.autoRotate = true;
            this.controls.autoRotateSpeed = 0.6;
        }

        this.clock = new THREE.Clock();

        // Build the flower
        this._buildScene();

        // Resize
        this._resizeHandler = () => this._onResize();
        window.addEventListener('resize', this._resizeHandler);

        // Start animation
        this._animate();
    }

    _buildScene() {
        this._addLights();

        this.flowerGroup = new THREE.Group();
        this.scene.add(this.flowerGroup);

        this._addBase();
        this._addStem();
        this._addLeaves();
        this._addPetalLayers();
        this._addCenter();
        this._addPollen();
        this._addGround();
    }

    // ── Lights ────────────────────────────────────────────────────────────
    _addLights() {
        // Warm ambient
        const ambient = new THREE.AmbientLight(0xFFF5EE, 0.38);
        this.scene.add(ambient);

        // Main directional (sunlight)
        const sunLight = new THREE.DirectionalLight(0xFFFAF0, 0.9);
        sunLight.position.set(4, 8, 4);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 1024;
        sunLight.shadow.mapSize.height = 1024;
        this.scene.add(sunLight);

        // Fill from below (bounce light)
        const fillLight = new THREE.DirectionalLight(0xFFE4E1, 0.2);
        fillLight.position.set(-3, -1, 2);
        this.scene.add(fillLight);

        // Subtle colored point lights matching band colors
        const bandLights = [
            { color: '#C4B7D8', pos: [-2, 2, 2] },
            { color: '#A8D8B9', pos: [2, 1.5, -2] },
            { color: '#FFD1DC', pos: [0, 4, 0] },
        ];

        bandLights.forEach(bl => {
            const light = new THREE.PointLight(new THREE.Color(bl.color), 0.3, 8);
            light.position.set(...bl.pos);
            this.scene.add(light);
        });

        // Top-down fill: ilumina pétalos vistos desde arriba
        const topLight = new THREE.DirectionalLight(0xFFF8F0, 0.7);
        topLight.position.set(0, 12, 0);
        this.scene.add(topLight);

        // Hemisphere: cielo pastel → tierra cálida (cubre todos los ángulos)
        const hemi = new THREE.HemisphereLight(0xF0E8FF, 0xFFE8D0, 0.55);
        this.scene.add(hemi);

        // Rim light lateral: mejora volumen y color en vista cenital
        const rimLight = new THREE.DirectionalLight(0xFFEAF4, 0.45);
        rimLight.position.set(-6, 5, -6);
        this.scene.add(rimLight);
    }

    _vibrantPastel(baseColor, saturationBoost = 0.32, lightnessBoost = 0.03) {
        const hsl = { h: 0, s: 0, l: 0 };
        baseColor.getHSL(hsl);
        const boosted = new THREE.Color();
        boosted.setHSL(
            hsl.h,
            clamp(hsl.s + saturationBoost, 0, 1),
            clamp(hsl.l + lightnessBoost, 0, 1)
        );
        return boosted;
    }

    // ── Base Platform (for 3D printing stability) ─────────────────────────
    _addBase() {
        const baseGeo = new THREE.CylinderGeometry(1.2, 1.4, 0.08, 64);
        const baseMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color('#E8E0D0'),
            metalness: 0.05,
            roughness: 0.8,
        });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = -0.04;
        base.receiveShadow = true;
        this.flowerGroup.add(base);

        // Decorative ring
        const ringGeo = new THREE.TorusGeometry(1.3, 0.02, 8, 64);
        const ringMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color('#D4C8B8'),
            metalness: 0.1,
            roughness: 0.6,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0;
        this.flowerGroup.add(ring);
    }

    // ── Stem ──────────────────────────────────────────────────────────────
    _addStem() {
        const stemHeight = 2.5;
        const stemRadius = 0.06;
        const segments = 32;

        // Create a curved stem using a TubeGeometry from a CatmullRomCurve3
        const points = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0.05, stemHeight * 0.3, 0.02),
            new THREE.Vector3(-0.03, stemHeight * 0.6, -0.02),
            new THREE.Vector3(0.02, stemHeight * 0.85, 0.01),
            new THREE.Vector3(0, stemHeight, 0),
        ];

        const curve = new THREE.CatmullRomCurve3(points);
        const tubeGeo = new THREE.TubeGeometry(curve, segments, stemRadius, 8, false);

        const stemMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color('#7EAD8B'),
            roughness: 0.7,
            metalness: 0.05,
        });

        const stem = new THREE.Mesh(tubeGeo, stemMat);
        stem.castShadow = true;
        this.flowerGroup.add(stem);

        // Store stem top for positioning petals
        this.stemTop = stemHeight;
    }

    // ── Leaves ────────────────────────────────────────────────────────────
    _addLeaves() {
        const stemH = this.stemTop || 2.5;

        // Left leaf
        this._createLeaf(
            new THREE.Vector3(-0.05, stemH * 0.35, 0.02),
            0.6, -Math.PI / 5, '#A8D8B9'
        );

        // Right leaf (higher, smaller)
        this._createLeaf(
            new THREE.Vector3(0.04, stemH * 0.55, -0.02),
            0.4, Math.PI / 4, '#B5E0C3'
        );
    }

    _createLeaf(position, scale, rotZ, colorHex) {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.bezierCurveTo(0.3 * scale, 0.06 * scale, 0.6 * scale, 0.05 * scale, 0.8 * scale, 0);
        shape.bezierCurveTo(0.6 * scale, -0.05 * scale, 0.3 * scale, -0.06 * scale, 0, 0);

        const extrudeSettings = {
            depth: 0.01,
            bevelEnabled: true,
            bevelThickness: 0.005,
            bevelSize: 0.005,
            bevelSegments: 2,
            curveSegments: 12,
        };

        const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(colorHex),
            roughness: 0.6,
            metalness: 0.05,
            side: THREE.DoubleSide,
        });

        const leaf = new THREE.Mesh(geo, mat);
        leaf.position.copy(position);
        leaf.rotation.z = rotZ;
        leaf.rotation.x = -0.2;
        leaf.castShadow = true;
        this.flowerGroup.add(leaf);
    }

    // ── Petal Layers ──────────────────────────────────────────────────────
    _addPetalLayers() {
        const stemTop = this.stemTop || 2.5;
        const layers = this.params.layers;
        this.printSpec = [];

        // Draw from outer (delta) to inner (gamma)
        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            const band = layer.band;

            const petalCount = layer.petalCount;
            const color = new THREE.Color(band.color);
            const colorDeep = new THREE.Color(band.colorDeep);

            // Layer radius decreases for inner bands
            const layerRadius = lerp(1.0, 0.2, i / (layers.length - 1));

            // Petal height grows with band power
            const petalH = layer.petalHeight * 1.35;

            // Petal scale
            const petalScale = lerp(0.6, 0.25, i / (layers.length - 1));
            const width = petalScale * lerp(2.25, 1.1, i / (layers.length - 1));

            // Y position: inner layers slightly higher (flower bloom opens up)
            const yBase = stemTop + i * 0.08;

            // Tilt angle: pétalos exteriores inclinados hacia afuera (cara visible desde arriba)
            const tiltAngle = lerp(0.72, -0.1, i / (layers.length - 1));

            for (let j = 0; j < petalCount; j++) {
                const angle = (j / petalCount) * Math.PI * 2 + layer.rotation;

                const petal = this._createPetal(petalScale, width, petalH, color, colorDeep, layer.opacity);
                petal.geometry.computeBoundingBox();
                const petalSize = new THREE.Vector3();
                petal.geometry.boundingBox.getSize(petalSize);

                petal.name = `petal_${band.key}_${i + 1}_${j + 1}`;
                petal.userData = {
                    type: 'petal',
                    bandKey: band.key,
                    bandName: band.name,
                    bandColor: band.color,
                    bandColorDeep: band.colorDeep,
                    layerIndex: i + 1,
                    petalIndex: j + 1,
                    dimensionsModelUnits: {
                        x: petalSize.x,
                        y: petalSize.y,
                        z: petalSize.z,
                    },
                };

                this.printSpec.push({
                    bandKey: band.key,
                    bandName: band.name,
                    layerIndex: i + 1,
                    petalIndex: j + 1,
                    color: band.color,
                    colorDeep: band.colorDeep,
                    percentage: band.percentage,
                    dimensionsModelUnits: {
                        x: petalSize.x,
                        y: petalSize.y,
                        z: petalSize.z,
                    },
                });

                petal.position.set(
                    layerRadius * 0.15 * Math.cos(angle),
                    yBase,
                    layerRadius * 0.15 * Math.sin(angle)
                );

                petal.rotation.y = -angle + Math.PI / 2;
                petal.rotation.z = tiltAngle;

                petal.castShadow = true;
                petal.receiveShadow = true;
                this.flowerGroup.add(petal);
            }
        }
    }

    _createPetal(scale, width, height, color, colorDeep, opacity) {
        const shape = new THREE.Shape();
        const w = 0.2 * width;
        const h = 0.5 * scale;
        const tipHalf = w * 0.56;
        const tipY = h * 0.94;

        shape.moveTo(0, 0);
        shape.bezierCurveTo(w * 1.7, h * 0.12, w * 1.45, h * 0.58, tipHalf, tipY);
        shape.bezierCurveTo(w * 0.22, h * 1.04, -w * 0.22, h * 1.04, -tipHalf, tipY);
        shape.bezierCurveTo(-w * 1.45, h * 0.58, -w * 1.7, h * 0.12, 0, 0);

        const extrudeSettings = {
            depth: 0.09 * scale,          // más grueso → visible desde arriba
            bevelEnabled: true,
            bevelThickness: 0.018 * scale,
            bevelSize: 0.012 * scale,
            bevelSegments: 4,
            curveSegments: 20,
        };

        const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);

        // Arqueo hacia arriba más pronunciado para que la cara quede visible desde arriba
        const positions = geo.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const y = positions.getY(i);
            const t = y / h;                      // 0 en base, 1 en punta
            // parábola: sube en el centro y se curva en la punta
            const arch = t * t * height * 1.1 + t * (1 - t) * height * 0.5;
            positions.setZ(i, positions.getZ(i) + arch);
        }
        geo.computeVertexNormals();

        const softAccent = this._vibrantPastel(color.clone().lerp(colorDeep, 0.28), 0.34, 0.02);
        const deepVibrant = this._vibrantPastel(colorDeep.clone(), 0.26, 0.0);

        const mat = new THREE.MeshStandardMaterial({
            color: softAccent,
            emissive: deepVibrant,
            emissiveIntensity: 0.42,
            roughness: 0.36,
            metalness: 0.02,
            transparent: false,
            opacity: 1.0,
            side: THREE.DoubleSide,
            depthWrite: true,
            depthTest: true,
        });

        return new THREE.Mesh(geo, mat);
    }

    // ── Flower Center (pistil) ────────────────────────────────────────────
    _addCenter() {
        const stemTop = this.stemTop || 2.5;
        const centerR = this.params.centerSize * 3;

        // Main spherical center
        const centerGeo = new THREE.SphereGeometry(centerR, 32, 32);
        const centerMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color('#FFE4C9'),
            roughness: 0.5,
            metalness: 0.1,
            emissive: new THREE.Color('#F5D0A9'),
            emissiveIntensity: 0.15,
        });
        const center = new THREE.Mesh(centerGeo, centerMat);
        center.position.y = stemTop + 0.02;
        center.scale.y = 0.6; // Slightly flattened
        this.flowerGroup.add(center);

        // Small pistil dots
        const dotCount = 12;
        for (let i = 0; i < dotCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI * 0.4 + 0.1;
            const r = centerR * 0.85;

            const dotGeo = new THREE.SphereGeometry(centerR * 0.12, 8, 8);
            const dotMat = new THREE.MeshStandardMaterial({
                color: new THREE.Color('#D4A574'),
                roughness: 0.6,
                metalness: 0.1,
            });
            const dot = new THREE.Mesh(dotGeo, dotMat);
            dot.position.set(
                r * Math.sin(phi) * Math.cos(theta),
                stemTop + r * Math.cos(phi) * 0.5 + centerR * 0.15,
                r * Math.sin(phi) * Math.sin(theta)
            );
            this.flowerGroup.add(dot);
        }
    }

    // ── Pollen Particles ──────────────────────────────────────────────────
    _addPollen() {
        const count = 60;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const stemTop = this.stemTop || 2.5;

        const pollenColors = [
            new THREE.Color('#FFF3B0'),
            new THREE.Color('#FFE4C9'),
            new THREE.Color('#FFD1DC'),
            new THREE.Color('#F5D0A9'),
        ];

        for (let i = 0; i < count; i++) {
            const theta = Math.random() * Math.PI * 2;
            const r = 0.2 + Math.random() * 2;
            const y = stemTop - 0.5 + Math.random() * 2.5;

            positions[i * 3] = r * Math.cos(theta);
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = r * Math.sin(theta);

            const c = pollenColors[Math.floor(Math.random() * pollenColors.length)];
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.PointsMaterial({
            size: 0.04,
            vertexColors: true,
            transparent: true,
            opacity: 0.28,
            blending: THREE.NormalBlending,
            depthWrite: false,
        });

        this.particles = new THREE.Points(geo, mat);
        this.scene.add(this.particles);
    }

    // ── Ground ────────────────────────────────────────────────────────────
    _addGround() {
        const geo = new THREE.CircleGeometry(6, 64);
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color('#E7DED3'),
            metalness: 0.0,
            roughness: 1.0,
        });
        const ground = new THREE.Mesh(geo, mat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.1;
        ground.receiveShadow = true;
        this.scene.add(ground);
    }

    // ── Animation ─────────────────────────────────────────────────────────
    _animate() {
        this.animationId = requestAnimationFrame(() => this._animate());

        const elapsed = this.clock.getElapsedTime();

        // Gentle sway
        if (this.flowerGroup) {
            this.flowerGroup.rotation.z = Math.sin(elapsed * 0.3) * 0.015;
            this.flowerGroup.rotation.x = Math.sin(elapsed * 0.2 + 1) * 0.008;
        }

        // Pollen drift
        if (this.particles) {
            const pos = this.particles.geometry.attributes.position.array;
            for (let i = 0; i < pos.length; i += 3) {
                pos[i] += Math.sin(elapsed * 0.5 + i) * 0.0005;
                pos[i + 1] += Math.sin(elapsed * 0.3 + i * 0.5) * 0.0003;
                pos[i + 2] += Math.cos(elapsed * 0.4 + i) * 0.0005;
            }
            this.particles.geometry.attributes.position.needsUpdate = true;
        }

        if (this.controls) this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    // ── Resize ────────────────────────────────────────────────────────────
    _onResize() {
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

    // ── Screenshot ────────────────────────────────────────────────────────
    exportPNG(filename) {
        this.renderer.render(this.scene, this.camera);
        const link = document.createElement('a');
        link.download = filename || 'flor_neurofuncional_3d.png';
        link.href = this.renderer.domElement.toDataURL('image/png');
        link.click();
    }

    _downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = filename;
        link.href = url;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    _buildPrintableGroup(targetHeightMm = 120) {
        const clone = this.flowerGroup.clone(true);
        const bbox = new THREE.Box3().setFromObject(clone);
        const size = new THREE.Vector3();
        bbox.getSize(size);

        const currentHeight = Math.max(0.0001, size.y);
        const scaleFactor = targetHeightMm / currentHeight;
        clone.scale.setScalar(scaleFactor);

        const scaledBox = new THREE.Box3().setFromObject(clone);
        clone.position.y -= scaledBox.min.y;

        return { clone, scaleFactor, targetHeightMm, sourceHeight: currentHeight };
    }

    _buildPrintSpec(scaleFactor, targetHeightMm) {
        const petals = this.printSpec.map((p) => ({
            bandKey: p.bandKey,
            bandName: p.bandName,
            layerIndex: p.layerIndex,
            petalIndex: p.petalIndex,
            color: p.color,
            colorDeep: p.colorDeep,
            percentage: p.percentage,
            dimensionsMm: {
                x: +(p.dimensionsModelUnits.x * scaleFactor).toFixed(2),
                y: +(p.dimensionsModelUnits.y * scaleFactor).toFixed(2),
                z: +(p.dimensionsModelUnits.z * scaleFactor).toFixed(2),
            },
        }));

        return {
            format: '3d-print-spec-v1',
            model: 'flor_neurofuncional_print.glb',
            units: 'mm',
            targetHeightMm,
            petals,
        };
    }

    exportGLBFor3DPrint(filename = 'flor_neurofuncional_print.glb', targetHeightMm = 120) {
        if (!THREE.GLTFExporter) {
            alert('No se encontró GLTFExporter. Recarga la página e intenta de nuevo.');
            return;
        }
        if (!this.flowerGroup) {
            alert('La flor 3D aún no está lista para exportar.');
            return;
        }

        const printable = this._buildPrintableGroup(targetHeightMm);
        const exportScene = new THREE.Scene();
        exportScene.add(printable.clone);

        const exporter = new THREE.GLTFExporter();
        exporter.parse(
            exportScene,
            (result) => {
                if (!(result instanceof ArrayBuffer)) {
                    alert('No se pudo exportar en formato GLB binario.');
                    return;
                }

                this._downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), filename);

                const printSpec = this._buildPrintSpec(printable.scaleFactor, targetHeightMm);
                this._downloadBlob(
                    new Blob([JSON.stringify(printSpec, null, 2)], { type: 'application/json' }),
                    'flor_neurofuncional_print_spec.json'
                );
            },
            { binary: true, onlyVisible: true, trs: false }
        );
    }

    _bakeMeshWorld(mesh) {
        const baked = new THREE.Mesh(mesh.geometry.clone(), mesh.material);
        baked.geometry.applyMatrix4(mesh.matrixWorld);
        baked.position.set(0, 0, 0);
        baked.rotation.set(0, 0, 0);
        baked.scale.set(1, 1, 1);
        baked.updateMatrixWorld(true);
        baked.userData = { ...mesh.userData };
        return baked;
    }

    _exportSTLObject(object3D, filename) {
        const exporter = new THREE.STLExporter();
        const stlString = exporter.parse(object3D);
        this._downloadBlob(new Blob([stlString], { type: 'model/stl' }), filename);
    }

    _buildSTLParts(printableClone) {
        const structureGroup = new THREE.Group();
        const bandGroups = {};

        printableClone.updateMatrixWorld(true);
        printableClone.traverse((obj) => {
            if (!obj.isMesh || !obj.geometry) return;

            const baked = this._bakeMeshWorld(obj);
            const isPetal = obj.userData?.type === 'petal';
            const bandKey = obj.userData?.bandKey;

            if (isPetal && bandKey) {
                if (!bandGroups[bandKey]) bandGroups[bandKey] = new THREE.Group();
                bandGroups[bandKey].add(baked);
            } else {
                structureGroup.add(baked);
            }
        });

        return { structureGroup, bandGroups };
    }

    exportSTLFor3DPrint(baseFilename = 'flor_neurofuncional_print', targetHeightMm = 120) {
        if (!THREE.STLExporter) {
            alert('No se encontró STLExporter. Recarga la página e intenta de nuevo.');
            return;
        }
        if (!this.flowerGroup) {
            alert('La flor 3D aún no está lista para exportar.');
            return;
        }

        const printable = this._buildPrintableGroup(targetHeightMm);
        const fullClone = printable.clone.clone(true);
        this._exportSTLObject(fullClone, `${baseFilename}_full_${targetHeightMm}mm.stl`);

        const parts = this._buildSTLParts(printable.clone.clone(true));
        this._exportSTLObject(parts.structureGroup, `${baseFilename}_structure_${targetHeightMm}mm.stl`);

        const bandFiles = [];
        const bandOrder = this.bands.map((b) => b.key);
        bandOrder.forEach((key) => {
            const group = parts.bandGroups[key];
            if (!group || group.children.length === 0) return;
            const filename = `${baseFilename}_${key}_${targetHeightMm}mm.stl`;
            this._exportSTLObject(group, filename);

            const bandMeta = this.bands.find((b) => b.key === key);
            bandFiles.push({
                bandKey: key,
                bandName: bandMeta?.name || key,
                color: bandMeta?.color || '#FFFFFF',
                colorDeep: bandMeta?.colorDeep || '#FFFFFF',
                percentage: bandMeta?.percentage || 0,
                file: filename,
            });
        });

        const manifest = {
            format: 'stl-multicolor-print-v1',
            note: 'STL no guarda color interno. Usa los archivos STL por banda para asignar filamento/color en el slicer.',
            units: 'mm',
            targetHeightMm,
            files: {
                fullModel: `${baseFilename}_full_${targetHeightMm}mm.stl`,
                structure: `${baseFilename}_structure_${targetHeightMm}mm.stl`,
                bands: bandFiles,
            },
            petals: this._buildPrintSpec(printable.scaleFactor, targetHeightMm).petals,
        };

        this._downloadBlob(
            new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
            `${baseFilename}_manifest_${targetHeightMm}mm.json`
        );
    }

    // ── Export geometry JSON for local Python conversion ───────────────────
    exportGeometryJSON(targetHeightMm = 120) {
        if (!this.flowerGroup) {
            throw new Error('La flor 3D aún no está lista.');
        }

        const printable = this._buildPrintableGroup(targetHeightMm);
        const clone = printable.clone;
        clone.updateMatrixWorld(true);

        const meshes = [];

        clone.traverse((obj) => {
            if (!obj.isMesh || !obj.geometry) return;

            // Bake world transform into geometry
            const geo = obj.geometry.clone();
            geo.applyMatrix4(obj.matrixWorld);

            const posAttr = geo.attributes.position;
            const vertices = [];
            for (let i = 0; i < posAttr.count; i++) {
                vertices.push([posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)]);
            }

            // Extract faces (indexed or non-indexed)
            const faces = [];
            if (geo.index) {
                const idx = geo.index.array;
                for (let i = 0; i < idx.length; i += 3) {
                    faces.push([idx[i], idx[i + 1], idx[i + 2]]);
                }
            } else {
                for (let i = 0; i < posAttr.count; i += 3) {
                    faces.push([i, i + 1, i + 2]);
                }
            }

            // Material color
            const mat = obj.material;
            let colorHex = '#CCCCCC';
            let emissiveHex = '#000000';
            if (mat && mat.color) {
                colorHex = '#' + mat.color.getHexString();
            }
            if (mat && mat.emissive) {
                emissiveHex = '#' + mat.emissive.getHexString();
            }

            // Print color should not include emissive glow (avoids over-saturated exports)
            const baseC = mat?.color ? mat.color.clone() : new THREE.Color(0xcccccc);
            const hsl = { h: 0, s: 0, l: 0 };
            baseC.getHSL(hsl);
            const printColor = new THREE.Color().setHSL(
                hsl.h,
                clamp(hsl.s * 0.72, 0, 1),
                clamp(hsl.l * 0.86, 0, 1)
            );

            meshes.push({
                name: obj.name || 'unnamed',
                userData: obj.userData || {},
                vertices,
                faces,
                color: colorHex,
                emissive: emissiveHex,
                emissiveIntensity: mat?.emissiveIntensity || 0,
                printColorHex: '#' + printColor.getHexString(),
                printColorRGB: [
                    Math.round(printColor.r * 255),
                    Math.round(printColor.g * 255),
                    Math.round(printColor.b * 255),
                ],
            });
        });

        const payload = {
            format: 'flower-geometry-v1',
            units: 'mm',
            targetHeightMm,
            scaleFactor: printable.scaleFactor,
            sourceHeightModelUnits: printable.sourceHeight,
            meshCount: meshes.length,
            bands: this.bands.map(b => ({
                key: b.key,
                name: b.name,
                color: b.color,
                colorDeep: b.colorDeep,
                percentage: b.percentage,
            })),
            meshes,
        };

        return payload;
    }

    downloadGeometryJSON(targetHeightMm = 120) {
        const data = this.exportGeometryJSON(targetHeightMm);
        const json = JSON.stringify(data);
        this._downloadBlob(
            new Blob([json], { type: 'application/json' }),
            `flor_neurofuncional_${targetHeightMm}mm.json`
        );
        return data;
    }
}