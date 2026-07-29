import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import './style.css';
import './mobile.css';

const $ = (selector) => document.querySelector(selector);
const viewer = $('#viewer');
const input = $('#fileInput');
const dropZone = $('#dropZone');
const loading = $('#loading');
const toast = $('#toast');
const cubeCanvas = $('#viewCubeCanvas');
let model;
let worker;
let loadingFile = false;
let toastTimer;
let viewAnimation;
let modelBasis = new THREE.Quaternion();
let clickStart;
let cubeDrag;
let rightPan;
let distanceLock;
let edgesVisible = true;
let progressValue = 0;
let rejectActiveParse;
let activeFileReader;
let cancelRequested = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1f2f3);
const camera = new THREE.PerspectiveCamera(42, 1, .01, 1000000);
camera.position.set(180, -220, 155);
camera.up.set(0, 0, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewer.append(renderer.domElement);

const controls = new TrackballControls(camera, renderer.domElement);
controls.rotateSpeed = 2.2;
controls.zoomSpeed = 1.15;
controls.panSpeed = .16;
controls.staticMoving = false;
controls.dynamicDampingFactor = .12;
controls.target.set(0, 0, 0);

const faceRaycaster = new THREE.Raycaster();
const facePointer = new THREE.Vector2();
const selectedFace = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
  color: 0xffe21a,
  transparent: true,
  opacity: .72,
  side: THREE.DoubleSide,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
}));
selectedFace.visible = false;
selectedFace.renderOrder = 20;

scene.add(new THREE.HemisphereLight(0xffffff, 0xc9cdd0, 2.7));
const light = new THREE.DirectionalLight(0xffffff, 1.35);
light.position.set(-4, -5, 8);
scene.add(light);

function makeFaceTexture(label, tint = '#f4f7f9', rotation = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = tint;
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = '#c7d0d8';
  context.lineWidth = 8;
  context.strokeRect(5, 5, 246, 246);
  context.fillStyle = '#405366';
  context.font = '600 62px "Microsoft JhengHei", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.save();
  context.translate(128, 128);
  context.rotate(rotation);
  context.fillText(label, 0, 4);
  context.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

const cubeScene = new THREE.Scene();
const cubeCamera = new THREE.PerspectiveCamera(30, 1, .1, 20);
const cubeRenderer = new THREE.WebGLRenderer({ canvas: cubeCanvas, alpha: true, antialias: true });
cubeRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
cubeRenderer.setSize(96, 96, false);
cubeRenderer.outputColorSpace = THREE.SRGBColorSpace;

// BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z.
const cubeMaterials = [
  ['右', '#eaf4fd', -Math.PI / 2],
  ['左', '#edf2f6', Math.PI / 2],
  ['後', '#edf2f6', Math.PI],
  ['前', '#eaf4fd', 0],
  ['上', '#f8fafb', 0],
  ['下', '#e4e9ed', Math.PI],
].map(([label, color, rotation]) => new THREE.MeshBasicMaterial({
  map: makeFaceTexture(label, color, rotation),
}));
const navCube = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), cubeMaterials);
const navEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(navCube.geometry),
  new THREE.LineBasicMaterial({ color: 0x9eabb6 }),
);
navCube.add(navEdges);
cubeScene.add(navCube);

const cubeRaycaster = new THREE.Raycaster();
const cubePointer = new THREE.Vector2();
const faceViews = {
  0: new THREE.Vector3(1, 0, 0),
  1: new THREE.Vector3(-1, 0, 0),
  2: new THREE.Vector3(0, 1, 0),
  3: new THREE.Vector3(0, -1, 0),
  4: new THREE.Vector3(0, 0, 1),
  5: new THREE.Vector3(0, 0, -1),
};

function resize() {
  const { clientWidth: width, clientHeight: height } = viewer;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  model?.traverse((item) => {
    if (item.isLineSegments2) item.material.resolution.set(width, height);
  });
  controls.handleResize();
}
addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
function updateFullscreenUi() {
  const fullscreen = Boolean(document.fullscreenElement) || document.body.classList.contains('pseudo-fullscreen');
  $('#fullscreenLabel').textContent = fullscreen ? '離開全螢幕' : '全螢幕';
  $('#fullscreenBtn').title = fullscreen ? '離開全螢幕' : '進入全螢幕';
  requestAnimationFrame(resize);
}
document.addEventListener('fullscreenchange', updateFullscreenUi);
resize();

function updateViewAnimation(time) {
  if (!viewAnimation) return;
  const progress = Math.min((time - viewAnimation.startedAt) / 320, 1);
  const eased = 1 - (1 - progress) ** 3;
  const turn = new THREE.Quaternion().slerpQuaternions(
    new THREE.Quaternion(),
    viewAnimation.rotation,
    eased,
  );
  const direction = viewAnimation.startDirection.clone().applyQuaternion(turn);
  camera.position.copy(controls.target).addScaledVector(direction, viewAnimation.distance);
  camera.up.lerpVectors(viewAnimation.startUp, viewAnimation.nextUp, eased).normalize();
  if (progress === 1) viewAnimation = undefined;
}

function renderViewCube() {
  const direction = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  cubeCamera.position.copy(direction).multiplyScalar(5);
  cubeCamera.up.copy(camera.up);
  cubeCamera.lookAt(0, 0, 0);
  navCube.quaternion.copy(model?.quaternion ?? new THREE.Quaternion()).multiply(modelBasis);
  cubeRenderer.render(cubeScene, cubeCamera);
}

renderer.setAnimationLoop((time) => {
  updateViewAnimation(time);
  controls.update();
  if (distanceLock) {
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    if (offset.lengthSq()) {
      camera.position.copy(controls.target).add(offset.setLength(distanceLock.distance));
      camera.lookAt(controls.target);
    }
  }
  renderer.render(scene, camera);
  renderViewCube();
});

function setLoading(title, note) {
  $('#loadingTitle').textContent = title;
  $('#loadingNote').textContent = note;
  loading.classList.remove('hidden');
}
function setProgress(value, note) {
  const progress = Math.max(0, Math.min(100, Math.round(value)));
  progressValue = progress;
  $('#progressBar').style.width = `${progress}%`;
  $('#progressValue').value = `${progress}%`;
  $('.load-progress').setAttribute('aria-valuenow', String(progress));
  if (note) $('#loadingNote').textContent = note;
}
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    activeFileReader = reader;
    reader.onprogress = (event) => {
      if (event.lengthComputable) setProgress(event.loaded / event.total * 8, '正在讀取檔案…');
    };
    reader.onload = () => {
      activeFileReader = undefined;
      resolve(reader.result);
    };
    reader.onerror = () => {
      activeFileReader = undefined;
      reject(new Error('無法讀取檔案。'));
    };
    reader.onabort = () => {
      activeFileReader = undefined;
      reject(new Error('已取消載入。'));
    };
    reader.readAsArrayBuffer(file);
  });
}
function showError(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
}
function dispose(object) {
  object?.traverse((item) => {
    item.geometry?.dispose();
    const materials = Array.isArray(item.material) ? item.material : [item.material];
    materials.forEach((material) => material?.dispose());
  });
}
function fitCamera() {
  if (!model) return;
  const sphere = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
  const distance = Math.max(sphere.radius, 1) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.35;
  camera.position.copy(sphere.center).add(new THREE.Vector3(1, -1.25, .8).normalize().multiplyScalar(distance));
  camera.up.set(0, 0, 1);
  camera.near = Math.max(distance / 1000, .001);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(sphere.center);
  controls.update();
}
async function buildModel(meshes) {
  const geometryGroup = new THREE.Group();
  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    if (cancelRequested) throw new Error('已取消載入。');
    const source = meshes[meshIndex];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(source.position, 3));
    if (source.normal) geometry.setAttribute('normal', new THREE.BufferAttribute(source.normal, 3));
    else geometry.computeVertexNormals();
    geometry.setIndex(new THREE.BufferAttribute(source.index, 1));
    const material = new THREE.MeshStandardMaterial({
      color: source.color ? new THREE.Color(...source.color) : 0xf4f4f4,
      roughness: .65,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const solid = new THREE.Mesh(geometry, material);
    solid.userData.brepFaces = source.brepFaces ?? [];
    const edgePositions = [];
    if (source.brepFaces?.length) {
      for (let faceIndex = 0; faceIndex < source.brepFaces.length; faceIndex += 1) {
        if (faceIndex % 40 === 0) {
          await new Promise(requestAnimationFrame);
          if (cancelRequested) throw new Error('已取消載入。');
        }
        const { first, last } = source.brepFaces[faceIndex];
        const faceGeometry = new THREE.BufferGeometry();
        faceGeometry.setAttribute('position', geometry.attributes.position);
        faceGeometry.setIndex(new THREE.BufferAttribute(source.index.slice(first * 3, (last + 1) * 3), 1));
        const edgeGeometry = new THREE.EdgesGeometry(faceGeometry, 180);
        faceGeometry.dispose();
        for (const value of edgeGeometry.attributes.position.array) edgePositions.push(value);
        edgeGeometry.dispose();
      }
    } else {
      const edgeGeometry = new THREE.EdgesGeometry(geometry, 7);
      for (const value of edgeGeometry.attributes.position.array) edgePositions.push(value);
      edgeGeometry.dispose();
    }
    if (edgePositions.length) {
      const lineGeometry = new LineSegmentsGeometry().setPositions(edgePositions);
      const lineMaterial = new LineMaterial({
        color: 0x171717,
        linewidth: 1.9,
        resolution: new THREE.Vector2(viewer.clientWidth, viewer.clientHeight),
      });
      const outline = new LineSegments2(lineGeometry, lineMaterial);
      outline.visible = edgesVisible;
      solid.add(outline);
    }
    geometryGroup.add(solid);
    setProgress(97 + (meshIndex + 1) / meshes.length * 2, '正在建立 3D 場景…');
    await new Promise(requestAnimationFrame);
  }

  const bounds = new THREE.Box3().setFromObject(geometryGroup);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const dimensions = [size.x, size.y, size.z];
  const axes = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];
  const orderedAxes = [0, 1, 2].sort((a, b) => dimensions[a] - dimensions[b]);
  const front = axes[orderedAxes[0]].clone();
  const up = axes[orderedAxes[2]].clone();
  const initialView = new THREE.Vector3(1, -1.25, .8);
  if (front.dot(initialView) < 0) front.negate();
  const back = front.clone().negate();
  const right = new THREE.Vector3().crossVectors(back, up).normalize();
  modelBasis.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, back, up));

  geometryGroup.position.sub(center);
  const pivot = new THREE.Group();
  pivot.position.copy(center);
  pivot.add(geometryGroup);
  return pivot;
}
function parse(buffer) {
  return new Promise((resolve, reject) => {
    if (!worker) worker = new Worker(new URL('./vendor/step-worker.js', window.location.href));
    const progressTimer = setInterval(() => {
      if (progressValue < 84) setProgress(progressValue + Math.max(1, (84 - progressValue) * .025));
    }, 250);
    rejectActiveParse = (error) => {
      clearInterval(progressTimer);
      rejectActiveParse = undefined;
      reject(error);
    };
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') setProgress(Math.max(progressValue, data.value), data.note);
      else if (data.type === 'complete') {
        clearInterval(progressTimer);
        rejectActiveParse = undefined;
        resolve(data.meshes);
      } else {
        clearInterval(progressTimer);
        rejectActiveParse = undefined;
        reject(new Error(data.message));
      }
    };
    worker.onerror = () => {
      clearInterval(progressTimer);
      worker = undefined;
      rejectActiveParse = undefined;
      reject(new Error('無法載入 STEP 解析器。'));
    };
    worker.postMessage({ buffer, params: { linearDeflection: .00035, angularDeflection: .10 } }, [buffer]);
  });
}
async function openFile(file) {
  if (!file || loadingFile) return;
  if (!/\.(stp|step)$/i.test(file.name)) return showError('請選擇 .stp 或 .step 檔案。');
  loadingFile = true;
  cancelRequested = false;
  try {
    setLoading('正在讀取模型', '正在讀取檔案…');
    setProgress(0);
    const buffer = await readFile(file);
    if (cancelRequested) throw new Error('已取消載入。');
    setProgress(8, '正在啟動 STEP 解析器…');
    const meshes = await parse(buffer);
    setProgress(97, '正在建立 3D 場景…');
    const nextModel = await buildModel(meshes);
    if (cancelRequested) throw new Error('已取消載入。');
    clearFaceSelection();
    dispose(model);
    scene.remove(model);
    model = nextModel;
    scene.add(model);
    fitCamera();
    $('#fileName').textContent = file.name;
    $('#fileName').hidden = false;
    dropZone.classList.add('hidden');
    setProgress(100, '模型載入完成');
    await new Promise((resolve) => setTimeout(resolve, 180));
  } catch (reason) {
    if (reason.message !== '已取消載入。') showError(reason.message || '檔案無法開啟。');
  } finally {
    loadingFile = false;
    loading.classList.add('hidden');
    input.value = '';
  }
}

function setView(localDirection) {
  if (!model) return;
  const nextDirection = localDirection.clone()
    .applyQuaternion(modelBasis)
    .applyQuaternion(model.quaternion)
    .normalize();
  const startDirection = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  const dot = startDirection.dot(nextDirection);
  let rotation;
  if (dot < -.9999) {
    const axis = camera.up.clone().addScaledVector(startDirection, -camera.up.dot(startDirection)).normalize();
    rotation = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI);
  } else {
    rotation = new THREE.Quaternion().setFromUnitVectors(startDirection, nextDirection);
  }
  const transportedUp = camera.up.clone().applyQuaternion(rotation).normalize();
  const localAxes = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ].filter((axis) => Math.abs(axis.dot(localDirection)) < .5);
  const upCandidates = localAxes.flatMap((axis) => [axis, axis.clone().negate()])
    .map((axis) => axis.applyQuaternion(modelBasis).applyQuaternion(model.quaternion).normalize());
  const nextUp = upCandidates.reduce(
    (nearest, candidate) => candidate.dot(transportedUp) > nearest.dot(transportedUp) ? candidate : nearest,
    upCandidates[0],
  );
  viewAnimation = {
    startedAt: performance.now(),
    distance: camera.position.distanceTo(controls.target),
    startDirection,
    startUp: camera.up.clone(),
    nextUp,
    rotation,
  };
  clearFaceSelection();
}

function turnView(degrees) {
  if (!model) return;
  const viewAxis = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
  const rotation = new THREE.Quaternion().setFromAxisAngle(viewAxis, THREE.MathUtils.degToRad(degrees));
  model.quaternion.premultiply(rotation).normalize();
  clearFaceSelection();
}

function clearFaceSelection() {
  selectedFace.removeFromParent();
  selectedFace.geometry.dispose();
  selectedFace.geometry = new THREE.BufferGeometry();
  selectedFace.visible = false;
}

function selectFace(event) {
  if (!model) return;
  const bounds = renderer.domElement.getBoundingClientRect();
  facePointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  facePointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  faceRaycaster.setFromCamera(facePointer, camera);
  const hit = faceRaycaster.intersectObject(model, true)
    .find((intersection) => intersection.object.isMesh && intersection.object.userData.brepFaces);
  if (!hit) {
    clearFaceSelection();
    return;
  }
  const range = hit.object.userData.brepFaces
    .find(({ first, last }) => hit.faceIndex >= first && hit.faceIndex <= last);
  if (!range) {
    clearFaceSelection();
    return;
  }
  clearFaceSelection();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', hit.object.geometry.attributes.position);
  geometry.setIndex(new THREE.BufferAttribute(
    hit.object.geometry.index.array.slice(range.first * 3, (range.last + 1) * 3),
    1,
  ));
  selectedFace.geometry = geometry;
  selectedFace.visible = true;
  hit.object.add(selectedFace);
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button === 0) clickStart = { x: event.clientX, y: event.clientY };
  if (event.pointerType !== 'touch' && (event.button === 0 || event.button === 2)) {
    distanceLock = {
      id: event.pointerId,
      distance: camera.position.distanceTo(controls.target),
    };
  }
  if (event.button === 2) {
    rightPan = {
      id: event.pointerId,
      distance: camera.position.distanceTo(controls.target),
    };
  }
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (distanceLock?.id === event.pointerId) distanceLock = undefined;
  if (rightPan?.id === event.pointerId) rightPan = undefined;
  if (!clickStart) return;
  const moved = Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y);
  clickStart = undefined;
  if (moved < 4) selectFace(event);
});
renderer.domElement.addEventListener('pointercancel', (event) => {
  if (distanceLock?.id === event.pointerId) distanceLock = undefined;
  if (rightPan?.id === event.pointerId) rightPan = undefined;
});
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

function pickCubeFace(event) {
  const bounds = cubeCanvas.getBoundingClientRect();
  cubePointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  cubePointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  cubeRaycaster.setFromCamera(cubePointer, cubeCamera);
  const hit = cubeRaycaster.intersectObject(navCube, false)[0];
  const localDirection = hit && faceViews[hit.face.materialIndex];
  if (localDirection) setView(localDirection);
}

cubeCanvas.addEventListener('pointerdown', (event) => {
  if (!model || event.button !== 0) return;
  cubeCanvas.setPointerCapture(event.pointerId);
  cubeDrag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
  };
  document.body.classList.add('interacting');
});
cubeCanvas.addEventListener('pointermove', (event) => {
  if (!cubeDrag || cubeDrag.id !== event.pointerId || !(event.buttons & 1) || !model) return;
  const deltaX = event.clientX - cubeDrag.x;
  const deltaY = event.clientY - cubeDrag.y;
  cubeDrag.x = event.clientX;
  cubeDrag.y = event.clientY;
  if (!deltaX && !deltaY) return;
  const screenRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const screenUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const yaw = new THREE.Quaternion().setFromAxisAngle(screenUp, deltaX * .012);
  const pitch = new THREE.Quaternion().setFromAxisAngle(screenRight, deltaY * .012);
  model.quaternion.premultiply(yaw).premultiply(pitch).normalize();
  viewAnimation = undefined;
  clearFaceSelection();
});
cubeCanvas.addEventListener('pointerup', (event) => {
  if (!cubeDrag || cubeDrag.id !== event.pointerId) return;
  const moved = Math.hypot(event.clientX - cubeDrag.startX, event.clientY - cubeDrag.startY);
  cubeDrag = undefined;
  document.body.classList.remove('interacting');
  if (moved < 4) pickCubeFace(event);
});
cubeCanvas.addEventListener('pointercancel', (event) => {
  if (cubeDrag?.id !== event.pointerId) return;
  cubeDrag = undefined;
  document.body.classList.remove('interacting');
});

controls.addEventListener('start', () => {
  viewAnimation = undefined;
  document.body.classList.add('interacting');
});
controls.addEventListener('end', () => document.body.classList.remove('interacting'));
input.addEventListener('change', () => openFile(input.files[0]));
for (const event of ['dragenter', 'dragover']) {
  $('#main').addEventListener(event, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragging');
  });
}
for (const event of ['dragleave', 'drop']) {
  $('#main').addEventListener(event, (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragging');
  });
}
$('#main').addEventListener('drop', (event) => openFile(event.dataTransfer.files[0]));
$('#cancelLoadBtn').addEventListener('click', () => {
  cancelRequested = true;
  activeFileReader?.abort();
  worker?.terminate();
  worker = undefined;
  rejectActiveParse?.(new Error('已取消載入。'));
});
$('#turnLeftBtn').addEventListener('click', () => turnView(-45));
$('#turnRightBtn').addEventListener('click', () => turnView(45));
$('#fitBtn').addEventListener('click', fitCamera);
$('#edgesBtn').addEventListener('click', () => {
  edgesVisible = !edgesVisible;
  model?.traverse((item) => {
    if (item.isLineSegments2) item.visible = edgesVisible;
  });
  $('#edgesBtn').classList.toggle('active', edgesVisible);
});
$('#openBtn').addEventListener('click', () => input.click());
$('#fullscreenBtn').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.fullscreenEnabled) await $('#main').requestFullscreen();
    else document.body.classList.toggle('pseudo-fullscreen');
  } catch {
    document.body.classList.toggle('pseudo-fullscreen');
  }
  updateFullscreenUi();
});
$('#hideToolbarBtn').addEventListener('click', () => document.body.classList.add('toolbar-hidden'));
$('#showToolbarBtn').addEventListener('click', () => document.body.classList.remove('toolbar-hidden'));
