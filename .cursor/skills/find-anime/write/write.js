import fs from 'fs';
import path from 'path';

function seasonToZh(season) {
  const s = String(season || '').toLowerCase();
  switch (s) {
    case 'winter': return '冬';
    case 'spring': return '春';
    case 'summer': return '夏';
    case 'fall':   return '秋';
    default: return s || '未知';
  }
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y  = date.getFullYear();
  const m  = pad(date.getMonth() + 1);
  const d  = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function loadCache() {
  const cachePath = path.resolve(process.cwd(), 'anime-cache.json');
  if (!fs.existsSync(cachePath)) {
    throw new Error(`找不到 anime-cache.json，請先執行「找動畫」產生暫存（預期路徑：${cachePath}）`);
  }

  const raw = fs.readFileSync(cachePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('anime-cache.json 解析失敗，請確認檔案內容為正確的 JSON。');
  }

  const { year, season, minScore, items } = parsed;
  if (!year || !season || typeof minScore !== 'number' || !Array.isArray(items)) {
    throw new Error('anime-cache.json 結構不完整，缺少 year/season/minScore/items。');
  }

  return { year, season, minScore, items };
}

function buildBatchText({ year, season, minScore, items }) {
  const seasonZh = seasonToZh(season);
  const scoreStr = Number.isFinite(minScore) ? minScore.toFixed(2) : String(minScore);
  const headerLine = `${year}  ${seasonZh}  >${scoreStr}    (更新時間: ${formatTimestamp()})`;

  const lines = [headerLine];

  for (const item of items) {
    const name =
      (item && (item.name_cn || item.title_cn || item.title_japanese || item.title)) || '未命名';
    const scoreVal = item && typeof item.score === 'number' ? item.score : null;
    const score    = scoreVal != null ? scoreVal.toFixed(2) : '-';
    const episodes =
      item && (item.episodes || item.episodes === 0)
        ? String(item.episodes)
        : '未定';
    const type = (item && item.type) || '未知';

    lines.push(`${name}  ${score}  ${episodes}  ${type}`);
  }

  lines.push('------------------------------');

  return lines.join('\n');
}

function saveStacked(targetPath, batchText) {
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  const hasExisting = existing.trim().length > 0;
  const finalText = hasExisting ? `${batchText}\n\n${existing}` : batchText;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, finalText, 'utf8');
}

async function main() {
  try {
    const cache = loadCache();
    const batchText = buildBatchText(cache);

    const targetPath = 'D:/MCPfilesystem/動畫.md';
    saveStacked(targetPath, batchText);

    const seasonZh = seasonToZh(cache.season);
    console.log(`\n✅ 已寫入一批動畫資料到：${targetPath}`);
    console.log(`   來源：${cache.year} ${seasonZh}季，評分門檻 > ${cache.minScore.toFixed(2)}，共 ${cache.items.length} 部`);
  } catch (err) {
    console.error('\n❌ 寫入失敗：', err.message || err);
    process.exit(1);
  }
}

main();
