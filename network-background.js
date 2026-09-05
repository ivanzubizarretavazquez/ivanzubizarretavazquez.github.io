/*
 * NetworkBackground
 * Fase 1 — Universo 3D ambiental (Three.js).
 *
 * Genera un campo de partículas conectadas (dispositivos / endpoints / datos)
 * que vive en un <canvas> fijo detrás de todo el contenido. No controla
 * todavía la cámara con el scroll (eso es CameraController, Fase 2): aquí
 * solo se establece la infraestructura de render, el parallax sutil de
 * ratón y las salvaguardas de rendimiento/accesibilidad.
 *
 * Expone window.NetworkBackground = { init, setIntensity, destroy }
 * para que fases posteriores (CameraController, etc.) puedan conectarse.
 */

(function () {
  "use strict";

  const NetworkBackground = {
    init,
    setIntensity,
    destroy,
    isActive: () => Boolean(state && state.renderer),
  };

  let state = null;

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

      camera.position.x += (pointer.x * 1.1 - camera.position.x) * 0.02;
      camera.position.y += (-pointer.y * 0.7 - camera.position.y) * 0.02;
      camera.lookAt(0, 0, 0);

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
