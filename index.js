import axios from 'axios';

const JIKAN_BASE = 'https://api.jikan.moe/v4';

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

async function main() {
  const VALID_SEASONS = ['winter', 'spring', 'summer', 'fall'];
  const argYear    = process.argv[2];
  const argSeason  = process.argv[3];
  const argMinScore = process.argv[4];

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

    // Sort by score descending, unscored at the end
    animeList.sort((a, b) => {
      if (a.score == null && b.score == null) return 0;
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
    });

    animeList = animeList.filter((anime) => anime.score != null && anime.score >= minScore);

    console.log(`（篩選：評分 >= ${minScore}）`);
    printAnimeList(animeList);
  } catch (err) {
    console.error('❌ 發生錯誤:', err.response?.data ?? err.message);
    process.exit(1);
  }
}

main();
