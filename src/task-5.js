import "./style.css";

import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";

let container;
let camera, scene, renderer;
let reticle;
let controller;

let hitTestSource = null;
let localSpace = null;
let hitTestSourceInitialized = false;

// The two points the user taps in the real world
let pointA = null; // THREE.Vector3 — first tapped point
let markerA = null; // cyan sphere sitting at point A
let markerB = null; // red sphere sitting at point B
let activeLine = null; // the line being drawn right now

// Simple state machine: 0 = waiting for first tap, 1 = waiting for second tap, 2 = done
let tapPhase = 0;

// Previous measurements stay visible so the user can compare them
const completedMeasurements = [];

// DOM refs wired up in init()
let hudEl, statusEl, distanceEl, resetBtn;

init();
animate();

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20,
  );

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
  scene.add(ambientLight);

  addReticleToScene();

  controller = renderer.xr.getController(0);
  controller.addEventListener("select", onSelect);
  scene.add(controller);

  // dom-overlay is required so the HUD stays visible during the AR session
  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay"],
    domOverlay: { root: document.body },
  });
  document.body.appendChild(arButton);

  const panel = document.getElementById("t5-panel");
  hudEl = document.getElementById("t5-hud");
  statusEl = document.getElementById("t5-status");
  distanceEl = document.getElementById("t5-distance");
  resetBtn = document.getElementById("t5-reset-btn");

  resetBtn.addEventListener("click", resetAll);

  renderer.xr.addEventListener("sessionstart", () => {
    panel.style.display = "none";
    hudEl.style.display = "flex";
    resetAll();
  });

  renderer.xr.addEventListener("sessionend", () => {
    hitTestSourceInitialized = false;
    hitTestSource = null;
    localSpace = null;
    reticle.visible = false;
    panel.style.display = "flex";
    hudEl.style.display = "none";
    clearAllFromScene();
  });

  window.addEventListener("resize", onWindowResize);
}

// Flat ring that follows the detected surface
function addReticleToScene() {
  const geo = new THREE.RingGeometry(0.06, 0.1, 32).rotateX(-Math.PI / 2);
  reticle = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0x64dcb4,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
}

// Small sphere to mark a tapped point
function makeMarker(color) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.015, 16, 16),
    new THREE.MeshBasicMaterial({ color }),
  );
  return mesh;
}

// Line with two placeholder endpoints that are updated every frame while measuring
function createLine() {
  const points = [new THREE.Vector3(), new THREE.Vector3()];
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color: 0x64dcb4 });
  return new THREE.Line(geo, mat);
}

// Push new coordinates directly into the buffer
function setLineEndpoints(line, from, to) {
  const pos = line.geometry.attributes.position.array;
  pos[0] = from.x;
  pos[1] = from.y;
  pos[2] = from.z;
  pos[3] = to.x;
  pos[4] = to.y;
  pos[5] = to.z;
  line.geometry.attributes.position.needsUpdate = true;
}

// Called on every screen tap while in AR
function onSelect() {
  if (!reticle.visible) return;

  const pos = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);

  if (tapPhase === 0) {
    // First tap — drop a cyan marker and start drawing the line
    pointA = pos;

    markerA = makeMarker(0x64dcb4);
    markerA.position.copy(pointA);
    scene.add(markerA);

    activeLine = createLine();
    scene.add(activeLine);

    tapPhase = 1;
    statusEl.textContent = "Tap to place second point";
    distanceEl.textContent = "";
    resetBtn.classList.remove("t5-reset-hidden");
  } else if (tapPhase === 1) {
    // Second tap — lock the endpoint and show the final distance
    const pointB = pos;

    markerB = makeMarker(0xff6b6b);
    markerB.position.copy(pointB);
    scene.add(markerB);

    setLineEndpoints(activeLine, pointA, pointB);

    const distance = pointA.distanceTo(pointB);
    distanceEl.textContent = `${distance.toFixed(3)} m`;
    statusEl.textContent = "Tap again for new measurement";

    completedMeasurements.push({ markerA, markerB, line: activeLine });

    // Let go of the working refs so the next tap starts fresh
    pointA = null;
    markerA = null;
    markerB = null;
    activeLine = null;
    tapPhase = 2;
  } else {
    // Third tap — keep the old measurement visible and start a new one
    tapPhase = 0;
    statusEl.textContent = "Tap to place first point";
    distanceEl.textContent = "";
  }
}

// Remove everything that was placed this session
function clearAllFromScene() {
  if (markerA) {
    scene.remove(markerA);
    markerA = null;
  }
  if (markerB) {
    scene.remove(markerB);
    markerB = null;
  }
  if (activeLine) {
    scene.remove(activeLine);
    activeLine = null;
  }

  completedMeasurements.forEach((m) => {
    scene.remove(m.markerA);
    scene.remove(m.markerB);
    scene.remove(m.line);
  });
  completedMeasurements.length = 0;

  pointA = null;
}

function resetAll() {
  clearAllFromScene();
  tapPhase = 0;
  statusEl.textContent = "Tap to place first point";
  distanceEl.textContent = "";
  resetBtn.classList.add("t5-reset-hidden");
}

// Called once after the session starts — sets up the hit-test stream
async function initializeHitTestSource() {
  const session = renderer.xr.getSession();
  const viewerSpace = await session.requestReferenceSpace("viewer");
  hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  localSpace = await session.requestReferenceSpace("local");
  hitTestSourceInitialized = true;

  session.addEventListener("end", () => {
    hitTestSourceInitialized = false;
    hitTestSource = null;
    localSpace = null;
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  if (frame) {
    if (!hitTestSourceInitialized) initializeHitTestSource();

    if (hitTestSourceInitialized && hitTestSource) {
      const hits = frame.getHitTestResults(hitTestSource);

      if (hits.length > 0) {
        const pose = hits[0].getPose(localSpace);
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
        reticle.material.opacity = 0.5 + 0.3 * Math.sin(timestamp * 0.005);

        // While the user is aiming for the second point, show a live distance
        if (tapPhase === 1 && pointA && activeLine) {
          const current = new THREE.Vector3().setFromMatrixPosition(
            reticle.matrix,
          );
          setLineEndpoints(activeLine, pointA, current);
          const dist = pointA.distanceTo(current);
          distanceEl.textContent = `~${dist.toFixed(3)} m`;
        }
      } else {
        reticle.visible = false;
      }
    }
  }

  renderer.render(scene, camera);
}
