/*
 * NetworkBackground
 * Fase 1 — Universo 3D ambiental (Three.js).
 *
 * Genera un campo de partículas conectadas (dispositivos / endpoints / datos)
 * que vive en un <canvas> fijo detrás de todo el contenido.
 *
 * Fase 2 añade CameraController: la cámara viaja por el universo siguiendo
 * un recorrido (spline) con un punto de referencia por zona/sección, y
 * `setScrollProgress(0..1)` es la única API que necesita el scroll de la
 * página para pilotarla. El parallax de ratón de la Fase 1 se mantiene y
 * se suma como un offset pequeño sobre la posición que marca el scroll.
 *
 * Expone window.NetworkBackground = { init, setIntensity, setScrollProgress,
 * destroy } para que fases posteriores puedan seguir conectándose.
 */

(function () {
  "use strict";

  const NetworkBackground = {
    init,
    setIntensity,
    setScrollProgress,
    destroy,
    isActive: () => Boolean(state && state.renderer),
  };

  let state = null;

  // --- CameraController path -------------------------------------------
  // One waypoint per zone of the "infrastructure". Six stops line up with
  // the six zones the brief describes (SYSTEM CORE → SECURE CHANNEL).
  // Positions stay close to the original Fase 1 vantage point (z ≈ 18) so
  // the network never feels like it's flying off-screen — it's a slow
  // walk through the same room, not a rollercoaster.
  const CAMERA_PATH = [
    { pos: [0, 0, 18], look: [0, 0, 0] }, // SYSTEM CORE (hero)
    { pos: [3.5, 1.2, 15], look: [0.5, 0, 0] }, // SECURITY OPERATIONS (servicios)
    { pos: [-3, -0.8, 13], look: [-0.5, 0.2, 0] }, // SYSTEM HISTORY (experiencia)
    { pos: [2.5, 1.6, 11], look: [0, -0.3, 0] }, // KNOWLEDGE CORE (formación)
    { pos: [-2.5, -1.4, 9.5], look: [0.3, 0.3, 0] }, // SECURITY LAB (proyectos)
    { pos: [0, 0.6, 8], look: [0, 0, 0] }, // SECURE CHANNEL (cta/contacto)
  ];

  function catmullRom(p0, p1, p2, p3, t) {
    // Standard Catmull-Rom spline, per-component. Keeps the camera path
    // smooth between waypoints instead of jumping linearly from one to
    // the next.
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    );
  }

  function sampleCameraPath(progress) {
    const path = CAMERA_PATH;
    const segments = path.length - 1;
    const clamped = Math.max(0, Math.min(1, progress));
    const scaled = clamped * segments;
    let i = Math.floor(scaled);
    if (i >= segments) i = segments - 1;
    const localT = scaled - i;

    const get = (idx, key) => path[Math.max(0, Math.min(segments, idx))][key];

    const result = { pos: [0, 0, 0], look: [0, 0, 0] };
    for (let axis = 0; axis < 3; axis++) {
      const p0 = get(i - 1, "pos")[axis];
      const p1 = get(i, "pos")[axis];
      const p2 = get(i + 1, "pos")[axis];
      const p3 = get(i + 2, "pos")[axis];
      result.pos[axis] = catmullRom(p0, p1, p2, p3, localT);

      const l0 = get(i - 1, "look")[axis];
      const l1 = get(i, "look")[axis];
      const l2 = get(i + 1, "look")[axis];
      const l3 = get(i + 2, "look")[axis];
      result.look[axis] = catmullRom(l0, l1, l2, l3, localT);
    }
    return result;
  }

  function prefersReducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function isLowPowerDevice() {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4; // not all browsers expose this
    const smallScreen = window.innerWidth < 760;
    return cores <= 4 || mem <= 4 || smallScreen;
  }

  function init(canvas) {
    if (!canvas || typeof THREE === "undefined") return null;
    if (state) return state; // already initialized

    const reducedMotion = prefersReducedMotion();
    const lowPower = isLowPowerDevice();

    // Particle budget scales down on weak/mobile devices and is skipped
    // almost entirely (single static frame) under reduced-motion.
    const PARTICLE_COUNT = lowPower ? 160 : 320;
    const CONNECT_DISTANCE = lowPower ? 5.2 : 6.4;
    const FIELD_RADIUS = 26;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
    });
    const dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.25 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.set(0, 0, 18);

    // --- Nodes (particles): devices / endpoints / data ------------------
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const drift = new Float32Array(PARTICLE_COUNT * 3); // per-particle velocity
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * FIELD_RADIUS;
      positions[i3 + 1] = (Math.random() - 0.5) * FIELD_RADIUS * 0.6;
      positions[i3 + 2] = (Math.random() - 0.5) * FIELD_RADIUS;

      drift[i3] = (Math.random() - 0.5) * 0.004;
      drift[i3 + 1] = (Math.random() - 0.5) * 0.004;
      drift[i3 + 2] = (Math.random() - 0.5) * 0.004;
    }

    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );

    const pointsMaterial = new THREE.PointsMaterial({
      color: 0x7ea2ff,
      size: 0.11,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });

    const points = new THREE.Points(pointsGeometry, pointsMaterial);
    scene.add(points);

    // --- Connections: link nearby nodes into a "network" ----------------
    // Computed once (not every frame) for performance; re-derived only on
    // structural changes, not on every drift tick.
    const lineGeometry = new THREE.BufferGeometry();
    const linePositions = buildConnectionSegments(
      positions,
      PARTICLE_COUNT,
      CONNECT_DISTANCE
    );
    lineGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(linePositions, 3)
    );
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x2e6bff,
      transparent: true,
      opacity: 0.18,
    });
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(lines);

    // --- Subtle ambient light glow (no lighting model needed for points) -
    // (kept minimal: points/lines use basic materials, no lights required)

    let frame = 0;
    let rafId = null;
    let recomputeCounter = 0;

    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    let intensity = 1; // 0..1, allows later phases to fade the effect

    // CameraController state: target progress comes from the page's scroll
    // (Fase 2), current progress eases toward it so the trip always feels
    // smooth even if the scroll itself jumps (anchor links, keyboard nav).
    const cameraState = { current: 0, target: 0 };
    const currentPos = new THREE.Vector3(...CAMERA_PATH[0].pos);
    const currentLook = new THREE.Vector3(...CAMERA_PATH[0].look);

    function onPointerMove(e) {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      pointer.targetX = nx;
      pointer.targetY = ny;
    }

    function onResize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }

    function renderStaticFrame() {
      renderer.render(scene, camera);
    }

    function animate() {
      frame++;

      // Smooth pointer easing (very subtle — this is an ambient install,
      // not a game).
      pointer.x += (pointer.targetX - pointer.x) * 0.03;
      pointer.y += (pointer.targetY - pointer.y) * 0.03;

      // CameraController: ease the current path-progress toward whatever
      // the scroll last reported, then sample the spline for a position
      // and look-at target. This is the "travel through the universe"
      // driven by scroll instead of sections just sliding by.
      cameraState.current += (cameraState.target - cameraState.current) * 0.06;
      const sample = sampleCameraPath(cameraState.current);
      currentPos.set(sample.pos[0], sample.pos[1], sample.pos[2]);
      currentLook.set(sample.look[0], sample.look[1], sample.look[2]);

      // Mouse parallax is a small offset layered on top of the scroll
      // position, not a replacement for it.
      camera.position.x = currentPos.x + pointer.x * 1.1;
      camera.position.y = currentPos.y + -pointer.y * 0.7;
      camera.position.z = currentPos.z;
      camera.lookAt(currentLook.x, currentLook.y, currentLook.z);

      // Gentle overall rotation so the network feels alive without being
      // distracting.
      points.rotation.y += 0.00035 * intensity;
      lines.rotation.y = points.rotation.y;

      // Drift particles very slowly; keep them inside the field bounds.
      const posAttr = pointsGeometry.attributes.position;
      const arr = posAttr.array;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        arr[i3] += drift[i3] * intensity;
        arr[i3 + 1] += drift[i3 + 1] * intensity;
        arr[i3 + 2] += drift[i3 + 2] * intensity;

        if (Math.abs(arr[i3]) > FIELD_RADIUS / 2) drift[i3] *= -1;
        if (Math.abs(arr[i3 + 1]) > FIELD_RADIUS * 0.3) drift[i3 + 1] *= -1;
        if (Math.abs(arr[i3 + 2]) > FIELD_RADIUS / 2) drift[i3 + 2] *= -1;
      }
      posAttr.needsUpdate = true;

      // Recompute connection segments occasionally (not every frame — this
      // is the expensive part) so links follow the slow drift.
      recomputeCounter++;
      if (recomputeCounter % 90 === 0) {
        const updated = buildConnectionSegments(
          arr,
          PARTICLE_COUNT,
          CONNECT_DISTANCE
        );
        lineGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(updated, 3)
        );
      }

      renderer.render(scene, camera);
      rafId = window.requestAnimationFrame(animate);
    }

    window.addEventListener("resize", onResize);

    if (reducedMotion) {
      // Respect prefers-reduced-motion: draw one calm frame, no loop, no
      // pointer reactivity.
      renderStaticFrame();
    } else {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      rafId = window.requestAnimationFrame(animate);
    }

    state = {
      renderer,
      scene,
      camera,
      points,
      lines,
      onResize,
      onPointerMove,
      reducedMotion,
      get rafId() {
        return rafId;
      },
      setIntensityValue(v) {
        intensity = v;
      },
      setScrollProgressValue(p) {
        cameraState.target = Math.max(0, Math.min(1, p));
        if (reducedMotion) {
          // No continuous flight for reduced-motion users: jump straight
          // to the right vantage point and render a single calm frame.
          cameraState.current = cameraState.target;
          const sample = sampleCameraPath(cameraState.current);
          camera.position.set(sample.pos[0], sample.pos[1], sample.pos[2]);
          camera.lookAt(sample.look[0], sample.look[1], sample.look[2]);
          renderStaticFrame();
        }
      },
    };

    return state;
  }

  function buildConnectionSegments(positions, count, maxDistance) {
    // Simple O(n^2) neighbor search. Particle counts here are small
    // (<= ~320) and this only runs at init + every ~1.5s, so it stays cheap.
    const segments = [];
    const maxDistSq = maxDistance * maxDistance;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const xi = positions[i3];
      const yi = positions[i3 + 1];
      const zi = positions[i3 + 2];

      for (let j = i + 1; j < count; j++) {
        const j3 = j * 3;
        const dx = xi - positions[j3];
        const dy = yi - positions[j3 + 1];
        const dz = zi - positions[j3 + 2];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < maxDistSq) {
          segments.push(xi, yi, zi, positions[j3], positions[j3 + 1], positions[j3 + 2]);
        }
      }
    }

    return new Float32Array(segments);
  }

  function setIntensity(value) {
    if (state && state.setIntensityValue) {
      state.setIntensityValue(Math.max(0, Math.min(1, value)));
    }
  }

  function setScrollProgress(value) {
    if (state && state.setScrollProgressValue) {
      state.setScrollProgressValue(value);
    }
  }

  function destroy() {
    if (!state) return;
    if (state.rafId) window.cancelAnimationFrame(state.rafId);
    window.removeEventListener("resize", state.onResize);
    window.removeEventListener("pointermove", state.onPointerMove);
    state.renderer.dispose();
    state = null;
  }

  window.NetworkBackground = NetworkBackground;
})();
