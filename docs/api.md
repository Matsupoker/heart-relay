# HEART RELAY バックエンド API 契約（v2）

ベースURL: `http://<PCのIP>:8787`（開発時）。すべて JSON（ファイル取り込みのみ multipart）。文字コード UTF-8。
認証: 職員アカウント選択のみ。Android は `X-Staff-Id: <staff_id>` ヘッダを付ける。

v1（第一段階）からの差分は **「v2 追加」** と記す。v1 のエンドポイント・型は後方互換で維持する（Android アプリは無変更で動く）。

## 共通型

```ts
type Role = "事業所長" | "理学療法士" | "看護師" | "生活相談員" | "運転手" | "介護職員";

interface Staff {
  id: string; name: string; role: Role; duties: string[]; active: boolean;
  ledger_staff_id: string | null;   // v2 追加: HARMONIZE2 側の職員ID（S0001…）。対応が無ければ null
  transport_routes: string[];       // v2 追加: 担当する送迎コース（"1".."4"）。運転手・送迎添乗のみ
}

// v2 追加: 200名台帳（fixtures/ 由来、すべて架空）
interface Resident {
  id: string;                // 4桁文字列 "0001"（先頭ゼロ保持）
  name: string;              // "新田 洋子"（半角空白1個）
  kana: string;              // 半角カナ "ﾆｯﾀ ﾖｳｺ"
  sei: string; mei: string;  // 空の場合あり（kanaBoundary review）
  gender: string; birth_date: string; age: number;
  service_status: "利用中" | "中止中" | "終了";
  weekly_pattern: string[];  // ["月","水","金"]
  transport_route: string;   // "1".."4" or ""（施設居住）
  transport_note: string;
  mobility: string;          // "1.独歩" など
  residence: string;         // "1.自宅" など
  care_manager: string; office: string;
  staff_id: string | null;   // 担当職員（HEART RELAY の staff.id に変換済み）
  staff_name: string | null;
  attendance: { date: string; status: "出席"|"欠席"|"対象外"; reason: string }; // デモ基準日の当日出欠
  notes: string;             // v1 互換の要約1行（"利用中 / 月水金 / 送迎コース4 / 独歩 / 担当: 清水 達也"）
}

// v2 追加: 利用者照合の候補
interface ResidentCandidate {
  id: string; name: string; kana: string; service_status: string;
  score: number;             // 100 = ID一致, 90 = 氏名完全一致, 85 = カナ完全一致, 50 = 姓のみ
  reason: string;            // "氏名が一致" / "姓「新田」が一致" など
  same_name: boolean;        // 同姓同名が台帳に存在する
}
interface ResidentMatch {
  status: "confirmed" | "ambiguous" | "none";
  resident_id: string | null;         // confirmed のとき
  candidates: ResidentCandidate[];    // 最大 10 件、score 降順・利用中優先
}

interface Analysis {
  summary: string;
  categories: string[];
  urgency: "high" | "medium" | "low";
  resident_id: string | null;  // サーバーが確定した利用者（Claude の出力ではなく message.resident_id を正とする）
  deadline: string | null;
  required_actions: string[];
  recipients: RecipientProposal[];
  excluded: ExcludedStaff[];   // v2 追加: 宛先に含めなかった職員と理由（構造化）
  excluded_note: string;       // v1 互換の要約文
  audience: "individual" | "board" | "both";   // v2 追加: 個別配信／全体共有／両方
  board_post: BoardPostProposal | null;        // v2 追加: audience が board/both のとき必須
  board_summary: string;       // v1 互換（board_post.body の1行版）
}
interface RecipientProposal { staff_id: string; reason: string; title: string; body: string; action_required: string }
interface ExcludedStaff { staff_id: string; reason: string }     // v2 追加
interface BoardPostProposal { title: string; body: string; until: string | null }  // v2 追加。until は ISO 日時 or null（当日中）

// v2 追加: 取り込みファイル
interface Attachment {
  id: string; filename: string; mime: string; size: number;
  kind: "image" | "pdf" | "txt" | "docx" | "xlsx" | "xls";
  extractor: "claude" | "local";
  extracted_text: string;      // 職員が確認・修正する前の抽出結果
  warnings: string[];          // 例 "マクロは実行していません", "文字コードを Shift_JIS と判定"
  created_at: string;
  message_id: string | null;   // 連絡事項に紐づけ後
}

interface Message {
  id: string; raw_text: string; source: string; created_by: string; created_at: string;
  status: "needs_resident" | "analyzing" | "proposed" | "sent" | "failed";  // v2 追加: needs_resident
  analyzer: "claude" | "mock" | null; model: string | null; error: string | null;
  usage: { input_tokens: number; output_tokens: number; est_cost_usd: number } | null;
  resident_id: string | null;              // v2 追加: 確定した対象利用者
  resident: Resident | null;               // v2 追加
  resident_match: ResidentMatch | null;    // v2 追加: 照合結果（needs_resident のとき candidates を表示）
  attachments: Attachment[];               // v2 追加（extracted_text は省略可）
  analysis: Analysis | null;
  deliveries: Delivery[];
  board_post: BoardPost | null;            // v2 追加: 配信時に作成された共有ボード投稿
}
interface Delivery { /* v1 と同じ */ }

// v2 追加
interface BoardPost {
  id: string; message_id: string; title: string; body: string;
  urgency: "high"|"medium"|"low"; categories: string[];
  resident_name: string | null;   // 画面表示用（氏名のみ）
  created_at: string; until: string | null; archived_at: string | null;
}
```

## エンドポイント

| Method | Path | 用途 | 呼び出し元 |
|---|---|---|---|
| GET | `/api/health` | `{ok, analyzer, model, time, residents: number}` | 全部 |
| GET | `/api/staff` | 職員一覧 | PC / Android |
| GET | `/api/residents?q=&limit=` | **v2 変更**: 台帳検索（氏名・カナ・ID の部分一致、既定 limit 20、`q` 無しは全件） | PC |
| GET | `/api/residents/:id` | **v2 追加**: 利用者詳細 | PC |
| POST | `/api/residents/match` | **v2 追加**: `{text}` → `ResidentMatch`（Claude は呼ばない。決定的照合のみ） | PC |
| GET | `/api/messages` | 連絡事項一覧（新しい順） | PC |
| POST | `/api/messages` | 登録＋照合＋解析 `{raw_text, source?, created_by?, resident_id?, attachment_ids?: string[]}`。照合が `ambiguous` なら **解析せず** `status=needs_resident` で返す。`resident_id` を明示（`""` は「利用者に関係しない」）すると照合をスキップ | PC |
| POST | `/api/messages/:id/resident` | **v2 追加**: `{resident_id: string | null}` で対象利用者を確定し解析を実行 → `Message`。`needs_resident`／`proposed`／`failed` で呼べる（proposed のときは再解析になる） | PC |
| GET | `/api/messages/:id` | 詳細 | PC |
| POST | `/api/messages/:id/reanalyze` | 再解析 | PC |
| POST | `/api/messages/:id/send` | 承認して配信 `{recipients: RecipientProposal[], board_post?: BoardPostProposal | null}`。`recipients` が空でも `board_post` があれば可（全体共有のみ）。両方空は 400 | PC |
| GET | `/api/staff/:id/deliveries` | v1 と同じ | Android |
| POST | `/api/deliveries/:id/ack` | v1 と同じ | Android |
| GET | `/api/stats` | `{messages, deliveries, acked, unacked, board_posts}` | PC |
| GET | `/api/board` | **v2 追加**: 有効な共有ボード投稿（`archived_at IS NULL` かつ `until` 未到来または null）を新しい順 | タブレット |
| POST | `/api/board/:id/archive` | **v2 追加**: 掲示を終了 | PC |
| POST | `/api/intake` | **v2 追加**: multipart `file`（1件、最大 20MB）→ `Attachment`。画像/PDF は Claude で読み取り、TXT/DOCX/XLS/XLSX はローカル抽出。レート制限は解析と共有 | PC / スマホ |
| GET | `/api/attachments/:id` | **v2 追加**: `Attachment`（extracted_text 含む） | PC |
| GET | `/api/attachments/:id/file` | **v2 追加**: 元ファイルを返す（画像プレビュー用） | PC |
| GET | `/api/demo-messages` | デモ用サンプル文 | PC |

### 画面（静的）
- `/`（index.html）: 入力・提案確認・配信状況。PC・スマホ共通（レスポンシブ）
- `/board.html`: フロア共有タブレット用の全画面ページ。5秒ごとに `/api/board` を取得。確認操作は無い（個別確認履歴とは区別）

### 利用者照合の規則（サーバー側・決定的）
1. 文字列正規化: NFKC → 空白除去 → 敬称（様・さん・氏・さま）除去。カナは半角→全角、濁点結合。
2. ID: `ID`/`No.`/`#`/`利用者` に続く4桁、または `"0001"` のような引用付き4桁のみ ID 一致とする（時刻・年の4桁誤認を避ける）。
3. 氏名完全一致（姓名連結）・カナ完全一致 → 候補 score 90/85。姓のみ一致 → 50。
4. **自動確定は「ID一致」または「氏名／カナ完全一致で台帳に同姓同名が無い」場合のみ**。それ以外（姓のみ・同姓同名・複数候補）は `ambiguous` として職員に選ばせる。
5. 候補なし → `none`。解析は `resident_id=null` で進める（提案画面で手動設定可）。
6. Claude へは確定した利用者 1 名の情報のみ渡す（200名の一覧は渡さない）。

### 解析時に Claude へ渡す文脈
- 現在日時（JST）
- 職員名簿（id／氏名／職種／当日の担当業務／送迎コース担当）
- 確定した利用者の台帳情報（利用状況・曜日予定・当日出欠・送迎コースと注意・移動手段・居住先・担当職員・ケアマネ事業所）。未確定なら「対象利用者: 特定なし」
- 連絡事項本文（取り込みファイルがあれば「入手経路: FAX（画像）」等）

### エラー形式
`{ error: string, code?: string }`。400/403/404/413/415/429/500。

### 解析呼び出しの保護
- Claude を呼ぶのは `POST /api/messages`、`/resident`、`/reanalyze`、`/api/intake`（画像/PDF）のみ。
- 1分あたりの上限 `ANALYZE_RATE_LIMIT_PER_MIN`（既定 10）。超過時 429。

## Android の最小フロー（v1 のまま）
1. 起動時 `GET /api/staff` → 職員選択
2. 5秒ごと `GET /api/staff/:id/deliveries`
3. 「確認しました」→ `POST /api/deliveries/:id/ack`
4. 設定でサーバURL変更可
