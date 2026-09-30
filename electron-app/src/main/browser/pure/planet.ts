/**
 * Rotating digital planet — shared WebGL snippet for the pab://newtab page.
 *
 * A proper shaded globe (not a bare wireframe):
 *   1. solid UV-sphere body — dark translucent ocean shading, subtle
 *      trig-noise "continents", diffuse key light + cyan fresnel rim;
 *   2. lat/long grid lines + bulged great-circle arcs + glowing nodes,
 *      depth-occluded by the body (back-side lines hidden behind globe);
 *   3. additive atmosphere halo (enlarged shell, fresnel-only shader).
 * The whole assembly rotates as one model around the tilted Y axis.
 *
 * Design constraints (Matrix NTP spec):
 *   - Slow continuous rotation, ~120 s per full revolution (spec: 90–180 s),
 *     delta-time based and frame-rate independent — no visible resets.
 *   - `pointer-events:none` — the planet never intercepts clicks, the wheel,
 *     selection or drags; only the hero UI above it is interactive.
 *   - DPR clamped to min(devicePixelRatio, 1.5); low-core machines get a
 *     lighter geometry + DPR 1 budget.
 *   - Animation pauses while the document is hidden (tab switched/minimized).
 *   - prefers-reduced-motion renders a single static frame.
 *   - Graceful degradation: WebGL → (on loss) restore-and-resume → after a
 *     5 s unrestored loss, a FRESH Canvas2D static wireframe canvas (a 2D
 *     context can never attach to a canvas that ever had a GL context) →
 *     the CSS sphere silhouette always remains underneath regardless.
 *   - Full cleanup: on pagehide the RAF loop is cancelled and all WebGL
 *     resources (buffers/program/context) are disposed.
 *
 * Pure — template strings only, no imports, no external libraries.
 */

/** Full revolution period in ms — spec target 90–180 s. */
export const PLANET_ROTATION_PERIOD_MS = 120_000;

export const PLANET_CANVAS = `<div id="planet-shell" aria-hidden="true"></div><canvas id="planet-canvas" aria-hidden="true"></canvas>`;

export function buildPlanetScript(): string {
  return `(function () {
  if (window.__pabPlanet) return;
  window.__pabPlanet = true;
  var shell = document.getElementById('planet-shell');
  var canvas = document.getElementById('planet-canvas');
  if (!shell || !canvas) return;

  var PERIOD_MS = ${String(PLANET_ROTATION_PERIOD_MS)};   // full revolution
  var TILT = -0.32;                    // slight axis tilt (radians)
  var LOW_BUDGET = (navigator.hardwareConcurrency || 8) <= 4;
  var MAX_DPR = 1.5;
  var RESTORE_WATCHDOG_MS = 5000;      // lost-and-not-restored → 2D fallback
  var raf = 0, disposed = false;

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // ---- sizing ---------------------------------------------------------------
  function side() {
    // Bottom-anchored large globe (concept: ~88% of viewport width).
    return Math.max(260, Math.min(window.innerWidth * 0.88, 980));
  }
  function applySize(target) {
    var s = side();
    // CSS sphere bed matches the GL globe scale (0.72 — see render()).
    shell.style.width = Math.round(s * 0.72) + 'px';
    shell.style.height = Math.round(s * 0.72) + 'px';
    var dpr = LOW_BUDGET ? 1 : Math.min(window.devicePixelRatio || 1, MAX_DPR);
    target.width = Math.round(s * dpr);
    target.height = Math.round(s * dpr);
    target.style.width = s + 'px';
    target.style.height = s + 'px';
  }

  // ---- minimal mat4 helpers (column-major) -----------------------------------
  function perspective(fov, aspect, near, far) {
    var f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function mul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function rotY(a) {
    var c = Math.cos(a), s = Math.sin(a);
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  }
  function rotX(a) {
    var c = Math.cos(a), s = Math.sin(a);
    return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
  }
  function scaleUniform(k) {
    return [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1];
  }
  function translateZ(z) {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1];
  }

  // ---- geometry: UV sphere (positions interleaved with normals) ---------------
  function sphPoint(lat, lon) {
    return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
  }
  function buildSphereGeometry(stacks, slices) {
    var v = [];
    function tri(p0, p1, p2) {
      v.push(p0[0], p0[1], p0[2], p0[0], p0[1], p0[2]);
      v.push(p1[0], p1[1], p1[2], p1[0], p1[1], p1[2]);
      v.push(p2[0], p2[1], p2[2], p2[0], p2[1], p2[2]);
    }
    for (var i = 0; i < stacks; i++) {
      var lat0 = Math.PI * (-0.5 + i / stacks), lat1 = Math.PI * (-0.5 + (i + 1) / stacks);
      for (var j = 0; j < slices; j++) {
        var lon0 = 2 * Math.PI * j / slices, lon1 = 2 * Math.PI * (j + 1) / slices;
        var a = sphPoint(lat0, lon0), b = sphPoint(lat0, lon1);
        var c = sphPoint(lat1, lon0), d = sphPoint(lat1, lon1);
        tri(a, c, b);
        tri(b, c, d);
      }
    }
    return v;
  }

  // ---- geometry: grid / arcs / nodes (unit sphere, lines + alpha) -------------
  function buildWireGeometry(nodeCount, arcCount) {
    var verts = [], alphas = [];
    function seg(x1, y1, z1, x2, y2, z2, a) {
      verts.push(x1, y1, z1, x2, y2, z2);
      alphas.push(a, a);
    }
    var R = 1, SEG = 56;
    // Latitude rings.
    for (var li = 1; li < 7; li++) {
      var lat = -Math.PI / 2 + (li * Math.PI) / 7;
      var r = R * Math.cos(lat), y = R * Math.sin(lat);
      var a = 0.06 + 0.10 * Math.sin(lat + Math.PI / 2);
      for (var i = 0; i < SEG; i++) {
        var t1 = (i / SEG) * Math.PI * 2, t2 = ((i + 1) / SEG) * Math.PI * 2;
        seg(r * Math.cos(t1), y, r * Math.sin(t1), r * Math.cos(t2), y, r * Math.sin(t2), a);
      }
    }
    // Meridians.
    for (var mi = 0; mi < 12; mi++) {
      var lon = (mi / 12) * Math.PI;
      for (var j = 0; j < SEG; j++) {
        var p1 = (j / SEG) * Math.PI * 2 - Math.PI / 2, p2 = ((j + 1) / SEG) * Math.PI * 2 - Math.PI / 2;
        seg(R * Math.cos(p1) * Math.cos(lon), R * Math.sin(p1), R * Math.cos(p1) * Math.sin(lon),
            R * Math.cos(p2) * Math.cos(lon), R * Math.sin(p2), R * Math.cos(p2) * Math.sin(lon), 0.13);
      }
    }
    // Fibonacci-distributed glowing nodes.
    var nodes = [];
    var golden = Math.PI * (3 - Math.sqrt(5));
    for (var n = 0; n < nodeCount; n++) {
      var yy = 1 - (n / (nodeCount - 1)) * 2;
      var rr = Math.sqrt(Math.max(0, 1 - yy * yy));
      var th = golden * n;
      nodes.push([Math.cos(th) * rr, yy, Math.sin(th) * rr]);
    }
    // Great-circle arcs hugging the surface (thin bulge).
    var arcVerts = [], arcAlphas = [];
    var ARC_SEG = 26;
    for (var k = 0; k < arcCount; k++) {
      var A = nodes[(k * 7) % nodes.length], B = nodes[(k * 13 + 5) % nodes.length];
      var prev = null;
      for (var s = 0; s <= ARC_SEG; s++) {
        var t = s / ARC_SEG;
        var x = A[0] + (B[0] - A[0]) * t, y = A[1] + (B[1] - A[1]) * t, z = A[2] + (B[2] - A[2]) * t;
        var len = Math.sqrt(x * x + y * y + z * z) || 1;
        var lift = 1.015 + 0.035 * Math.sin(Math.PI * t);
        x = (x / len) * lift; y = (y / len) * lift; z = (z / len) * lift;
        if (prev) {
          arcVerts.push(prev[0], prev[1], prev[2], x, y, z);
          var aa = 0.10 + 0.34 * Math.sin(Math.PI * t);
          arcAlphas.push(aa, aa);
        }
        prev = [x, y, z];
      }
    }
    var nodeVerts = [], nodeAlphas = [];
    for (var q = 0; q < nodes.length; q++) {
      nodeVerts.push(nodes[q][0] * 1.012, nodes[q][1] * 1.012, nodes[q][2] * 1.012);
      nodeAlphas.push(q % 9 === 0 ? 1.0 : 0.45);
    }
    // Dot-matrix surface texture — dense faint dots give the "digital
    // earth" pointillism from the concept, behind the brighter nodes.
    var dotVerts = [], dotAlphas = [];
    var DOT_COUNT = LOW_BUDGET ? 180 : 380;
    for (var d2 = 0; d2 < DOT_COUNT; d2++) {
      var dy = 1 - (d2 / (DOT_COUNT - 1)) * 2;
      var dr = Math.sqrt(Math.max(0, 1 - dy * dy));
      var dt = golden * d2 * 1.618;
      // Sparse hatching — keep ~55% of dots for organic texture.
      if ((d2 * 2654435761) % 100 < 45) continue;
      dotVerts.push(Math.cos(dt) * dr * 1.004, dy * 1.004, Math.sin(dt) * dr * 1.004);
      dotAlphas.push(0.08 + 0.16 * Math.abs(Math.sin(d2 * 12.9898)));
    }
    return { wireVerts: verts, wireAlphas: alphas, arcVerts: arcVerts, arcAlphas: arcAlphas, nodeVerts: nodeVerts, nodeAlphas: nodeAlphas, dotVerts: dotVerts, dotAlphas: dotAlphas };
  }

  // ---- static Canvas2D fallback (own canvas) ---------------------------------
  // A 2D context can NEVER attach to a canvas that once held a GL context —
  // so the fallback draws on a freshly created canvas replacing the old one.
  function fallback2d() {
    if (disposed) return;
    api = null;                          // retire any dead GL handle
    try {
      var fresh = document.createElement('canvas');
      fresh.id = 'planet-canvas';
      fresh.setAttribute('aria-hidden', 'true');
      fresh.style.cssText = canvas.style.cssText;
      canvas.parentNode.replaceChild(fresh, canvas);
      canvas = fresh;
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      applySize(canvas);
      var w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.40;
      // Shaded disc so even the fallback reads as a solid globe.
      var grad = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      grad.addColorStop(0, 'rgba(12, 42, 52, 0.95)');
      grad.addColorStop(0.7, 'rgba(6, 20, 28, 0.95)');
      grad.addColorStop(1, 'rgba(2, 9, 13, 0.98)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,255,209,0.30)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,255,209,0.15)';
      ctx.lineWidth = 1;
      for (var i = 1; i < 6; i++) {
        var rx = R * Math.sin((i * Math.PI) / 6) * 0.9;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(1, rx), R, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,255,209,0.35)';
      for (var k = 0; k < 60; k++) {
        var t = k * 2.399963;
        var y = (1 - (k / 59) * 2) * R;
        var r2 = Math.sqrt(Math.max(0, R * R - y * y));
        ctx.fillRect(cx + Math.cos(t) * r2 - 1, cy + y - 1, 2.5, 2.5);
      }
    } catch (e) { /* CSS silhouette remains */ }
  }

  // ---- WebGL planet ----------------------------------------------------------
  function initGL() {
    // premultipliedAlpha:false — the shaders output straight (non-premultiplied)
    // RGBA; with the default premultiplied compositing a fragment like
    // rgb(0,0.95,0.78)/a(0.05) reads as a blinding additive flood on the page.
    var gl = canvas.getContext('webgl', { alpha: true, antialias: true, depth: true, premultipliedAlpha: false }) ||
             canvas.getContext('experimental-webgl', { alpha: true, antialias: true, depth: true, premultipliedAlpha: false });
    if (!gl || gl.isContextLost()) return null;

    var VS_BODY = 'attribute vec3 aPos; attribute vec3 aNormal;' +
      'uniform mat4 uMVP; uniform mat4 uModel;' +
      'varying vec3 vN; varying vec3 vP;' +
      'void main(){ gl_Position = uMVP * vec4(aPos, 1.0);' +
      '  vN = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNormal;' +
      '  vP = aPos; }';
    var FS_BODY = 'precision mediump float;' +
      'varying vec3 vN; varying vec3 vP; uniform float uMode;' +
      'void main(){' +
      '  vec3 N = normalize(vN);' +
      '  vec3 V = vec3(0.0, 0.0, 1.0);' +
      '  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);' +
      '  float fres = pow(1.0 - ndv, 3.0);' +
      '  if (uMode > 0.5) { gl_FragColor = vec4(0.0, 0.95, 0.78, fres * 0.5); return; }' +
      '  float diff = clamp(dot(N, normalize(vec3(-0.35, 0.45, 0.82))), 0.0, 1.0);' +
      '  float h = sin(vP.x*5.3 + vP.z*2.1) * sin(vP.y*4.7 + vP.x*1.7) * sin(vP.z*6.1 + vP.y*2.9) * 0.5 + 0.5;' +
      '  float land = smoothstep(0.60, 0.78, h);' +
      '  vec3 surf = vec3(0.012, 0.055, 0.075) + land * vec3(0.008, 0.085, 0.055);' +
      '  vec3 col = surf * (0.35 + 0.75 * diff) + vec3(0.0, 0.85, 0.68) * fres * 0.45;' +
      '  gl_FragColor = vec4(col, 0.92); }';
    var VS_LINE = 'attribute vec3 aPos; attribute float aAlpha; uniform mat4 uMVP; uniform float uSize; varying float vAlpha;' +
      'void main(){ gl_Position = uMVP * vec4(aPos, 1.0); gl_PointSize = uSize; vAlpha = aAlpha; }';
    var FS_LINE = 'precision mediump float; uniform vec4 uColor; varying float vAlpha;' +
      'void main(){ gl_FragColor = vec4(uColor.rgb, uColor.a * vAlpha); }';

    function shader(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader');
      return sh;
    }
    function program(vs, fs) {
      var p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link');
      return p;
    }
    var progBody, progLine;
    try {
      progBody = program(VS_BODY, FS_BODY);
      progLine = program(VS_LINE, FS_LINE);
    } catch (e) { return null; }

    var body = buildSphereGeometry(LOW_BUDGET ? 20 : 30, LOW_BUDGET ? 28 : 44);
    var bodyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bodyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(body), gl.STATIC_DRAW);
    var bodyCount = body.length / 6;

    var geo = buildWireGeometry(LOW_BUDGET ? 64 : 110, LOW_BUDGET ? 14 : 30);
    function buffer(vertArray, alphaArray) {
      var vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertArray), gl.STATIC_DRAW);
      var ab = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, ab);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(alphaArray), gl.STATIC_DRAW);
      return { buf: vb, alphaBuf: ab, count: vertArray.length / 3 };
    }
    var wire = buffer(geo.wireVerts, geo.wireAlphas);
    var arcs = buffer(geo.arcVerts, geo.arcAlphas);
    var nodes = buffer(geo.nodeVerts, geo.nodeAlphas);
    var dots = buffer(geo.dotVerts, geo.dotAlphas);

    // body program locations
    var bPos = gl.getAttribLocation(progBody, 'aPos');
    var bNorm = gl.getAttribLocation(progBody, 'aNormal');
    var bMVP = gl.getUniformLocation(progBody, 'uMVP');
    var bModel = gl.getUniformLocation(progBody, 'uModel');
    var bMode = gl.getUniformLocation(progBody, 'uMode');
    // line program locations
    var aPos = gl.getAttribLocation(progLine, 'aPos');
    var aAlpha = gl.getAttribLocation(progLine, 'aAlpha');
    var uMVP = gl.getUniformLocation(progLine, 'uMVP');
    var uColor = gl.getUniformLocation(progLine, 'uColor');
    var uSize = gl.getUniformLocation(progLine, 'uSize');

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);                  // blendFunc set per pass in render()
    gl.clearColor(0, 0, 0, 0);

    var angle = 0.62;                     // pleasant initial facing
    var last = 0;
    var running = false;

    function bindBody() {
      gl.useProgram(progBody);
      gl.bindBuffer(gl.ARRAY_BUFFER, bodyBuf);
      gl.enableVertexAttribArray(bPos);
      gl.vertexAttribPointer(bPos, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(bNorm);
      gl.vertexAttribPointer(bNorm, 3, gl.FLOAT, false, 24, 12);
    }
    function drawShell(model, mvp, mode) {
      bindBody();
      gl.uniformMatrix4fv(bMVP, false, new Float32Array(mvp));
      gl.uniformMatrix4fv(bModel, false, new Float32Array(model));
      gl.uniform1f(bMode, mode);
      gl.drawArrays(gl.TRIANGLES, 0, bodyCount);
    }
    function bindAttribs(b) {
      gl.useProgram(progLine);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(aPos);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.alphaBuf);
      gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(aAlpha);
    }
    function drawSet(b, color, size, mvp) {
      bindAttribs(b);
      gl.uniformMatrix4fv(uMVP, false, new Float32Array(mvp));
      gl.uniform4f(uColor, color[0], color[1], color[2], color[3]);
      gl.uniform1f(uSize, size);
      gl.drawArrays(b === nodes ? gl.POINTS : gl.LINES, 0, b.count);
    }

    function render() {
      var w = canvas.width, h = canvas.height;
      gl.viewport(0, 0, w, h);
      // depthMask(true) BEFORE the clear — a false mask from the previous
      // frame's line/halo passes would make the depth clear a no-op.
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var proj = perspective(0.58, w / Math.max(1, h), 0.1, 10);
      var view = translateZ(-3.05);
      var spin = mul(rotX(TILT), rotY(angle));
      // Fit inside the canvas: radius 0.72 keeps the silhouette + atmosphere
      // ring visible (unit sphere at this distance would overflow the view).
      var base = mul(spin, scaleUniform(0.72));
      var mvpSpin = mul(proj, mul(view, base));

      // 1) solid globe body (writes depth)
      gl.enable(gl.DEPTH_TEST);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      drawShell(base, mvpSpin, 0);

      // 2) network lines — depth-tested against the body (far side hidden)
      gl.depthMask(false);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);      // additive glow lines
      var mL = mul(base, scaleUniform(1.006));
      drawSet(wire, [0.0, 1.0, 0.82, 0.42], 0, mul(proj, mul(view, mL)));
      drawSet(arcs, [0.0, 0.95, 1.0, 0.60], 0, mul(proj, mul(view, mL)));
      drawSet(dots, [0.30, 1.0, 0.88, 0.9], Math.max(1.2, 1.7 * (w / 980)), mul(proj, mul(view, mL)));
      var s = w / 980;
      drawSet(nodes, [0.35, 1.0, 0.85, 0.95], Math.max(1.6, 2.8 * s), mul(proj, mul(view, mul(base, scaleUniform(1.012)))));

      // 3) atmosphere halo — enlarged shell, fresnel only, additive
      gl.disable(gl.DEPTH_TEST);
      var mH = mul(base, scaleUniform(1.05));
      drawShell(mH, mul(proj, mul(view, mH)), 1);
      gl.enable(gl.DEPTH_TEST);
    }

    function frame(ts) {
      if (disposed || !running) return;
      raf = requestAnimationFrame(frame);
      if (!last) last = ts;
      var dt = ts - last;
      if (dt < 33) return;                // ~30fps cap (it is a background)
      last = ts;
      angle += (dt / PERIOD_MS) * Math.PI * 2;   // delta-time, frame-rate independent
      render();
    }

    function start() {
      if (disposed || running) return;
      running = true; last = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    return {
      start: start,
      stop: stop,
      renderStatic: function () { angle = 0.62; render(); },
      resize: function () { applySize(canvas); },
      dispose: function () {
        stop();
        try {
          gl.getExtension('WEBGL_lose_context')?.loseContext();
        } catch (e) { /* already gone */ }
      }
    };
  }

  // ---- lifecycle ---------------------------------------------------------------
  var api = null;
  var watchdog = 0;

  function stopWatchdog() {
    if (watchdog) { clearTimeout(watchdog); watchdog = 0; }
  }
  function bootGL() {
    if (disposed) return;
    stopWatchdog();
    try { api = initGL(); } catch (e) { api = null; }
    if (!api) {
      fallback2d();
      return;
    }
    api.resize();
    if (reducedMotion()) {
      api.renderStatic();               // static frame — no rotation loop
    } else {
      api.start();
    }
  }

  // Cold-boot GPU churn can kill the context right after startup. A lost
  // context that preventDefaults WILL be restored by Chromium shortly —
  // re-init everything on restore. If it never comes, degrade to 2D.
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    if (api) api.stop();
    stopWatchdog();
    watchdog = setTimeout(function () {
      watchdog = 0;
      if (!disposed) fallback2d();
    }, RESTORE_WATCHDOG_MS);
  });
  canvas.addEventListener('webglcontextrestored', function () {
    stopWatchdog();
    bootGL();
  });

  document.addEventListener('visibilitychange', function () {
    if (disposed) return;
    if (document.hidden) { if (api) api.stop(); }
    else if (api && !reducedMotion()) api.start();
  });

  bootGL();

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    if (disposed) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = 0;
      if (api) { api.resize(); if (reducedMotion()) api.renderStatic(); }
      else fallback2d();
    }, 150);
  });

  window.addEventListener('pagehide', function () {
    disposed = true;
    stopWatchdog();
    if (api) api.dispose();
  });
})();`;
}
