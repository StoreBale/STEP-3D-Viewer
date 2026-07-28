"""Local STEP/STP 3D viewer.

Run from the project's virtual environment:
    .\.venv\Scripts\python.exe -m pip install -r requirements.txt
    .\.venv\Scripts\python.exe main.py

Then open http://127.0.0.1:8000.
"""

from __future__ import annotations

import html
import os
import re
import tempfile
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Timer
from urllib.parse import parse_qs, urlsplit


IS_CLOUD = bool(os.environ.get("RENDER") or os.environ.get("CI"))
HOST = os.environ.get("HOST", "0.0.0.0" if IS_CLOUD else "127.0.0.1")
# Hosting providers (including Render) supply PORT and retain control of their port.
PORT = int(os.environ.get("PORT", os.environ.get("STEP_VIEWER_PORT", "8000")))
MAX_UPLOAD_MB = max(1, min(int(os.environ.get("MAX_UPLOAD_MB", "200")), 500))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
QUALITY_PRESETS = {
    "draft": (0.004, 0.45),
    "balanced": (0.0015, 0.28),
    "fine": (0.00055, 0.16),
    "ultra": (0.0002, 0.09),
}


INDEX_HTML = r"""<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>STEP 3D Viewer</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #090d12;
      --panel: rgba(18, 25, 34, .88);
      --panel-2: #121a24;
      --line: rgba(255,255,255,.11);
      --text: #eef4fb;
      --muted: #8d9bab;
      --accent: #68e2c2;
      --accent-2: #42a5f5;
      --danger: #ff7b87;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body {
      background:
        radial-gradient(circle at 15% 10%, rgba(66,165,245,.11), transparent 28%),
        radial-gradient(circle at 85% 80%, rgba(104,226,194,.08), transparent 26%),
        var(--bg);
      color: var(--text);
      font-family: Inter, "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif;
    }
    button, input, select { font: inherit; }
    .app {
      display: grid; grid-template-rows: 68px 1fr; width: 100%; height: 100%;
      transition: grid-template-rows .18s;
    }
    @supports (height: 100dvh) { .app { height: 100dvh; } }
    header {
      z-index: 10; display: flex; align-items: center; justify-content: space-between;
      padding: 0 22px; border-bottom: 1px solid var(--line);
      background: rgba(9,13,18,.75); backdrop-filter: blur(16px);
    }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .brand-mark {
      display: grid; place-items: center; width: 38px; height: 38px; border-radius: 11px;
      color: #07120f; background: linear-gradient(135deg, var(--accent), #a4f6df);
      box-shadow: 0 0 30px rgba(104,226,194,.18);
    }
    .brand-mark svg { width: 22px; height: 22px; }
    .brand h1 { margin: 0; font-size: 16px; letter-spacing: .02em; }
    .brand p { margin: 2px 0 0; color: var(--muted); font-size: 11px; }
    .header-actions { display: flex; align-items: center; gap: 9px; }
    .quality-control {
      display: flex; align-items: center; gap: 7px; height: 38px; padding: 0 8px 0 11px;
      border: 1px solid var(--line); border-radius: 10px; color: var(--muted);
      background: rgba(255,255,255,.04); font-size: 11px;
    }
    .quality-control select {
      max-width: 92px; border: 0; outline: 0; color: var(--text); background: var(--panel-2);
      cursor: pointer;
    }
    .button {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      min-height: 38px; padding: 0 14px; border: 1px solid var(--line); border-radius: 10px;
      color: var(--text); background: rgba(255,255,255,.045); cursor: pointer;
      transition: transform .15s, border-color .15s, background .15s;
    }
    .button:hover { border-color: rgba(104,226,194,.45); background: rgba(104,226,194,.08); }
    .button:active { transform: translateY(1px); }
    .button.primary { color: #06130f; border: 0; font-weight: 700; background: var(--accent); }
    .button.primary:hover { background: #84ebd0; }
    .button svg { width: 16px; height: 16px; }
    #fileInput { display: none; }
    main { position: relative; min-height: 0; }
    #viewer { position: absolute; inset: 0; }
    #viewer canvas {
      display: block; width: 100%; height: 100%; outline: none;
      touch-action: none; -webkit-user-select: none; user-select: none;
    }
    .toolbar {
      position: absolute; z-index: 4; top: 18px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 4px; padding: 5px; border: 1px solid var(--line);
      border-radius: 12px; background: var(--panel); backdrop-filter: blur(15px);
      box-shadow: 0 12px 35px rgba(0,0,0,.22);
    }
    .tool {
      width: 38px; height: 34px; padding: 0; border: 0; border-radius: 8px;
      color: var(--muted); background: transparent; cursor: pointer;
    }
    .tool:hover, .tool.active { color: var(--text); background: rgba(255,255,255,.08); }
    .tool.active { color: var(--accent); }
    .tool svg { width: 17px; height: 17px; vertical-align: middle; }
    .divider { width: 1px; margin: 5px 2px; background: var(--line); }
    .info-card {
      position: absolute; z-index: 4; left: 18px; bottom: 18px; width: min(310px, calc(100% - 36px));
      padding: 15px; border: 1px solid var(--line); border-radius: 14px;
      background: var(--panel); backdrop-filter: blur(15px);
      box-shadow: 0 12px 40px rgba(0,0,0,.22);
      transition: opacity .2s, transform .2s;
    }
    .info-card.hidden { pointer-events: none; opacity: 0; transform: translateY(8px); }
    .file-line { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .file-icon {
      display: grid; flex: 0 0 auto; place-items: center; width: 34px; height: 34px;
      border-radius: 9px; color: var(--accent); background: rgba(104,226,194,.1);
    }
    .file-name { overflow: hidden; font-size: 13px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .file-state { margin-top: 2px; color: var(--muted); font-size: 11px; }
    .stats {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
      margin-top: 13px; padding-top: 13px; border-top: 1px solid var(--line);
    }
    .stat span { display: block; color: var(--muted); font-size: 10px; text-transform: uppercase; }
    .stat strong { display: block; overflow: hidden; margin-top: 4px; font-size: 12px; text-overflow: ellipsis; }
    .help {
      position: absolute; z-index: 3; right: 18px; bottom: 18px; padding: 10px 12px;
      border: 1px solid var(--line); border-radius: 10px; color: var(--muted);
      background: rgba(12,17,23,.72); font-size: 11px; backdrop-filter: blur(10px);
    }
    .drop-zone {
      position: absolute; z-index: 5; inset: 50% auto auto 50%; width: min(520px, calc(100% - 38px));
      padding: 42px 26px; transform: translate(-50%, -50%);
      border: 1px dashed rgba(104,226,194,.38); border-radius: 20px;
      background: rgba(16,23,31,.62); text-align: center; backdrop-filter: blur(10px);
      transition: border-color .2s, background .2s, transform .2s, opacity .2s;
    }
    .drop-zone.compact { pointer-events: none; opacity: 0; transform: translate(-50%, -48%); }
    .drop-zone.dragging {
      border-color: var(--accent); background: rgba(104,226,194,.09);
      transform: translate(-50%, -50%) scale(1.015);
    }
    .upload-orbit {
      display: grid; place-items: center; width: 70px; height: 70px; margin: 0 auto 18px;
      border: 1px solid rgba(104,226,194,.25); border-radius: 50%; color: var(--accent);
      background: rgba(104,226,194,.08); box-shadow: inset 0 0 25px rgba(104,226,194,.05);
    }
    .upload-orbit svg { width: 28px; height: 28px; }
    .drop-zone h2 { margin: 0 0 8px; font-size: 21px; }
    .drop-zone p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.65; }
    .drop-zone .button { margin-top: 20px; }
    .drop-zone small { display: block; margin-top: 13px; color: #647181; }
    .loading {
      position: absolute; z-index: 8; inset: 0; display: grid; place-items: center;
      background: rgba(7,10,14,.54); backdrop-filter: blur(5px);
      transition: opacity .2s;
    }
    .loading.hidden { pointer-events: none; opacity: 0; }
    .loading-box { width: min(330px, calc(100% - 38px)); text-align: center; }
    .loader {
      width: 34px; height: 34px; margin: 0 auto 15px; border: 2px solid rgba(255,255,255,.13);
      border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite;
    }
    .loading-title { font-size: 14px; font-weight: 650; }
    .loading-note { margin-top: 6px; color: var(--muted); font-size: 11px; }
    .progress { height: 3px; margin-top: 15px; overflow: hidden; border-radius: 3px; background: rgba(255,255,255,.08); }
    .progress i { display: block; width: 38%; height: 100%; background: var(--accent); animation: progress 1.3s ease-in-out infinite; }
    .toast {
      position: absolute; z-index: 20; top: 18px; right: 18px; max-width: min(390px, calc(100% - 36px));
      padding: 12px 15px; border: 1px solid rgba(255,123,135,.38); border-radius: 11px;
      color: #ffd7db; background: rgba(71,24,31,.94); font-size: 12px;
      box-shadow: 0 12px 35px rgba(0,0,0,.3); opacity: 0; transform: translateY(-8px);
      pointer-events: none; transition: opacity .2s, transform .2s;
    }
    .toast.show { opacity: 1; transform: none; }
    .ui-peek {
      position: absolute; z-index: 30; top: max(13px, env(safe-area-inset-top)); right: 13px;
      display: none; width: 42px; height: 42px; padding: 0; border: 1px solid var(--line);
      border-radius: 12px; color: var(--accent); background: var(--panel);
      box-shadow: 0 10px 30px rgba(0,0,0,.28); backdrop-filter: blur(12px); cursor: pointer;
    }
    .ui-peek svg { width: 18px; height: 18px; }
    header, .toolbar, .info-card, .help, .drop-zone {
      transition: opacity .18s, transform .18s;
    }
    body.interacting header, body.interacting .toolbar, body.interacting .info-card,
    body.interacting .help, body.interacting .drop-zone,
    body.ui-hidden header, body.ui-hidden .toolbar, body.ui-hidden .info-card,
    body.ui-hidden .help, body.ui-hidden .drop-zone {
      pointer-events: none; opacity: 0;
    }
    body.interacting header, body.ui-hidden header { transform: translateY(-10px); }
    body.interacting .toolbar, body.ui-hidden .toolbar { transform: translate(-50%, -8px); }
    body.interacting .info-card, body.ui-hidden .info-card { transform: translateY(8px); }
    body.ui-hidden .ui-peek { display: grid; place-items: center; pointer-events: auto; opacity: 1; }
    body.ui-hidden .app { grid-template-rows: 0 1fr; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes progress { 0% { transform: translateX(-110%); } 100% { transform: translateX(270%); } }
    @media (max-width: 620px) {
      .app { grid-template-rows: calc(62px + env(safe-area-inset-top)) 1fr; }
      header { padding: env(safe-area-inset-top) 10px 0; }
      .brand p, .header-actions .desktop-label, .quality-control > span, .help { display: none; }
      .brand { gap: 8px; }
      .brand-mark { width: 34px; height: 34px; }
      .brand h1 { font-size: 13px; }
      .button { padding: 0 11px; }
      .quality-control { padding: 0 7px; }
      .quality-control select { width: 72px; font-size: 11px; }
      .toolbar { top: 10px; max-width: calc(100% - 18px); }
      .tool { width: 36px; }
      .info-card {
        left: 10px; bottom: max(10px, env(safe-area-inset-bottom));
        width: min(300px, calc(100% - 20px)); padding: 12px;
      }
      .drop-zone { padding: 30px 18px; }
      .drop-zone h2 { font-size: 18px; }
      .drop-zone p br { display: none; }
    }
    @media (max-width: 400px) {
      .header-actions { gap: 5px; }
      .brand h1, .upload-label { display: none; }
      .button { min-width: 38px; padding: 0 10px; }
    }
  </style>
  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.167.1/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.167.1/examples/jsm/"
    }
  }
  </script>
</head>
<body>
  <div class="app">
    <header>
      <div class="brand">
        <div class="brand-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z"/><path d="m4 6.5 8 4.5 8-4.5M12 11v9"/>
          </svg>
        </div>
        <div><h1>STEP 3D Viewer</h1><p>互動式 CAD 模型檢視器</p></div>
      </div>
      <div class="header-actions">
        <label class="quality-control" title="曲面三角化精細度">
          <span>精細度</span>
          <select id="qualitySelect">
            <option value="draft">快速</option>
            <option value="balanced">標準</option>
            <option value="fine" selected>精細</option>
            <option value="ultra">極致</option>
          </select>
        </label>
        <button class="button" id="clearBtn" hidden title="關閉目前模型">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-3h4l1 3m3 0-1 14H7L6 7"/></svg>
          <span class="desktop-label">關閉</span>
        </button>
        <label class="button primary" for="fileInput">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4m0 0L7 9m5-5 5 5M4 15v5h16v-5"/></svg>
          <span class="upload-label">開啟模型</span>
        </label>
        <input id="fileInput" type="file" accept=".stp,.step">
      </div>
    </header>
    <main id="main">
      <div id="viewer"></div>
      <div class="toolbar">
        <button class="tool active" id="solidBtn" title="實體顯示">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z"/><path d="m4 6.5 8 4.5 8-4.5M12 11v9"/></svg>
        </button>
        <button class="tool" id="wireBtn" title="線框顯示">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2ZM4 6.5l8 4.5 8-4.5M12 11v9M4 15.5l8-4.5 8 4.5M12 2v9"/></svg>
        </button>
        <div class="divider"></div>
        <button class="tool active" id="gridBtn" title="顯示格線">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7h18M3 12h18M3 17h18M7 3v18m5-18v18m5-18v18"/></svg>
        </button>
        <button class="tool active" id="axisBtn" title="顯示座標軸">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 19 19 5M5 19V7m0 12h12"/><path d="m15 5 4 0 0 4"/></svg>
        </button>
        <button class="tool" id="themeBtn" title="切換淺色背景">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>
        </button>
        <div class="divider"></div>
        <button class="tool" id="fitBtn" title="重設視角">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5"/></svg>
        </button>
        <button class="tool" id="hideUiBtn" title="隱藏介面">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/><path d="m4 4 16 16"/></svg>
        </button>
      </div>
      <section class="drop-zone" id="dropZone">
        <div class="upload-orbit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 3 7 4v8l-7 4-7-4V7l7-4Z"/><path d="m5 7 7 4 7-4m-7 4v8"/></svg>
        </div>
        <h2>把 STEP 模型拖到這裡</h2>
        <p>伺服器會將 CAD 曲面轉成可即時顯示的 3D 網格<br>原始模型只會暫存處理，完成後立即刪除</p>
        <label class="button primary" for="fileInput">選擇 .stp / .step 檔案</label>
        <small>單一檔案上限 {{MAX_UPLOAD_MB}} MB</small>
      </section>
      <section class="info-card hidden" id="infoCard">
        <div class="file-line">
          <div class="file-icon">3D</div>
          <div style="min-width:0"><div class="file-name" id="fileName">—</div><div class="file-state">模型已載入</div></div>
        </div>
        <div class="stats">
          <div class="stat"><span>三角面</span><strong id="faces">—</strong></div>
          <div class="stat"><span>頂點</span><strong id="vertices">—</strong></div>
          <div class="stat"><span>尺寸 XYZ</span><strong id="size">—</strong></div>
        </div>
      </section>
      <div class="help">左鍵旋轉 · 右鍵平移 · 滾輪縮放</div>
      <div class="loading hidden" id="loading">
        <div class="loading-box">
          <div class="loader"></div>
          <div class="loading-title">正在解析 STEP 幾何…</div>
          <div class="loading-note">大型或複雜模型可能需要一點時間</div>
          <div class="progress"><i></i></div>
        </div>
      </div>
      <div class="toast" id="toast"></div>
      <button class="ui-peek" id="showUiBtn" title="顯示介面">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>
      </button>
    </main>
  </div>

  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

    const viewer = document.querySelector('#viewer');
    const main = document.querySelector('#main');
    const dropZone = document.querySelector('#dropZone');
    const fileInput = document.querySelector('#fileInput');
    const loading = document.querySelector('#loading');
    const infoCard = document.querySelector('#infoCard');
    const toast = document.querySelector('#toast');
    const solidBtn = document.querySelector('#solidBtn');
    const wireBtn = document.querySelector('#wireBtn');
    const gridBtn = document.querySelector('#gridBtn');
    const axisBtn = document.querySelector('#axisBtn');
    const themeBtn = document.querySelector('#themeBtn');
    const qualitySelect = document.querySelector('#qualitySelect');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d12);
    scene.fog = new THREE.FogExp2(0x090d12, 0.00055);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
    camera.up.set(0, 0, 1);
    camera.position.set(80, -110, 75);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    viewer.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .07;
    controls.screenSpacePanning = true;

    // Ground and fill lights make recessed and underside faces readable.
    const hemi = new THREE.HemisphereLight(0xd9ecff, 0x5f7892, 2.35);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(4, -5, 8);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6de4c6, 2.0);
    rim.position.set(-5, 2, 3);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xbfd9ff, 1.7);
    fill.position.set(-3, 4, -6);
    scene.add(fill);

    const grid = new THREE.GridHelper(200, 20, 0x35536a, 0x1c2a35);
    grid.rotation.x = Math.PI / 2;
    grid.material.transparent = true;
    grid.material.opacity = .55;
    scene.add(grid);
    const axes = new THREE.AxesHelper(25);
    scene.add(axes);

    let lightBackground = false;
    function setBackgroundTheme(useLight) {
      lightBackground = useLight;
      const palette = useLight
        ? { background: 0xe7edf3, fog: 0xe7edf3, gridMajor: 0x8da4b7, gridMinor: 0xc6d3de, sky: 0xffffff, ground: 0xaabccb, key: 2.8, rim: 1.35, fill: 2.4, exposure: 1.16 }
        : { background: 0x090d12, fog: 0x090d12, gridMajor: 0x35536a, gridMinor: 0x1c2a35, sky: 0xd9ecff, ground: 0x5f7892, key: 3.2, rim: 2.0, fill: 1.7, exposure: 1.08 };
      scene.background.setHex(palette.background);
      scene.fog.color.setHex(palette.fog);
      const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
      gridMaterials[0].color.setHex(palette.gridMajor);
      gridMaterials[1]?.color.setHex(palette.gridMinor);
      hemi.color.setHex(palette.sky);
      hemi.groundColor.setHex(palette.ground);
      key.intensity = palette.key;
      rim.intensity = palette.rim;
      fill.intensity = palette.fill;
      renderer.toneMappingExposure = palette.exposure;
      themeBtn.classList.toggle('active', useLight);
      themeBtn.title = useLight ? '切換深色背景' : '切換淺色背景';
    }

    let model = null;
    let modelSize = 100;
    let toastTimer = null;
    let interactionTimer = null;

    function resize() {
      const w = viewer.clientWidth, h = viewer.clientHeight;
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }
    new ResizeObserver(resize).observe(viewer);
    function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    function showError(message) {
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('show'), 6000);
    }

    function clearModel() {
      if (model) {
        scene.remove(model);
        const geometries = new Set(), materials = new Set(), textures = new Set();
        model.traverse(object => {
          if (object.geometry) geometries.add(object.geometry);
          const list = Array.isArray(object.material) ? object.material : [object.material];
          for (const mat of list) {
            if (!mat) continue;
            materials.add(mat);
            for (const value of Object.values(mat)) {
              if (value && value.isTexture) textures.add(value);
            }
          }
        });
        geometries.forEach(item => item.dispose());
        materials.forEach(item => item.dispose());
        textures.forEach(item => item.dispose());
        model = null;
      }
      infoCard.classList.add('hidden');
      dropZone.classList.remove('compact');
      document.querySelector('#clearBtn').hidden = true;
      fileInput.value = '';
    }

    function fitCamera() {
      if (!model) return;
      const box = new THREE.Box3().setFromObject(model);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const distance = (sphere.radius / Math.sin(fov / 2)) * 1.15;
      const direction = new THREE.Vector3(1, -1.25, .8).normalize();
      camera.position.copy(sphere.center).addScaledVector(direction, distance);
      camera.near = Math.max(distance / 1000, .001);
      camera.far = Math.max(distance * 100, 1000);
      camera.updateProjectionMatrix();
      controls.target.copy(sphere.center);
      controls.maxDistance = distance * 10;
      controls.update();
    }

    function updateHelpers(size) {
      modelSize = size;
      grid.scale.setScalar(Math.max(size / 100, .01));
      // Keep the floor just below the model to prevent z-fighting at its base.
      grid.position.z = -Math.max(size * .003, .01);
      axes.scale.setScalar(Math.max(size / 100, .01));
    }

    async function openFile(file) {
      if (!file) return;
      if (!/\.(stp|step)$/i.test(file.name)) {
        showError('請選擇副檔名為 .stp 或 .step 的檔案。');
        return;
      }
      const maxUploadMb = Number('{{MAX_UPLOAD_MB}}');
      if (file.size > maxUploadMb * 1024 * 1024) {
        showError(`檔案超過 ${maxUploadMb} MB 上限。`);
        return;
      }
      loading.classList.remove('hidden');
      const form = new FormData();
      form.append('model', file);
      try {
        const quality = encodeURIComponent(qualitySelect.value);
        const response = await fetch(`/api/convert?quality=${quality}`, { method: 'POST', body: form });
        if (!response.ok) {
          let detail = await response.text();
          try { detail = JSON.parse(detail).error || detail; } catch (_) {}
          throw new Error(detail || `伺服器錯誤 ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        const gltf = await new GLTFLoader().parseAsync(buffer, '');
        if (model) clearModel();
        model = gltf.scene;
        model.rotation.x = Math.PI / 2;
        model.updateMatrixWorld(true);
        let box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.x -= center.x;
        model.position.y -= center.y;
        model.position.z -= box.min.z;
        model.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(model);
        const dims = box.getSize(new THREE.Vector3());
        let vertices = 0, faces = 0;
        model.traverse(object => {
          if (!object.isMesh || !object.geometry) return;
          object.castShadow = true;
          object.receiveShadow = true;
          const position = object.geometry.attributes.position;
          if (position) vertices += position.count;
          faces += object.geometry.index
            ? object.geometry.index.count / 3
            : (position ? position.count / 3 : 0);
          const list = Array.isArray(object.material) ? object.material : [object.material];
          for (const mat of list) {
            if (mat) {
              mat.side = THREE.DoubleSide;
              mat.needsUpdate = true;
            }
          }
        });
        scene.add(model);
        updateHelpers(Math.max(dims.x, dims.y, dims.z));
        fitCamera();

        document.querySelector('#fileName').textContent = file.name;
        document.querySelector('#faces').textContent = Math.floor(faces).toLocaleString();
        document.querySelector('#vertices').textContent = vertices.toLocaleString();
        const fmt = n => n >= 1000 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
        document.querySelector('#size').textContent = `${fmt(dims.x)} × ${fmt(dims.y)} × ${fmt(dims.z)}`;
        infoCard.classList.remove('hidden');
        dropZone.classList.add('compact');
        document.querySelector('#clearBtn').hidden = false;
      } catch (error) {
        showError(error.message || '模型載入失敗。');
      } finally {
        loading.classList.add('hidden');
        fileInput.value = '';
      }
    }

    fileInput.addEventListener('change', () => openFile(fileInput.files[0]));
    document.querySelector('#clearBtn').addEventListener('click', clearModel);
    document.querySelector('#fitBtn').addEventListener('click', fitCamera);
    solidBtn.addEventListener('click', () => {
      if (model) model.traverse(object => {
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach(mat => { if (mat) { mat.wireframe = false; mat.needsUpdate = true; } });
      });
      solidBtn.classList.add('active'); wireBtn.classList.remove('active');
    });
    wireBtn.addEventListener('click', () => {
      if (model) model.traverse(object => {
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach(mat => { if (mat) { mat.wireframe = true; mat.needsUpdate = true; } });
      });
      wireBtn.classList.add('active'); solidBtn.classList.remove('active');
    });
    gridBtn.addEventListener('click', () => {
      grid.visible = !grid.visible; gridBtn.classList.toggle('active', grid.visible);
    });
    axisBtn.addEventListener('click', () => {
      axes.visible = !axes.visible; axisBtn.classList.toggle('active', axes.visible);
    });
    themeBtn.addEventListener('click', () => setBackgroundTheme(!lightBackground));
    document.querySelector('#hideUiBtn').addEventListener('click', () => {
      document.body.classList.add('ui-hidden');
    });
    document.querySelector('#showUiBtn').addEventListener('click', () => {
      document.body.classList.remove('ui-hidden');
    });
    controls.addEventListener('start', () => {
      clearTimeout(interactionTimer);
      document.body.classList.add('interacting');
    });
    controls.addEventListener('end', () => {
      clearTimeout(interactionTimer);
      interactionTimer = setTimeout(() => document.body.classList.remove('interacting'), 280);
    });

    for (const event of ['dragenter', 'dragover']) {
      main.addEventListener(event, e => {
        e.preventDefault(); dropZone.classList.add('dragging'); dropZone.classList.remove('compact');
      });
    }
    for (const event of ['dragleave', 'drop']) {
      main.addEventListener(event, e => {
        e.preventDefault(); dropZone.classList.remove('dragging');
        if (model) dropZone.classList.add('compact');
      });
    }
    main.addEventListener('drop', e => openFile(e.dataTransfer.files[0]));
  </script>
</body>
</html>
"""


class RequestError(Exception):
    """An error safe to return to the browser."""


def _extract_upload(content_type: str, body: bytes) -> tuple[str, bytes]:
    """Extract the `model` part from a small multipart/form-data request."""
    boundary_match = re.search(r"boundary=(?:\"([^\"]+)\"|([^;]+))", content_type)
    if not boundary_match:
        raise RequestError("上傳格式不正確（缺少 multipart boundary）。")

    boundary = (boundary_match.group(1) or boundary_match.group(2)).strip().encode("ascii", "ignore")
    if not boundary or len(boundary) > 200:
        raise RequestError("上傳格式不正確。")

    marker = b"--" + boundary
    for part in body.split(marker):
        part = part.strip(b"\r\n")
        if not part or part == b"--":
            continue
        header_blob, separator, data = part.partition(b"\r\n\r\n")
        if not separator:
            continue
        headers = header_blob.decode("utf-8", "replace")
        if 'name="model"' not in headers:
            continue
        name_match = re.search(r'filename="([^"]*)"', headers, re.IGNORECASE)
        filename = name_match.group(1) if name_match else "model.step"
        filename = Path(filename.replace("\\", "/")).name
        if data.endswith(b"\r\n"):
            data = data[:-2]
        if data.endswith(b"--"):
            data = data[:-2].rstrip(b"\r\n")
        return filename, data
    raise RequestError("找不到上傳的模型檔案。")


def _step_to_glb(step_data: bytes, suffix: str, quality: str = "fine") -> bytes:
    """Read STEP colors/assembly data with XCAF and export a meshed binary glTF."""
    try:
        from OCP.Bnd import Bnd_Box
        from OCP.BRepBndLib import BRepBndLib
        from OCP.BRepMesh import BRepMesh_IncrementalMesh
        from OCP.Message import Message_ProgressRange
        from OCP.RWGltf import RWGltf_CafWriter
        from OCP.STEPCAFControl import STEPCAFControl_Reader
        from OCP.TCollection import TCollection_AsciiString, TCollection_ExtendedString
        from OCP.TColStd import TColStd_IndexedDataMapOfStringString
        from OCP.TDocStd import TDocStd_Document
        from OCP.XCAFDoc import XCAFDoc_DocumentTool
    except ImportError as exc:
        raise RequestError(
            "尚未安裝 CadQuery。請關閉伺服器後，在 .venv 中執行："
            "python -m pip install -r requirements.txt"
        ) from exc

    with tempfile.TemporaryDirectory(prefix="step-viewer-") as temp_dir:
        input_path = Path(temp_dir) / f"input{suffix}"
        output_path = Path(temp_dir) / "model.glb"
        input_path.write_bytes(step_data)
        try:
            document = TDocStd_Document(TCollection_ExtendedString("BinXCAF"))
            reader = STEPCAFControl_Reader()
            reader.SetColorMode(True)
            reader.SetNameMode(True)
            reader.SetLayerMode(True)
            reader.SetPropsMode(True)
            if not reader.Perform(str(input_path), document):
                raise ValueError("OpenCascade 無法讀取這個 STEP 檔案")

            shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())
            shape = shape_tool.GetOneShape()
            if shape.IsNull():
                raise ValueError("STEP 檔案中沒有可顯示的實體")

            bounds = Bnd_Box()
            BRepBndLib.Add_s(shape, bounds)
            x_min, y_min, z_min, x_max, y_max, z_max = bounds.Get()
            diagonal = (
                (x_max - x_min) ** 2
                + (y_max - y_min) ** 2
                + (z_max - z_min) ** 2
            ) ** 0.5
            relative_deflection, angular_deflection = QUALITY_PRESETS.get(
                quality, QUALITY_PRESETS["fine"]
            )
            linear_deflection = max(diagonal * relative_deflection, 1e-6)

            mesher = BRepMesh_IncrementalMesh(
                shape,
                linear_deflection,
                False,
                angular_deflection,
                True,
            )
            mesher.Perform()
            if not mesher.IsDone():
                raise ValueError("曲面三角化失敗")

            writer = RWGltf_CafWriter(TCollection_AsciiString(str(output_path)), True)
            writer.SetParallel(True)
            writer.SetMergeFaces(False)
            file_info = TColStd_IndexedDataMapOfStringString()
            if not writer.Perform(document, file_info, Message_ProgressRange()):
                raise ValueError("GLB 輸出失敗")
            return output_path.read_bytes()
        except Exception as exc:
            raise RequestError(f"STEP 解析失敗：{exc}") from exc


class StepViewerHandler(BaseHTTPRequestHandler):
    server_version = "StepViewer/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[STEP Viewer] {self.address_string()} - {fmt % args}")

    def _send(self, status: int, data: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def _send_error_text(self, status: int, message: str) -> None:
        safe_message = html.escape(message, quote=False).encode("utf-8")
        self._send(status, safe_message, "text/plain; charset=utf-8")

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            page = INDEX_HTML.replace("{{MAX_UPLOAD_MB}}", str(MAX_UPLOAD_MB))
            self._send(HTTPStatus.OK, page.encode("utf-8"), "text/html; charset=utf-8")
        elif path == "/api/health":
            self._send(HTTPStatus.OK, b'{"ok":true}', "application/json; charset=utf-8")
        else:
            self._send_error_text(HTTPStatus.NOT_FOUND, "找不到頁面。")

    def do_POST(self) -> None:  # noqa: N802
        request_url = urlsplit(self.path)
        if request_url.path != "/api/convert":
            self._send_error_text(HTTPStatus.NOT_FOUND, "找不到 API。")
            return

        try:
            quality = parse_qs(request_url.query).get("quality", ["fine"])[0]
            if quality not in QUALITY_PRESETS:
                raise RequestError("未知的精細度設定。")
            content_type = self.headers.get("Content-Type", "")
            if not content_type.lower().startswith("multipart/form-data"):
                raise RequestError("請使用 multipart/form-data 上傳檔案。")

            raw_length = self.headers.get("Content-Length")
            if raw_length is None:
                raise RequestError("缺少 Content-Length。")
            content_length = int(raw_length)
            if content_length <= 0:
                raise RequestError("上傳內容是空的。")
            if content_length > MAX_UPLOAD_BYTES + 1024 * 1024:
                self._send_error_text(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    f"檔案超過 {MAX_UPLOAD_MB} MB 上限。",
                )
                return

            filename, step_data = _extract_upload(content_type, self.rfile.read(content_length))
            suffix = Path(filename).suffix.lower()
            if suffix not in {".stp", ".step"}:
                raise RequestError("只接受 .stp 或 .step 檔案。")
            if not step_data:
                raise RequestError("上傳的檔案是空的。")
            if len(step_data) > MAX_UPLOAD_BYTES:
                self._send_error_text(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    f"檔案超過 {MAX_UPLOAD_MB} MB 上限。",
                )
                return

            glb_data = _step_to_glb(step_data, suffix, quality)
            self._send(HTTPStatus.OK, glb_data, "model/gltf-binary")
        except RequestError as exc:
            self._send_error_text(HTTPStatus.BAD_REQUEST, str(exc))
        except (ValueError, OverflowError):
            self._send_error_text(HTTPStatus.BAD_REQUEST, "上傳資料格式不正確。")
        except Exception as exc:
            print(f"[STEP Viewer] Unexpected error: {exc!r}")
            self._send_error_text(HTTPStatus.INTERNAL_SERVER_ERROR, "伺服器發生未預期的錯誤。")


class StepViewerServer(ThreadingHTTPServer):
    """Permit an immediate restart after the previous local server exits."""

    allow_reuse_address = True


def main() -> None:
    try:
        server = StepViewerServer((HOST, PORT), StepViewerHandler)
    except OSError as exc:
        if exc.errno in {48, 98, 10013, 10048}:
            raise SystemExit(
                f"Port {PORT} is already in use. Stop the previous Python process "
                f"or start with STEP_VIEWER_PORT=<another port>."
            ) from exc
        raise
    url = f"http://{HOST}:{PORT}"
    print("STEP 3D Viewer 已啟動")
    print(f"請開啟：{url}")
    print("按 Ctrl+C 停止伺服器")
    if not IS_CLOUD and os.environ.get("STEP_VIEWER_NO_BROWSER") != "1":
        Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n伺服器已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
