---
name: find-anime
description: 搜尋指定年份與季節的動畫列表，透過 Jikan API 回傳結果。當使用者說「找動畫」、「搜尋動畫」、「查動畫」、「動畫列表」或詢問某一季的動畫時自動觸發。Searches seasonal anime via Jikan API. Use when user says 找動畫, 搜尋動畫, or asks about seasonal anime.
---

# 找動畫 (Seasonal Anime Search)

## 專案位置

`d:\練習\spiderMAL`

## 執行指令

```bash
node index.js [年份] [季節]
```

- **季節**可填：`winter`（冬）、`spring`（春）、`summer`（夏）、`fall`（秋）
- 省略參數時預設為 **2025 winter**

## 使用流程

1. 判斷使用者是否有指定年份或季節
   - 有指定 → 帶入對應參數
   - 未指定 → 使用預設值（2025 winter）
2. 在 `d:\練習\spiderMAL` 目錄執行指令
3. 將輸出結果顯示給使用者

## 季節對應

| 使用者說 | season 參數 |
|---------|-------------|
| 冬季 / winter / 冬天 | `winter` |
| 春季 / spring / 春天 | `spring` |
| 夏季 / summer / 夏天 | `summer` |
| 秋季 / fall / 秋天   | `fall`   |

## 範例

| 使用者輸入 | 執行指令 |
|-----------|---------|
| 找動畫 | `node index.js` |
| 找 2024 春季動畫 | `node index.js 2024 spring` |
| 搜尋 2025 秋天的動畫 | `node index.js 2025 fall` |
| 幫我查 2023 夏季動畫 | `node index.js 2023 summer` |
