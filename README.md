# STEP 3D Viewer

使用 Python、CadQuery/OpenCascade 與 Three.js，在瀏覽器中互動查看
`.stp` / `.step` 3D 模型。

## 功能

- 拖放或選擇 STEP/STP 檔案
- 讀取 STEP/XCAF 的零件及曲面原色，轉換成帶材質的 GLB
- 快速、標準、精細、極致四段曲面三角化精細度
- 旋轉、平移、縮放與自動置中
- 實體／線框模式
- 格線、座標軸、模型尺寸與網格統計
- 操作模型時自動隱藏介面，也可手動切換沉浸檢視
- 支援手機觸控、動態視窗高度與安全區域
- 原始檔案僅在暫存目錄中轉換，完成後自動刪除

## 使用 `.venv` 在本機執行

Windows PowerShell：

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python main.py
```

如果 PowerShell 不允許執行啟用腳本，不需要修改系統設定，直接使用：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe main.py
```

瀏覽器會開啟 <http://127.0.0.1:8000>。

## 部署到 Render

本專案包含 `Dockerfile` 與 `render.yaml`，可以直接從 GitHub 建立 Render
Blueprint：

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/StoreBale/STEP-3D-Viewer)

1. 將專案推送到 GitHub。
2. 登入 [Render](https://dashboard.render.com/)。
3. 選擇 **New → Blueprint**。
4. 連接 GitHub repository，Render 會讀取 `render.yaml` 並建立服務。
5. 部署完成後使用 Render 提供的 `onrender.com` 網址。

每次推送到預設分支，Render 都會自動重新建置與部署。

> 雲端預設限制單檔 50 MB，可在 Render 的 `MAX_UPLOAD_MB` 環境變數調整。
> 「極致」精細度及複雜 STEP 模型的記憶體需求較高，雲端環境可能需要升級執行個體。

## 環境變數

| 名稱 | 預設值 | 說明 |
| --- | --- | --- |
| `HOST` | 本機 `127.0.0.1`、雲端 `0.0.0.0` | 監聽位址 |
| `PORT` | `8000` | HTTP 連接埠；Render 會自動提供 |
| `MAX_UPLOAD_MB` | 本機 `200` | 單一模型上傳限制 |
| `STEP_VIEWER_NO_BROWSER` | `0` | 設為 `1` 時不自動開啟瀏覽器 |

首次載入頁面需要網路連線，以取得 Three.js 前端模組。
