import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import './mobile.css';

const $ = (selector) => document.querySelector(selector);
const viewer = $('#viewer');
const mainElement = $('#main');
const fileInput = $('#fileInput');
const dropZone = $('#dropZone');
const loading = $('#loading');
const loadingTitle = $('#loadingTitle');
const loadingNote = $('#loadingNote');
const toast = $('#toast');
let model = null;
let worker = null;
let busy = false;
let toastTimer;
let interactionTimer;
let lightBackground = false;
let rejectActiveParse = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090d12);
scene.fog = new THREE.Fog(0x090d12, 400, 3000);
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000000);
camera.position.set(180, -220, 150);
camera.up.set(0, 0, 1);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewer.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xd9ecff, 0x5f7892, 2.4));
const key = new THREE.DirectionalLight(0xffffff, 3.1); key.position.set(4, -5, 8); scene.add(key);
const grid = new THREE.GridHelper(200, 20, 0x35536a, 0x1c2a35); grid.rotation.x = Math.PI / 2; scene.add(grid);
const axes = new THREE.AxesHelper(25); scene.add(axes);

function setBackgroundTheme(useLight) {
  lightBackground = useLight;
  const palette = useLight
    ? { background: 0xe7edf3, fog: 0xe7edf3, gridMajor: 0x8da4b7, gridMinor: 0xc6d3de, sky: 0xffffff, ground: 0xaabccb, key: 2.8 }
    : { background: 0x090d12, fog: 0x090d12, gridMajor: 0x35536a, gridMinor: 0x1c2a35, sky: 0xd9ecff, ground: 0x5f7892, key: 3.1 };
  scene.background.setHex(palette.background); scene.fog.color.setHex(palette.fog);
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMaterials[0].color.setHex(palette.gridMajor); gridMaterials[1]?.color.setHex(palette.gridMinor);
  scene.children.find((item) => item.isHemisphereLight).color.setHex(palette.sky);
  scene.children.find((item) => item.isHemisphereLight).groundColor.setHex(palette.ground);
  key.intensity = palette.key;
  $('#themeBtn').classList.toggle('active', useLight);
  $('#themeBtn').title = useLight ? '切換深色背景' : '切換淺色背景';
}

function resize() { const { clientWidth: w, clientHeight: h } = viewer; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); }
addEventListener('resize', resize); resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

function setLoading(title, note) { loadingTitle.textContent = title; loadingNote.textContent = note; loading.classList.remove('hidden'); }
function stopLoading() { loading.classList.add('hidden'); }
function showError(message) { clearTimeout(toastTimer); toast.textContent = message; toast.classList.add('show'); toastTimer = setTimeout(() => toast.classList.remove('show'), 7500); }
function disposeObject(object) {
  object.traverse((item) => {
    item.geometry?.dispose();
    const materials = Array.isArray(item.material) ? item.material : [item.material];
    materials.filter(Boolean).forEach((material) => { Object.values(material).forEach((value) => value?.isTexture && value.dispose()); material.dispose(); });
  });
}
function clearModel() {
  if (!model) return;
  scene.remove(model); disposeObject(model); model = null;
  $('#infoCard').classList.add('hidden'); $('#clearBtn').hidden = true; dropZone.classList.remove('compact');
}
function fitCamera() {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(model); const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 1); const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.35;
  camera.position.copy(sphere.center).add(new THREE.Vector3(1, -1.25, .8).normalize().multiplyScalar(distance));
  camera.near = Math.max(distance / 1000, .001); camera.far = Math.max(distance * 100, 1000); camera.updateProjectionMatrix();
  controls.target.copy(sphere.center); controls.maxDistance = distance * 12; controls.update();
}
function updateHelpers() {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const largestDimension = Math.max(size.x, size.y, size.z, 1);
  const helperScale = Math.max(largestDimension / 100, .01);

  // STEP coordinates are not necessarily centred at the world origin. Keep the
  // grid underneath the imported part and scale both helpers to the model.
  grid.scale.setScalar(helperScale);
  grid.position.set(center.x, center.y, box.min.z - largestDimension * .003);
  axes.scale.setScalar(helperScale);
  axes.position.set(box.min.x, box.min.y, box.min.z);
}
function formatSize(value) { return value >= 1000 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2); }
function qualityParams() {
  return {
    draft: { linearDeflection: .004, angularDeflection: .45 },
    balanced: { linearDeflection: .0015, angularDeflection: .28 },
    fine: { linearDeflection: .00055, angularDeflection: .16 },
    ultra: { linearDeflection: .0002, angularDeflection: .09 },
  }[$('#qualitySelect').value];
}
function buildModel(meshes) {
  const group = new THREE.Group(); let triangles = 0;
  meshes.forEach((source) => {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(source.position, 3));
    if (source.normal) geometry.setAttribute('normal', new THREE.BufferAttribute(source.normal, 3)); else geometry.computeVertexNormals();
    geometry.setIndex(new THREE.BufferAttribute(source.index, 1)); geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ color: source.color ? new THREE.Color(...source.color) : 0xa4c4d7, metalness: .06, roughness: .48, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material); mesh.name = source.name; group.add(mesh); triangles += source.index.length / 3;
  });
  return { group, triangles };
}
function setRenderDensity(triangles) {
  // High-density displays multiply the fragment workload dramatically on large CAD meshes.
  const maxDensity = triangles > 1_000_000 ? 1 : triangles > 250_000 ? 1.4 : 2;
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxDensity));
  resize();
}
function parseInWorker(buffer) {
  return new Promise((resolve, reject) => {
    rejectActiveParse = reject;
    const url = new URL('./vendor/step-worker.js', window.location.href);
    worker = new Worker(url);
    worker.onmessage = ({ data }) => data.type === 'complete' ? resolve(data.meshes) : reject(new Error(data.message));
    worker.onerror = () => reject(new Error('無法載入瀏覽器端 STEP 解析器。請確認網路可取得首次載入的 WASM 檔，或重新整理後再試。'));
    worker.postMessage({ buffer, params: qualityParams() }, [buffer]);
  });
}
async function openFile(file) {
  if (busy || !file) return;
  if (!/\.(stp|step)$/i.test(file.name)) return showError('請選擇副檔名為 .stp 或 .step 的檔案。');
  if (!file.size) return showError('此 STEP 檔案是空白的。');
  busy = true; fileInput.disabled = true; $('#qualitySelect').disabled = true;
  try {
    if (file.size > 100 * 1024 * 1024) showError('大型檔案會使用較多瀏覽器記憶體；解析速度取決於裝置與模型複雜度。');
    setLoading('讀取檔案', '正在從您的裝置讀取檔案，不會上傳。');
    const buffer = await file.arrayBuffer();
    setLoading('解析模型', 'OpenCascade WebAssembly 正在此瀏覽器內解析 STEP。');
    const meshes = await parseInWorker(buffer);
    setLoading('建立幾何', '正在建立 Three.js 模型。');
    clearModel();
    const result = buildModel(meshes); setRenderDensity(result.triangles); model = result.group; scene.add(model); updateHelpers(); fitCamera();
    const dimensions = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    $('#fileName').textContent = file.name; $('#meshes').textContent = meshes.length.toLocaleString(); $('#faces').textContent = Math.floor(result.triangles).toLocaleString();
    $('#size').textContent = `${formatSize(dimensions.x)} × ${formatSize(dimensions.y)} × ${formatSize(dimensions.z)}`;
    $('#infoCard').classList.remove('hidden'); $('#clearBtn').hidden = false; dropZone.classList.add('compact');
    setLoading('完成', '模型已在此裝置建立。'); setTimeout(stopLoading, 350);
  } catch (error) {
    stopLoading();
    const message = /memory|abort|out of/i.test(error?.message) ? '記憶體不足，無法解析此模型。請關閉其他分頁、使用桌面瀏覽器或嘗試較小的檔案。' : (error?.message || 'STEP 解析失敗。');
    showError(message);
  } finally {
    worker?.terminate(); worker = null; rejectActiveParse = null; busy = false; fileInput.disabled = false; $('#qualitySelect').disabled = false; fileInput.value = ''; if (!model) stopLoading();
  }
}
fileInput.addEventListener('change', () => openFile(fileInput.files[0]));
$('#clearBtn').addEventListener('click', clearModel); $('#fitBtn').addEventListener('click', fitCamera); $('#resetBtn').addEventListener('click', fitCamera);
$('#solidBtn').addEventListener('click', () => { model?.traverse((x) => { if (x.isMesh) x.material.wireframe = false; }); $('#solidBtn').classList.add('active'); $('#wireBtn').classList.remove('active'); });
$('#wireBtn').addEventListener('click', () => { model?.traverse((x) => { if (x.isMesh) x.material.wireframe = true; }); $('#wireBtn').classList.add('active'); $('#solidBtn').classList.remove('active'); });
$('#gridBtn').addEventListener('click', () => { grid.visible = !grid.visible; $('#gridBtn').classList.toggle('active', grid.visible); });
$('#axisBtn').addEventListener('click', () => { axes.visible = !axes.visible; $('#axisBtn').classList.toggle('active', axes.visible); });
$('#themeBtn').addEventListener('click', () => setBackgroundTheme(!lightBackground));
$('#hideUiBtn').addEventListener('click', () => document.body.classList.add('ui-hidden'));
$('#showUiBtn').addEventListener('click', () => document.body.classList.remove('ui-hidden'));
$('#cancelLoadBtn').addEventListener('click', () => {
  if (!busy) return;
  worker?.terminate(); worker = null;
  rejectActiveParse?.(new Error('已取消模型解析。'));
});
controls.addEventListener('start', () => { clearTimeout(interactionTimer); document.body.classList.add('interacting'); });
controls.addEventListener('end', () => { clearTimeout(interactionTimer); interactionTimer = setTimeout(() => document.body.classList.remove('interacting'), 280); });
for (const event of ['dragenter', 'dragover']) mainElement.addEventListener(event, (e) => { e.preventDefault(); if (!busy) dropZone.classList.add('dragging'); });
for (const event of ['dragleave', 'drop']) mainElement.addEventListener(event, (e) => { e.preventDefault(); dropZone.classList.remove('dragging'); });
mainElement.addEventListener('drop', (event) => openFile(event.dataTransfer.files[0]));
