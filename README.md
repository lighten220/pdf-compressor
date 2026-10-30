# PDF 線上壓縮

純靜態網站，PDF 在使用者瀏覽器內以 Ghostscript（WebAssembly）壓縮，檔案不會上傳到伺服器。

## 功能
- 壓縮等級：極限 / 高度 / 推薦 / 輕度 / 自訂（解析度 30–300 DPI、影像品質）
- 指定目標大小（例如 2 MB 以下），自動挑出符合大小且品質最好的結果
- 灰階轉換
- 批次多檔壓縮、ZIP 打包下載
- 壓縮前後大小與節省比例

## 檔案
| 檔案 | 用途 |
| --- | --- |
| `index.html` | 頁面 |
| `style.css` | 樣式（含深色模式） |
| `app.js` | 介面、佇列、目標大小邏輯 |
| `worker.js` | Web Worker，載入 Ghostscript WASM 並執行壓縮 |
| `netlify.toml` | Netlify 設定（不需建置） |

Ghostscript 引擎（約 16 MB）與 JSZip 由 CDN 載入：
`@jspawn/ghostscript-wasm@0.0.2`（jsDelivr）、`jszip@3.10.1`（cdnjs）。

## 部署到 Netlify（GitHub）
1. 把本資料夾的檔案推到 GitHub repo。
2. Netlify → Add new site → Import an existing project → 選 GitHub repo。
3. Build command 留空，Publish directory 填 `.`（`netlify.toml` 已設定），按 Deploy。
之後每次推送到 GitHub 都會自動重新部署。

## 本機測試
```
python -m http.server 8765
```
開啟 http://localhost:8765（Worker 不能用 file:// 直接開啟）。

## 授權注意
Ghostscript 採 AGPL 授權。本網站未修改引擎、僅從 CDN 載入；若要商用或修改引擎請留意 AGPL 條款。
