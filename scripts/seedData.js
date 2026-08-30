#!/usr/bin/env node
/**
 * seedData.js
 *
 * Seeds the database with Arabic tech dummy data:
 *   categories → subcategories → brands → products
 *
 * - Loads the correct environment file (mirrors backend/server.js):
 *     .env.production  when NODE_ENV=production
 *     .env.development otherwise
 * - Connects inline to MongoDB (does NOT import connectdb.js or server.js).
 * - Wipes the four collections (products → subcategories → brands → categories)
 *   then re-inserts in dependency order.
 * - Uploads images to Cloudinary once and caches the resulting URLs in
 *   seed-image-cache.json so re-runs are fast and orphan-free. If Cloudinary
 *   is not configured, the source image URLs are used directly.
 *
 * Usage:
 *   npm run seed                                    # development
 *   NODE_ENV=production npm run seed -- --force     # production (destructive!)
 */

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

// Load the correct environment file FIRST — the Cloudinary config reads env
// vars at require time, so it must run before requiring ../config/cloudinary.
const envFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development";

dotenv.config({ path: path.resolve(__dirname, "..", envFile) });

const { cloudinary } = require("../config/cloudinary");

const Category = require("../models/categoryModel");
const Subcategory = require("../models/subCategoryModel");
const Brand = require("../models/brandModel");
const Product = require("../models/productModel");

const mongoURI =
  process.env.MONGO_DB_URI || "mongodb://localhost:27017/my-e-commerce";

const CACHE_FILE = path.join(__dirname, "seed-image-cache.json");

// npm swallows a bare `--dry-run` after `npm run seed` (it treats it as its own
// option), so also support SEED_DRY_RUN=true. Run directly with
// `node scripts/seedData.js --dry-run` if you prefer the flag.
const isDryRun =
  process.argv.includes("--dry-run") || process.env.SEED_DRY_RUN === "true";

// Refuse to wipe a production database unless --force is passed.
if (
  process.env.NODE_ENV === "production" &&
  !process.argv.includes("--force")
) {
  console.error(
    "Refusing to wipe the database in production. Re-run with --force to override."
  );
  process.exit(1);
}

// ====================================
// Image helpers
// ====================================
// photo IDs already include the `photo-` prefix, so just prepend the base URL.
const u = (photoId) =>
  `https://images.unsplash.com/${photoId}?w=600&q=80&auto=format&fit=crop`;

const cloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);

let imageCache = {};
if (fs.existsSync(CACHE_FILE)) {
  try {
    imageCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    imageCache = {};
  }
}

/**
 * Upload an image to Cloudinary (or return the source URL when Cloudinary is
 * not configured). Results are cached by folder+source so re-runs are fast.
 */
async function ensureImage(srcUrl, folder) {
  const key = `${folder}:${srcUrl}`;
  if (imageCache[key]) return imageCache[key];

  if (!cloudinaryConfigured) {
    console.warn(
      `  ⚠ Cloudinary not configured — using source URL for ${folder}`
    );
    imageCache[key] = srcUrl;
    return srcUrl;
  }

  const upload = async (source) =>
    cloudinary.uploader.upload(source, {
      folder,
      allowed_formats: ["jpg", "jpeg", "png", "webp"],
      transformation: [
        { width: 600, height: 600, crop: "limit", quality: "auto" },
      ],
    });

  try {
    const res = await upload(srcUrl);
    imageCache[key] = res.secure_url;
  } catch (err) {
    console.warn(
      `  ⚠ upload failed for ${srcUrl} (${err.message}) — using placeholder`
    );
    const fallback = `https://picsum.photos/seed/${encodeURIComponent(
      folder
    )}-${encodeURIComponent(srcUrl)}/600/600`;
    const res = await upload(fallback);
    imageCache[key] = res.secure_url;
  }
  return imageCache[key];
}

// ====================================
// Data — Arabic tech dummy data
// ====================================

// Short keys → Arabic names (keeps the product rows compact)
const CAT = {
  phones: "الهواتف والأجهزة اللوحية",
  laptops: "الحواسيب المحمولة والمكتبية",
  audio: "الصوتيات والسماعات",
  wearables: "الساعات الذكية والأجهزة القابلة للارتداء",
  gaming: "الألعاب",
  accessories: "الإكسسوارات",
  smartHome: "المنزل الذكي",
  monitors: "الشاشات",
};

const SUB = {
  smartphones: "هواتف ذكية",
  tablets: "أجهزة لوحية",
  laptops: "حواسيب محمولة",
  desktopPcs: "حواسيب مكتبية",
  headphones: "سماعات رأس",
  earbuds: "سماعات أذن",
  speakers: "مكبرات صوت",
  smartwatches: "ساعات ذكية",
  fitnessTrackers: "أجهزة تتبع اللياقة",
  gamingConsoles: "أجهزة الألعاب",
  videoGames: "ألعاب الفيديو",
  gamingAccessories: "ملحقات الألعاب",
  chargersCables: "شواحن وكوابل",
  casesCovers: "حقائب وأغطية",
  keyboardsMice: "لوحات مفاتيح وفئران",
  smartSpeakers: "مكبرات ذكية",
  securityCameras: "كاميرات مراقبة",
  smartLighting: "إضاءة ذكية",
  computerMonitors: "شاشات حاسوب",
  tvs: "تلفزيونات",
};

const BRAND = {
  samsung: "سامسونج",
  apple: "آبل",
  xiaomi: "شاومي",
  huawei: "هواوي",
  hp: "إتش بي",
  dell: "ديل",
  lenovo: "لينوفو",
  asus: "آسوس",
  sony: "سوني",
  jbl: "جي بي إل",
  microsoft: "مايكروسوفت",
  logitech: "لوجيتك",
};

const categories = [
  {
    name: CAT.phones,
    slug: "phones-tablets",
    image: u("photo-1511707171634-5f897ff02aa9"),
  },
  {
    name: CAT.laptops,
    slug: "laptops-computers",
    image: u("photo-1496181133206-80ce9b88a853"),
  },
  {
    name: CAT.audio,
    slug: "audio-headphones",
    image: u("photo-1505740420928-5e560c06d30e"),
  },
  {
    name: CAT.wearables,
    slug: "wearables-smartwatches",
    image: u("photo-1523275335684-37898b6baf30"),
  },
  {
    name: CAT.gaming,
    slug: "gaming",
    image: u("photo-1550745165-9bc0b252726f"),
  },
  {
    name: CAT.accessories,
    slug: "accessories",
    image: u("photo-1587829741301-dc798b83add3"),
  },
  {
    name: CAT.smartHome,
    slug: "smart-home",
    image: u("photo-1558002038-1055907df827"),
  },
  {
    name: CAT.monitors,
    slug: "monitors-displays",
    image: u("photo-1546435770-a3e426bf472b"),
  },
];

const subcategories = [
  { name: SUB.smartphones, slug: "smartphones", category: "phones" },
  { name: SUB.tablets, slug: "tablets", category: "phones" },
  { name: SUB.laptops, slug: "laptops", category: "laptops" },
  { name: SUB.desktopPcs, slug: "desktop-pcs", category: "laptops" },
  { name: SUB.headphones, slug: "headphones", category: "audio" },
  { name: SUB.earbuds, slug: "earbuds", category: "audio" },
  { name: SUB.speakers, slug: "speakers", category: "audio" },
  { name: SUB.smartwatches, slug: "smartwatches", category: "wearables" },
  { name: SUB.fitnessTrackers, slug: "fitness-trackers", category: "wearables" },
  { name: SUB.gamingConsoles, slug: "gaming-consoles", category: "gaming" },
  { name: SUB.videoGames, slug: "video-games", category: "gaming" },
  { name: SUB.gamingAccessories, slug: "gaming-accessories", category: "gaming" },
  { name: SUB.chargersCables, slug: "chargers-cables", category: "accessories" },
  { name: SUB.casesCovers, slug: "cases-covers", category: "accessories" },
  { name: SUB.keyboardsMice, slug: "keyboards-mice", category: "accessories" },
  { name: SUB.smartSpeakers, slug: "smart-speakers", category: "smartHome" },
  { name: SUB.securityCameras, slug: "security-cameras", category: "smartHome" },
  { name: SUB.smartLighting, slug: "smart-lighting", category: "smartHome" },
  { name: SUB.computerMonitors, slug: "computer-monitors", category: "monitors" },
  { name: SUB.tvs, slug: "tvs", category: "monitors" },
];

const brands = [
  { name: BRAND.samsung, slug: "samsung", image: u("photo-1610945265064-0e34e5519bbf") },
  { name: BRAND.apple, slug: "apple", image: u("photo-1517336714731-489689fd1ca8") },
  { name: BRAND.xiaomi, slug: "xiaomi", image: u("photo-1512499617640-c74ae3a79d37") },
  { name: BRAND.huawei, slug: "huawei", image: u("photo-1580910051074-3eb694886505") },
  { name: BRAND.hp, slug: "hp", image: u("photo-1588872657578-7efd1f1555ed") },
  { name: BRAND.dell, slug: "dell", image: u("photo-1593642632823-8f785ba67e45") },
  { name: BRAND.lenovo, slug: "lenovo", image: u("photo-1531297484001-80022131f5a1") },
  { name: BRAND.asus, slug: "asus", image: u("photo-1587202372775-e229f172b9d7") },
  { name: BRAND.sony, slug: "sony", image: u("photo-1593359677879-a4bb92f829d1") },
  { name: BRAND.jbl, slug: "jbl", image: u("photo-1608043152269-423dbba4e7e1") },
  { name: BRAND.microsoft, slug: "microsoft", image: u("photo-1618424181497-157f25b6ddd5") },
  { name: BRAND.logitech, slug: "logitech", image: u("photo-1618384887929-16ec33fab9ef") },
];

// Per-category image pools — products rotate through them (no manual URLs).
const IMAGE_POOLS = {
  phones: [
    u("photo-1511707171634-5f897ff02aa9"),
    u("photo-1592899677977-9c10ca588bbd"),
    u("photo-1580910051074-3eb694886505"),
    u("photo-1512499617640-c74ae3a79d37"),
  ],
  laptops: [
    u("photo-1496181133206-80ce9b88a853"),
    u("photo-1593642632823-8f785ba67e45"),
    u("photo-1531297484001-80022131f5a1"),
    u("photo-1517336714731-489689fd1ca8"),
  ],
  audio: [
    u("photo-1505740420928-5e560c06d30e"),
    u("photo-1583394838336-acd977736f90"),
    u("photo-1524678606370-a47ad25cb82a"),
    u("photo-1608043152269-423dbba4e7e1"),
  ],
  wearables: [
    u("photo-1523275335684-37898b6baf30"),
    u("photo-1546868871-7041f2a55e12"),
    u("photo-1579586337278-3befd40fd17a"),
  ],
  gaming: [
    u("photo-1550745165-9bc0b252726f"),
    u("photo-1593305841991-05c297ba4575"),
    u("photo-1606144042614-b2417e99c4e3"),
    u("photo-1612287230202-1ff1d85d1bdf"),
  ],
  accessories: [
    u("photo-1587829741301-dc798b83add3"),
    u("photo-1588872657578-7efd1f1555ed"),
    u("photo-1595044426077-d36d9236d54a"),
    u("photo-1618384887929-16ec33fab9ef"),
  ],
  smartHome: [
    u("photo-1558002038-1055907df827"),
    u("photo-1606220945770-b5b6c2c55bf1"),
    u("photo-1585771724684-38269d6639fd"),
  ],
  monitors: [
    u("photo-1546435770-a3e426bf472b"),
    u("photo-1593359677879-a4bb92f829d1"),
    u("photo-1586210579191-33b45e38fa2c"),
  ],
};

// Rotating index per category so products get varied images deterministically.
const poolIndex = {};
const productImage = (cat) => {
  const pool = IMAGE_POOLS[cat];
  poolIndex[cat] = (poolIndex[cat] ?? 0) % pool.length;
  return pool[poolIndex[cat]++];
};

// Compact product rows: name, Latin slug, category/subcategory/brand keys,
// price (DZD), optional explicit colors. Description/slug/images/stock are
// generated programmatically.
const products = [
  // ---- الهواتف والأجهزة اللوحية ----
  { name: "هاتف سامسونج جالاكسي S24", slug: "samsung-galaxy-s24", cat: "phones", sub: "smartphones", brand: "samsung", price: 145000, colors: ["أسود", "رمادي"] },
  { name: "هاتف آيفون 15 برو", slug: "apple-iphone-15-pro", cat: "phones", sub: "smartphones", brand: "apple", price: 220000, colors: ["أسود", "أزرق"] },
  { name: "هاتف شاومي ريدمي نوت 13", slug: "xiaomi-redmi-note-13", cat: "phones", sub: "smartphones", brand: "xiaomi", price: 45000, colors: ["أزرق", "أخضر"] },
  { name: "هاتف هواوي نوفا 12", slug: "huawei-nova-12", cat: "phones", sub: "smartphones", brand: "huawei", price: 60000, colors: ["أسود", "أبيض"] },
  { name: "هاتف سامسونج جالاكسي A55", slug: "samsung-galaxy-a55", cat: "phones", sub: "smartphones", brand: "samsung", price: 38000, colors: ["أسود", "أزرق", "أبيض"] },
  { name: "آيباد برو 11 بوصة", slug: "apple-ipad-pro-11", cat: "phones", sub: "tablets", brand: "apple", price: 180000, colors: ["رمادي", "فضي"] },
  { name: "تابلت سامسونج جالاكسي تاب S9", slug: "samsung-galaxy-tab-s9", cat: "phones", sub: "tablets", brand: "samsung", price: 120000, colors: ["رمادي"] },
  { name: "تابلت شاومي باد 6", slug: "xiaomi-pad-6", cat: "phones", sub: "tablets", brand: "xiaomi", price: 55000, colors: ["ذهبي", "رمادي"] },

  // ---- الحواسيب المحمولة والمكتبية ----
  { name: "لابتوب ماك بوك إير M3", slug: "apple-macbook-air-m3", cat: "laptops", sub: "laptops", brand: "apple", price: 320000, colors: ["فضي", "رمادي"] },
  { name: "لابتوب ديل إكس بي إس 13", slug: "dell-xps-13", cat: "laptops", sub: "laptops", brand: "dell", price: 250000, colors: ["فضي"] },
  { name: "لابتوب لينوفو ثينك باد T14", slug: "lenovo-thinkpad-t14", cat: "laptops", sub: "laptops", brand: "lenovo", price: 180000, colors: ["أسود"] },
  { name: "لابتوب إتش بي بافيليون 15", slug: "hp-pavilion-15", cat: "laptops", sub: "laptops", brand: "hp", price: 95000, colors: ["رمادي", "أزرق"] },
  { name: "لابتوب آسوس فيفوبوك 14", slug: "asus-vivobook-14", cat: "laptops", sub: "laptops", brand: "asus", price: 85000, colors: ["فضي", "أسود"] },
  { name: "لابتوب ألعاب آسوس ROG", slug: "asus-rog-gaming-laptop", cat: "laptops", sub: "laptops", brand: "asus", price: 280000, colors: ["أسود", "أحمر"] },
  { name: "حاسوب مكتبي ديل أوبتيبلكس", slug: "dell-optiplex-desktop", cat: "laptops", sub: "desktopPcs", brand: "dell", price: 130000, colors: ["أسود"] },
  { name: "حاسوب مكتبي إتش بي برو تاور", slug: "hp-pro-tower-desktop", cat: "laptops", sub: "desktopPcs", brand: "hp", price: 110000, colors: ["أسود"] },

  // ---- الصوتيات والسماعات ----
  { name: "سماعات رأس سوني WH-1000XM5", slug: "sony-wh-1000xm5", cat: "audio", sub: "headphones", brand: "sony", price: 65000, colors: ["أسود", "فضي"] },
  { name: "سماعات رأس جي بي إل تيون 770", slug: "jbl-tune-770", cat: "audio", sub: "headphones", brand: "jbl", price: 25000, colors: ["أزرق", "أسود"] },
  { name: "سماعات رأس هواوي فري بادز", slug: "huawei-freebuds-headphones", cat: "audio", sub: "headphones", brand: "huawei", price: 18000, colors: ["أبيض"] },
  { name: "سماعات أذن آبل إيربودز برو", slug: "apple-airpods-pro", cat: "audio", sub: "earbuds", brand: "apple", price: 55000, colors: ["أبيض"] },
  { name: "سماعات أذن سامسونج جالاكسي بادز", slug: "samsung-galaxy-buds", cat: "audio", sub: "earbuds", brand: "samsung", price: 30000, colors: ["أسود", "أبيض"] },
  { name: "سماعات أذن شاومي ريدمي بادز", slug: "xiaomi-redmi-buds", cat: "audio", sub: "earbuds", brand: "xiaomi", price: 8000, colors: ["أبيض", "أسود"] },
  { name: "مكبر صوت جي بي إل فليب 6", slug: "jbl-flip-6", cat: "audio", sub: "speakers", brand: "jbl", price: 28000, colors: ["أسود", "أزرق", "أحمر"] },
  { name: "مكبر صوت سوني إس آر إس", slug: "sony-srs-speaker", cat: "audio", sub: "speakers", brand: "sony", price: 35000, colors: ["أسود"] },

  // ---- الساعات الذكية والأجهزة القابلة للارتداء ----
  { name: "ساعة آبل ووتش سيريس 9", slug: "apple-watch-series-9", cat: "wearables", sub: "smartwatches", brand: "apple", price: 120000, colors: ["أسود", "فضي"] },
  { name: "ساعة سامسونج جالاكسي ووتش 6", slug: "samsung-galaxy-watch-6", cat: "wearables", sub: "smartwatches", brand: "samsung", price: 45000, colors: ["أسود", "ذهبي"] },
  { name: "ساعة شاومي ووتش S2", slug: "xiaomi-watch-s2", cat: "wearables", sub: "smartwatches", brand: "xiaomi", price: 15000, colors: ["أسود"] },
  { name: "ساعة هواوي ووتش GT 4", slug: "huawei-watch-gt-4", cat: "wearables", sub: "smartwatches", brand: "huawei", price: 35000, colors: ["أسود", "فضي"] },
  { name: "سوار شاومي مي باند 8", slug: "xiaomi-mi-band-8", cat: "wearables", sub: "fitnessTrackers", brand: "xiaomi", price: 6000, colors: ["أسود", "أزرق"] },
  { name: "سوار سامسونج فيت 3", slug: "samsung-fit-3", cat: "wearables", sub: "fitnessTrackers", brand: "samsung", price: 12000, colors: ["أسود", "وردي"] },

  // ---- الألعاب ----
  { name: "جهاز بلايستيشن 5", slug: "sony-playstation-5", cat: "gaming", sub: "gamingConsoles", brand: "sony", price: 180000, colors: ["أبيض"] },
  { name: "جهاز إكس بوكس سيريس إكس", slug: "microsoft-xbox-series-x", cat: "gaming", sub: "gamingConsoles", brand: "microsoft", price: 170000, colors: ["أسود"] },
  { name: "يد تحكم بلايستيشن 5", slug: "sony-dualsense-controller", cat: "gaming", sub: "gamingAccessories", brand: "sony", price: 15000, colors: ["أبيض", "أسود"] },
  { name: "يد تحكم إكس بوكس", slug: "microsoft-xbox-controller", cat: "gaming", sub: "gamingAccessories", brand: "microsoft", price: 12000, colors: ["أسود"] },
  { name: "سماعة ألعاب سوني بلس", slug: "sony-gaming-headset", cat: "gaming", sub: "gamingAccessories", brand: "sony", price: 20000, colors: ["أسود"] },
  { name: "لعبة سبايدرمان 2", slug: "spiderman-2-game", cat: "gaming", sub: "videoGames", brand: "sony", price: 12000 },
  { name: "لعبة فيفا 24", slug: "fifa-24-game", cat: "gaming", sub: "videoGames", brand: "sony", price: 10000 },
  { name: "لعبة كول أوف ديوتي", slug: "call-of-duty-game", cat: "gaming", sub: "videoGames", brand: "microsoft", price: 11000 },

  // ---- الإكسسوارات ----
  { name: "شاحن سريع سامسونج 45 واط", slug: "samsung-45w-charger", cat: "accessories", sub: "chargersCables", brand: "samsung", price: 5000, colors: ["أسود"] },
  { name: "كابل آبل لايتنينج", slug: "apple-lightning-cable", cat: "accessories", sub: "chargersCables", brand: "apple", price: 3000, colors: ["أبيض"] },
  { name: "شاحن لاسلكي شاومي", slug: "xiaomi-wireless-charger", cat: "accessories", sub: "chargersCables", brand: "xiaomi", price: 4000, colors: ["أبيض"] },
  { name: "حافظة آيفون سيليكون", slug: "apple-iphone-silicone-case", cat: "accessories", sub: "casesCovers", brand: "apple", price: 2500, colors: ["أزرق", "وردي", "أسود"] },
  { name: "حافظة سامسونج جالاكسي", slug: "samsung-galaxy-case", cat: "accessories", sub: "casesCovers", brand: "samsung", price: 2000, colors: ["أسود", "أحمر"] },
  { name: "حقيبة لابتوب ديل", slug: "dell-laptop-bag", cat: "accessories", sub: "casesCovers", brand: "dell", price: 7000, colors: ["أسود", "رمادي"] },
  { name: "لوحة مفاتيح لاسلكية لوجيتك", slug: "logitech-wireless-keyboard", cat: "accessories", sub: "keyboardsMice", brand: "logitech", price: 9000, colors: ["أسود"] },
  { name: "فأرة لاسلكية لوجيتك", slug: "logitech-wireless-mouse", cat: "accessories", sub: "keyboardsMice", brand: "logitech", price: 5000, colors: ["رمادي", "أسود"] },

  // ---- المنزل الذكي ----
  { name: "مكبر ذكي شاومي", slug: "xiaomi-smart-speaker", cat: "smartHome", sub: "smartSpeakers", brand: "xiaomi", price: 8000, colors: ["أبيض"] },
  { name: "مكبر ذكي سوني", slug: "sony-smart-speaker", cat: "smartHome", sub: "smartSpeakers", brand: "sony", price: 15000, colors: ["أسود"] },
  { name: "كاميرا مراقبة شاومي", slug: "xiaomi-security-camera", cat: "smartHome", sub: "securityCameras", brand: "xiaomi", price: 10000, colors: ["أبيض"] },
  { name: "كاميرا مراقبة هواوي", slug: "huawei-security-camera", cat: "smartHome", sub: "securityCameras", brand: "huawei", price: 12000, colors: ["أبيض", "أسود"] },
  { name: "لمبة ذكية شاومي", slug: "xiaomi-smart-bulb", cat: "smartHome", sub: "smartLighting", brand: "xiaomi", price: 2000, colors: ["أبيض"] },
  { name: "شريط إضاءة ذكي سامسونج", slug: "samsung-smart-light-strip", cat: "smartHome", sub: "smartLighting", brand: "samsung", price: 6000, colors: ["أبيض"] },

  // ---- الشاشات ----
  { name: "شاشة سامسونج أوديسي 27 بوصة", slug: "samsung-odyssey-27", cat: "monitors", sub: "computerMonitors", brand: "samsung", price: 45000, colors: ["أسود"] },
  { name: "شاشة ديل أولترا شارب 27", slug: "dell-ultrasharp-27", cat: "monitors", sub: "computerMonitors", brand: "dell", price: 38000, colors: ["أسود"] },
  { name: "شاشة آسوس تيوف 24 بوصة", slug: "asus-tuf-24", cat: "monitors", sub: "computerMonitors", brand: "asus", price: 18000, colors: ["أسود"] },
  { name: "شاشة لينوفو 27 بوصة", slug: "lenovo-27-monitor", cat: "monitors", sub: "computerMonitors", brand: "lenovo", price: 22000, colors: ["أسود"] },
  { name: "تلفزيون سامسونج 55 بوصة", slug: "samsung-55-tv", cat: "monitors", sub: "tvs", brand: "samsung", price: 120000, colors: ["أسود"] },
  { name: "تلفزيون سوني برافيا 50 بوصة", slug: "sony-bravia-50", cat: "monitors", sub: "tvs", brand: "sony", price: 95000, colors: ["أسود"] },
];

// Arabic description templates, keyed by category key.
const DESCRIPTION_TEMPLATES = {
  phones: (name, brand) =>
    `${name} من ${brand} — جهاز بشاشة عالية الدقة وكاميرا متقدمة وبطارية تدوم طوال اليوم. أداء سريع وتصميم أنيق يناسب جميع الاستخدامات اليومية.`,
  laptops: (name, brand) =>
    `${name} من ${brand} — حاسوب قوي بأداء عالٍ وشاشة واضحة، مثالي للعمل والدراسة والترفيه. خفيف الوزن وبطارية تدوم لساعات طويلة.`,
  audio: (name, brand) =>
    `${name} من ${brand} — جودة صوت استثنائية مع عزل فعال للضوضاء وتصميم مريح. مثالي للموسيقى والمكالمات والاستخدام اليومي.`,
  wearables: (name, brand) =>
    `${name} من ${brand} — تتبع دقيق للصحة واللياقة مع شاشة واضحة وتصميم أنيق. يدعم الإشعارات والعديد من التطبيقات.`,
  gaming: (name, brand) =>
    `${name} من ${brand} — تجربة ألعاب غامرة بأداء فائق ورسومات مذهلة. مصمم لعشاق الألعاب.`,
  accessories: (name, brand) =>
    `${name} من ${brand} — ملحق عملي وعالي الجودة مصمم ليتوافق مع أجهزتك. متين وسهل الاستخدام.`,
  smartHome: (name, brand) =>
    `${name} من ${brand} — جهاز منزلي ذكي يسهل حياتك اليومية مع التحكم عن بعد والتكامل مع المساعدين الصوتيين.`,
  monitors: (name, brand) =>
    `${name} من ${brand} — شاشة عالية الدقة بألوان دقيقة وزاوية مشاهدة واسعة. مثالية للعمل والترفيه.`,
};

// ====================================
// Helpers
// ====================================
const COLORS_POOL = [
  "أسود",
  "أبيض",
  "فضي",
  "ذهبي",
  "أزرق",
  "أحمر",
  "رمادي",
  "أخضر",
  "بنفسجي",
  "وردي",
];

const pickColors = () => {
  const count = 1 + Math.floor(Math.random() * 3);
  const shuffled = [...COLORS_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
};

// ~15% sold out, ~20% low stock, rest healthy — makes dashboards look real.
const randomQuantity = () => {
  const r = Math.random();
  if (r < 0.15) return 0;
  if (r < 0.35) return 1 + Math.floor(Math.random() * 5);
  return 10 + Math.floor(Math.random() * 90);
};

const randomSold = () => Math.floor(Math.random() * 200);

// Fail fast if any product/subcategory references an unknown key.
const validateData = () => {
  const catNames = new Set(categories.map((c) => c.name));
  const subNames = new Set(subcategories.map((s) => s.name));
  const brandNames = new Set(brands.map((b) => b.name));

  for (const s of subcategories) {
    if (!catNames.has(CAT[s.category])) {
      throw new Error(`Unknown category key in subcategory: ${s.category}`);
    }
  }
  for (const p of products) {
    if (!catNames.has(CAT[p.cat])) throw new Error(`Unknown category key: ${p.cat}`);
    if (!subNames.has(SUB[p.sub])) throw new Error(`Unknown subcategory key: ${p.sub}`);
    if (!brandNames.has(BRAND[p.brand])) throw new Error(`Unknown brand key: ${p.brand}`);
  }
};

// ====================================
// Main
// ====================================
async function seed() {
  validateData();

  // --dry-run / SEED_DRY_RUN=true: validate the data and preview it without
  // touching the DB.
  if (isDryRun) {
    const byCat = {};
    for (const p of products) {
      byCat[CAT[p.cat]] = (byCat[CAT[p.cat]] ?? 0) + 1;
    }
    console.log("Dry run — data looks valid:");
    console.log(`  categories: ${categories.length}`);
    console.log(`  subcategories: ${subcategories.length}`);
    console.log(`  brands: ${brands.length}`);
    console.log(`  products: ${products.length}`);
    for (const [cat, count] of Object.entries(byCat)) {
      console.log(`    ${cat}: ${count}`);
    }
    console.log(`\nSample product: ${JSON.stringify(products[0], null, 2)}`);
    return;
  }

  await mongoose.connect(mongoURI);
  console.log(`Connected to MongoDB (${mongoURI})`);

  // Wipe in reverse dependency order so the product deleteMany hooks still
  // find their parent documents when recalculating counts.
  await Product.deleteMany({});
  await Subcategory.deleteMany({});
  await Brand.deleteMany({});
  await Category.deleteMany({});
  console.log("Cleared existing categories, subcategories, brands, products");

  // Categories
  const categoryIds = {};
  for (const c of categories) {
    const doc = await Category.create({
      name: c.name,
      slug: c.slug,
      image: await ensureImage(c.image, "categories"),
    });
    categoryIds[c.name] = doc._id;
    console.log(`  ✓ category: ${c.name}`);
  }

  // Subcategories (reuse the parent category image — no extra upload)
  const subcategoryIds = {};
  for (const s of subcategories) {
    const cat = categories.find((c) => c.name === CAT[s.category]);
    const doc = await Subcategory.create({
      name: s.name,
      slug: s.slug,
      category: categoryIds[cat.name],
      image: await ensureImage(cat.image, "subcategories"),
    });
    subcategoryIds[s.name] = doc._id;
    console.log(`  ✓ subcategory: ${s.name}`);
  }

  // Brands
  const brandIds = {};
  for (const b of brands) {
    const doc = await Brand.create({
      name: b.name,
      slug: b.slug,
      image: await ensureImage(b.image, "brands"),
    });
    brandIds[b.name] = doc._id;
    console.log(`  ✓ brand: ${b.name}`);
  }

  // Products
  for (const p of products) {
    const catName = CAT[p.cat];
    const subName = SUB[p.sub];
    const brandName = BRAND[p.brand];

    await Product.create({
      name: p.name,
      slug: p.slug,
      description: DESCRIPTION_TEMPLATES[p.cat](p.name, brandName),
      price: p.price,
      mainImage: await ensureImage(productImage(p.cat), "products"),
      colors: p.colors && p.colors.length ? p.colors : pickColors(),
      quantity: randomQuantity(),
      sold: randomSold(),
      category: categoryIds[catName],
      subCategory: subcategoryIds[subName],
      brand: brandIds[brandName],
    });
  }
  console.log(`  ✓ products: ${products.length}`);

  // Persist the image cache so re-runs skip uploads.
  fs.writeFileSync(CACHE_FILE, JSON.stringify(imageCache, null, 2));
  console.log(`Image cache saved to ${CACHE_FILE}`);

  const [catCount, subCount, brandCount, prodCount] = await Promise.all([
    Category.countDocuments(),
    Subcategory.countDocuments(),
    Brand.countDocuments(),
    Product.countDocuments(),
  ]);
  console.log(
    `\nSeed complete: ${catCount} categories, ${subCount} subcategories, ` +
      `${brandCount} brands, ${prodCount} products`
  );

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("\nSeed failed:", err);
  process.exit(1);
});