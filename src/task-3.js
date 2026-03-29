import "./style.css";

import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";

let container;
let camera, scene, renderer;
let reticle;
let controller;

let cones = [];
let rotationEnabled = true;
let scaleAnimationEnabled = false;
let currentMaterialIndex = 0;
let currentColor = 0x00ccff;
let currentScale = 1.0;

let hitTestSource = null;
let localSpace = null;
let hitTestSourceInitialized = false;

function createMaterial(index, color) {
    switch (index) {
        case 1:
            return new THREE.MeshStandardMaterial({
                color,
                emissive: color,
                emissiveIntensity: 1.8,
                metalness: 0.2,
                roughness: 0.5,
            });
        case 2:
            return new THREE.MeshPhysicalMaterial({
                color,
                transparent: true,
                opacity: 0.45,
                metalness: 0.1,
                roughness: 0.1,
                transmission: 0.9,
                thickness: 0.5,
            });
        default:
            return new THREE.MeshStandardMaterial({
                color,
                metalness: 0.45,
                roughness: 0.35,
            });
    }
}

init();
animate();

function init() {
    container = document.createElement("div");
    document.body.appendChild(container);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1.5);
    hemiLight.position.set(0.5, 1, 0.25);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(3, 5, 3);
    scene.add(dirLight);

    controller = renderer.xr.getController(0);
    controller.addEventListener("select", onSelect);
    scene.add(controller);

    addReticleToScene();

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
    const panel = document.getElementById("settings-panel");

    const colorPicker = panel.querySelector("#colorPicker");
    const colorSwatch = panel.querySelector("#colorSwatch");

    colorSwatch.addEventListener("click", () => colorPicker.click());
    colorPicker.addEventListener("input", () => {
        const hex = colorPicker.value;
        currentColor = parseInt(hex.slice(1), 16);
        colorSwatch.style.background = hex;
        applyColorToAll(currentColor);
    });

    panel.querySelector("#randomColorBtn").addEventListener("click", () => {
        currentColor = Math.floor(Math.random() * 0xffffff);
        const css = hexCSS(currentColor);
        colorPicker.value = css;
        colorSwatch.style.background = css;
        applyColorToAll(currentColor);
    });

    panel.querySelector("#sizeSlider").addEventListener("input", (e) => {
        currentScale = parseFloat(e.target.value);
        panel.querySelector("#scaleIndicator").textContent = `${currentScale.toFixed(2)}×`;
        cones.forEach(c => c.scale.setScalar(currentScale));
    });

    panel.querySelector("#toggleRotationBtn").addEventListener("click", () => {
        rotationEnabled = !rotationEnabled;
        const btn = panel.querySelector("#toggleRotationBtn");
        btn.textContent = rotationEnabled ? "Enabled" : "Disabled";
        btn.classList.toggle("on", rotationEnabled);
    });

    panel.querySelector("#toggleScaleAnimationBtn").addEventListener("click", () => {
        scaleAnimationEnabled = !scaleAnimationEnabled;
        const btn = panel.querySelector("#toggleScaleAnimationBtn");
        btn.textContent = scaleAnimationEnabled ? "Enabled" : "Disabled";
        btn.classList.toggle("on", scaleAnimationEnabled);
        if (!scaleAnimationEnabled) {
            cones.forEach(c => c.scale.setScalar(currentScale));
        }
    });

    panel.querySelectorAll(".mat-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            currentMaterialIndex = parseInt(btn.dataset.idx);
            panel.querySelectorAll(".mat-btn").forEach((b, i) => {
                b.classList.toggle("on", i === currentMaterialIndex);
            });
            applyMaterialToAll(currentMaterialIndex);
        });
    });

    return panel;
}

function hexCSS(num) {
    return `#${(num & 0xffffff).toString(16).padStart(6, "0")}`;
}

function applyColorToAll(color) {
    cones.forEach(c => {
        c.material.color.setHex(color);
        if (c.material.emissive) c.material.emissive.setHex(color);
    });
}

function applyMaterialToAll(index) {
    cones.forEach(c => {
        const oldColor = c.material.color.getHex();
        c.material.dispose();
        c.material = createMaterial(index, oldColor);
    });
}

function addReticleToScene() {
    const geometry = new THREE.RingGeometry(0.12, 0.18, 32).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
        color: 0x64dcb4,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
    });

    reticle = new THREE.Mesh(geometry, material);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    reticle.add(new THREE.AxesHelper(0.15));
}

function onSelect() {
    if (!reticle.visible) return;

    const geometry = new THREE.ConeGeometry(0.05, 0.15, 32);
    const material = createMaterial(currentMaterialIndex, currentColor);
    const cone = new THREE.Mesh(geometry, material);

    cone.position.setFromMatrixPosition(reticle.matrix);
    cone.quaternion.setFromRotationMatrix(reticle.matrix);
    cone.position.y += 0.075;

    cone.scale.setScalar(currentScale);
    cone.userData.scaleDir = 1;
    cone.userData.baseScale = currentScale;

    scene.add(cone);
    cones.push(cone);
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
        if (!hitTestSourceInitialized) {
            initializeHitTestSource();
        }

        if (hitTestSourceInitialized && hitTestSource) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            if (hitTestResults.length > 0) {
                const pose = hitTestResults[0].getPose(localSpace);
                reticle.visible = true;
                reticle.matrix.fromArray(pose.transform.matrix);
                reticle.material.opacity = 0.5 + 0.3 * Math.sin(timestamp * 0.005);
            } else {
                reticle.visible = false;
            }
        }

        cones.forEach(cone => {
            if (rotationEnabled) {
                cone.rotation.y += 0.02;
            }

            if (scaleAnimationEnabled) {
                const base = cone.userData.baseScale ?? currentScale;
                const min = base * 0.7;
                const max = base * 1.3;
                const speed = 0.012;

                if (cone.userData.scaleDir === 1) {
                    cone.scale.x += speed;
                    cone.scale.y += speed;
                    cone.scale.z += speed;
                    if (cone.scale.x >= max) cone.userData.scaleDir = -1;
                } else {
                    cone.scale.x -= speed;
                    cone.scale.y -= speed;
                    cone.scale.z -= speed;
                    if (cone.scale.x <= min) cone.userData.scaleDir = 1;
                }
            }
        });
    }

    renderer.render(scene, camera);
}
