import "./style.css";

import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

let camera, scene, renderer;
let dodecahedronMesh, ringMesh, planeMesh;
let controls;
let clock;
let meshes;

const state = {
  rotationEnabled: true,
  colorEmitEnabled: false,
  texturesEnabled: false,
  pulseMoveEnabled: false,
  speedFast: false,
  specialEffect: false,
};

let baseMaterials;
let emitMaterials;
let textureMaterials;

init();
animate();

function init() {
  clock = new THREE.Clock();

  const container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    40,
  );

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  const dirLight = new THREE.DirectionalLight(0xffffff, 4);
  dirLight.position.set(3, 3, 3);
  scene.add(dirLight);

  const pointLight = new THREE.PointLight(0xffffff, 10, 10);
  pointLight.position.set(-2, 2, 2);
  scene.add(pointLight);

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));

  baseMaterials = [
    new THREE.MeshStandardMaterial({
      color: 0x9b59b6,
      metalness: 0.9,
      roughness: 0.2,
    }),
    new THREE.MeshStandardMaterial({
      color: 0x1abc9c,
      metalness: 0.4,
      roughness: 0.3,
      side: THREE.DoubleSide,
    }),
    new THREE.MeshPhysicalMaterial({
      color: 0xe67e22,
      transparent: true,
      opacity: 0.7,
      roughness: 0.5,
      metalness: 0.3,
      side: THREE.DoubleSide,
    }),
  ];

  emitMaterials = [
    new THREE.MeshStandardMaterial({
      color: 0xff4466,
      emissive: 0xff4466,
      emissiveIntensity: 1.8,
      metalness: 0.4,
      roughness: 0.2,
    }),
    new THREE.MeshStandardMaterial({
      color: 0x00ffee,
      emissive: 0x00ffee,
      emissiveIntensity: 2.2,
      metalness: 0.2,
      roughness: 0.1,
      side: THREE.DoubleSide,
    }),
    new THREE.MeshStandardMaterial({
      color: 0xffdd00,
      emissive: 0xffdd00,
      emissiveIntensity: 1.4,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    }),
  ];

  textureMaterials = [
    new THREE.MeshStandardMaterial({
      map: makeCheckerTexture("#9b59b6", "#ffffff"),
      metalness: 0.3,
      roughness: 0.5,
    }),
    new THREE.MeshStandardMaterial({
      map: makeGradientTexture(),
      side: THREE.DoubleSide,
      metalness: 0.2,
      roughness: 0.4,
    }),
    new THREE.MeshStandardMaterial({
      map: makeGridTexture(),
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
  ];

  dodecahedronMesh = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.15, 0),
    baseMaterials[0],
  );
  dodecahedronMesh.position.set(-0.4, 0, -1.5);
  scene.add(dodecahedronMesh);

  ringMesh = new THREE.Mesh(
    new THREE.RingGeometry(0.1, 0.2, 32),
    baseMaterials[1],
  );
  ringMesh.position.set(0, 0, -1.5);
  scene.add(ringMesh);

  planeMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    baseMaterials[2],
  );
  planeMesh.position.set(0.4, 0, -1.5);
  scene.add(planeMesh);

  meshes = [dodecahedronMesh, ringMesh, planeMesh];

  camera.position.z = 3;
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  document.body.appendChild(ARButton.createButton(renderer));

  renderer.xr.addEventListener("sessionstart", () => {
    document.getElementById("ctrl-panel").style.display = "none";
  });
  renderer.xr.addEventListener("sessionend", () => {
    document.getElementById("ctrl-panel").style.display = "flex";
  });

  buildControlPanel();

  window.addEventListener("resize", onWindowResize);
}

function makeCheckerTexture(hex1, hex2, tiles = 4, size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cell = size / tiles;
  for (let row = 0; row < tiles; row++) {
    for (let col = 0; col < tiles; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? hex1 : hex2;
      ctx.fillRect(col * cell, row * cell, cell, cell);
    }
  }
  return new THREE.CanvasTexture(canvas);
}

function makeGradientTexture(size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "#1abc9c");
  grad.addColorStop(0.5, "#3498db");
  grad.addColorStop(1, "#9b59b6");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function makeGridTexture(size = 128, divisions = 4) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e67e22";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#ffffffcc";
  ctx.lineWidth = 2;
  const step = size / divisions;
  for (let i = 0; i <= divisions; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(size, i * step);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

function buildControlPanel() {
  const panel = document.createElement("div");
  panel.id = "ctrl-panel";
  panel.innerHTML = `
        <div class="ctrl-title">AR Controls</div>
        <button id="btn-rotation"   class="ctrl-btn on">Disable Rotation</button>
        <button id="btn-emit"       class="ctrl-btn">Enable Color/Emit</button>
        <button id="btn-textures"   class="ctrl-btn">Enable Textures</button>
        <button id="btn-pulse"      class="ctrl-btn">Enable Pulse/Move</button>
        <button id="btn-speed"      class="ctrl-btn">Speed: Normal</button>
        <button id="btn-special"    class="ctrl-btn">Special Effect</button>
    `;
  document.body.appendChild(panel);

  document.getElementById("btn-rotation").addEventListener("click", toggleRotation);
  document.getElementById("btn-emit").addEventListener("click", toggleColorEmit);
  document.getElementById("btn-textures").addEventListener("click", toggleTextures);
  document.getElementById("btn-pulse").addEventListener("click", togglePulse);
  document.getElementById("btn-speed").addEventListener("click", toggleSpeed);
  document.getElementById("btn-special").addEventListener("click", toggleSpecial);
}

function toggleRotation() {
  state.rotationEnabled = !state.rotationEnabled;
  setBtn("btn-rotation", state.rotationEnabled, "Disable Rotation", "Enable Rotation");
}

function toggleColorEmit() {
  state.colorEmitEnabled = !state.colorEmitEnabled;
  setBtn("btn-emit", state.colorEmitEnabled, "Disable Color/Emit", "Enable Color/Emit");
  applyMaterials();
}

function toggleTextures() {
  state.texturesEnabled = !state.texturesEnabled;
  setBtn("btn-textures", state.texturesEnabled, "Disable Textures", "Enable Textures");
  applyMaterials();
}

function togglePulse() {
  state.pulseMoveEnabled = !state.pulseMoveEnabled;
  setBtn("btn-pulse", state.pulseMoveEnabled, "Disable Pulse/Move", "Enable Pulse/Move");
  if (!state.pulseMoveEnabled) {
    meshes.forEach((m) => {
      m.scale.setScalar(1);
    });
    planeMesh.position.y = 0;
  }
}

function toggleSpeed() {
  state.speedFast = !state.speedFast;
  setBtn("btn-speed", state.speedFast, "Speed: Fast", "Speed: Normal");
}

function toggleSpecial() {
  state.specialEffect = !state.specialEffect;
  setBtn("btn-special", state.specialEffect, "Special Effect: ON", "Special Effect");
  if (!state.specialEffect) {
    // reset wireframe and emissive intensity
    meshes.forEach((m) => {
      m.material.wireframe = false;
      if (m.material.emissiveIntensity !== undefined) {
        m.material.emissiveIntensity = state.colorEmitEnabled
          ? emitMaterials[meshes.indexOf(m)].emissiveIntensity
          : 0;
      }
    });
  }
}

function setBtn(id, active, labelOn, labelOff) {
  const btn = document.getElementById(id);
  btn.textContent = active ? labelOn : labelOff;
  btn.classList.toggle("on", active);
}

function applyMaterials() {
  const bank = state.texturesEnabled
    ? textureMaterials
    : state.colorEmitEnabled
      ? emitMaterials
      : baseMaterials;
  meshes.forEach((mesh, i) => {
    mesh.material = bank[i];
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

function render() {
  const t = clock.getElapsedTime();
  const speed = state.speedFast ? 2.5 : 1.0;

  controls.update();

  if (state.rotationEnabled) {
    dodecahedronMesh.rotation.y += 0.01 * speed;
    dodecahedronMesh.rotation.x += 0.005 * speed;
    ringMesh.rotation.x += 0.01 * speed;
    ringMesh.rotation.z += 0.008 * speed;
    planeMesh.rotation.z += 0.01 * speed;
    planeMesh.rotation.y += 0.006 * speed;
  }

  if (state.pulseMoveEnabled) {
    const s = speed;
    dodecahedronMesh.scale.setScalar(1 + 0.25 * Math.sin(t * 3 * s));
    ringMesh.scale.setScalar(1 + 0.2 * Math.sin(t * 3 * s + 1.0));
    planeMesh.scale.setScalar(1 + 0.18 * Math.sin(t * 3 * s + 2.0));
    planeMesh.position.y = 0.1 * Math.sin(t * 2 * s);
  }

  if (state.specialEffect) {
    if (Math.random() < 0.04) {
      meshes.forEach((m) => {
        if ("wireframe" in m.material)
          m.material.wireframe = !m.material.wireframe;
      });
    }
    const surge = Math.abs(Math.sin(t * 6 * speed)) * 3.5;
    meshes.forEach((m) => {
      if (m.material.emissive) {
        m.material.emissive.setHSL((t * 0.2) % 1, 1.0, 0.5);
        m.material.emissiveIntensity = surge;
      }
    });
  }

  renderer.render(scene, camera);
}
