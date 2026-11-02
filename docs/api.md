# HEART RELAY バックエンド API 契約（v1）

ベースURL: `http://<PCのIP>:8787`（開発時）。すべて JSON。文字コード UTF-8。
認証: 第一段階は職員アカウント選択のみ。Android は `X-Staff-Id: <staff_id>` ヘッダを付ける。

## 共通型

```ts
type Role = "事業所長" | "理学療法士" | "看護師" | "生活相談員" | "運転手" | "介護職員";

interface Staff { id: string; name: string; role: Role; duties: string[]; active: boolean }
interface Resident { id: string; name: string; notes: string }

interface Analysis {
  summary: string;            // 1〜2文の要約
  categories: string[];       // 例 ["受診","送迎","時間変更"]
  urgency: "high" | "medium" | "low";
  resident_id: string | null; // 対象利用者（判別できない場合 null）
  deadline: string | null;    // 例 "15:00" / "2026-11-05"
  required_actions: string[]; // 必要な対応
  recipients: RecipientProposal[];
  board_summary: string;      // 共有ボード向け要点（画面は後続段階）
  excluded_note: string;      // 送らないと判断した理由の要約
}
interface RecipientProposal {
  staff_id: string; reason: string;
  title: string; body: string; action_required: string;
}

interface Message {
  id: string; raw_text: string; source: string; created_by: string; created_at: string;
  status: "analyzing" | "proposed" | "sent" | "failed";
  analyzer: "claude" | "mock" | null; model: string | null; error: string | null;
  usage: { input_tokens: number; output_tokens: number; est_cost_usd: number } | null;
  analysis: Analysis | null;
  deliveries: Delivery[];     // sent 以降
}
interface Delivery {
  id: string; message_id: string; staff_id: string; staff_name: string; staff_role: Role;
  title: string; body: string; action_required: string; reason: string;
  urgency: "high"|"medium"|"low"; categories: string[];
  created_at: string; acknowledged_at: string | null;
}
```

## エンドポイント

| Method | Path | 用途 | 呼び出し元 |
|---|---|---|---|
| GET | `/api/health` | 稼働確認 `{ok, analyzer, model, time}` | 全部 |
| GET | `/api/staff` | 職員一覧 | PC / Android |
| GET | `/api/residents` | 利用者一覧（架空） | PC |
| GET | `/api/messages` | 連絡事項一覧（新しい順、deliveries含む） | PC |
| POST | `/api/messages` | 連絡事項登録＋AI解析 `{raw_text, source?, created_by?}` → `Message`（同期。解析完了まで待つ、最大60秒） | PC |
| GET | `/api/messages/:id` | 連絡事項詳細（確認状況含む） | PC |
| POST | `/api/messages/:id/reanalyze` | 再解析 | PC |
| POST | `/api/messages/:id/send` | 承認して配信 `{recipients: RecipientProposal[]}` → `Message(status=sent)` | PC |
| GET | `/api/staff/:id/deliveries` | 当該職員宛の配信一覧（新しい順）。`?since=<ISO>` で差分 | Android |
| POST | `/api/deliveries/:id/ack` | 確認 `{client: "android"|"web"}`。ヘッダ `X-Staff-Id` 必須、配信先本人以外は 403 → `Delivery` | Android |
| GET | `/api/stats` | ダッシュボード用 `{messages, deliveries, acked, unacked}` | PC |

### エラー形式
`{ error: string, code?: string }` と適切な HTTP ステータス（400/403/404/429/500）。

### 解析呼び出しの保護
- 解析は `POST /api/messages` と `/reanalyze` のみで実行。ポーリング系はDB読み取りのみ。
- 1分あたりの解析回数上限 `ANALYZE_RATE_LIMIT_PER_MIN`（既定 10）。超過時 429。

## Android の最小フロー
1. 起動時 `GET /api/staff` → 職員選択（端末に保存）
2. 5秒ごと `GET /api/staff/:id/deliveries` → 新着（前回より増えた未確認）があれば端末通知
3. 詳細画面で「確認しました」→ `POST /api/deliveries/:id/ack` → `acknowledged_at` を反映
4. 設定画面でサーバURLを変更可能（既定 `http://10.0.2.2:8787` はエミュレータ用。実機はPCのLAN IP）
