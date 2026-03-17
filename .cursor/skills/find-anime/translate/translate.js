import axios from 'axios';

const BANGUMI_BASE = 'https://api.bgm.tv';

async function searchBangumi(rawTitle) {
  // 這裡使用 Bangumi 舊版 JSON API 作為範例：
  // GET /search/subject/{keywords}?type=2
  // 部分部署可能需要根據實際文件微調 endpoint
  const encoded = encodeURIComponent(rawTitle);
  const url = `${BANGUMI_BASE}/search/subject/${encoded}`;

  const { data } = await axios.get(url, {
    params: {
      type: 2, // 2 = 動畫
    },
  });

  return data?.list ?? data?.results ?? [];
}

function pickBestMatch(rawTitle, results) {
  if (!Array.isArray(results) || results.length === 0) return null;

  // 優先：有 name_cn 的條目
  const candidates = results.filter((item) => item.name_cn && String(item.name_cn).trim().length > 0);
  const list = candidates.length > 0 ? candidates : results;

  // 簡單相似度規則：
  // 1. 完全相同（忽略空白）
  // 2. 否則依 score / rank 排序
  const normalize = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const target = normalize(rawTitle);

  const exact = list.find(
    (item) => normalize(item.name) === target || normalize(item.name_cn) === target,
  );
  if (exact) return exact;

  // Fallback：根據 score / rank 取最前面一筆
  const sorted = [...list].sort((a, b) => {
    // 有 score 的優先
    const sa = typeof a.score === 'number' ? a.score : -1;
    const sb = typeof b.score === 'number' ? b.score : -1;
    if (sa !== sb) return sb - sa;

    // 其次比 rank（數字越小越前面）
    const ra = typeof a.rank === 'number' ? a.rank : Number.MAX_SAFE_INTEGER;
    const rb = typeof b.rank === 'number' ? b.rank : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });

  return sorted[0] ?? null;
}

function printResult(rawTitle, subject) {
  console.log(`原始名稱：${rawTitle}`);

  if (!subject) {
    console.log('目前在 Bangumi 找不到此作品的中文名稱。');
    return;
  }

  const cn = subject.name_cn || subject.name || rawTitle;
  console.log(`中文名稱：${cn}`);
  console.log('來源：Bangumi');

  if (subject.id != null) {
    console.log(`連結：https://bangumi.tv/subject/${subject.id}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const rawTitle = args.join(' ').trim();

  if (!rawTitle) {
    console.log('\n用法：');
    console.log('  node .cursor/skills/find-anime/translate/translate.js <原始名稱>\n');
    console.log('範例：');
    console.log('  node .cursor/skills/find-anime/translate/translate.js 薫る花は凛と咲く\n');
    process.exit(1);
  }

  try {
    console.log(`\n🔎 正在使用 Bangumi 搜尋：「${rawTitle}」的中文名稱...\n`);
    const results = await searchBangumi(rawTitle);
    const best = pickBestMatch(rawTitle, results);
    printResult(rawTitle, best);
  } catch (err) {
    console.error('❌ 發生錯誤:', err.response?.data ?? err.message);
    process.exit(1);
  }
}

main();

