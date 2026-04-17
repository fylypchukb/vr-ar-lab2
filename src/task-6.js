import "./style.css";

import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import RAPIER from "@dimforge/rapier3d-compat";

const MODEL_URL =
  "https://vrlab2.blob.core.windows.net/vr-lab-2-task-2/3d_chrome_dino_walking.glb";

// Target size in metres after normalization
const TARGET_MODEL_SIZE = 0.12;

let container, camera, scene, renderer;
let reticle, controller;

// WebXR hit-test source and reference spaces
let hitTestSource = null,
  localSpace = null,
  hitTestSourceInitialized = false;

// Rapier physics world instance
let physicsWorld = null;
// Rapier uses WebAssembly, so we must wait for it to initialize before using it
let rapierReady = false;

// Stores pairs of { mesh, body } for dynamic objects that need per-frame sync
const dynamicObjects = [];

// All Three.js objects added to the scene during a session, used for cleanup
const sceneNodes = [];

// Physics parameters controlled by the settings panel
let restitution = 0.55; // coefficient of restitution (bounciness)
let gravityY = 9.8; // gravitational acceleration, m/s²
let spawnHeight = 0.6; // height above surface where the model is spawned, metres

// Template loaded once from the server and cloned on each placement
let modelTemplate = null;
// Half-extents of the scaled bounding box, used to define the collider shape
let modelHalfExts = new THREE.Vector3(0.05, 0.05, 0.05);

let statusEl;
let placedCount = 0;

// Initialize Rapier WASM module as early as possible
RAPIER.init().then(() => {
  rapierReady = true;
});

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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Three-point lighting: hemisphere for ambient, directional for shadows, fill for balance
  const hemi = new THREE.HemisphereLight(0xfff0d0, 0x8899aa, 1.2);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(3, 6, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xc0d8ff, 0.9);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  addReticle();

  controller = renderer.xr.getController(0);
  controller.addEventListener("select", onSelect);
  scene.add(controller);

  preloadModel();

  // dom-overlay feature is required to render HTML elements over the AR camera feed
  const arBtn = ARButton.createButton(renderer, {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay"],
    domOverlay: { root: document.body },
  });
  document.body.appendChild(arBtn);

  setupUI();
  window.addEventListener("resize", onWindowResize);
}

function setupUI() {
  const panel = document.getElementById("t6-panel");
  const hud = document.getElementById("t6-hud");
  statusEl = document.getElementById("t6-status");
  const resetBtn = document.getElementById("t6-reset-btn");

  const restitutionSlider = document.getElementById("t6-restitution");
  const gravitySlider = document.getElementById("t6-gravity");
  const spawnSlider = document.getElementById("t6-spawn");
  const restitutionLabel = document.getElementById("t6-restitution-label");
  const gravityLabel = document.getElementById("t6-gravity-label");
  const spawnLabel = document.getElementById("t6-spawn-label");

  restitutionSlider.addEventListener("input", () => {
    restitution = parseFloat(restitutionSlider.value);
    restitutionLabel.textContent = restitution.toFixed(2);
  });

  gravitySlider.addEventListener("input", () => {
    gravityY = parseFloat(gravitySlider.value);
    gravityLabel.textContent = `${gravityY.toFixed(1)} m/s²`;
    // Apply the new gravity to the running simulation immediately
    if (physicsWorld) {
      physicsWorld.gravity.x = 0;
      physicsWorld.gravity.y = -gravityY;
      physicsWorld.gravity.z = 0;
    }
  });

  spawnSlider.addEventListener("input", () => {
    spawnHeight = parseFloat(spawnSlider.value);
    spawnLabel.textContent = `${spawnHeight.toFixed(1)} m`;
  });

  resetBtn.addEventListener("click", resetAll);

  renderer.xr.addEventListener("sessionstart", () => {
    panel.style.display = "none";
    hud.style.display = "flex";
    if (rapierReady)
      physicsWorld = new RAPIER.World({ x: 0, y: -gravityY, z: 0 });
    placedCount = 0;
    statusEl.textContent = "Tap a surface to drop";
  });

  renderer.xr.addEventListener("sessionend", () => {
    hitTestSourceInitialized = false;
    hitTestSource = null;
    localSpace = null;
    reticle.visible = false;
    panel.style.display = "flex";
    hud.style.display = "none";
    teardownPhysics();
  });
}

// The reticle is a ring geometry pre-rotated by -90° on X so it lies flat on surfaces
function addReticle() {
  const geo = new THREE.RingGeometry(0.07, 0.12, 32).rotateX(-Math.PI / 2);
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

function preloadModel() {
  const getEl = () => document.getElementById("t6-load-status");

  new GLTFLoader().load(
    MODEL_URL,
    (gltf) => {
      modelTemplate = gltf.scene;

      // Normalize the model size so it looks reasonable in AR regardless of original scale
      const box = new THREE.Box3().setFromObject(modelTemplate);
      const size = box.getSize(new THREE.Vector3());
      const scale = TARGET_MODEL_SIZE / Math.max(size.x, size.y, size.z);
      modelTemplate.scale.setScalar(scale);

      // Compute bounding box after scaling to get correct collider dimensions
      const sb = new THREE.Box3().setFromObject(modelTemplate);
      const ss = sb.getSize(new THREE.Vector3());
      modelHalfExts.set(ss.x / 2, ss.y / 2, ss.z / 2);

      modelTemplate.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });

      const el = getEl();
      if (el) {
        el.textContent = "Model ready ✓";
        el.style.color = "#64dcb4";
      }
    },
    (xhr) => {
      if (xhr.total > 0) {
        const el = getEl();
        if (el)
          el.textContent = `Loading… ${Math.round((xhr.loaded / xhr.total) * 100)}%`;
      }
    },
    () => {
      const el = getEl();
      if (el) {
        el.textContent = "Load failed";
        el.style.color = "#ff6b6b";
      }
    },
  );
}

// On each tap, a static floor is created at the detected surface and a dynamic
// model is spawned above it to fall under gravity
function onSelect() {
  if (!reticle.visible || !modelTemplate || !physicsWorld) return;

  const surfacePos = new THREE.Vector3();
  const surfaceQuat = new THREE.Quaternion();
  surfacePos.setFromMatrixPosition(reticle.matrix);
  surfaceQuat.setFromRotationMatrix(reticle.matrix);

  createFloor(surfacePos, surfaceQuat);
  dropModel(surfacePos, surfaceQuat);

  placedCount++;
  statusEl.textContent = `${placedCount} dropped · tap for more`;
}

// Creates a fixed Rapier rigid body at the hit-test surface position and orientation.
// A large flat cuboid collider is attached to represent the physical floor plane.
function createFloor(pos, quat) {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(pos.x, pos.y, pos.z)
    .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
  const body = physicsWorld.createRigidBody(bodyDesc);

  // 4 m × 4 m footprint, 1 cm thick
  physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(4.0, 0.005, 4.0).setFriction(0.8),
    body,
  );

  // Visual indicator showing where the physics surface was placed
  const grid = new THREE.GridHelper(1.5, 6, 0x64dcb4, 0x64dcb4);
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  grid.position.copy(pos);
  // GridHelper lies in the XZ plane by default; the surface quaternion rotates it
  // to match the orientation returned by the hit-test (e.g. a tilted or vertical surface)
  grid.quaternion.copy(quat);
  scene.add(grid);
  sceneNodes.push(grid);
}

// Clones the pre-loaded model, positions it above the surface along the surface normal,
// and registers a dynamic Rapier rigid body to simulate gravity and collisions
function dropModel(surfacePos, surfaceQuat) {
  // The Y axis of the hit-test pose represents the surface normal.
  // Translating along this vector places the spawn point directly above the surface.
  const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(surfaceQuat);
  const spawnPos = surfacePos.clone().addScaledVector(normal, spawnHeight);

  const instance = modelTemplate.clone(true);
  instance.rotation.y = Math.random() * Math.PI * 2; // randomize initial orientation
  scene.add(instance);
  sceneNodes.push(instance);

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(spawnPos.x, spawnPos.y, spawnPos.z)
    .setLinearDamping(0.05)
    .setAngularDamping(0.35);
  const body = physicsWorld.createRigidBody(bodyDesc);

  // Axis-aligned box collider derived from the model's scaled bounding box
  physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(
      modelHalfExts.x,
      modelHalfExts.y,
      modelHalfExts.z,
    )
      .setRestitution(restitution)
      .setFriction(0.7),
    body,
  );

  dynamicObjects.push({ mesh: instance, body });
}

// Removes all scene objects and releases the Rapier world from WASM memory
function teardownPhysics() {
  sceneNodes.forEach((n) => scene.remove(n));
  sceneNodes.length = 0;
  dynamicObjects.length = 0;
  if (physicsWorld) {
    physicsWorld.free();
    physicsWorld = null;
  }
}

function resetAll() {
  sceneNodes.forEach((n) => scene.remove(n));
  sceneNodes.length = 0;
  dynamicObjects.length = 0;

  // Recreating the world is the simplest way to remove all rigid bodies at once
  if (physicsWorld) physicsWorld.free();
  physicsWorld = new RAPIER.World({ x: 0, y: -gravityY, z: 0 });

  placedCount = 0;
  statusEl.textContent = "Tap a surface to drop";
}

// Requests hit-test and local reference spaces from the active XR session.
// Called lazily on the first rendered frame rather than at session start.
async function initializeHitTestSource() {
  const session = renderer.xr.getSession();
  const viewerSpc = await session.requestReferenceSpace("viewer");
  hitTestSource = await session.requestHitTestSource({ space: viewerSpc });
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
        // Animate opacity to indicate the reticle is actively tracking a surface
        reticle.material.opacity = 0.5 + 0.3 * Math.sin(timestamp * 0.005);
      } else {
        reticle.visible = false;
      }
    }

    // Step the physics simulation and synchronize each Three.js mesh
    // with the position and rotation of its corresponding Rapier rigid body
    if (physicsWorld) {
      physicsWorld.step();

      dynamicObjects.forEach(({ mesh, body }) => {
        const t = body.translation();
        const r = body.rotation();
        mesh.position.set(t.x, t.y, t.z);
        mesh.quaternion.set(r.x, r.y, r.z, r.w);
      });
    }
  }

  renderer.render(scene, camera);
}
