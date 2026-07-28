# STEP 3D Viewer

一個完全在瀏覽器中執行的 STEP/STP 3D 檢視器。選取的 CAD 檔案只會留在使用者的裝置；網站不提供上傳 API、後端、Pages Functions、Workers 或 R2。

## 架構

| 原本 | 現在 |
| --- | --- |
| Python `main.py` + CadQuery/OpenCascade | Vite 靜態網站 + `occt-import-js` WebAssembly |
| 瀏覽器上傳 STEP 到 Render `/api/convert` | 檔案以 `ArrayBuffer` 交給本機 Web Worker |
| Render Docker Web Service 轉成 GLB | Worker 內的 OpenCascade WASM 產生 Three.js geometry |
| 50 MB 伺服器端上傳限制 | 沒有固定檔案大小拒絕限制；取決於裝置記憶體與模型複雜度 |

`occt-import-js` 是成熟的 OpenCascade 匯入 WASM 封裝，原生支援 STEP，輸出網格結構與 Three.js 相容；解析會在 Worker 中進行，避免長時間阻塞介面。它的 WASM 約 7.6 MB，低於 Cloudflare Pages 的單一靜態資產 25 MiB 限制。

## 本機開發

需求：Node.js 20 或更新版本。

```powershell
npm install
npm run dev
```

開啟終端顯示的本機網址。正式建置與預覽：

```powershell
npm run build
npm run preview
```

`npm run build` 會把 OpenCascade 的 JavaScript 與 WASM 靜態資產複製到 `dist/vendor/`。第一次開啟網站需要下載 WASM；下載完成並被瀏覽器快取後，即使離線仍可對本機 STEP 檔案進行處理。清除快取或第一次離線開啟時，WASM 無法載入是預期行為。

## Cloudflare Pages

在 Cloudflare Dashboard 選擇 **Workers & Pages → Create application → Pages → Connect to Git**，連結此 GitHub repository，並填寫：

| 設定 | 值 |
| --- | --- |
| Framework preset | `Vite`（或 `None`，使用下方指令） |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js version | `20`（建議） |
| Environment variables | 不需要 |

每次推送到 `main`，Cloudflare Pages 都會建立新的部署。這是純靜態網站，沒有機密環境變數、付費 API 或 server-side code。Vite 使用相對 `base`，因此 Pages 的正式網址與 preview 網址皆會使用正確的 Worker/WASM 路徑；單頁首頁重新整理也會回傳靜態 `index.html`。

## 隱私、效能與限制

- 網頁只會從 Cloudflare 靜態資產下載前端程式與 WASM。選取 STEP 後，程式未呼叫 `fetch`、XHR 或 form upload，也沒有 `/api/convert`。
- 解析時以 Transferable `ArrayBuffer` 把檔案交給 Worker；完成或失敗後 Worker 都會終止，替換模型也會釋放舊 geometry、material 與 texture。
- 大型或複雜的模型可能耗用大量 RAM；建議桌面版 Chrome 或 Edge。大型檔案會顯示效能提醒而不是以固定大小拒絕。
- `occt-import-js` 依其 LGPL-2.1 授權發佈；發佈時請保留其套件附帶的授權檔。
- Repository 未包含可自由發布的 STEP 測試檔。請自行提供授權允許的 `.stp`/`.step` 檔案驗證模型結果。
