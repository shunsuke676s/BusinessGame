/* ============================================================
   /api/leaderboard
   スコアを登録せず、指定した難易度・営業期間の上位ランキングだけを
   取得するための読み取り専用エンドポイント。
   ============================================================ */
 
const DIFFICULTIES = ["初級", "中級", "上級"];
const VALID_MONTHS = [3, 6, 12];
 
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }
 
  try {
    const difficulty = req.query.difficulty;
    const months = Number(req.query.months);
 
    if (!DIFFICULTIES.includes(difficulty)) throw new Error("難易度が不正です");
    if (!VALID_MONTHS.includes(months)) throw new Error("営業期間が不正です");
 
    const params = new URLSearchParams({
      difficulty: `eq.${difficulty}`,
      months: `eq.${months}`,
      select: "name,score,created_at",
      order: "score.desc",
      limit: "10",
    });
    const url = `${process.env.SUPABASE_URL}/rest/v1/scores?${params.toString()}`;
    const supabaseRes = await fetch(url, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!supabaseRes.ok) throw new Error("ランキングの取得に失敗しました");
    const leaderboard = await supabaseRes.json();
 
    res.status(200).json({ success: true, leaderboard });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message || "不明なエラーが発生しました" });
  }
}
