// HEART RELAY 開発用フェイクサーバ (依存なし / Node 18+)
//   node android/dev/fake-server.mjs [port]     既定 8787
// 追加配信(通知テスト):  curl -X POST http://localhost:8787/dev/send -H "Content-Type: application/json" \
//   -d '{"staff_id":"s01","title":"テスト","body":"本文","urgency":"high"}'
import http from "node:http";

const port = Number(process.argv[2] || process.env.PORT || 8787);
const staff = [
  { id: "s01", name: "高橋 美咲", role: "事業所長", duties: [], active: true },
  { id: "s02", name: "伊藤 健", role: "生活相談員", duties: ["相談対応"], active: true },
  { id: "s03", name: "山田 花子", role: "看護師", duties: ["バイタル測定"], active: true },
  { id: "s04", name: "中村 亮", role: "理学療法士", duties: ["機能訓練"], active: true },
  { id: "s05", name: "小林 直樹", role: "運転手", duties: ["送迎(午後)"], active: true },
  { id: "s06", name: "渡辺 優子", role: "介護職員", duties: ["入浴介助"], active: true },
  { id: "s07", name: "退職 太郎", role: "介護職員", duties: [], active: false },
];
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
let seq = 0;
const deliveries = [];
function add(staff_id, title, body, urgency, categories, action, reason, ageMin = 0) {
  const s = staff.find((x) => x.id === staff_id);
  deliveries.push({
    id: `d${++seq}`, message_id: `m${seq}`, staff_id, staff_name: s.name, staff_role: s.role,
    title, body, action_required: action, reason, urgency, categories,
    created_at: iso(Date.now() - ageMin * 60000), acknowledged_at: null,
  });
}
add("s05", "A様 15時までに帰宅 (受診)", "A様は受診のため本日15時までにご自宅へお送りする必要があります。", "high", ["受診", "送迎", "時間変更"], "14:30に送迎車を出せるよう準備してください。", "本日午後の送迎担当のため", 20);
add("s05", "B様 本日欠席", "B様は体調不良のため本日欠席です。送迎は不要です。", "low", ["欠席"], "送迎ルートからB様を外してください。", "送迎ルートに影響するため", 90);
add("s06", "A様 入浴は午前に変更", "A様は午後受診のため、入浴を午前中に変更します。", "medium", ["時間変更"], "入浴順を調整してください。", "入浴介助の担当のため", 40);

const send = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  console.log(new Date().toISOString(), req.method, p);
  let m;
  if (req.method === "GET" && p === "/api/health") return send(res, 200, { ok: true, analyzer: "mock", model: null, time: iso(Date.now()) });
  if (req.method === "GET" && p === "/api/staff") return send(res, 200, staff);
  if (req.method === "GET" && (m = p.match(/^\/api\/staff\/([^/]+)\/deliveries$/))) {
    let list = deliveries.filter((d) => d.staff_id === m[1]);
    const since = url.searchParams.get("since");
    if (since) list = list.filter((d) => d.created_at > since);
    return send(res, 200, list.sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }
  if (req.method === "POST" && (m = p.match(/^\/api\/deliveries\/([^/]+)\/ack$/))) {
    const d = deliveries.find((x) => x.id === m[1]);
    if (!d) return send(res, 404, { error: "not found" });
    if (req.headers["x-staff-id"] !== d.staff_id) return send(res, 403, { error: "forbidden" });
    d.acknowledged_at ??= iso(Date.now());
    return send(res, 200, d);
  }
  if (req.method === "POST" && p === "/dev/send") {
    let o = {}; try { o = JSON.parse((await readBody(req)) || "{}"); } catch {}
    if (!staff.find((s) => s.id === o.staff_id)) return send(res, 400, { error: "staff_id invalid" });
    add(o.staff_id, o.title || "テスト連絡", o.body || "テスト本文", o.urgency || "medium", o.categories || ["テスト"], o.action_required || "内容を確認してください", o.reason || "開発用", 0);
    return send(res, 200, deliveries[deliveries.length - 1]);
  }
  send(res, 404, { error: "not found" });
}).listen(port, "0.0.0.0", () => console.log(`fake server on :${port}`));
