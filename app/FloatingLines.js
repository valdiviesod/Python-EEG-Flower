/**
 * FloatingLines — vanilla JS port of React Bits FloatingLines
 * Requires global THREE (three.js r128+)
 */
(function (global) {
    'use strict';

    const vertexShader = `
        precision highp float;
        void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;

    const fragmentShader = `
        precision highp float;
        uniform float iTime;
        uniform vec3  iResolution;
        uniform float animationSpeed;
        uniform bool  enableTop;
        uniform bool  enableMiddle;
        uniform bool  enableBottom;
        uniform int   topLineCount;
        uniform int   middleLineCount;
        uniform int   bottomLineCount;
        uniform float topLineDistance;
        uniform float middleLineDistance;
        uniform float bottomLineDistance;
        uniform vec3  topWavePosition;
        uniform vec3  middleWavePosition;
        uniform vec3  bottomWavePosition;
        uniform vec2  iMouse;
        uniform bool  interactive;
        uniform float bendRadius;
        uniform float bendStrength;
        uniform float bendInfluence;
        uniform bool  parallax;
        uniform float parallaxStrength;
        uniform vec2  parallaxOffset;
        uniform vec3  lineGradient[8];
        uniform int   lineGradientCount;

        const vec3 BLACK = vec3(0.0);
        const vec3 PINK  = vec3(233.0,71.0,245.0)/255.0;
        const vec3 BLUE  = vec3(47.0,75.0,162.0)/255.0;

        mat2 rotate(float r){return mat2(cos(r),sin(r),-sin(r),cos(r));}

        vec3 background_color(vec2 uv){
            float y=sin(uv.x-0.2)*0.3-0.1;
            float m=uv.y-y;
            vec3 col=mix(BLUE,BLACK,smoothstep(0.0,1.0,abs(m)));
            col+=mix(PINK,BLACK,smoothstep(0.0,1.0,abs(m-0.8)));
            return col*0.5;
        }

        vec3 getLineColor(float t,vec3 base){
            if(lineGradientCount<=0)return base;
            if(lineGradientCount==1)return lineGradient[0]*0.5;
            float ct=clamp(t,0.0,0.9999)*float(lineGradientCount-1);
            int idx=int(floor(ct));
            float f=fract(ct);
            int idx2=min(idx+1,lineGradientCount-1);
            return mix(lineGradient[idx],lineGradient[idx2],f)*0.5;
        }

        float wave(vec2 uv,float offset,vec2 suv,vec2 muv,bool bend){
            float time=iTime*animationSpeed;
            float amp=sin(offset+time*0.2)*0.3;
            float y=sin(uv.x+offset+time*0.1)*amp;
            if(bend){
                vec2 d=suv-muv;
                float inf=exp(-dot(d,d)*bendRadius);
                y+=(muv.y-suv.y)*inf*bendStrength*bendInfluence;
            }
            float m=uv.y-y;
            return 0.0175/max(abs(m)+0.01,1e-3)+0.01;
        }

        void mainImage(out vec4 fc,in vec2 fco){
            vec2 uv=(2.0*fco-iResolution.xy)/iResolution.y;
            uv.y*=-1.0;
            if(parallax)uv+=parallaxOffset;
            vec3 col=vec3(0.0);
            vec3 b=lineGradientCount>0?vec3(0.0):background_color(uv);
            vec2 muv=vec2(0.0);
            if(interactive){muv=(2.0*iMouse-iResolution.xy)/iResolution.y;muv.y*=-1.0;}

            if(enableBottom){
                for(int i=0;i<bottomLineCount;++i){
                    float fi=float(i);
                    float t=fi/max(float(bottomLineCount-1),1.0);
                    vec3 lc=getLineColor(t,b);
                    float ang=bottomWavePosition.z*log(length(uv)+1.0);
                    vec2 ruv=uv*rotate(ang);
                    col+=lc*wave(ruv+vec2(bottomLineDistance*fi+bottomWavePosition.x,bottomWavePosition.y),1.5+0.2*fi,uv,muv,interactive)*0.2;
                }
            }
            if(enableMiddle){
                for(int i=0;i<middleLineCount;++i){
                    float fi=float(i);
                    float t=fi/max(float(middleLineCount-1),1.0);
                    vec3 lc=getLineColor(t,b);
                    float ang=middleWavePosition.z*log(length(uv)+1.0);
                    vec2 ruv=uv*rotate(ang);
                    col+=lc*wave(ruv+vec2(middleLineDistance*fi+middleWavePosition.x,middleWavePosition.y),2.0+0.15*fi,uv,muv,interactive);
                }
            }
            if(enableTop){
                for(int i=0;i<topLineCount;++i){
                    float fi=float(i);
                    float t=fi/max(float(topLineCount-1),1.0);
                    vec3 lc=getLineColor(t,b);
                    float ang=topWavePosition.z*log(length(uv)+1.0);
                    vec2 ruv=uv*rotate(ang);
                    ruv.x*=-1.0;
                    col+=lc*wave(ruv+vec2(topLineDistance*fi+topWavePosition.x,topWavePosition.y),1.0+0.2*fi,uv,muv,interactive)*0.1;
                }
            }
            fc=vec4(col,1.0);
        }

        void main(){vec4 c=vec4(0.0);mainImage(c,gl_FragCoord.xy);gl_FragColor=c;}
    `;

    const MAX_GRAD = 8;

    function hexToVec3(hex) {
        const v = hex.trim().replace(/^#/, '');
        let r = 255, g = 255, b = 255;
        if (v.length === 3) {
            r = parseInt(v[0]+v[0], 16);
            g = parseInt(v[1]+v[1], 16);
            b = parseInt(v[2]+v[2], 16);
        } else if (v.length === 6) {
            r = parseInt(v.slice(0,2), 16);
            g = parseInt(v.slice(2,4), 16);
            b = parseInt(v.slice(4,6), 16);
        }
        return new THREE.Vector3(r/255, g/255, b/255);
    }

    function pickVal(arr, idx, def) {
        return typeof arr === 'number' ? arr : (arr[idx] !== undefined ? arr[idx] : def);
    }

    class FloatingLines {
        constructor(container, opts) {
            this._c = container;
            this._o = Object.assign({
                linesGradient:      undefined,
                enabledWaves:       ['top','middle','bottom'],
                lineCount:          [6],
                lineDistance:       [5],
                topWavePosition:    { x:10.0, y:0.5,  rotate:-0.4 },
                middleWavePosition: { x:5.0,  y:0.0,  rotate:0.2  },
                bottomWavePosition: { x:2.0,  y:-0.7, rotate:-1   },
                animationSpeed:     1,
                interactive:        true,
                bendRadius:         5.0,
                bendStrength:       -0.5,
                mouseDamping:       0.05,
                parallax:           true,
                parallaxStrength:   0.2,
                mixBlendMode:       'screen',
            }, opts || {});

            this._active   = false;
            this._raf      = 0;
            this._tMouse   = new THREE.Vector2(-1000,-1000);
            this._cMouse   = new THREE.Vector2(-1000,-1000);
            this._tInf     = 0;
            this._cInf     = 0;
            this._tPar     = new THREE.Vector2(0,0);
            this._cPar     = new THREE.Vector2(0,0);

            this._init();
        }

        _lc(wave) {
            const { enabledWaves, lineCount } = this._o;
            if (!enabledWaves.includes(wave)) return 0;
            return pickVal(lineCount, enabledWaves.indexOf(wave), 6);
        }

        _ld(wave) {
            const { enabledWaves, lineDistance } = this._o;
            if (!enabledWaves.includes(wave)) return 0.01;
            return pickVal(lineDistance, enabledWaves.indexOf(wave), 5) * 0.01;
        }

        _init() {
            const o   = this._o;
            const con = this._c;

            this._scene  = new THREE.Scene();
            this._camera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
            this._camera.position.z = 1;

            this._renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
            this._renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
            const cv = this._renderer.domElement;
            cv.style.position   = 'absolute';
            cv.style.inset      = '0';
            cv.style.width      = '100%';
            cv.style.height     = '100%';
            cv.style.mixBlendMode = o.mixBlendMode;
            con.appendChild(cv);

            const twp = o.topWavePosition;
            const mwp = o.middleWavePosition;
            const bwp = o.bottomWavePosition;

            const gradArr = Array.from({length:MAX_GRAD}, ()=>new THREE.Vector3(1,1,1));
            let gradCount = 0;
            if (o.linesGradient && o.linesGradient.length > 0) {
                const stops = o.linesGradient.slice(0, MAX_GRAD);
                gradCount   = stops.length;
                stops.forEach((hex,i)=>{ const c=hexToVec3(hex); gradArr[i].set(c.x,c.y,c.z); });
            }

            this._uniforms = {
                iTime:             { value: 0 },
                iResolution:       { value: new THREE.Vector3(1,1,1) },
                animationSpeed:    { value: o.animationSpeed },
                enableTop:         { value: o.enabledWaves.includes('top')    },
                enableMiddle:      { value: o.enabledWaves.includes('middle') },
                enableBottom:      { value: o.enabledWaves.includes('bottom') },
                topLineCount:      { value: this._lc('top')    },
                middleLineCount:   { value: this._lc('middle') },
                bottomLineCount:   { value: this._lc('bottom') },
                topLineDistance:   { value: this._ld('top')    },
                middleLineDistance:{ value: this._ld('middle') },
                bottomLineDistance:{ value: this._ld('bottom') },
                topWavePosition:   { value: new THREE.Vector3(twp.x,twp.y,twp.rotate) },
                middleWavePosition:{ value: new THREE.Vector3(mwp.x,mwp.y,mwp.rotate) },
                bottomWavePosition:{ value: new THREE.Vector3(bwp.x,bwp.y,bwp.rotate) },
                iMouse:            { value: new THREE.Vector2(-1000,-1000) },
                interactive:       { value: o.interactive    },
                bendRadius:        { value: o.bendRadius     },
                bendStrength:      { value: o.bendStrength   },
                bendInfluence:     { value: 0                },
                parallax:          { value: o.parallax       },
                parallaxStrength:  { value: o.parallaxStrength },
                parallaxOffset:    { value: new THREE.Vector2(0,0) },
                lineGradient:      { value: gradArr   },
                lineGradientCount: { value: gradCount },
            };

            const mat  = new THREE.ShaderMaterial({ uniforms:this._uniforms, vertexShader, fragmentShader });
            const geo  = new THREE.PlaneBufferGeometry(2, 2);
            this._scene.add(new THREE.Mesh(geo, mat));
            this._mat  = mat;
            this._geo  = geo;
            this._clock = new THREE.Clock();

            this._setSize = () => {
                const w = con.clientWidth  || 1;
                const h = con.clientHeight || 1;
                this._renderer.setSize(w, h, false);
                this._uniforms.iResolution.value.set(
                    this._renderer.domElement.width,
                    this._renderer.domElement.height, 1);
            };
            this._setSize();

            this._ro = typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(this._setSize) : null;
            if (this._ro) this._ro.observe(con);

            // Listen on window: bg has pointer-events:none so canvas never fires
            this._onMove = (e) => {
                const rect = con.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const dpr = this._renderer.getPixelRatio();
                this._tMouse.set(x * dpr, (rect.height - y) * dpr);
                this._tInf = 1.0;
                if (o.parallax) {
                    this._tPar.set(
                        ((x - rect.width  / 2) / rect.width)  *  o.parallaxStrength,
                        ((y - rect.height / 2) / rect.height) * -o.parallaxStrength
                    );
                }
            };
            this._onLeave = () => { this._tInf = 0.0; };

            if (o.interactive) {
                window.addEventListener('pointermove',  this._onMove);
                window.addEventListener('pointerleave', this._onLeave);
            }

            this.start();
        }

        start() {
            if (this._active) return;
            this._active = true;
            this._clock.start();
            const tick = () => {
                if (!this._active) return;
                const u = this._uniforms;
                const o = this._o;
                u.iTime.value = this._clock.getElapsedTime();
                if (o.interactive) {
                    this._cMouse.lerp(this._tMouse, o.mouseDamping);
                    u.iMouse.value.copy(this._cMouse);
                    this._cInf += (this._tInf - this._cInf) * o.mouseDamping;
                    u.bendInfluence.value = this._cInf;
                }
                if (o.parallax) {
                    this._cPar.lerp(this._tPar, o.mouseDamping);
                    u.parallaxOffset.value.copy(this._cPar);
                }
                this._renderer.render(this._scene, this._camera);
                this._raf = requestAnimationFrame(tick);
            };
            tick();
        }

        stop() {
            this._active = false;
            cancelAnimationFrame(this._raf);
            this._clock.stop();
        }

        destroy() {
            this.stop();
            if (this._ro) this._ro.disconnect();
            const cv = this._renderer.domElement;
            if (this._o.interactive) {
                window.removeEventListener('pointermove',  this._onMove);
                window.removeEventListener('pointerleave', this._onLeave);
            }
            this._geo.dispose();
            this._mat.dispose();
            this._renderer.dispose();
            this._renderer.forceContextLoss();
            if (cv.parentElement) cv.parentElement.removeChild(cv);
        }
    }

    global.FloatingLines = FloatingLines;
})(window);
