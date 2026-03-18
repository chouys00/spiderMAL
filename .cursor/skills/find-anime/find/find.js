import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as OpenCC from 'opencc-js';

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const BANGUMI_BASE = 'https://api.bgm.tv';

const BANGUMI_REQUEST_DELAY_MS = 300;
const JIKAN_REQUEST_DELAY_MS = 700;
const BANGUMI_CONCURRENCY = 3;
const DEFAULT_MIN_SCORE = 7.70;
const COL_TITLE_WIDTH = 36;
const COL_TYPE_WIDTH = 8;
const COL_SCORE_WIDTH = 8;
const TABLE_WIDTH = 72;
const MAX_RETRIES = 2;

const toTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' });

function logStep(step, total, message) {
  console.log(`[${step}/${total}] ${message}`);
}

async function searchBangumi(rawTitle) {
  const encoded = encodeURIComponent(rawTitle);
  const url = `${BANGUMI_BASE}/search/subject/${encoded}`;
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data } = await axios.get(url, { params: { type: 2 } });
      return data?.list ?? data?.results ?? [];
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

function pickBestMatch(rawTitle, results) {
  if (!Array.isArray(results) || results.length === 0) return null;

  const candidates = results.filter((item) => item.name_cn && String(item.name_cn).trim().length > 0);
  const list = candidates.length > 0 ? candidates : results;

  const normalize = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const target = normalize(rawTitle);

  const exact = list.find(
    (item) => normalize(item.name) === target || normalize(item.name_cn) === target,
  );
  if (exact) return exact;

  const sorted = [...list].sort((a, b) => {
    const sa = typeof a.score === 'number' ? a.score : -1;
    const sb = typeof b.score === 'number' ? b.score : -1;
    if (sa !== sb) return sb - sa;
    const ra = typeof a.rank === 'number' ? a.rank : Number.MAX_SAFE_INTEGER;
    const rb = typeof b.rank === 'number' ? b.rank : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });

  return sorted[0] ?? null;
}

async function enrichWithCN(animeList, onProgress) {
  const results = [];
  const total = animeList.length;

  for (let i = 0; i < animeList.length; i += BANGUMI_CONCURRENCY) {
    const batch = animeList.slice(i, i + BANGUMI_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (anime, batchIndex) => {
        const index = i + batchIndex;
        const rawTitle = anime.title_japanese || anime.title;
        onProgress?.(index + 1, total, rawTitle);
        try {
          const hits = await searchBangumi(rawTitle);
          const best = pickBestMatch(rawTitle, hits);
          const rawNameCn = best?.name_cn?.trim() || null;
          const titleCnTraditional = rawNameCn ? toTraditional(rawNameCn) : null;
          return { ...anime, title_cn: titleCnTraditional };
        } catch {
          return { ...anime, title_cn: null };
        }
      }),
    );
    results.push(...batchResults);
    if (i + BANGUMI_CONCURRENCY < animeList.length) {
      await new Promise((r) => setTimeout(r, BANGUMI_REQUEST_DELAY_MS));
    }
  }

  return results;
}

async function getSeasonAnime(year = 2025, season = 'winter') {
  const results = [];
  let page = 1;
  let hasNextPage = true;

  console.log(`\n📺 正在搜尋 ${year} ${season.toUpperCase()} 季動畫...`);

  while (hasNextPage) {
    console.log(`（取得第 ${page} 頁...）`);
    const { data } = await axios.get(`${JIKAN_BASE}/seasons/${year}/${season}`, {
      params: { page, limit: 25 },
    });

    results.push(...data.data);
    hasNextPage = data.pagination?.has_next_page ?? false;
    page++;

    if (hasNextPage) {
      await new Promise((r) => setTimeout(r, JIKAN_REQUEST_DELAY_MS));
    }
  }

  return results;
}

function getDisplayWidth(s) {
  let width = 0;
  for (const ch of String(s)) width += ch.codePointAt(0) > 0x7f ? 2 : 1;
  return width;
}

function pad(str, len) {
  const s = String(str);
  return s + ' '.repeat(Math.max(0, len - getDisplayWidth(s)));
}

function printAnimeList(animeList, useCn = true) {
  console.log(`共找到 ${animeList.length} 部動畫\n`);

  const header = `${'名次'.padEnd(4)} ${pad('標題', COL_TITLE_WIDTH)} ${pad('類型', COL_TYPE_WIDTH)} ${'評分'.padEnd(6)} 集數`;
  const divider = '─'.repeat(TABLE_WIDTH);

  console.log(header);
  console.log(divider);

  animeList.forEach((anime, index) => {
    const rank = String(index + 1).padStart(4);
    const chosenTitle = useCn
      ? anime.title_cn || anime.title_japanese || anime.title
      : anime.title_japanese || anime.title;
    const title = pad(chosenTitle, COL_TITLE_WIDTH);
    const type = pad(anime.type ?? '未知', COL_TYPE_WIDTH);
    const score = pad(anime.score ? `⭐ ${anime.score}` : '尚無評分', COL_SCORE_WIDTH);
    const eps = anime.episodes ? `${anime.episodes} 集` : '未定';

    console.log(`${rank} ${title} ${type} ${score} ${eps}`);
  });

  console.log(divider);
}

function saveCache({ year, season, minScore, items }) {
  try {
    const cachePath = path.resolve(process.cwd(), 'anime-cache.json');
    const payload = { year, season, minScore, items };
    fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`暫存檔已寫入：${cachePath}`);
  } catch (err) {
    console.warn('\n⚠️  暫存檔寫入失敗:', err.message);
  }
}

async function main() {
  const TOTAL_STEPS = 6;
  const VALID_SEASONS = ['winter', 'spring', 'summer', 'fall'];
  const args = process.argv.slice(2);

  const argYear = args[0];
  const argSeason = args[1];
  const argMinScore = args[2];

  const year = argYear && /^\d{4}$/.test(argYear) ? Number(argYear) : 2025;
  const season =
    argSeason && VALID_SEASONS.includes(argSeason.toLowerCase())
      ? argSeason.toLowerCase()
      : 'winter';
  const minScore =
    argMinScore && !isNaN(parseFloat(argMinScore))
      ? parseFloat(argMinScore)
      : DEFAULT_MIN_SCORE;

  try {
    logStep(1, TOTAL_STEPS, `解析參數：${year} ${season}，評分 >= ${minScore}\n`);

    logStep(2, TOTAL_STEPS, '正在從 Jikan 取得季節動畫...');
    let animeList = await getSeasonAnime(year, season);

    animeList.sort((a, b) => {
      if (a.score == null && b.score == null) return 0;
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
    });

    animeList = animeList.filter((anime) => anime.score != null && anime.score >= minScore);

    logStep(3, TOTAL_STEPS, `取得 ${animeList.length} 部，依評分排序並篩選...（篩選：評分 >= ${minScore}）\n`);

    logStep(4, TOTAL_STEPS, `查詢 Bangumi 中文名稱 (${animeList.length} 部)...`);
    const enriched = await enrichWithCN(animeList, (current, total, rawTitle) => {
      process.stdout.write(`\r  → [${current}/${total}] 查詢：${rawTitle.slice(0, 30).padEnd(30)}`);
    });
    process.stdout.write('\r' + ' '.repeat(60) + '\r');

    logStep(5, TOTAL_STEPS, '輸出清單');
    printAnimeList(enriched, true);

    const items = enriched.map((anime) => ({
      name_cn: anime.title_cn || anime.title_japanese || anime.title || null,
      score: anime.score ?? null,
      episodes: anime.episodes ?? null,
      type: anime.type ?? null,
    }));

    logStep(6, TOTAL_STEPS, '寫入暫存檔');
    saveCache({ year, season, minScore, items });

    console.log('\n✓ 完成');
  } catch (err) {
    console.error('❌ 發生錯誤:', err.response?.data ?? err.message);
    process.exit(1);
  }
}

main();
