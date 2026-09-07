/* ============================================================
   /api/submit-score
   クライアントから「シード値＋操作ログ」だけを受け取り、
   サーバー側でゲームを最初から再現計算して、その結果だけを
   正式なスコアとして採用する。クライアントが送ってきた点数の
   数値そのものは一切信用しない。

   ゲームロジック（乱数生成・注文生成・決算計算）は
   src/BusinessGame.jsx の該当ロジックと必ず同期させること。
   ============================================================ */

const MASTER_PRODUCTS = [
  { id: "cola", name: "コーラ", price: 150, cost: 80 },
  { id: "water", name: "天然水", price: 100, cost: 40 },
  { id: "oj", name: "オレンジジュース", price: 180, cost: 100 },
  { id: "greentea", name: "緑茶", price: 140, cost: 70 },
  { id: "soda", name: "炭酸水", price: 120, cost: 55 },
  { id: "energy", name: "エナジードリンク", price: 250, cost: 140 },
  { id: "coffee", name: "缶コーヒー", price: 130, cost: 60 },
  { id: "sports", name: "スポーツドリンク", price: 160, cost: 85 },
  { id: "lemonade", name: "レモネード", price: 170, cost: 90 },
  { id: "ginger", name: "ジンジャエール", price: 150, cost: 75 },
];

const DIFFICULTIES = {
  初級: { count: 3, startCash: 500000, orderRange: [50, 150], maxOrdersPerDay: 1, missedOrderPenalty: 6 },
  中級: { count: 5, startCash: 800000, orderRange: [80, 220], maxOrdersPerDay: 2, missedOrderPenalty: 4 },
  上級: { count: 10, startCash: 1200000, orderRange: [100, 300], maxOrdersPerDay: 3, missedOrderPenalty: 3 },
};
const VALID_MONTHS = [3, 6, 12];
const DAYS_PER_MONTH = 30;
const LEAD_TIME = 3;
const EMERGENCY_LEAD_TIME = 1;
const EMERGENCY_MULTIPLIER = 1.2;
const STORAGE_RATE = 2;
const MAX_ACTIONS = VALID_MONTHS[VALID_MONTHS.length - 1] * DAYS_PER_MONTH + 5;

function fixedCostsFor(productCount) {
  const rent = 30000 + productCount * 7000;
  const utilities = 8000 + productCount * 1200;
  const labor = 50000 + productCount * 10000;
  return { rent, utilities, labor, total: rent + utilities + labor };
}

function createRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundTo10(n) {
  return Math.max(10, Math.round(n / 10) * 10);
}

function buildProducts(difficulty) {
  const conf = DIFFICULTIES[difficulty];
  return MASTER_PRODUCTS.slice(0, conf.count).map((p) => ({ ...p, stock: 100 }));
}

function makeRandInt(rng) {
  return (min, max) => Math.floor(rng() * (max - min + 1)) + min;
}
function makeShuffle(rng) {
  return (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
}

function generateIncomingOrders(products, trust, conf, randInt, shuffle) {
  const maxOrders = Math.min(conf.maxOrdersPerDay, products.length);
  const numOrders = randInt(1, maxOrders);
  const chosen = shuffle(products).slice(0, numOrders);
  const trustFactor = 0.5 + (trust / 100) * 0.7;
  return chosen.map((product) => {
    const raw = randInt(conf.orderRange[0], conf.orderRange[1]) * trustFactor;
    const qty = roundTo10(raw);
    return { productId: product.id, qty };
  });
}

/* ============================================================
   ゲーム全体をシード値と操作ログから再現し、最終純資産を算出する
   ============================================================ */
function replayGame({ difficulty, months, seed, actions }) {
  const conf = DIFFICULTIES[difficulty];
  const rng = createRng(seed);
  const randInt = makeRandInt(rng);
  const shuffle = makeShuffle(rng);

  let products = buildProducts(difficulty);
  const initialInventoryValue = products.reduce((s, p) => s + p.stock * p.cost, 0);
  let cash = conf.startCash;
  const capitalStock = conf.startCash + initialInventoryValue;
  let trust = 70;
  let pendingArrivals = [];
  let totalDay = 1;
  let day = 1;
  let currentMonth = 1;
  let dailyLog = [];
  let retainedEarnings = 0;

  let todayOrders = generateIncomingOrders(products, trust, conf, randInt, shuffle);

  const settleMonth = () => {
    const revenue = dailyLog.reduce((s, d) => s + d.revenue, 0);
    const cogs = dailyLog.reduce((s, d) => s + d.cogs, 0);
    const storageCostTotal = dailyLog.reduce((s, d) => s + d.storageCost, 0);
    const emergencyPremiumTotal = dailyLog.reduce((s, d) => s + (d.emergencyPremium || 0), 0);
    const fixed = fixedCostsFor(products.length);
    const netIncome = revenue - cogs - storageCostTotal - emergencyPremiumTotal - fixed.total;
    cash -= fixed.total;
    retainedEarnings += netIncome;
    dailyLog = [];
    currentMonth += 1;
  };

  for (let idx = 0; idx < actions.length; idx++) {
    if (currentMonth > months) break; // ゲームは既に終了しているはずなので、それ以上は無視する
    const entry = actions[idx];
    if (!entry || typeof entry !== "object") throw new Error("不正な操作ログです");

    // --- 発注の適用 ---
    const purchases = Array.isArray(entry.purchases) ? entry.purchases : [];
    purchases.forEach((p) => {
      const product = products.find((pp) => pp.id === p.productId);
      if (!product) return;
      const lots = Math.max(0, Math.round(Number(p.lots) || 0));
      if (lots <= 0) return;
      const qty = lots * 100;
      const isEmergency = !!p.isEmergency;
      const unitCost = isEmergency ? Math.round(product.cost * EMERGENCY_MULTIPLIER) : product.cost;
      const arrivalDay = totalDay + (isEmergency ? EMERGENCY_LEAD_TIME : LEAD_TIME);
      pendingArrivals.push({ arrivalDay, productId: p.productId, qty, unitCost, baseCost: product.cost, isEmergency });
    });

    // --- 受注の適用 ---
    const acceptedIdx = new Set(Array.isArray(entry.accepted) ? entry.accepted : []);
    let revenue = 0, cogs = 0, trustAdjust = 0;
    todayOrders.forEach((o, i) => {
      if (acceptedIdx.has(i)) {
        const product = products.find((p) => p.id === o.productId);
        if (product && product.stock >= o.qty) {
          product.stock -= o.qty;
          cash += o.qty * product.price;
          revenue += o.qty * product.price;
          cogs += o.qty * product.cost;
          trust = Math.min(100, trust + 1);
        } else {
          trustAdjust -= conf.missedOrderPenalty; // 在庫不足なのに受注扱いにしようとした場合は見送り扱い
        }
      } else {
        trustAdjust -= conf.missedOrderPenalty;
      }
    });
    trust = Math.max(0, Math.min(100, trust + trustAdjust));

    const stockTotalToday = products.reduce((s, p) => s + p.stock, 0);
    const storageCost = stockTotalToday * STORAGE_RATE;
    dailyLog.push({ revenue, cogs, storageCost, emergencyPremium: 0 });

    if (entry.endedMonthHere) {
      settleMonth();
      if (currentMonth > months) break;
      day = 1;
      todayOrders = generateIncomingOrders(products, trust, conf, randInt, shuffle);
      continue;
    }

    // --- 翌日への処理 ---
    const nextTotalDay = totalDay + 1;
    const arrivalsToday = pendingArrivals.filter((a) => a.arrivalDay === nextTotalDay);
    pendingArrivals = pendingArrivals.filter((a) => a.arrivalDay !== nextTotalDay);
    let arrivalCost = 0, emergencyPremium = 0;
    arrivalsToday.forEach((a) => {
      const p = products.find((pp) => pp.id === a.productId);
      if (p) p.stock += a.qty;
      arrivalCost += a.qty * a.unitCost;
      if (a.isEmergency) emergencyPremium += a.qty * (a.unitCost - a.baseCost);
    });
    dailyLog[dailyLog.length - 1].emergencyPremium = emergencyPremium;
    cash = cash - arrivalCost - storageCost;
    totalDay = nextTotalDay;

    const nextDay = day + 1;
    if (nextDay > DAYS_PER_MONTH) {
      settleMonth();
      if (currentMonth > months) break;
      day = 1;
      todayOrders = generateIncomingOrders(products, trust, conf, randInt, shuffle);
    } else {
      day = nextDay;
      todayOrders = generateIncomingOrders(products, trust, conf, randInt, shuffle);
    }
  }

  if (currentMonth <= months) {
    throw new Error("ゲームが最後まで再現できませんでした（操作ログが不足しています）");
  }

  return Math.round(capitalStock + retainedEarnings);
}

/* ============================================================
   Supabase REST API 呼び出し（サービスロールキーはサーバー側のみで使用）
   ============================================================ */
async function insertScore({ name, score, difficulty, months }) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/scores`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify([{ name, score, difficulty, months }]),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`スコアの保存に失敗しました: ${text}`);
  }
}

async function fetchLeaderboard({ difficulty, months }) {
  const params = new URLSearchParams({
    difficulty: `eq.${difficulty}`,
    months: `eq.${months}`,
    select: "name,score,created_at",
    order: "score.desc",
    limit: "10",
  });
  const url = `${process.env.SUPABASE_URL}/rest/v1/scores?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return [];
  return res.json();
}

export { replayGame };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }

  try {
    const { name, difficulty, months, seed, actions } = req.body || {};

    if (typeof name !== "string" || !name.trim() || name.length > 20) {
      throw new Error("表示名が不正です");
    }
    if (!DIFFICULTIES[difficulty]) throw new Error("難易度が不正です");
    if (!VALID_MONTHS.includes(months)) throw new Error("営業期間が不正です");
    if (!Number.isInteger(seed)) throw new Error("シード値が不正です");
    if (!Array.isArray(actions) || actions.length === 0 || actions.length > MAX_ACTIONS) {
      throw new Error("操作ログが不正です");
    }

    const score = replayGame({ difficulty, months, seed, actions });

    await insertScore({ name: name.trim().slice(0, 20), score, difficulty, months });
    const leaderboard = await fetchLeaderboard({ difficulty, months });

    res.status(200).json({ success: true, score, leaderboard });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message || "不明なエラーが発生しました" });
  }
}
