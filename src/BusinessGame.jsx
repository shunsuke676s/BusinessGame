import React, { useState, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

/* ============================================================
   マスターデータ
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

const DURATIONS = [3, 6, 12];
const DAYS_PER_MONTH = 30;
const LEAD_TIME = 3; // 通常発注のリードタイム（発注から入荷までの日数）
const EMERGENCY_LEAD_TIME = 1; // 緊急発注のリードタイム（翌日入荷）
const EMERGENCY_MULTIPLIER = 1.2; // 緊急発注の割増率（仕入原価の1.2倍）
const STORAGE_RATE = 2; // 1本・1日あたりの保管費（在庫量が多いほど総額が上がる）
const ADSENSE_CLIENT = "ca-pub-5157428118387471";
// AdSense管理画面で作成した広告ユニットのスロットID
const AD_SLOT_HOME = "7651172534";
const AD_SLOT_SETTLEMENT = "5852829537";
const SAVE_KEY = "beverage-trade-save-v1"; // 中断データの保存キー

function saveGameState(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false; // 保存できない環境（プライベートブラウズ等）では静かに諦める
  }
}

function loadGameState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearGameState() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // 何もしない
  }
}

function hasSavedGameState() {
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch {
    return false;
  }
}

/* ============================================================
   AdSense 広告表示用の共通コンポーネント
   ============================================================ */
function AdBanner({ slot, style }) {
  useEffect(() => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // AdSenseスクリプトが未読み込み・審査未通過の場合は何もしない
    }
  }, [slot]);

  return (
    <div className="ad-slot">
      <span className="ad-slot-label">広告</span>
      <ins
        className="adsbygoogle"
        style={{ display: "block", ...style }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}

function fixedCostsFor(productCount) {
  // 家賃・水道光熱費・人件費のすべてを取扱商品数（難易度）に応じてスケールさせる。
  // 上級（10品目）は従来と同水準を維持しつつ、初級・中級の固定費負担を軽減する。
  const rent = 30000 + productCount * 7000;
  const utilities = 8000 + productCount * 1200;
  const labor = 50000 + productCount * 10000;
  return { rent, utilities, labor, total: rent + utilities + labor };
}

function yen(n) {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}¥${Math.abs(rounded).toLocaleString()}`;
}

/* ============================================================
   シード化乱数生成器（mulberry32）
   ランキングのリプレイ検証のため、ゲーム中の乱数はすべてこの生成器経由にする。
   同じシード値であれば、クライアント・サーバーで完全に同じ乱数列が再現できる。
   ============================================================ */
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

function makeSeed() {
  return Math.floor(Math.random() * 0xffffffff);
}

let currentRng = Math.random; // ゲーム開始時に createRng(seed) へ差し替える

function randInt(min, max) {
  return Math.floor(currentRng() * (max - min + 1)) + min;
}

function roundTo10(n) {
  return Math.max(10, Math.round(n / 10) * 10);
}

function toLots(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(currentRng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ============================================================
   ゲーム初期化・注文生成ロジック
   ============================================================ */
function buildProducts(difficulty) {
  const conf = DIFFICULTIES[difficulty];
  return MASTER_PRODUCTS.slice(0, conf.count).map((p) => ({
    ...p,
    stock: 100,
  }));
}

function generateIncomingOrders(products, trust, conf) {
  const maxOrders = Math.min(conf.maxOrdersPerDay, products.length);
  const numOrders = randInt(1, maxOrders);
  const chosen = shuffle(products).slice(0, numOrders);
  const trustFactor = 0.5 + (trust / 100) * 0.7;
  return chosen.map((product, idx) => {
    const raw = randInt(conf.orderRange[0], conf.orderRange[1]) * trustFactor;
    const qty = roundTo10(raw);
    return {
      id: `${product.id}-${idx}-${Date.now()}`,
      productId: product.id,
      productName: product.name,
      qty,
      fulfillable: product.stock >= qty,
      decision: null,
    };
  });
}

/* ============================================================
   メインコンポーネント
   ============================================================ */
export default function BusinessGame() {
  const [screen, setScreen] = useState("home"); // home | game | settlement | end | help | leaderboard
  const [hasSavedGame, setHasSavedGame] = useState(() => hasSavedGameState());
  const [difficulty, setDifficulty] = useState("初級");
  const [duration, setDuration] = useState(3);

  const [months, setMonths] = useState(3);
  const [currentMonth, setCurrentMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [totalDay, setTotalDay] = useState(1); // 月をまたいでも通算で増え続ける日数（入荷スケジュール管理用）
  const [cash, setCash] = useState(0);
  const [trust, setTrust] = useState(70);
  const [products, setProducts] = useState([]);
  const [pendingArrivals, setPendingArrivals] = useState([]);
  const [todayOrders, setTodayOrders] = useState([]);
  const [dailyLog, setDailyLog] = useState([]);
  const [monthlyRecords, setMonthlyRecords] = useState([]);
  const [retainedEarnings, setRetainedEarnings] = useState(0);
  const [capitalStock, setCapitalStock] = useState(0);
  const [lastSettlement, setLastSettlement] = useState(null);
  const [showSettlementAd, setShowSettlementAd] = useState(false);

  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderDraft, setOrderDraft] = useState({}); // { [productId]: lots }
  const [orderEmergency, setOrderEmergency] = useState({}); // { [productId]: boolean }
  const [confirmModal, setConfirmModal] = useState(null);
  const [helpReturnScreen, setHelpReturnScreen] = useState("home");
  const [stockThresholds, setStockThresholds] = useState({}); // { [productId]: number } 在庫基準量
  const [gameSeed, setGameSeed] = useState(null);
  const [actionLog, setActionLog] = useState([]); // ランキングのリプレイ検証用の操作ログ
  const [rankingSubmitted, setRankingSubmitted] = useState(false);
  const [pendingPurchaseLog, setPendingPurchaseLog] = useState([]); // 当日発注した内容を一時的に蓄積

  const openHelp = (from) => {
    setHelpReturnScreen(from);
    setScreen("help");
  };

  const conf = DIFFICULTIES[difficulty];

  /* ---------- ホーム画面からゲーム開始 ---------- */
  const startGame = () => {
    const seed = makeSeed();
    currentRng = createRng(seed);
    setGameSeed(seed);
    setActionLog([]);
    setRankingSubmitted(false);
    setPendingPurchaseLog([]);
    const initProducts = buildProducts(difficulty);
    const initialInventoryValue = initProducts.reduce((s, p) => s + p.stock * p.cost, 0);
    setProducts(initProducts);
    setMonths(duration);
    setCurrentMonth(1);
    setDay(1);
    setTotalDay(1);
    setCash(conf.startCash);
    // 資本金 = 現金 + 期首在庫評価額（無償で付与される初期在庫分も資本として計上し、貸借を一致させる）
    setCapitalStock(conf.startCash + initialInventoryValue);
    setTrust(70);
    setPendingArrivals([]);
    setDailyLog([]);
    setMonthlyRecords([]);
    setRetainedEarnings(0);
    setTodayOrders(generateIncomingOrders(initProducts, 70, conf));
    setOrderDraft({});
    const initThresholds = {};
    initProducts.forEach((p) => (initThresholds[p.id] = 100));
    setStockThresholds(initThresholds);
    clearGameState();
    setHasSavedGame(false);
    setScreen("game");
  };

  /* ---------- 発注確定（複数商品を一括） ---------- */
  const confirmPlaceOrder = () => {
    const entries = Object.entries(orderDraft)
      .map(([productId, lots]) => [productId, toLots(lots)])
      .filter(([, lots]) => lots > 0);
    const arrivals = entries.map(([productId, lots]) => {
      const product = products.find((p) => p.id === productId);
      const qty = lots * 100;
      const isEmergency = !!orderEmergency[productId];
      const unitCost = isEmergency ? Math.round(product.cost * EMERGENCY_MULTIPLIER) : product.cost;
      const arrivalDay = totalDay + (isEmergency ? EMERGENCY_LEAD_TIME : LEAD_TIME);
      return { arrivalDay, productId, qty, unitCost, baseCost: product.cost, isEmergency };
    });
    setPendingArrivals((prev) => [...prev, ...arrivals]);
    setPendingPurchaseLog((prev) => [
      ...prev,
      ...entries.map(([productId, lots]) => ({ productId, lots, isEmergency: !!orderEmergency[productId] })),
    ]);
    setOrderDraft({});
    setOrderEmergency({});
    setOrderModalOpen(false);
    setConfirmModal(null);
  };

  /* ---------- 注文の受諾／拒否（商品ごと個別） ---------- */
  const acceptOrder = (orderId) => {
    const order = todayOrders.find((o) => o.id === orderId);
    if (!order || order.decision) return;
    const product = products.find((p) => p.id === order.productId);
    if (!product || product.stock < order.qty) return; // 在庫不足の受注は常に不可（保険）

    setProducts((prev) =>
      prev.map((p) => (p.id === order.productId ? { ...p, stock: p.stock - order.qty } : p))
    );
    setCash((c) => c + order.qty * product.price);
    setTrust((t) => Math.min(100, t + 1));
    setTodayOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, decision: "accepted" } : o))
    );
    setConfirmModal(null);
  };

  /* ---------- 本日分の実績ログを集計する（翌日へ／当月を終了する で共用） ---------- */
  const buildTodayLogEntry = () => {
    let trustAdjust = 0;
    let revenue = 0;
    let cogs = 0;
    const requestedByProduct = {};
    const acceptedByProduct = {};

    todayOrders.forEach((o) => {
      requestedByProduct[o.productId] = (requestedByProduct[o.productId] || 0) + o.qty;
      if (o.decision === "accepted") {
        const product = products.find((p) => p.id === o.productId);
        acceptedByProduct[o.productId] = (acceptedByProduct[o.productId] || 0) + o.qty;
        revenue += o.qty * product.price;
        cogs += o.qty * product.cost;
      } else if (o.decision === null) {
        trustAdjust -= conf.missedOrderPenalty; // 受注しないまま見送った注文（難易度に応じたペナルティ）
      }
    });

    const stockTotalToday = products.reduce((s, p) => s + p.stock, 0);
    const storageCost = stockTotalToday * STORAGE_RATE;
    const stockByProduct = {};
    products.forEach((p) => (stockByProduct[p.id] = p.stock));

    return {
      logEntry: {
        day,
        stockByProduct,
        stockTotal: stockTotalToday,
        requestedByProduct,
        acceptedByProduct,
        requestedQtyTotal: Object.values(requestedByProduct).reduce((a, b) => a + b, 0),
        acceptedQtyTotal: Object.values(acceptedByProduct).reduce((a, b) => a + b, 0),
        revenue,
        cogs,
        storageCost,
        emergencyPremium: 0,
      },
      trustAdjust,
      storageCost,
    };
  };

  /* ---------- 翌日へ ---------- */
  const goToNextDay = () => {
    const nextDay = day + 1;
    const nextTotalDay = totalDay + 1;
    const arrivalsToday = pendingArrivals.filter((a) => a.arrivalDay === nextTotalDay);
    const remainingArrivals = pendingArrivals.filter((a) => a.arrivalDay !== nextTotalDay);

    const updatedProducts = products.map((p) => ({ ...p }));
    let arrivalCost = 0;
    let emergencyPremium = 0;
    arrivalsToday.forEach((a) => {
      const p = updatedProducts.find((pp) => pp.id === a.productId);
      if (p) p.stock += a.qty;
      arrivalCost += a.qty * a.unitCost;
      // 緊急発注の割増分（原価と実際の支払額の差）は、入荷時に一括で費用計上する
      if (a.isEmergency) emergencyPremium += a.qty * (a.unitCost - a.baseCost);
    });

    const { logEntry, trustAdjust, storageCost } = buildTodayLogEntry();
    logEntry.emergencyPremium = emergencyPremium;
    const newDailyLog = [...dailyLog, logEntry];

    // ランキング検証用の操作ログに当日分を記録
    const acceptedIndices = todayOrders
      .map((o, i) => (o.decision === "accepted" ? i : null))
      .filter((i) => i !== null);
    setActionLog((prev) => [
      ...prev,
      { purchases: pendingPurchaseLog, accepted: acceptedIndices, endedMonthHere: false },
    ]);
    setPendingPurchaseLog([]);

    const newTrust = Math.max(0, Math.min(100, trust + trustAdjust));
    const newCash = cash - arrivalCost - storageCost;

    setProducts(updatedProducts);
    setPendingArrivals(remainingArrivals);
    setCash(newCash);
    setTrust(newTrust);
    setDailyLog(newDailyLog);
    setTotalDay(nextTotalDay);

    if (nextDay > DAYS_PER_MONTH) {
      runSettlement(newDailyLog, updatedProducts, newCash);
    } else {
      setDay(nextDay);
      setTodayOrders(generateIncomingOrders(updatedProducts, newTrust, conf));
    }
  };

  /* ---------- 当月を終了する（早期決算） ---------- */
  const endMonthEarly = () => {
    // 本日すでに確定した受注・拒否・保管費も決算に含める（含めないと貸借が一致しなくなるため）
    const { logEntry, trustAdjust, storageCost } = buildTodayLogEntry();
    const newDailyLog = [...dailyLog, logEntry];
    const newTrust = Math.max(0, Math.min(100, trust + trustAdjust));
    const newCash = cash - storageCost;

    const acceptedIndices = todayOrders
      .map((o, i) => (o.decision === "accepted" ? i : null))
      .filter((i) => i !== null);
    setActionLog((prev) => [
      ...prev,
      { purchases: pendingPurchaseLog, accepted: acceptedIndices, endedMonthHere: true },
    ]);
    setPendingPurchaseLog([]);

    setTrust(newTrust);
    setCash(newCash);
    runSettlement(newDailyLog, products, newCash);
  };

  /* ---------- 月次決算 ---------- */
  const runSettlement = (log, finalProducts, finalCash) => {
    const revenue = log.reduce((s, d) => s + d.revenue, 0);
    const cogs = log.reduce((s, d) => s + d.cogs, 0);
    const storageCostTotal = log.reduce((s, d) => s + d.storageCost, 0);
    const emergencyPremiumTotal = log.reduce((s, d) => s + (d.emergencyPremium || 0), 0);
    const fixed = fixedCostsFor(finalProducts.length);
    const netIncome = revenue - cogs - storageCostTotal - emergencyPremiumTotal - fixed.total;

    const newCashAfterFixed = finalCash - fixed.total;
    const inventoryValue = finalProducts.reduce((s, p) => s + p.stock * p.cost, 0);
    const newRetained = retainedEarnings + netIncome;

    const settlement = {
      month: currentMonth,
      revenue,
      cogs,
      storageCostTotal,
      emergencyPremiumTotal,
      fixed,
      netIncome,
      cash: newCashAfterFixed,
      inventoryValue,
      assets: newCashAfterFixed + inventoryValue,
      capitalStock,
      retainedEarnings: newRetained,
      dailyLog: log,
      products: finalProducts,
      totalRequested: log.reduce((s, d) => s + d.requestedQtyTotal, 0),
      totalAccepted: log.reduce((s, d) => s + d.acceptedQtyTotal, 0),
    };

    setCash(newCashAfterFixed);
    setRetainedEarnings(newRetained);
    setMonthlyRecords((prev) => [...prev, settlement]);
    setLastSettlement(settlement);
    setShowSettlementAd(true);
    setScreen("settlement");
  };

  /* ---------- 次の月へ ---------- */
  const goToNextMonth = () => {
    if (currentMonth >= months) {
      clearGameState();
      setHasSavedGame(false);
      setScreen("end");
      return;
    }
    const nextMonth = currentMonth + 1;
    setCurrentMonth(nextMonth);
    setDay(1);
    setDailyLog([]);
    setTodayOrders(generateIncomingOrders(products, trust, conf));
    setScreen("game");
  };

  const restart = () => setScreen("home");

  /* ---------- 中断する（現在の進行状況を保存してホームへ） ---------- */
  const suspendGame = () => {
    const snapshot = {
      difficulty, duration, months, currentMonth, day, totalDay,
      cash, trust, products, pendingArrivals, todayOrders, dailyLog,
      monthlyRecords, retainedEarnings, capitalStock, stockThresholds,
    };
    saveGameState(snapshot);
    setHasSavedGame(true);
    setScreen("home");
  };

  /* ---------- 続きから再開する ---------- */
  const resumeGame = () => {
    const saved = loadGameState();
    if (!saved) return;
    setDifficulty(saved.difficulty);
    setDuration(saved.duration);
    setMonths(saved.months);
    setCurrentMonth(saved.currentMonth);
    setDay(saved.day);
    setTotalDay(saved.totalDay);
    setCash(saved.cash);
    setTrust(saved.trust);
    setProducts(saved.products);
    setPendingArrivals(saved.pendingArrivals);
    setTodayOrders(saved.todayOrders);
    setDailyLog(saved.dailyLog);
    setMonthlyRecords(saved.monthlyRecords);
    setRetainedEarnings(saved.retainedEarnings);
    setCapitalStock(saved.capitalStock);
    setStockThresholds(saved.stockThresholds || {});
    setScreen("game");
  };

  const setThreshold = (productId, value) => {
    const n = Number(value);
    setStockThresholds((prev) => ({ ...prev, [productId]: Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0 }));
  };

  /* ============================================================
     描画
     ============================================================ */
  return (
    <div className="bg-root">
      <style>{STYLE}</style>
      {screen === "home" && (
        <HomeScreen
          difficulty={difficulty}
          setDifficulty={setDifficulty}
          duration={duration}
          setDuration={setDuration}
          onStart={startGame}
          onShowHelp={() => openHelp("home")}
          hasSavedGame={hasSavedGame}
          onResume={resumeGame}
          onShowLeaderboard={() => setScreen("leaderboard")}
        />
      )}
      {screen === "game" && (
        <GameScreen
          difficulty={difficulty}
          months={months}
          currentMonth={currentMonth}
          day={day}
          totalDay={totalDay}
          cash={cash}
          trust={trust}
          products={products}
          pendingArrivals={pendingArrivals}
          todayOrders={todayOrders}
          dailyLog={dailyLog}
          stockThresholds={stockThresholds}
          onSetThreshold={setThreshold}
          onOpenOrder={() => setOrderModalOpen(true)}
          onAccept={(orderId) => setConfirmModal({ type: "decision", orderId })}
          onNextDay={() => setConfirmModal({ type: "nextday" })}
          onEndMonth={() => setConfirmModal({ type: "endmonth" })}
          onSuspend={() => setConfirmModal({ type: "suspend" })}
          onShowHelp={() => openHelp("game")}
        />
      )}
      {screen === "help" && (
        <HelpScreen onBack={() => setScreen(helpReturnScreen)} />
      )}
      {screen === "leaderboard" && (
        <LeaderboardScreen onBack={() => setScreen("home")} />
      )}
      {screen === "settlement" && lastSettlement && showSettlementAd && (
        <SettlementAdOverlay onContinue={() => setShowSettlementAd(false)} />
      )}
      {screen === "settlement" && lastSettlement && !showSettlementAd && (
        <SettlementScreen
          settlement={lastSettlement}
          isFinalMonth={currentMonth >= months}
          onNext={goToNextMonth}
        />
      )}
      {screen === "end" && (
        <EndScreen
          monthlyRecords={monthlyRecords}
          onRestart={restart}
          difficulty={difficulty}
          months={months}
          gameSeed={gameSeed}
          actionLog={actionLog}
        />
      )}

      {orderModalOpen && (
        <OrderModal
          products={products}
          draft={orderDraft}
          setDraft={setOrderDraft}
          emergency={orderEmergency}
          setEmergency={setOrderEmergency}
          cash={cash}
          onCancel={() => {
            setOrderDraft({});
            setOrderEmergency({});
            setOrderModalOpen(false);
          }}
          onSubmit={() => setConfirmModal({ type: "order" })}
        />
      )}

      {confirmModal && (
        <ConfirmModal
          confirmModal={confirmModal}
          products={products}
          todayOrders={todayOrders}
          orderDraft={orderDraft}
          orderEmergency={orderEmergency}
          onCancel={() => setConfirmModal(null)}
          onConfirm={() => {
            if (confirmModal.type === "order") confirmPlaceOrder();
            else if (confirmModal.type === "decision") acceptOrder(confirmModal.orderId);
            else if (confirmModal.type === "nextday") {
              setConfirmModal(null);
              goToNextDay();
            } else if (confirmModal.type === "endmonth") {
              setConfirmModal(null);
              endMonthEarly();
            } else if (confirmModal.type === "suspend") {
              setConfirmModal(null);
              suspendGame();
            }
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
   ホーム画面
   ============================================================ */
/* ============================================================
   決算画面遷移時の広告オーバーレイ
   ============================================================ */
function SettlementAdOverlay({ onContinue }) {
  return (
    <div className="modal-overlay">
      <div className="modal-box settlement-ad-box">
        <h2>決算処理中…</h2>
        <AdBanner slot={AD_SLOT_SETTLEMENT} style={{ minHeight: 250 }} />
        <button className="btn primary big" onClick={onContinue}>
          決算結果を見る
        </button>
      </div>
    </div>
  );
}

function HomeScreen({ difficulty, setDifficulty, duration, setDuration, onStart, onShowHelp, hasSavedGame, onResume, onShowLeaderboard }) {
  return (
    <div className="screen home-screen">
      <div className="ledger-header">
        <span className="stamp">BEVERAGE TRADE Co.</span>
        <h1>ビジネスゲーム<span className="title-sub">〜飲料販売〜</span></h1>
        <p className="subtitle">発注と受注を見極め、30日ごとの決算を乗り切れ。</p>
        <button className="btn ghost help-btn" onClick={onShowHelp}>遊び方・ルール説明</button>
      </div>

      {hasSavedGame && (
        <div className="panel resume-panel">
          <h2>中断中のゲームがあります</h2>
          <p className="resume-note">前回の続きから再開できます。</p>
          <button className="btn primary big" onClick={onResume}>続きから再開する</button>
        </div>
      )}

      <div className="panel">
        <h2>難易度を選ぶ</h2>
        <div className="choice-row">
          {Object.keys(DIFFICULTIES).map((key) => (
            <button
              key={key}
              className={`choice-card ${difficulty === key ? "selected" : ""}`}
              onClick={() => setDifficulty(key)}
            >
              <div className="choice-title">{key}</div>
              <div className="choice-meta">
                取扱商品 {DIFFICULTIES[key].count} 種 ／ 初期資金 {yen(DIFFICULTIES[key].startCash)}
              </div>
              <div className="choice-meta">1日の注文 最大{DIFFICULTIES[key].maxOrdersPerDay}件</div>
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>営業期間を選ぶ</h2>
        <div className="choice-row">
          {DURATIONS.map((m) => (
            <button
              key={m}
              className={`choice-card ${duration === m ? "selected" : ""}`}
              onClick={() => setDuration(m)}
            >
              <div className="choice-title">{m} カ月</div>
              <div className="choice-meta">{m * DAYS_PER_MONTH} 営業日</div>
            </button>
          ))}
        </div>
      </div>

      <button className="btn primary big" onClick={onStart}>
        開業する
      </button>
      {hasSavedGame && <p className="resume-warning">新しく開業すると、中断中のデータは失われます。</p>}
      <button className="btn ghost big" onClick={onShowLeaderboard}>
        ランキングを見る
      </button>
      <p className="guide-link"><a href="/guide.html">遊び方ガイド・開発の背景を読む</a></p>
      <AdBanner slot={AD_SLOT_HOME} />
    </div>
  );
}

/* ============================================================
   ゲーム中画面
   ============================================================ */
function GameScreen({
  difficulty, months, currentMonth, day, totalDay, cash, trust, products,
  pendingArrivals, todayOrders, dailyLog, stockThresholds, onSetThreshold,
  onOpenOrder, onAccept, onNextDay, onEndMonth, onSuspend, onShowHelp,
}) {
  const totalStock = products.reduce((s, p) => s + p.stock, 0);
  const [stockViewMode, setStockViewMode] = useState("total"); // 'total' | productId

  const stockChartData = [
    ...dailyLog.map((d) => ({
      day: d.day,
      在庫: stockViewMode === "total" ? d.stockTotal : (d.stockByProduct[stockViewMode] || 0),
    })),
    {
      day,
      在庫: stockViewMode === "total" ? totalStock : (products.find((p) => p.id === stockViewMode)?.stock || 0),
    },
  ];

  // 表示中のモードに応じた在庫基準量（全体表示のときは各商品の基準量の合計、商品別表示のときはその商品の基準量）
  const referenceThreshold =
    stockViewMode === "total"
      ? products.reduce((s, p) => s + (stockThresholds[p.id] || 0), 0)
      : stockThresholds[stockViewMode] || 0;
  return (
    <div className="screen game-screen">
      <div className="status-bar">
        <div className="status-item"><span className="label">難易度</span><span className="value">{difficulty}</span></div>
        <div className="status-item"><span className="label">月 / 期間</span><span className="value">{currentMonth} / {months} カ月目</span></div>
        <div className="status-item"><span className="label">営業日</span><span className="value">{day} / {DAYS_PER_MONTH} 日目</span></div>
        <div className="status-item"><span className="label">現金</span><span className="value cash">{yen(cash)}</span></div>
        <div className="status-item"><span className="label">信用度</span><span className="value">{trust} / 100</span></div>
        <button className="btn ghost help-btn-small" onClick={onSuspend}>中断する</button>
        <button className="btn ghost help-btn-small" onClick={onShowHelp}>遊び方</button>
      </div>

      <div className="panel">
        <h2>在庫の推移（今月・{stockViewMode === "total" ? "全体" : products.find((p) => p.id === stockViewMode)?.name}）</h2>
        <div className="view-toggle">
          <button className={`toggle-btn ${stockViewMode === "total" ? "active" : ""}`} onClick={() => setStockViewMode("total")}>全体</button>
          {products.map((p) => (
            <button
              key={p.id}
              className={`toggle-btn ${stockViewMode === p.id ? "active" : ""}`}
              onClick={() => setStockViewMode(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={stockChartData}>
            <CartesianGrid stroke="#E5E5E0" />
            <XAxis dataKey="day" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Line type="monotone" dataKey="在庫" stroke="#0E8F6B" strokeWidth={2} dot={false} />
            {referenceThreshold > 0 && (
              <ReferenceLine
                y={referenceThreshold}
                stroke="#E2634B"
                strokeDasharray="6 4"
                strokeWidth={1.5}
                label={{ value: `基準量 ${referenceThreshold}`, position: "insideTopRight", fill: "#E2634B", fontSize: 11 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="game-grid">
        <div className="panel ledger">
          <h2>在庫台帳</h2>
          <table className="ledger-table">
            <thead>
              <tr><th>商品</th><th>在庫</th><th>販売価格</th><th>原価</th><th>基準量</th></tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={p.stock < (stockThresholds[p.id] || 0) ? "low-stock" : ""}>
                  <td>{p.name}</td><td>{p.stock} 本</td><td>{yen(p.price)}</td><td>{yen(p.cost)}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="10"
                      className="threshold-input"
                      value={stockThresholds[p.id] ?? 0}
                      onChange={(e) => onSetThreshold(p.id, e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ledger-total">
            在庫合計: {totalStock} 本 ／ 本日の保管費見込み: {yen(totalStock * STORAGE_RATE)}
          </div>

          {pendingArrivals.length > 0 && (
            <div className="pending-box">
              <h3>入荷予定</h3>
              <ul>
                {pendingArrivals.map((a, i) => {
                  const p = products.find((pp) => pp.id === a.productId);
                  const daysLeft = a.arrivalDay - totalDay;
                  return (
                    <li key={i}>
                      {p ? p.name : a.productId} {a.qty} 本 ／ あと{daysLeft}日で入荷{a.isEmergency && <span className="emergency-tag">緊急</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <button className="btn secondary" onClick={onOpenOrder}>発注する</button>
        </div>

        <div className="panel order-slip">
          <h2>本日の注文伝票（{todayOrders.length}件）</h2>
          {todayOrders.length === 0 && <div className="slip-body">本日の注文はありません。</div>}
          {todayOrders.map((order) => {
            const product = products.find((p) => p.id === order.productId);
            // 受注確定前は「これから引かれる想定の在庫」、確定後は在庫が既に反映済みなので現在値をそのまま使う
            const projectedAfterStock = product ? product.stock - order.qty : 0;
            const currentStock = product ? product.stock : 0;
            return (
              <div key={order.id} className="slip-body order-item">
                <div className="slip-row"><span>商品</span><span>{order.productName}</span></div>
                <div className="slip-row"><span>数量</span><span>{order.qty} 本</span></div>
                <div className="slip-row"><span>現在庫</span><span>{product ? product.stock : "-"} 本</span></div>
                {order.decision === null && (
                  <div className="slip-row">
                    <span>状態</span>
                    <span className={order.fulfillable ? "ok" : "warn"}>
                      {order.fulfillable ? `受注後在庫: ${projectedAfterStock} 本` : "在庫不足のため受注不可"}
                    </span>
                  </div>
                )}
                {order.decision === null && (
                  <div className="slip-actions">
                    <button className="btn accept" disabled={!order.fulfillable} onClick={() => onAccept(order.id)}>受注する</button>
                  </div>
                )}
                {order.decision === "accepted" && <div className="decision-result ok">この注文を受注しました（在庫 {currentStock} 本）。</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="action-bar">
        <button className="btn ghost" onClick={onEndMonth}>当月を終了する</button>
        <button className="btn primary big" onClick={onNextDay}>翌日へ →</button>
      </div>
    </div>
  );
}

/* ============================================================
   発注画面（モーダル・複数商品一括選択）
   ============================================================ */
function OrderModal({ products, draft, setDraft, emergency, setEmergency, cash, onCancel, onSubmit }) {
  const rows = products.map((p) => {
    const lots = toLots(draft[p.id]);
    const isEmergency = !!emergency[p.id];
    const unitCost = isEmergency ? Math.round(p.cost * EMERGENCY_MULTIPLIER) : p.cost;
    return { ...p, lots, isEmergency, unitCost, qty: lots * 100, totalCost: lots * 100 * unitCost };
  });
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalCost = rows.reduce((s, r) => s + r.totalCost, 0);
  const canAfford = totalCost <= cash;
  const hasItems = totalQty > 0;

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <h2>発注画面</h2>
        <p className="order-lead-note">
          通常発注は{LEAD_TIME}営業日後に入荷します。緊急発注にすると仕入原価が{EMERGENCY_MULTIPLIER}倍になる代わりに、翌営業日に入荷します。
        </p>
        <div className="order-rows">
          {rows.map((r) => (
            <div key={r.id} className="order-row">
              <div className="order-row-top">
                <span className="order-row-name">{r.name}</span>
                <span className="order-row-cost">
                  {yen(r.unitCost)}/本{r.isEmergency && <span className="emergency-tag">緊急</span>}
                </span>
              </div>
              <div className="order-row-bottom">
                <div className="lot-stepper">
                  <button
                    type="button"
                    className="lot-step-btn"
                    disabled={r.lots <= 0}
                    onClick={() => setDraft((d) => ({ ...d, [r.id]: Math.max(0, r.lots - 1) }))}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    className="lot-value"
                    value={r.lots}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [r.id]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="lot-step-btn"
                    onClick={() => setDraft((d) => ({ ...d, [r.id]: r.lots + 1 }))}
                  >
                    ＋
                  </button>
                </div>
                <button
                  type="button"
                  className={`emergency-toggle ${r.isEmergency ? "active" : ""}`}
                  onClick={() => setEmergency((e) => ({ ...e, [r.id]: !e[r.id] }))}
                >
                  緊急発注
                </button>
                <span className="order-row-total">{yen(r.totalCost)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="order-summary">
          <div className="slip-row"><span>合計発注数量</span><span>{totalQty} 本</span></div>
          <div className="slip-row"><span>合計発注金額</span><span>{yen(totalCost)}</span></div>
          {!canAfford && <div className="decision-result warn">現金が不足しています。</div>}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>キャンセル</button>
          <button className="btn primary" disabled={!canAfford || !hasItems} onClick={onSubmit}>
            この内容で発注する
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   各種操作の確認画面（モーダル）
   ============================================================ */
function ConfirmModal({ confirmModal, products, todayOrders, orderDraft, orderEmergency, onCancel, onConfirm }) {
  let title = "確認";
  let body = null;

  if (confirmModal.type === "order") {
    const items = Object.entries(orderDraft)
      .map(([productId, lots]) => [productId, toLots(lots)])
      .filter(([, lots]) => lots > 0)
      .map(([productId, lots]) => {
        const product = products.find((p) => p.id === productId);
        const isEmergency = !!orderEmergency[productId];
        return { name: product ? product.name : productId, qty: lots * 100, isEmergency };
      });
    title = "発注の確認";
    body = (
      <div>
        <p>以下の内容で発注します。よろしいですか？</p>
        <ul>{items.map((it, i) => <li key={i}>{it.name}: {it.qty} 本{it.isEmergency && "（緊急発注・翌日入荷）"}</li>)}</ul>
      </div>
    );
  } else if (confirmModal.type === "decision") {
    const order = todayOrders.find((o) => o.id === confirmModal.orderId);
    title = "受注の確認";
    body = (
      <p>
        {order ? `${order.productName} ${order.qty} 本の注文を` : "この注文を"}
        受注します。よろしいですか？
      </p>
    );
  } else if (confirmModal.type === "nextday") {
    title = "翌日へ進む確認";
    body = <p>本日の処理を確定し、翌日へ進みます。よろしいですか？</p>;
  } else if (confirmModal.type === "endmonth") {
    title = "当月を終了する確認";
    body = <p>本日分の実績（受注・保管費）を含めて今月の決算を締めます。本日まだ判断していない注文は見送り扱いとなります（発注済みで入荷待ちの商品は翌月以降も入荷予定のまま引き継がれます）。よろしいですか？</p>;
  } else if (confirmModal.type === "suspend") {
    title = "中断する確認";
    body = <p>現在の進行状況を保存してホーム画面に戻ります。本日まだ確定していない受注・拒否の判断はそのまま保存されます。ホーム画面の「続きから再開する」でいつでも続きを始められます。よろしいですか？</p>;
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box small">
        <h2>{title}</h2>
        {body}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>戻る</button>
          <button className="btn primary" onClick={onConfirm}>確定する</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   説明画面（ルール・操作説明）
   ============================================================ */
/* ============================================================
   ランキング画面（難易度・営業期間を選んで上位を閲覧）
   ============================================================ */
function LeaderboardScreen({ onBack }) {
  const [difficulty, setDifficulty] = useState("初級");
  const [months, setMonths] = useState(3);
  const [status, setStatus] = useState("loading"); // loading | done | error
  const [leaderboard, setLeaderboard] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetch(`/api/leaderboard?difficulty=${encodeURIComponent(difficulty)}&months=${months}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.success) throw new Error(data.error || "取得に失敗しました");
        setLeaderboard(data.leaderboard || []);
        setStatus("done");
      })
      .catch((e) => {
        if (cancelled) return;
        setErrorMessage(e.message || "通信エラーが発生しました");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [difficulty, months]);

  return (
    <div className="screen leaderboard-screen">
      <h1>ランキング</h1>

      <div className="panel">
        <h2>難易度</h2>
        <div className="view-toggle">
          {Object.keys(DIFFICULTIES).map((key) => (
            <button
              key={key}
              className={`toggle-btn ${difficulty === key ? "active" : ""}`}
              onClick={() => setDifficulty(key)}
            >
              {key}
            </button>
          ))}
        </div>
        <h2 style={{ marginTop: 20 }}>営業期間</h2>
        <div className="view-toggle">
          {DURATIONS.map((m) => (
            <button
              key={m}
              className={`toggle-btn ${months === m ? "active" : ""}`}
              onClick={() => setMonths(m)}
            >
              {m}カ月
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>{difficulty}・{months}カ月 トップ10</h2>
        {status === "loading" && <p className="ranking-note">読み込み中…</p>}
        {status === "error" && <div className="decision-result warn">{errorMessage}</div>}
        {status === "done" && leaderboard.length === 0 && (
          <p className="ranking-note">まだ登録がありません。最初の1人になりましょう。</p>
        )}
        {status === "done" && leaderboard.length > 0 && (
          <table className="statement-table ranking-table">
            <thead>
              <tr><th>順位</th><th>名前</th><th>純資産</th></tr>
            </thead>
            <tbody>
              {leaderboard.map((row, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{row.name}</td>
                  <td>{yen(row.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <button className="btn primary big" onClick={onBack}>戻る</button>
    </div>
  );
}

function HelpScreen({ onBack }) {
  return (
    <div className="screen help-screen">
      <h1>遊び方・ルール説明</h1>

      <div className="panel">
        <h2>ゲームの目的</h2>
        <p>あなたは飲料の卸商です。商品を発注して在庫を確保しつつ、毎日届く注文を受けるかどうかを判断し、30日間(1カ月)を乗り切って利益を出すことが目標です。すべての月を終えた時点での純資産の大きさを目指しましょう。</p>
      </div>

      <div className="panel">
        <h2>ホーム画面での設定</h2>
        <ul>
          <li><strong>難易度</strong>: 初級(3品目)・中級(5品目)・上級(10品目)。品目が多いほど管理が複雑になり、1日に届く注文の件数も増えます。</li>
          <li><strong>営業期間</strong>: 3・6・12カ月から選択。期間が長いほど長期的な資金繰りの計画が必要です。</li>
        </ul>
      </div>

      <div className="panel">
        <h2>1日の流れ</h2>
        <ol>
          <li><strong>発注</strong>: 「発注する」ボタンから商品ごとに100本単位(ロット)で発注できます。複数商品を一度に発注可能です。通常発注は<strong>{LEAD_TIME}営業日後</strong>に入荷し、入荷のタイミングで代金が現金から差し引かれます。商品ごとに「緊急発注」に切り替えると、仕入原価が{EMERGENCY_MULTIPLIER}倍になる代わりに<strong>翌営業日</strong>に入荷します。急な欠品対応に使えます。</li>
          <li><strong>注文を受ける</strong>: 毎日、1件以上の注文が届きます(数量はランダム、難易度が上がるほど件数も増加)。それぞれの注文について「受注する」を押すかどうかを判断します。<strong>部分的な受注はできません。</strong>在庫が注文数に満たない場合は自動的に受注できません。受注しないまま「翌日へ」に進むと、その注文は見送り扱いとなり信用度が下がります(下がり幅は難易度により異なります)。</li>
          <li><strong>翌日へ</strong>: その日の発注・受注の対応が終わったら「翌日へ」ボタンを押して次の日に進みます。押した時点で未対応の注文は「保留のまま見送った」扱いとなり、信用度がわずかに下がります。</li>
          <li><strong>当月を終了する</strong>: 30日を待たずに、その時点までの実績で今月の決算を締めたい場合はこのボタンを使います。未処理の注文や入荷待ちの発注はそのまま翌月に繰り越されます。</li>
          <li><strong>中断する</strong>: ゲーム中画面上部のボタンから、現在の進行状況を保存していつでも中断できます。ホーム画面の「続きから再開する」から続きを再開できます（お使いの端末・ブラウザに保存されます）。</li>
        </ol>
      </div>

      <div className="panel">
        <h2>信用度について</h2>
        <p>注文を受けると信用度が少し上がり、受注せずに見送ると信用度が下がります(0〜100)。見送り1件あたりの下がり幅は難易度によって異なります(初級ほど大きく、上級ほど小さく設定されています)。信用度が高いほど、翌日以降に届く注文の数量が安定して大きくなりやすくなります。</p>
      </div>

      <div className="panel">
        <h2>在庫保管費</h2>
        <p>在庫を多く抱えるほど、毎日の保管費が高くなります(1本あたり{yen(STORAGE_RATE)}／日を在庫数量分だけ加算)。売れ残りを抱えすぎないよう、発注量の調整が重要です。</p>
      </div>

      <div className="panel">
        <h2>決算画面の見方</h2>
        <ul>
          <li><strong>在庫の推移／受注量の推移</strong>: 「全体」または商品ごとに切り替えて確認できます。</li>
          <li><strong>総注文量と受注量の比較</strong>: 今月どれだけの注文機会を取りこぼしたかが分かります。</li>
          <li><strong>損益計算書(PL)</strong>: 売上高から売上原価・保管費・固定費(家賃・水道光熱費・人件費)を差し引いた当期純利益を表示します。</li>
          <li><strong>貸借対照表(BS)</strong>: 現金と在庫評価額の資産合計、資本金と繰越利益剰余金による純資産合計を表示します。</li>
        </ul>
      </div>

      <button className="btn primary big" onClick={onBack}>戻る</button>
    </div>
  );
}

/* ============================================================
   決算画面（商品別／全体の切り替え対応）
   ============================================================ */
function SettlementScreen({ settlement, isFinalMonth, onNext }) {
  const [viewMode, setViewMode] = useState("total"); // 'total' | productId

  const chartData = settlement.dailyLog.map((d) => ({
    day: d.day,
    在庫: viewMode === "total" ? d.stockTotal : (d.stockByProduct[viewMode] || 0),
    受注量: viewMode === "total" ? d.acceptedQtyTotal : (d.acceptedByProduct[viewMode] || 0),
  }));
  const comparisonData = [
    { name: "今月", 総注文量: settlement.totalRequested, 受注量: settlement.totalAccepted },
  ];

  return (
    <div className="screen settlement-screen">
      <h1>第 {settlement.month} 月 決算報告</h1>

      <div className="view-toggle">
        <button className={`toggle-btn ${viewMode === "total" ? "active" : ""}`} onClick={() => setViewMode("total")}>全体</button>
        {settlement.products.map((p) => (
          <button
            key={p.id}
            className={`toggle-btn ${viewMode === p.id ? "active" : ""}`}
            onClick={() => setViewMode(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="panel">
        <h2>在庫の推移（{viewMode === "total" ? "全体" : settlement.products.find((p) => p.id === viewMode)?.name}）</h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData}>
            <CartesianGrid stroke="#E5E5E0" />
            <XAxis dataKey="day" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Line type="monotone" dataKey="在庫" stroke="#0E8F6B" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="panel">
        <h2>受注量の推移（{viewMode === "total" ? "全体" : settlement.products.find((p) => p.id === viewMode)?.name}）</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData}>
            <CartesianGrid stroke="#E5E5E0" />
            <XAxis dataKey="day" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="受注量" fill="#0E8F6B" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="panel">
        <h2>総注文量と受注量の比較</h2>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={comparisonData} layout="vertical">
            <CartesianGrid stroke="#E5E5E0" />
            <XAxis type="number" tick={{ fontSize: 12 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="総注文量" fill="#E2634B" />
            <Bar dataKey="受注量" fill="#0E8F6B" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>損益計算書（PL）</h2>
          <table className="statement-table">
            <tbody>
              <tr><td>売上高</td><td>{yen(settlement.revenue)}</td></tr>
              <tr><td>売上原価</td><td>{yen(settlement.cogs)}</td></tr>
              <tr className="subtotal"><td>売上総利益</td><td>{yen(settlement.revenue - settlement.cogs)}</td></tr>
              <tr><td>保管費</td><td>{yen(settlement.storageCostTotal)}</td></tr>
              <tr><td>緊急発注割増費</td><td>{yen(settlement.emergencyPremiumTotal)}</td></tr>
              <tr><td>地代家賃</td><td>{yen(settlement.fixed.rent)}</td></tr>
              <tr><td>水道光熱費</td><td>{yen(settlement.fixed.utilities)}</td></tr>
              <tr><td>人件費</td><td>{yen(settlement.fixed.labor)}</td></tr>
              <tr className="total">
                <td>当期純利益</td>
                <td className={settlement.netIncome >= 0 ? "ok" : "warn"}>{yen(settlement.netIncome)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>貸借対照表（BS）</h2>
          <table className="statement-table">
            <tbody>
              <tr><td>現金</td><td>{yen(settlement.cash)}</td></tr>
              <tr><td>棚卸資産（在庫評価額）</td><td>{yen(settlement.inventoryValue)}</td></tr>
              <tr className="subtotal"><td>資産合計</td><td>{yen(settlement.assets)}</td></tr>
              <tr><td>資本金</td><td>{yen(settlement.capitalStock)}</td></tr>
              <tr><td>繰越利益剰余金</td><td>{yen(settlement.retainedEarnings)}</td></tr>
              <tr className="total"><td>純資産合計</td><td>{yen(settlement.capitalStock + settlement.retainedEarnings)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <button className="btn primary big" onClick={onNext}>
        {isFinalMonth ? "最終決算を締める" : "次の月へ"}
      </button>
    </div>
  );
}

/* ============================================================
   ゲーム終了画面
   ============================================================ */
function EndScreen({ monthlyRecords, onRestart, difficulty, months, gameSeed, actionLog }) {
  const last = monthlyRecords[monthlyRecords.length - 1];
  const totalNetIncome = monthlyRecords.reduce((s, m) => s + m.netIncome, 0);
  const trendData = monthlyRecords.map((m) => ({ month: `${m.month}月`, 純利益: m.netIncome }));

  const [playerName, setPlayerName] = useState("");
  const [submitState, setSubmitState] = useState("idle"); // idle | submitting | done | error
  const [errorMessage, setErrorMessage] = useState("");
  const [leaderboard, setLeaderboard] = useState(null);
  const [myScore, setMyScore] = useState(null);

  const submitScore = async () => {
    if (!playerName.trim()) return;
    setSubmitState("submitting");
    setErrorMessage("");
    try {
      const res = await fetch("/api/submit-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: playerName.trim().slice(0, 20),
          difficulty,
          months,
          seed: gameSeed,
          actions: actionLog,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "登録に失敗しました");
      }
      setMyScore(data.score);
      setLeaderboard(data.leaderboard || []);
      setSubmitState("done");
    } catch (e) {
      setErrorMessage(e.message || "通信エラーが発生しました");
      setSubmitState("error");
    }
  };

  return (
    <div className="screen end-screen">
      <h1>営業終了 ― 最終決算</h1>
      <div className="panel">
        <h2>月次純利益の推移</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={trendData}>
            <CartesianGrid stroke="#E5E5E0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="純利益" fill="#0E8F6B" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="panel summary-panel">
        <div className="slip-row"><span>営業月数</span><span>{monthlyRecords.length} カ月</span></div>
        <div className="slip-row"><span>累計純利益</span><span className={totalNetIncome >= 0 ? "ok" : "warn"}>{yen(totalNetIncome)}</span></div>
        <div className="slip-row"><span>最終純資産</span><span>{last ? yen(last.capitalStock + last.retainedEarnings) : "-"}</span></div>
        <div className="slip-row"><span>最終現金</span><span>{last ? yen(last.cash) : "-"}</span></div>
      </div>

      <div className="panel">
        <h2>ランキングに登録（{difficulty}・{months}カ月）</h2>
        {submitState !== "done" && (
          <>
            <p className="ranking-note">
              サーバー側でプレイ内容を再計算し、正式な最終純資産としてランキングに登録します。
            </p>
            <div className="field">
              <label>表示名（20文字まで）</label>
              <input
                type="text"
                maxLength={20}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="例: しゅん"
              />
            </div>
            {submitState === "error" && <div className="decision-result warn">{errorMessage}</div>}
            <button
              className="btn primary big"
              disabled={!playerName.trim() || submitState === "submitting"}
              onClick={submitScore}
            >
              {submitState === "submitting" ? "登録中…" : "ランキングに登録する"}
            </button>
          </>
        )}
        {submitState === "done" && (
          <>
            <div className="decision-result ok">
              登録しました！(サーバー算出スコア: {yen(myScore)})
            </div>
            <table className="statement-table ranking-table">
              <thead>
                <tr><th>順位</th><th>名前</th><th>純資産</th></tr>
              </thead>
              <tbody>
                {leaderboard && leaderboard.map((row, i) => (
                  <tr key={i} className={row.name === playerName.trim() && row.score === myScore ? "ranking-me" : ""}>
                    <td>{i + 1}</td>
                    <td>{row.name}</td>
                    <td>{yen(row.score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <button className="btn primary big" onClick={onRestart}>最初からやり直す</button>
    </div>
  );
}

/* ============================================================
   スタイル（レシート／台帳ふうデザイン）
   ============================================================ */
const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

.bg-root {
  --bg: #FAFAF8;
  --sheet: #FFFFFF;
  --ink: #14181C;
  --ink-secondary: #5B6167;
  --line: #E5E5E0;
  --green: #0E8F6B;
  --green-strong: #0B7358;
  --green-tint: #E4F3EE;
  --red: #E2634B;
  --red-tint: #FBEAE6;
  font-family: 'Inter', sans-serif;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  background: var(--bg);
  min-height: 100%;
  padding: 20px;
  box-sizing: border-box;
}
.bg-root * { box-sizing: border-box; }
.bg-root h1, .bg-root h2, .bg-root h3 { font-family: 'Inter', sans-serif; margin: 0 0 12px 0; font-weight: 600; }
.screen { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }

.ledger-header { text-align: center; padding: 12px 0 4px; }
.ledger-header .stamp { display: inline-block; background: var(--green-tint); color: var(--green-strong); padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; margin-bottom: 10px; }
.ledger-header h1 { font-size: 26px; font-weight: 700; }
.ledger-header h1 .title-sub { display: block; font-size: 16px; font-weight: 500; color: var(--ink-secondary); margin-top: 4px; }
.ledger-header .subtitle { font-size: 13px; color: var(--ink-secondary); }
.help-btn { margin-top: 12px; }
.resume-panel { border-color: var(--green); background: var(--green-tint); }
.resume-panel h2 { border-bottom-color: rgba(14,143,107,0.25); }
.resume-note { font-size: 13px; color: var(--ink-secondary); margin: 0 0 12px; }
.resume-warning { font-size: 12px; color: var(--ink-secondary); text-align: center; margin: -8px 0 0; }
.guide-link { text-align: center; font-size: 13px; margin: 4px 0 0; }
.guide-link a { color: var(--green-strong); }
.help-btn-small { margin-left: auto; align-self: center; font-size: 12px; padding: 6px 12px; }

.help-screen ul, .help-screen ol { padding-left: 20px; font-size: 13px; line-height: 1.7; margin: 0; }
.help-screen li { margin-bottom: 6px; }
.help-screen p { font-size: 13px; line-height: 1.7; margin: 0; }
.help-screen strong { color: var(--green-strong); font-weight: 600; }

.panel { background: var(--sheet); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; }
.panel h2 { font-size: 16px; font-weight: 600; border-bottom: 1px solid var(--line); padding-bottom: 10px; }

.choice-row { display: flex; gap: 10px; flex-wrap: wrap; }
.choice-card { flex: 1 1 150px; border: 1px solid var(--line); background: var(--sheet); padding: 14px; text-align: left; cursor: pointer; border-radius: 12px; font-family: inherit; color: var(--ink); }
.choice-card.selected { border-color: var(--green); background: var(--green-tint); box-shadow: 0 0 0 1px var(--green) inset; }
.choice-title { font-weight: 600; font-size: 15px; }
.choice-meta { font-size: 11px; color: var(--ink-secondary); margin-top: 4px; }

.btn { font-family: 'Inter', sans-serif; border: none; cursor: pointer; padding: 12px 18px; border-radius: 12px; font-size: 14px; font-weight: 600; }
.btn.primary { background: var(--green); color: #FFFFFF; }
.btn.primary:disabled { background: #B7CFC7; cursor: not-allowed; }
.btn.secondary { background: var(--ink); color: #FFFFFF; margin-top: 12px; }
.btn.ghost { background: transparent; border: 1px solid var(--line); color: var(--ink); }
.btn.accept { background: var(--green); color: #FFFFFF; }
.btn.big { align-self: center; padding: 15px 30px; font-size: 16px; width: 100%; max-width: 320px; }

.status-bar { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; background: var(--sheet); border: 1px solid var(--line); padding: 12px 16px; border-radius: 14px; }
.status-item { display: flex; flex-direction: column; font-size: 11px; }
.status-item .label { color: var(--ink-secondary); }
.status-item .value { font-size: 15px; font-weight: 600; }
.status-item .value.cash { color: var(--green-strong); }

.game-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; }
@media (max-width: 680px) { .game-grid { grid-template-columns: 1fr; } }

.ledger-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ledger-table th, .ledger-table td { text-align: left; padding: 8px 4px; border-bottom: 1px solid var(--line); }
.ledger-table th { color: var(--ink-secondary); font-weight: 500; font-size: 12px; }
.ledger-table tr.low-stock td { color: var(--red); font-weight: 600; }
.threshold-input { width: 56px; font-family: inherit; padding: 4px 6px; border: 1px solid var(--line); border-radius: 8px; background: var(--sheet); color: var(--ink); font-size: 12px; }
.ledger-total { text-align: right; font-size: 12px; margin-top: 8px; color: var(--ink-secondary); }

.pending-box { margin-top: 12px; font-size: 12px; background: var(--bg); padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
.pending-box ul { margin: 4px 0 0; padding-left: 18px; }

.order-item { border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 12px; }
.order-item:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }

.slip-body { font-size: 14px; }
.slip-row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid var(--line); }
.slip-actions { display: flex; gap: 10px; margin-top: 14px; }
.slip-actions .btn { flex: 1; }
.decision-result { margin-top: 12px; font-weight: 600; }
.decision-result.ok, .ok { color: var(--green-strong); }
.decision-result.warn, .warn { color: var(--red); }

.action-bar { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
.action-bar .btn { flex: 1; max-width: 320px; }

.modal-overlay { position: fixed; inset: 0; background: rgba(20,24,28,0.5); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 16px; }
.modal-box { background: var(--sheet); border: 1px solid var(--line); border-radius: 16px; padding: 22px; width: 100%; max-width: 480px; font-family: 'Inter', sans-serif; max-height: 90vh; overflow-y: auto; }
.modal-box.small { max-width: 360px; }
.settlement-ad-box { text-align: center; }
.settlement-ad-box .btn { margin-top: 16px; }
.ad-slot { margin: 16px 0; text-align: center; }
.ad-slot-label { display: block; font-size: 10px; color: var(--ink-secondary); margin-bottom: 4px; letter-spacing: 1px; }
.order-lead-note { font-size: 12px; color: var(--ink-secondary); margin: -4px 0 12px; line-height: 1.6; }
.order-rows { display: flex; flex-direction: column; gap: 10px; margin-bottom: 10px; }
.order-row { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.order-row-top { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; margin-bottom: 8px; }
.order-row-name { font-weight: 600; }
.order-row-cost { color: var(--ink-secondary); }
.order-row-bottom { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.order-row-total { margin-left: auto; font-size: 13px; font-weight: 600; }
.emergency-toggle { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 500; padding: 6px 10px; border: 1px solid var(--red); background: var(--sheet); color: var(--red); border-radius: 999px; cursor: pointer; }
.emergency-toggle.active { background: var(--red); color: #FFFFFF; }
.emergency-tag { display: inline-block; font-size: 10px; font-weight: 600; color: var(--red); background: var(--red-tint); border-radius: 999px; padding: 1px 7px; margin-left: 6px; vertical-align: middle; }
.lot-stepper { display: flex; align-items: center; gap: 4px; }
.lot-step-btn {
  width: 32px; height: 32px; flex: 0 0 auto;
  font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 600; line-height: 1;
  border: 1px solid var(--line); border-radius: 10px; background: var(--sheet); color: var(--ink);
  cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center;
}
.lot-step-btn:active { background: var(--bg); }
.lot-step-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.lot-value {
  width: 44px; text-align: center; font-family: inherit; font-size: 13px;
  padding: 6px 2px; border: 1px solid var(--line); border-radius: 8px; background: var(--sheet); color: var(--ink);
}
/* number入力のスピンボタン（ブラウザ標準の増減UI）は独自ステッパーと重複するため非表示にする */
.lot-value::-webkit-inner-spin-button, .lot-value::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.lot-value { -moz-appearance: textfield; }
.order-summary { margin: 10px 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.modal-actions .btn { flex: 0 0 auto; }

.view-toggle { display: flex; gap: 6px; flex-wrap: wrap; }
.toggle-btn { font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 500; padding: 7px 14px; border: 1px solid var(--line); background: var(--sheet); color: var(--ink); border-radius: 999px; cursor: pointer; }
.toggle-btn.active { background: var(--green); color: #FFFFFF; border-color: var(--green); }

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 680px) { .grid-2 { grid-template-columns: 1fr; } }

.statement-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.statement-table td { padding: 8px 4px; border-bottom: 1px solid var(--line); }
.statement-table td:last-child { text-align: right; }
.statement-table tr.subtotal td { font-weight: 600; border-top: 1px solid var(--line); }
.statement-table tr.total td { font-weight: 700; border-top: 2px solid var(--ink); }

.summary-panel .slip-row { font-size: 14px; }
.ranking-note { font-size: 12px; color: var(--ink-secondary); margin: -4px 0 12px; line-height: 1.6; }
.ranking-table { margin-top: 12px; }
.ranking-table th:first-child, .ranking-table td:first-child { width: 40px; }
.ranking-table tr.ranking-me td { font-weight: 700; color: var(--green-strong); }
`;
