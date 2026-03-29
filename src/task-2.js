import "./style.css";

import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const MODEL_URL =
  "https://vrlab2.blob.core.windows.net/vr-lab-2-task-2/low_poly_building.glb";

let camera, scene, renderer;
let model;
let reticle;

let hitTestSource = null;
let modelPlaced = false;

let sceneAmbientLight, sceneDirLight, modelLight;
let sceneLightEnabled = true;
let modelLightEnabled = true;
let modelLightType = "point";
let modelLightIntensity = 5;
let modelLightColor = 0xffffff;

let rotationEnabled = true;
let rotationAxis = "y";
let degrees = 0;

const originalMaterials = new Map();
const altMaterials = {};
let currentMaterial = "original";

let panelOpen = true;

init();
animate();

function init() {
  const container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    40
  );

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  sceneAmbientLight = new THREE.AmbientLight(0xffffff, 1.5);
  scene.add(sceneAmbientLight);

  sceneDirLight = new THREE.DirectionalLight(0xfff5e0, 2.5);
  sceneDirLight.position.set(4, 6, 4);
  scene.add(sceneDirLight);

  modelLight = new THREE.PointLight(modelLightColor, modelLightIntensity, 15);
  scene.add(modelLight);

  // Reticle geometry pre-rotated to lie flat on horizontal surfaces
  const reticleGeo = new THREE.RingGeometry(0.1, 0.16, 32).rotateX(-Math.PI / 2);
  reticle = new THREE.Mesh(
    reticleGeo,
    new THREE.MeshBasicMaterial({
      color: 0x64dcb4,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  loadModel();

  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["hit-test"],
  });
  document.body.appendChild(arButton);

  renderer.xr.addEventListener("sessionstart", onSessionStart);
  renderer.xr.addEventListener("sessionend", onSessionEnd);

  renderer.domElement.addEventListener("click", onTap);

  setupControls();

  window.addEventListener("resize", onWindowResize);
}

async function onSessionStart() {
  const session = renderer.xr.getSession();

  const viewerSpace = await session.requestReferenceSpace("viewer");
  hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

  document.getElementById("ctrl2-panel").style.display = "none";
  document.getElementById("back-btn").style.display = "none";

  session.addEventListener("end", () => {
    hitTestSource = null;
    modelPlaced = false;
    reticle.visible = false;
    if (model) model.visible = false;
  });
}

function onSessionEnd() {
  hitTestSource = null;
  modelPlaced = false;
  document.getElementById("ctrl2-panel").style.display = "flex";
  document.getElementById("back-btn").style.display = "";
}

function loadModel() {
  const loadingEl = createLoadingIndicator();

  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,

    function (gltf) {
      model = gltf.scene;

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3()).length();
      const scale = 0.5 / size;
      model.scale.setScalar(scale);

      const center = box.getCenter(new THREE.Vector3());
      model.position
        .copy(center)
        .negate()
        .multiplyScalar(scale)
        .add(new THREE.Vector3(0, 0, -1.2));

      scene.add(model);
      loadingEl.remove();

      model.traverse((child) => {
        if (child.isMesh) {
          originalMaterials.set(child, child.material);
        }
      });

      altMaterials.gold = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 1.0,
        roughness: 0.1,
      });
      altMaterials.silver = new THREE.MeshStandardMaterial({
        color: 0xc0c0c0,
        metalness: 1.0,
        roughness: 0.2,
      });
      altMaterials.emerald = new THREE.MeshStandardMaterial({
        color: 0x50c878,
        metalness: 0.3,
        roughness: 0.45,
      });
      altMaterials.glass = new THREE.MeshPhysicalMaterial({
        color: 0x99ccff,
        transparent: true,
        opacity: 0.65,
        roughness: 0.0,
        metalness: 0.05,
        transmission: 0.9,
        side: THREE.DoubleSide,
      });

      setMaterial(currentMaterial);
      console.log("Model loaded successfully");
    },

    function (xhr) {
      if (xhr.total > 0) {
        const pct = Math.round((xhr.loaded / xhr.total) * 100);
        loadingEl.textContent = `Loading model… ${pct}%`;
      }
    },

    function (error) {
      console.error("Failed to load model:", error);
      loadingEl.textContent = "Failed to load model.";
      loadingEl.style.color = "#ff6b6b";
    }
  );
}

function createLoadingIndicator() {
  const el = document.createElement("div");
  el.textContent = "Loading model…";
  el.style.cssText = [
    "position:fixed",
    "top:50%",
    "left:50%",
    "transform:translate(-50%,-50%)",
    "color:#64dcb4",
    "font-family:Monospace",
    "font-size:13px",
    "letter-spacing:2px",
    "z-index:100",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(el);
  return el;
}

function setupControls() {
  document.getElementById("ctrl2-toggle").addEventListener("click", () => {
    panelOpen = !panelOpen;
    document.getElementById("ctrl2-body").style.display = panelOpen ? "flex" : "none";
    document.getElementById("ctrl2-toggle").textContent = panelOpen ? "−" : "+";
  });

  document.getElementById("btn2-rotation").addEventListener("click", () => {
    rotationEnabled = !rotationEnabled;
    setActiveBtn("btn2-rotation", rotationEnabled);
    document.getElementById("btn2-rotation").textContent = rotationEnabled
      ? "Disable Rotation"
      : "Enable Rotation";
  });

  document.querySelectorAll(".c2-radio-btn[data-axis]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".c2-radio-btn[data-axis]").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      rotationAxis = btn.dataset.axis;
    });
  });

  document.getElementById("c2-material").addEventListener("change", (e) => {
    setMaterial(e.target.value);
  });

  document.getElementById("btn2-scene-light").addEventListener("click", () => {
    sceneLightEnabled = !sceneLightEnabled;
    sceneAmbientLight.visible = sceneLightEnabled;
    sceneDirLight.visible = sceneLightEnabled;
    setActiveBtn("btn2-scene-light", sceneLightEnabled);
    document.getElementById("btn2-scene-light").textContent = sceneLightEnabled
      ? "Scene: ON"
      : "Scene: OFF";
  });

  document.getElementById("btn2-model-light").addEventListener("click", () => {
    modelLightEnabled = !modelLightEnabled;
    modelLight.visible = modelLightEnabled;
    setActiveBtn("btn2-model-light", modelLightEnabled);
    document.getElementById("btn2-model-light").textContent = modelLightEnabled
      ? "Model: ON"
      : "Model: OFF";
  });

  document.querySelectorAll(".c2-type-btn[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".c2-type-btn[data-type]").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      modelLightType = btn.dataset.type;
      rebuildModelLight();
    });
  });

  const intensitySlider = document.getElementById("c2-intensity");
  const intensityVal = document.getElementById("c2-intensity-val");
  intensitySlider.addEventListener("input", (e) => {
    modelLightIntensity = parseFloat(e.target.value);
    intensityVal.textContent = modelLightIntensity;
    modelLight.intensity = modelLightIntensity;
  });

  document.getElementById("c2-color").addEventListener("input", (e) => {
    modelLightColor = parseInt(e.target.value.slice(1), 16);
    modelLight.color.setHex(modelLightColor);
  });
}

function setActiveBtn(id, active) {
  document.getElementById(id).classList.toggle("on", active);
}

function setMaterial(type) {
  currentMaterial = type;
  if (!model) return;
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.material =
      type === "original"
        ? originalMaterials.get(child)
        : altMaterials[type];
    child.material.needsUpdate = true;
  });
}

function rebuildModelLight() {
  const wasVisible = modelLight.visible;
  scene.remove(modelLight);

  if (modelLightType === "point") {
    modelLight = new THREE.PointLight(modelLightColor, modelLightIntensity, 15);
  } else if (modelLightType === "spot") {
    modelLight = new THREE.SpotLight(
      modelLightColor,
      modelLightIntensity,
      15,
      Math.PI / 5,
      0.4
    );
  } else {
    modelLight = new THREE.DirectionalLight(modelLightColor, modelLightIntensity);
    modelLight.position.set(4, 6, 4);
  }

  modelLight.visible = wasVisible;
  scene.add(modelLight);

  if (modelLightType === "spot" && model) {
    scene.add(modelLight.target);
  }
}

function onTap() {
  if (!renderer.xr.isPresenting || !reticle.visible || modelPlaced) return;

  model.matrixAutoUpdate = true;
  model.position.setFromMatrixPosition(reticle.matrix);
  model.rotation.set(0, 0, 0);
  degrees = 0;

  model.visible = true;
  modelPlaced = true;
  reticle.visible = false;
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(_, frame) {
  if (renderer.xr.isPresenting && hitTestSource && frame && !modelPlaced) {
    const results = frame.getHitTestResults(hitTestSource);
    if (results.length > 0) {
      const pose = results[0].getPose(renderer.xr.getReferenceSpace());
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);
    } else {
      reticle.visible = false;
    }
  }

  if (model && rotationEnabled) {
    degrees += 0.2;
    const rad = THREE.MathUtils.degToRad(degrees);
    model.rotation.x = rotationAxis === "x" ? rad : 0;
    model.rotation.y = rotationAxis === "y" ? rad : 0;
    model.rotation.z = rotationAxis === "z" ? rad : 0;
  }

  if (model && modelLight && modelLightType !== "directional") {
    const worldPos = new THREE.Vector3();
    model.getWorldPosition(worldPos);
    modelLight.position.set(worldPos.x + 1.5, worldPos.y + 2, worldPos.z + 1.5);
    if (modelLightType === "spot") {
      modelLight.target.position.copy(worldPos);
      modelLight.target.updateMatrixWorld();
    }
  }

  renderer.render(scene, camera);
}
