# SillyTavern ClinePass 路由監察

一個純監察的 SillyTavern 前端擴充，用來查看 `cline-pass/*` 回應所報告的最終下游服務商（Provider）。

介面使用 SillyTavern 原生抽屜、輸入框、按鈕與主題變數，會自動跟隨你目前的主題、美化 CSS、字體與顏色。手機和電腦版都可使用。

## 能做甚麼

擴充會讀取完成回應的副本，尋找 Cline／Vercel 類型的路由欄位：

- `finalProvider`
- `resolvedProvider`
- `totalProviderAttemptCount`
- Provider 嘗試記錄

它會把觀察到的最終服務商與你設定的預期代號比較，顯示「服務商符合」、「服務商不符」或「無法判斷」。

## 安全範圍

這個擴充只負責觀察：

- 不增加或覆寫任何請求參數。
- 不重試、取消、延遲或替換生成。
- 不讀取或儲存 API Key。
- 原始 `Response` 會原封不動交回 SillyTavern。

回應副本會在串流結束後非同步檢查，不影響正常逐字顯示。

## 從 SillyTavern 安裝

1. 打開「擴充功能」。
2. 選擇「安裝擴充功能」。
3. 貼上 `https://github.com/meowings20000/sillytavern-clinepass-provider-monitor.git`。
4. 選擇安裝給目前使用者或所有使用者。
5. 如果沒有立即看到面板，重新整理 SillyTavern。

安裝完成後，可在擴充設定中找到「ClinePass 路由監察」。

## 使用方法

1. 開啟「ClinePass 路由監察」。
2. 勾選「啟用路由監察」。
3. 把「預期服務商代號」設為你想確認的精確代號，例如 `moonshotai`。
4. 使用 `cline-pass/kimi-k3` 等 `cline-pass/*` 模型正常生成。
5. 等待串流結束，查看最近一次監察結果。

瀏覽器開發者工具的 Console 也會輸出完整路由物件。

## 結果解釋

- **服務商符合**：回應 metadata 中的最終服務商與預期代號一致。
- **服務商不符**：回應 metadata 顯示實際使用了另一個服務商。
- **無法判斷**：沒有可確認的 `finalProvider` 或 `resolvedProvider` 傳到 SillyTavern。

「無法判斷」不代表一定沒有使用 Moonshot。New API 等 OpenAI 相容轉發服務可能消耗或移除上游 metadata；此時前端擴充不會根據模型名稱或文字內容猜測服務商。

## 相容範圍

- SillyTavern 1.18.0 或更新版本
- 經由 `/api/backends/chat-completions/generate` 發出的 Chat Completion 請求
- 名稱以 `cline-pass/` 開頭的模型，不分大小寫
- SSE 串流與非串流 JSON 回應

## 開發檢查

```powershell
npm test
npm run check
```

沒有執行階段套件依賴，也不需要編譯。
