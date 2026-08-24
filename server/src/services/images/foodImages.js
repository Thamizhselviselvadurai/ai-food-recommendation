import { env } from '../../config/env.js';

/**
 * ---------------------------------------------------------------------------
 * Real dish photography — Wikimedia Commons via the MediaWiki API.
 * ---------------------------------------------------------------------------
 * These are genuine photographs taken by people, CC-licensed for reuse with
 * attribution. Nothing here is AI-generated, and nothing is a random stock
 * image: each dish maps to the encyclopedia article for that exact dish, so a
 * Masala Dosa photo is a photo of masala dosa.
 *
 * Keyless. Resolved once at seed time and stored on the FoodItem, so runtime
 * requests never depend on an external service. If a lookup fails, `imageUrl`
 * stays empty and the UI renders its emoji tile instead.
 *
 * To use a different source (Unsplash, Pexels, your own photography), replace
 * `resolveFoodImages` — the rest of the app only reads `FoodItem.imageUrl`.
 * ---------------------------------------------------------------------------
 */

const API = 'https://en.wikipedia.org/w/api.php';

/** dish key -> the Wikipedia article whose lead image shows that dish. */
export const DISH_ARTICLE = {
  idli: 'Idli', plain_dosa: 'Dosa (food)', masala_dosa: 'Masala dosa',
  ghee_pongal: 'Pongal (dish)', medu_vada: 'Vada (food)', uttapam: 'Uttapam',
  upma: 'Upma', poori: 'Puri (food)', curd_rice: 'Curd rice', lemon_rice: 'Lemon rice',
  // "Rasam" is a disambiguation-style page with no lead image; "Rasam (dish)"
  // is the food article and does carry one.
  veg_meals: 'Thali', sambar_rice: 'Sambar (dish)', rasam_rice: 'Rasam (dish)',
  kothu_parotta: 'Kothu parotta', chicken_kothu: 'Kothu parotta', parotta_salna: 'Parotta',

  chicken_biryani: 'Chicken biryani', mutton_biryani: 'Biryani', veg_biryani: 'Biryani',
  egg_biryani: 'Biryani', chettinad_chicken: 'Chettinad cuisine', chicken_65: 'Chicken 65',
  fish_fry: 'Fish fry', nattu_kozhi_soup: 'Chicken soup',

  paneer_butter_masala: 'Shahi paneer', butter_chicken: 'Butter chicken',
  dal_makhani: 'Dal makhani', butter_roti: 'Roti', butter_naan: 'Naan',
  chole_bhature: 'Chole bhature', rajma_chawal: 'Rajma', paneer_tikka: 'Paneer tikka',
  tandoori_chicken: 'Tandoori chicken', aloo_paratha: 'Aloo paratha', veg_pulao: 'Pilaf',

  veg_fried_rice: 'Fried rice', paneer_fried_rice: 'Fried rice', chicken_fried_rice: 'Fried rice',
  veg_noodles: 'Chow mein', schezwan_noodles: 'Chow mein', chilli_paneer: 'Paneer',
  chilli_chicken: 'Chilli chicken', gobi_manchurian: 'Gobi manchurian',
  hot_sour_soup: 'Hot and sour soup', sweet_corn_soup: 'Corn soup',
  veg_momos: 'Momo (food)', chicken_momos: 'Momo (food)',

  margherita_pizza: 'Pizza Margherita', farmhouse_pizza: 'Pizza', chicken_pizza: 'Pizza',
  white_sauce_pasta: 'Pasta', arrabbiata_pasta: 'Arrabbiata sauce', garlic_bread: 'Garlic bread',

  grilled_chicken_salad: 'Chicken salad', quinoa_bowl: 'Quinoa', greek_salad: 'Greek salad',
  sprout_salad: 'Sprouting', oats_bowl: 'Oatmeal', fruit_bowl: 'Fruit salad',
  veg_sandwich: 'Sandwich', chicken_sandwich: 'Chicken sandwich',
  paneer_wrap: 'Kati roll', chicken_wrap: 'Kati roll',

  chicken_shawarma: 'Shawarma', falafel_wrap: 'Falafel', alfaham: 'Shish taouk',

  pani_puri: 'Panipuri', samosa: 'Samosa', veg_puff: 'Curry puff', egg_puff: 'Curry puff',
  masala_maggi: 'Maggi', bajji: 'Bhaji',

  filter_coffee: 'Indian filter coffee', masala_tea: 'Masala chai', buttermilk: 'Chaas',
  lime_soda: 'Lemonade', tender_coconut: 'Coconut water', watermelon_juice: 'Watermelon',
  mango_shake: 'Mango lassi', cold_coffee: 'Iced coffee', badam_milk: 'Almond milk',
  green_tea: 'Green tea',

  gulab_jamun: 'Gulab jamun', brownie: 'Chocolate brownie', ice_cream: 'Ice cream',
  payasam: 'Payasam',
};

async function fetchBatch(titles, { thumbSize = 800, timeoutMs = 15000 } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: String(thumbSize),
    redirects: '1',
    origin: '*',
    titles: titles.join('|'),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API}?${params}`, {
      headers: { 'User-Agent': 'FoodAI/1.0 (open-source food discovery demo)' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const byTitle = new Map();

    // `redirects` and `normalized` let us map the resolved page back to the
    // title we asked for — otherwise "Dosa (food)" would not match its page.
    const alias = new Map();
    for (const entry of data.query?.normalized ?? []) alias.set(entry.to, entry.from);
    for (const entry of data.query?.redirects ?? []) alias.set(entry.to, alias.get(entry.from) ?? entry.from);

    for (const page of data.query?.pages ?? []) {
      if (!page.thumbnail?.source) continue;
      const requested = alias.get(page.title) ?? page.title;
      byTitle.set(requested, page.thumbnail.source);
    }
    return byTitle;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolves photos for a list of dish keys.
 * Returns a Map of dishKey -> { imageUrl, imageAttribution }.
 * Never throws — a failure just means fewer photos.
 */
export async function resolveFoodImages(dishKeys, { onProgress } = {}) {
  const results = new Map();
  if (!env.FOOD_IMAGES_ENABLED) return results;

  const wanted = [...new Set(dishKeys)].filter((key) => DISH_ARTICLE[key]);
  const titles = [...new Set(wanted.map((key) => DISH_ARTICLE[key]))];

  const titleToUrl = new Map();
  const BATCH = 40; // MediaWiki allows 50 titles per request

  for (let i = 0; i < titles.length; i += BATCH) {
    const slice = titles.slice(i, i + BATCH);
    try {
      const batch = await fetchBatch(slice);
      for (const [title, url] of batch) titleToUrl.set(title, url);
      onProgress?.(Math.min(i + BATCH, titles.length), titles.length);
    } catch (error) {
      console.warn(`[images] batch failed (${slice.length} titles): ${error.message}`);
    }
  }

  for (const key of wanted) {
    const url = titleToUrl.get(DISH_ARTICLE[key]);
    if (url) {
      results.set(key, {
        imageUrl: url,
        imageAttribution: `Photo: Wikimedia Commons — ${DISH_ARTICLE[key]} (CC)`,
      });
    }
  }

  return results;
}
