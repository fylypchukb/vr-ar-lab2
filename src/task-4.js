import "./style.css";

import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const MODEL_URL =
    "https://vrlab2.blob.core.windows.net/vr-lab-2-task-2/3d_chrome_dino_walking.glb";

let container;
let camera, scene, renderer;
let reticle;
let controller;

let modelTemplate = null;
let modelScale = 1;
let models = [];

const originalMaterials = new Map();

let directionalLight;
let directionalLightEnabled = true;
let lightIntensity = 3;

const LIGHT_COLORS = [0xffffff, 0xff6666, 0x66ff99, 0x66aaff, 0xffdd55];
const LIGHT_COLOR_NAMES = ["White", "Red", "Green", "Blue", "Amber"];
let currentLightColorIndex = 0;

let jumpEnabled = false;
let rotationEnabled = true;

let currentMaterial = "realistic";

const CHIP_TINTS = ["rgba(255,255,255,0.12)", "rgba(255,100,100,0.25)",
    "rgba(100,255,150,0.2)", "rgba(100,170,255,0.25)", "rgba(255,220,80,0.22)"];
const CHIP_TEXT = ["#fff", "#ff9999", "#88ffaa", "#88ccff", "#ffdd77"];

function makeMaterial(key) {
    switch (key) {
        case "gold":
            return new THREE.MeshStandardMaterial({
                color: 0xffd700,
                metalness: 0.9,
                roughness: 0.1,
            });
        case "glass":
            return new THREE.MeshPhysicalMaterial({
                color: 0xaaddff,
                transparent: true,
                opacity: 0.45,
                metalness: 0.1,
                roughness: 0.05,
                transmission: 0.9,
                thickness: 0.5,
            });
        case "chrome":
            return new THREE.MeshStandardMaterial({
                color: 0xffffff,
                metalness: 1.0,
                roughness: 0.02,
            });
        case "glow":
            return new THREE.MeshStandardMaterial({
                color: 0x00ff88,
                emissive: 0x00ff88,
                emissiveIntensity: 1.6,
                metalness: 0.2,
                roughness: 0.3,
            });
        default:
            return null;
    }
}

let hitTestSource = null;
let localSpace = null;
let hitTestSourceInitialized = false;

init();
animate();

function init() {
    container = document.createElement("div");
    document.body.appendChild(container);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xfff5e0, 0x8899aa, 1.0);
    hemiLight.position.set(0, 1, 0);
    scene.add(hemiLight);

    directionalLight = new THREE.DirectionalLight(
        LIGHT_COLORS[currentLightColorIndex],
        lightIntensity
    );
    directionalLight.position.set(4, 6, 4);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(1024, 1024);
    scene.add(directionalLight);

    const fillLight = new THREE.DirectionalLight(0xc0d8ff, 1.0);
    fillLight.position.set(-4, 2, -3);
    scene.add(fillLight);

    controller = renderer.xr.getController(0);
    controller.addEventListener("select", onSelect);
    scene.add(controller);

    addReticleToScene();
    preloadModel();

    const arButton = ARButton.createButton(renderer, {
        requiredFeatures: ["hit-test"],
    });
    document.body.appendChild(arButton);

    const panel = buildSettingsPanel();

    renderer.xr.addEventListener("sessionstart", () => {
        panel.style.display = "none";
    });
    renderer.xr.addEventListener("sessionend", () => {
        hitTestSourceInitialized = false;
        hitTestSource = null;
        localSpace = null;
        reticle.visible = false;
        panel.style.display = "flex";
    });

    window.addEventListener("resize", onWindowResize);
}

function buildSettingsPanel() {
    const panel = document.getElementById("t4-panel");

    panel.querySelectorAll(".mat-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            currentMaterial = btn.dataset.key;
            panel.querySelectorAll(".mat-btn").forEach(b =>
                b.classList.toggle("on", b.dataset.key === currentMaterial)
            );
            applyMaterialToAll(currentMaterial);
        });
    });

    panel.querySelector("#toggleDirLightBtn").addEventListener("click", () => {
        directionalLightEnabled = !directionalLightEnabled;
        directionalLight.visible = directionalLightEnabled;
        const btn = panel.querySelector("#toggleDirLightBtn");
        btn.textContent = directionalLightEnabled ? "ON" : "OFF";
        btn.classList.toggle("on", directionalLightEnabled);
    });

    panel.querySelector("#incIntBtn").addEventListener("click", () => {
        lightIntensity = Math.min(lightIntensity + 0.5, 8);
        directionalLight.intensity = lightIntensity;
        panel.querySelector("#intensityLabel").textContent = `${lightIntensity.toFixed(1)} lx`;
    });

    panel.querySelector("#decIntBtn").addEventListener("click", () => {
        lightIntensity = Math.max(lightIntensity - 0.5, 0);
        directionalLight.intensity = lightIntensity;
        panel.querySelector("#intensityLabel").textContent = `${lightIntensity.toFixed(1)} lx`;
    });

    panel.querySelector("#lightColorBtn").addEventListener("click", () => {
        currentLightColorIndex = (currentLightColorIndex + 1) % LIGHT_COLORS.length;
        directionalLight.color.setHex(LIGHT_COLORS[currentLightColorIndex]);
        const btn = panel.querySelector("#lightColorBtn");
        btn.textContent = LIGHT_COLOR_NAMES[currentLightColorIndex];
        btn.style.cssText = colorChipStyle(currentLightColorIndex);
    });

    panel.querySelector("#toggleJumpBtn").addEventListener("click", () => {
        jumpEnabled = !jumpEnabled;
        if (!jumpEnabled) {
            models.forEach(m => { m.position.y = m.userData.baseY; });
        }
        const btn = panel.querySelector("#toggleJumpBtn");
        btn.textContent = jumpEnabled ? "ON" : "OFF";
        btn.classList.toggle("on", jumpEnabled);
    });

    panel.querySelector("#toggleRotationBtn").addEventListener("click", () => {
        rotationEnabled = !rotationEnabled;
        const btn = panel.querySelector("#toggleRotationBtn");
        btn.textContent = rotationEnabled ? "ON" : "OFF";
        btn.classList.toggle("on", rotationEnabled);
    });

    return panel;
}

function colorChipStyle(idx) {
    return [
        "padding:6px 14px", "border-radius:6px",
        `background:${CHIP_TINTS[idx]}`,
        `color:${CHIP_TEXT[idx]}`,
        "font-family:monospace", "font-size:12px", "cursor:pointer",
        `border:1px solid ${CHIP_TEXT[idx]}44`,
    ].join(";");
}


function applyMaterialToAll(key) {
    const mat = makeMaterial(key);
    models.forEach(model => applyMaterialToModel(model, key, mat));
}

function applyMaterialToModel(model, key, mat) {
    model.traverse(child => {
        if (!child.isMesh) return;
        if (key === "realistic") {
            const orig = originalMaterials.get(child.uuid);
            if (orig) {
                child.material.dispose();
                child.material = orig.clone();
                child.material.needsUpdate = true;
            }
        } else {
            child.material.dispose();
            child.material = mat.clone();
            child.material.needsUpdate = true;
        }
    });
}

function addReticleToScene() {
    const geometry = new THREE.RingGeometry(0.12, 0.2, 32).rotateX(-Math.PI / 2);
    reticle = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
            color: 0x64dcb4,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
        })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);
}

function preloadModel() {
    const statusEl = () => document.getElementById("t4-load-status");

    new GLTFLoader().load(
        MODEL_URL,
        (gltf) => {
            modelTemplate = gltf.scene;

            const box = new THREE.Box3().setFromObject(modelTemplate);
            const size = box.getSize(new THREE.Vector3()).length();
            modelScale = 0.3 / size;
            modelTemplate.scale.setScalar(modelScale);

            modelTemplate.traverse(child => {
                if (child.isMesh && child.material) {
                    originalMaterials.set(child.uuid, child.material.clone());
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            const el = statusEl();
            if (el) { el.textContent = "Model ready ✓"; el.style.color = "#64dcb4"; }
            console.log("Model pre-loaded. Scale:", modelScale.toFixed(4));
        },
        (xhr) => {
            if (xhr.total > 0) {
                const pct = Math.round((xhr.loaded / xhr.total) * 100);
                const el = statusEl();
                if (el) el.textContent = `Loading model… ${pct}%`;
            }
        },
        (error) => {
            console.error("Model load failed:", error);
            const el = statusEl();
            if (el) { el.textContent = "Failed to load model"; el.style.color = "#ff6b6b"; }
        }
    );
}

function onSelect() {
    if (!reticle.visible || !modelTemplate) return;

    const instance = modelTemplate.clone(true);

    instance.position.setFromMatrixPosition(reticle.matrix);
    instance.quaternion.setFromRotationMatrix(reticle.matrix);

    const box = new THREE.Box3().setFromObject(modelTemplate);
    const bottomOffset = (box.getCenter(new THREE.Vector3()).y - box.min.y) * modelScale;
    instance.position.y += bottomOffset;

    instance.userData.baseY = instance.position.y;
    instance.userData.rotationSpeed = 0.018;

    const mat = makeMaterial(currentMaterial);
    applyMaterialToModel(instance, currentMaterial, mat);

    scene.add(instance);
    models.push(instance);
}

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
            } else {
                reticle.visible = false;
            }
        }

        models.forEach(model => {
            if (jumpEnabled) {
                const bounce = Math.abs(Math.sin(timestamp * 0.004)) * 0.08;
                model.position.y = model.userData.baseY + bounce;
            } else {
                model.position.y = model.userData.baseY;
            }

            if (rotationEnabled) {
                model.rotation.y += model.userData.rotationSpeed;
            }
        });
    }

    renderer.render(scene, camera);
}
