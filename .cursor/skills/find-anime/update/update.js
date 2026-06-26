import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as OpenCC from 'opencc-js';

// ── Constants ───────────────────────────────────────────────────────
const JIKAN_BASE = 'https://api.jikan.moe/v4';
const BANGUMI_BASE = 'https://api.bgm.tv';
const BANGUMI_REQUEST_DELAY_MS = 300;
const JIKAN_REQUEST_DELAY_MS = 700;
const BANGUMI_CONCURRENCY = 3;
const MAX_RETRIES = 2;
const DEFAULT_MIN_SCORE = 7.70;
const TARGET_PATH = 'D:/GoogleDrive_Sync/動畫.md';

const SEASONS = ['winter', 'spring', 'summer', 'fall'];
const ZH_TO_EN = { 冬: 'winter', 春: 'spring', 夏: 'summer', 秋: 'fall' };
const EN_TO_ZH = { winter: '冬', spring: '春', summer: '夏', fall: '秋' };

const toTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' });

// ── Season helpers ──────────────────────────────────────────────────

/**
 * Convert a month (1-12) to a season index (0-3).
 * winter=0 (Jan-Mar), spring=1 (Apr-Jun), summer=2 (Jul-Sep), fall=3 (Oct-Dec)
 */
function monthToSeasonIndex(month) {
  if (month >= 1 && month <= 3) return 0;
  if (month >= 4 && month <= 6) return 1;
  if (month >= 7 && month <= 9) return 2;
  return 3;
}

/**
 * Get the "previous season" relative to the current date.
 */
function getPreviousSeason(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const currentIdx = monthToSeasonIndex(month);

  if (currentIdx === 0) {
    return { year: year - 1, season: 'fall' };
  }
  return { year, season: SEASONS[currentIdx - 1] };
}

/**
 * Parse the latest season header from 動畫.md.
 * Expected: "2026  冬  >7.70    (更新時間: 2026-03-28 19:06)"
 */
function parseLatestSeason(filePath) {
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).slice(0, 5);

  const re = /^(\d{4})\s+(冬|春|夏|秋)\s+>/;
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      return { year: Number(m[1]), season: ZH_TO_EN[m[2]] };
    }
  }
  return null;
}

function seasonOrd(year, season) {
  return year * 4 + SEASONS.indexOf(season);
}

/**
 * Generate seasons from (startYear, startSeason) exclusive
 * to (endYear, endSeason) inclusive, chronological order.
 */
function getSeasonRange(startYear, startSeason, endYear, endSeason) {
  const startOrd = seasonOrd(startYear, startSeason);
  const endOrd = seasonOrd(endYear, endSeason);
  const result = [];

  for (let ord = startOrd + 1; ord <= endOrd; ord++) {
    const y = Math.floor(ord / 4);
    const s = SEASONS[((ord % 4) + 4) % 4];
    result.push({ year: y, season: s });
  }

  return result;
}

// ── Jikan API (reused from find.js) ─────────────────────────────────

async function getSeasonAnime(year, season) {
  const results = [];
  let page = 1;
  let hasNextPage = true;

  console.log(`\n📺 正在搜尋 ${year} ${season.toUpperCase()} 季動畫...`);

  while (hasNextPage) {
    console.log(`（取得第 ${page} 頁...）`);
    const url = `${JIKAN_BASE}/seasons/${year}/${season}`;
    let lastErr;
    let success = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { data } = await axios.get(url, {
          params: { page, limit: 25 },
        });
        results.push(...data.data);
        hasNextPage = data.pagination?.has_next_page ?? false;
        success = true;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`   ⚠️ 第 ${page} 頁取得失敗 (嘗試 ${attempt + 1}/${MAX_RETRIES + 1}): ${err.message}`);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    }

    if (!success) throw lastErr;
    page++;

    if (hasNextPage) {
      await new Promise((r) => setTimeout(r, JIKAN_REQUEST_DELAY_MS));
    }
  }

  return results;
}

async function getSeasonAnimeFromAniList(year, season) {
  const query = `
    query ($year: Int, $season: MediaSeason, $page: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo {
          hasNextPage
        }
        media(season: $season, seasonYear: $year, type: ANIME) {
          idMal
          title {
            romaji
            english
            native
          }
          episodes
          format
          averageScore
        }
      }
    }
  `;

  const alSeason = season.toUpperCase();
  const results = [];
  let page = 1;
  let hasNext = true;

  console.log(`   [AniList Fallback] 正在從 AniList 獲取 ${year} ${alSeason} 季動畫列表...`);

  while (hasNext) {
    let lastErr;
    let success = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post('https://graphql.anilist.co', {
          query,
          variables: { year, season: alSeason, page }
        });
        const pageData = response.data.data.Page;
        results.push(...pageData.media);
        hasNext = pageData.pageInfo.hasNextPage;
        success = true;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`   [AniList Fallback] 第 ${page} 頁獲取失敗 (${attempt + 1}/${MAX_RETRIES + 1}): ${err.message}`);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    }
    if (!success) throw lastErr;
    page++;
    await new Promise((r) => setTimeout(r, 500));
  }

  // 篩選 averageScore >= 70
  const candidates = results.filter(m => m.idMal && (m.averageScore == null || m.averageScore >= 70));
  console.log(`   [AniList Fallback] 找到 ${results.length} 部動畫，初步篩選出 ${candidates.length} 部評分較高的動畫，開始獲取 Jikan 詳細評分...`);

  const enrichedAnime = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const idMal = candidate.idMal;
    const title = candidate.title.native || candidate.title.romaji || candidate.title.english;

    process.stdout.write(`\r   → [${i + 1}/${candidates.length}] 獲取 MAL 評分：${title.slice(0, 30).padEnd(30)}`);

    let success = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const jikanRes = await axios.get(`${JIKAN_BASE}/anime/${idMal}`);
        const animeData = jikanRes.data.data;
        if (animeData) {
          enrichedAnime.push({
            title: animeData.title,
            title_japanese: animeData.title_japanese,
            score: animeData.score,
            episodes: animeData.episodes,
            type: animeData.type
          });
        }
        success = true;
        break;
      } catch (err) {
        if (err.response?.status === 404) {
          success = true;
          break;
        }
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    await new Promise((r) => setTimeout(r, 700));
  }

  process.stdout.write('\r' + ' '.repeat(80) + '\r');
  console.log(`   [AniList Fallback] 成功獲取 ${enrichedAnime.length} 部動畫的 Jikan 評分資訊`);
  return enrichedAnime;
}

// ── Bangumi enrichment (reused from find.js) ────────────────────────

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

  const candidates = results.filter(
    (item) => item.name_cn && String(item.name_cn).trim().length > 0,
  );
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

// ── Write helpers (reused from write.js) ────────────────────────────

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y  = date.getFullYear();
  const m  = pad(date.getMonth() + 1);
  const d  = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function buildBatchText({ year, season, minScore, items }) {
  const seasonZh = EN_TO_ZH[season] || season;
  const scoreStr = Number.isFinite(minScore) ? minScore.toFixed(2) : String(minScore);
  const headerLine = `${year}  ${seasonZh}  >${scoreStr}    (更新時間: ${formatTimestamp()})`;

  const lines = [headerLine, ''];

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

    lines.push(`- ${name}  **${score}**  (${episodes} · ${type})`);
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

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const now = new Date();
  const prev = getPreviousSeason(now);
  console.log(`\n🕐 當前時間：${now.toISOString().slice(0, 10)}`);
  console.log(`📅 上一季：${prev.year} ${prev.season}`);

  const latest = parseLatestSeason(TARGET_PATH);
  if (latest) {
    console.log(`📄 動畫.md 最新一季：${latest.year} ${latest.season}`);
  } else {
    console.log(`📄 動畫.md 不存在或無法解析，將從上一季開始寫入`);
  }

  // Determine which seasons to fetch
  let seasonsToFetch;
  if (!latest) {
    seasonsToFetch = [prev];
  } else {
    if (seasonOrd(latest.year, latest.season) >= seasonOrd(prev.year, prev.season)) {
      console.log(`\n✅ 動畫.md 已是最新（${latest.year} ${latest.season}），不需更新。`);
      return;
    }
    seasonsToFetch = getSeasonRange(latest.year, latest.season, prev.year, prev.season);
  }

  if (seasonsToFetch.length === 0) {
    console.log(`\n✅ 沒有需要補齊的季度。`);
    return;
  }

  console.log(`\n📋 需要補齊 ${seasonsToFetch.length} 個季度：`);
  seasonsToFetch.forEach((s) => console.log(`   → ${s.year} ${s.season}`));

  // Fetch and write each season (oldest first so stacking puts newest on top)
  for (const { year, season } of seasonsToFetch) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`🔍 正在搜尋 ${year} ${season}...`);

    try {
      // 1. Fetch from Jikan API
      let animeList;
      try {
        animeList = await getSeasonAnime(year, season);
      } catch (err) {
        console.warn(`   ⚠️ Jikan 官方季度 API 獲取失敗 (${err.message || err})，正在切換至 AniList 備用機制...`);
        animeList = await getSeasonAnimeFromAniList(year, season);
      }

      // 2. Sort by score descending
      animeList.sort((a, b) => {
        if (a.score == null && b.score == null) return 0;
        if (a.score == null) return 1;
        if (b.score == null) return -1;
        return b.score - a.score;
      });

      // 3. Filter by min score
      animeList = animeList.filter(
        (anime) => anime.score != null && anime.score >= DEFAULT_MIN_SCORE,
      );

      console.log(`   篩選後：${animeList.length} 部（評分 >= ${DEFAULT_MIN_SCORE}）`);

      if (animeList.length === 0) {
        console.log(`   ⚠️ 無符合條件的動畫，跳過此季`);
        continue;
      }

      // 4. Enrich with Chinese names from Bangumi
      console.log(`   查詢 Bangumi 中文名稱...`);
      const enriched = await enrichWithCN(animeList, (current, total, rawTitle) => {
        process.stdout.write(
          `\r   → [${current}/${total}] 查詢：${rawTitle.slice(0, 30).padEnd(30)}`,
        );
      });
      process.stdout.write('\r' + ' '.repeat(60) + '\r');

      // 5. Build items for batch text
      const items = enriched.map((anime) => ({
        name_cn: anime.title_cn || anime.title_japanese || anime.title || null,
        score: anime.score ?? null,
        episodes: anime.episodes ?? null,
        type: anime.type ?? null,
      }));

      // 6. Build batch text and stack into file
      const batchText = buildBatchText({
        year,
        season,
        minScore: DEFAULT_MIN_SCORE,
        items,
      });
      saveStacked(TARGET_PATH, batchText);

      console.log(`   ✅ ${year} ${season} 已寫入（${items.length} 部）`);
    } catch (err) {
      console.error(`   ❌ ${year} ${season} 處理失敗：${err.message || err}`);
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`\n✅ 全部完成！已補齊 ${seasonsToFetch.length} 個季度到：${TARGET_PATH}`);
}

main().catch((err) => {
  console.error('\n❌ 更新失敗:', err.message || err);
  process.exit(1);
});
