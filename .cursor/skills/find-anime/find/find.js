import axios from 'axios';
import * as OpenCC from 'opencc-js';

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const BANGUMI_BASE = 'https://api.bgm.tv';

const toTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' });

async function searchBangumi(rawTitle) {
  const encoded = encodeURIComponent(rawTitle);
  const url = `${BANGUMI_BASE}/search/subject/${encoded}`;
  const { data } = await axios.get(url, { params: { type: 2 } });
  return data?.list ?? data?.results ?? [];
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

async function enrichWithCN(animeList) {
  const results = [];
  for (let i = 0; i < animeList.length; i++) {
    const anime = animeList[i];
    const rawTitle = anime.title_japanese || anime.title;
    process.stdout.write(`\r[${i + 1}/${animeList.length}] 查詢中文名：${rawTitle.slice(0, 30)}`);
    try {
      const hits = await searchBangumi(rawTitle);
      const best = pickBestMatch(rawTitle, hits);
      // #region agent log
      fetch('http://127.0.0.1:7305/ingest/f60ad2c1-a0fb-4a76-8268-046155f48dbe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '451072',
        },
        body: JSON.stringify({
          sessionId: '451072',
          runId: 'pre-fix',
          hypothesisId: 'A',
          location: 'find.js:enrichWithCN',
          message: 'Bangumi match result',
          data: {
            rawTitle,
            name_cn: best?.name_cn ?? null,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion

      const rawNameCn = best?.name_cn?.trim() || null;
      const titleCnTraditional = rawNameCn ? toTraditional(rawNameCn) : null;

      results.push({ ...anime, title_cn: titleCnTraditional });
    } catch {
      results.push({ ...anime, title_cn: null });
    }
    if (i < animeList.length - 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  return results;
}

async function getWinterAnime(year = 2025, season = 'winter') {
  const results = [];
  let page = 1;
  let hasNextPage = true;

  console.log(`\n📺 正在搜尋 ${year} ${season.toUpperCase()} 季動畫...\n`);

  while (hasNextPage) {
    const { data } = await axios.get(`${JIKAN_BASE}/seasons/${year}/${season}`, {
      params: { page, limit: 25 },
    });

    results.push(...data.data);
    hasNextPage = data.pagination?.has_next_page ?? false;
    page++;

    if (hasNextPage) {
      // Jikan API rate limit: 3 requests/second
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  return results;
}

function pad(str, len) {
  const s = String(str);
  // 中文字符佔兩格，計算實際顯示寬度
  let width = 0;
  for (const ch of s) width += ch.codePointAt(0) > 0x7f ? 2 : 1;
  return s + ' '.repeat(Math.max(0, len - width));
}

function printAnimeList(animeList) {
  console.log(`共找到 ${animeList.length} 部動畫\n`);

  const header = `${'名次'.padEnd(4)} ${pad('標題', 36)} ${pad('類型', 8)} ${'評分'.padEnd(6)} 集數`;
  const divider = '─'.repeat(72);

  console.log(header);
  console.log(divider);

  animeList.forEach((anime, index) => {
    const rank  = String(index + 1).padStart(4);
    const title = pad(anime.title_japanese || anime.title, 36);
    const type  = pad(anime.type ?? '未知', 8);
    const score = pad(anime.score ? `⭐ ${anime.score}` : '尚無評分', 8);
    const eps   = anime.episodes ? `${anime.episodes} 集` : '未定';

    console.log(`${rank} ${title} ${type} ${score} ${eps}`);
  });

  console.log(divider);
}

function printAnimeListWithCN(animeList) {
  console.log(`共找到 ${animeList.length} 部動畫\n`);

  const header = `${'名次'.padEnd(4)} ${pad('標題', 36)} ${pad('類型', 8)} ${'評分'.padEnd(6)} 集數`;
  const divider = '─'.repeat(72);

  console.log(header);
  console.log(divider);

  animeList.forEach((anime, index) => {
    const rank  = String(index + 1).padStart(4);
    const chosenTitle = anime.title_cn || anime.title_japanese || anime.title;

    // #region agent log
    if (index < 5) {
      fetch('http://127.0.0.1:7305/ingest/f60ad2c1-a0fb-4a76-8268-046155f48dbe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '451072',
        },
        body: JSON.stringify({
          sessionId: '451072',
          runId: 'pre-fix',
          hypothesisId: 'B',
          location: 'find.js:printAnimeListWithCN',
          message: 'Chosen title for list row',
          data: {
            index,
            title_cn: anime.title_cn ?? null,
            title_japanese: anime.title_japanese ?? null,
            title: anime.title ?? null,
            chosenTitle,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
    // #endregion

    const title = pad(chosenTitle, 36);
    const type  = pad(anime.type ?? '未知', 8);
    const score = pad(anime.score ? `⭐ ${anime.score}` : '尚無評分', 8);
    const eps   = anime.episodes ? `${anime.episodes} 集` : '未定';

    console.log(`${rank} ${title} ${type} ${score} ${eps}`);
  });

  console.log(divider);
}

async function main() {
  const VALID_SEASONS = ['winter', 'spring', 'summer', 'fall'];
  const args = process.argv.slice(2);

  const argYear     = args[0];
  const argSeason   = args[1];
  const argMinScore = args[2];

  const year = argYear && /^\d{4}$/.test(argYear) ? Number(argYear) : 2025;
  const season =
    argSeason && VALID_SEASONS.includes(argSeason.toLowerCase())
      ? argSeason.toLowerCase()
      : 'winter';
  const minScore =
    argMinScore && !isNaN(parseFloat(argMinScore))
      ? parseFloat(argMinScore)
      : 7.70;

  try {
    let animeList = await getWinterAnime(year, season);

    animeList.sort((a, b) => {
      if (a.score == null && b.score == null) return 0;
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
    });

    animeList = animeList.filter((anime) => anime.score != null && anime.score >= minScore);

    console.log(`（篩選：評分 >= ${minScore}）`);
    console.log('🌐 正在查詢中文名稱，請稍候...\n');
    const enriched = await enrichWithCN(animeList);
    printAnimeListWithCN(enriched);
  } catch (err) {
    console.error('❌ 發生錯誤:', err.response?.data ?? err.message);
    process.exit(1);
  }
}

main();
