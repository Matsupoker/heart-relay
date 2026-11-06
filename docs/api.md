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
| GET | `/api/board` | **v2 追加**: 有効な共有ボード投稿（`archived_at IS NULL` かつ `until` 未到来または null）を緊急度 high→medium→low、同順位は新しい順。`?all=1` で終了・期限切れ込みの最新100件 | タブレット |
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

### 照合の補足（実装で決めた点）
- 姓の照合は漢字の姓のみ（カナの姓は照合しない）。カナの完全一致はひらがな表記でも一致。
- 氏名が完全一致した部分は姓のみ照合に数えない（「新田洋子様」で他の新田さんは候補に出ない）。
- 職員・ケアマネのフルネームは利用者照合から除外する。
- ID が別人の氏名と同時に書かれている場合は `ambiguous`。同姓同名の片方を ID で指定した場合は `confirmed`。
- ID 接頭辞は `ID`/`No.`/`#`/`利用者`/`利用者ID`/`利用者番号`、引用符は `" ' 「」『』【】（）`。
- `needs_resident` は Claude を呼ばず回数制限にも数えない。この状態の `/reanalyze`・`/send` は 400。
- `/resident` は `resident_id` 必須（関係なしは `null` or `""`）。存在しない ID は 400。
- Claude のツールスキーマに `resident_id` は含めない（サーバー確定値を使う）。`excluded` に漏れた職員はサーバーが「解析結果に理由の記載なし」で補完する。
- `/send` の `board_post.until` は ISO 日時 or null（それ以外 400）。`resident_name` は確定利用者の氏名。
- `POST /api/intake` の成功は **201**。抽出失敗（壊れたファイル）は 400 `extract_failed`。

### 解析時に Claude へ渡す文脈
- 現在日時（JST）
- 職員名簿（id／氏名／職種／当日の担当業務／送迎コース担当）
- 確定した利用者の台帳情報（利用状況・曜日予定・当日出欠・送迎コースと注意・移動手段・居住先・担当職員・ケアマネ事業所）。未確定なら「対象利用者: 特定なし」
- 連絡事項本文（取り込みファイルがあれば「入手経路: FAX（画像）」等）

### エラー形式
`{ error: string, code?: string }`。400/403/404/413/415/429/500。

### 解析呼び出しの保護
- Claude を呼ぶのは `POST /api/messages`、`/resident`、`/reanalyze`、`/api/intake`（画像/PDF）、v3 の `POST /api/office-messages/draft` のみ。
- 1分あたりの上限 `ANALYZE_RATE_LIMIT_PER_MIN`（既定 10）。超過時 429。

## v3（Issue #2 法人内複数事業所）

設計の正: `docs/plan/Issue2_法人内連絡_設計_2026-11-07.md` §2。架空 3 事業所（A デイサービス ひだまり／B 老健 やすらぎ／C ひだまり病院）。
既存エンドポイントは `office` 省略時 **A** として後方互換（Android は無変更）。事業所切替は架空データによる実証で、認証・認可は実装しない。

```ts
interface Office { id: string; name: string; kind: string }   // kind: "デイサービス" | "老健" | "病院"
interface OfficeMessage {
  id: string; from_office: Office; to_office: Office; source_message_id: string | null;
  title: string; body: string; created_by: string; created_at: string;
  acknowledged_at: string | null; acknowledged_by: string | null;
}
// 追加フィールド（v3）: Staff.office_id: string / Message.office_id: string
// BoardPost の形は v2 のまま（office_id は返さない。?office= で絞って取得する）
```

| Method | Path | 内容 |
|---|---|---|
| GET | `/api/offices` | `Office[]`（id 順） |
| GET | `/api/staff?office=A` | その事業所の職員（在籍・休止とも）。省略時 A |
| GET | `/api/messages?office=A` | その事業所の連絡事項。省略時 A |
| POST | `/api/messages` | body に `office_id`（省略時 A）。**解析に渡す職員名簿と `/send` の宛先検証は、その事業所の在籍（active）職員のみ** |
| GET | `/api/board?office=A` | その事業所の掲示（`?all=1` も同じく絞る）。省略時 A |
| GET | `/api/stats?office=A` | その事業所の件数（deliveries はその事業所の連絡事項に属するもの）。省略時 A |
| GET | `/api/office-messages?office=A` | `{inbox, outbox}`（inbox: to=office、outbox: from=office、どちらも新しい順）。省略時 A |
| POST | `/api/office-messages` | `{from_office_id, to_office_id, title, body, created_by?, source_message_id?}` → `OfficeMessage`。**人間の明示操作でのみ呼ぶ** |
| POST | `/api/office-messages/:id/ack` | `{staff_name, office_id?}` → `OfficeMessage`（冪等） |
| POST | `/api/office-messages/draft` | `{from_office_id, to_office_id, source_message_id?, notes?}` → `{title, body, model, usage}`（案のみ。**送信しない**） |
| GET | `/api/staff/:id/deliveries`・POST `/api/deliveries/:id/ack` | **無変更**（Android 互換。職員 ID で引くので事業所指定は不要） |

### v3 の実装で決めた点
- 未知の事業所 ID（`?office=`・`office_id`・`from_office_id`・`to_office_id`）は 400 `unknown_office`。空文字の `?office=` は省略扱い（A）。
- 照合（利用者台帳）は事業所共通。台帳は A のみだが、他事業所の連絡でも照合は行う（架空データの実証のため）。照合から除外する職員名は全事業所の職員。
- `/send` で作る掲示は、その連絡事項の事業所の `office_id` で保存する。
- `POST /api/office-messages`:
  - `from_office_id`・`to_office_id` 必須。from=to は 400 `same_office`。
  - `title`（200字以内）・`body`（5000字以内）必須（前後空白は除去）。`created_by` は任意（既定 `""`、100字まで）。
  - `source_message_id` は存在確認（無ければ 400 `unknown_message`）し、**送信元事業所の連絡事項であること**（違えば 400 `office_mismatch`）。
- `ack`: `staff_name` 必須（空は 400）。2回目以降は最初の `acknowledged_at`・`acknowledged_by` を保つ。`office_id` を付けた場合は受信事業所（to）と一致しなければ 403。存在しない id は 404。
- `/draft`:
  - from/to の検証は送信と同じ。`source_message_id` と `notes`（2000字以内）の**どちらかが必要**（両方無ければ 400）。元連絡は送信元事業所のもので、解析済み（analysis あり）であること（未解析は 400 `not_analyzed`）。
  - Claude に渡す材料は、送信元/先の事業所名・種別、元連絡の `summary`・`required_actions`・`categories`・利用者氏名、`notes` のみ。宛先職員名・宛先理由・除外理由・台帳の詳細（送迎コース・担当職員・ケアマネ等）・原文は渡さない。
  - ツール `submit_office_draft`（`tool_choice: auto`、無ければ本文の JSON）。モデルは `OFFICE_DRAFT_MODEL` → `HEART_RELAY_MODEL` → `claude-sonnet-5-5`。Claude の失敗は 502 `draft_failed`。
  - API キー未設定時はテンプレートのモック文面（`model: "mock"`、`usage: null`）。回数制限は解析と共有し、モックでも 1 回と数える。
- **作成経路の限定**: `office_messages` への INSERT は `backend/src/office/service.js` の `createOfficeMessage()` だけで、呼ぶのは `POST /api/office-messages` ハンドラだけ（`test/office.test.js` で grep と動作の両方を確認）。解析・`/send`・ボード・`/draft` からは作られない。
- スキーマ v3: `offices`・`office_messages` を新設、`staff`・`messages`・`board_posts` に `office_id TEXT NOT NULL DEFAULT 'A'`。v1/v2 の DB は起動時に自動移行し、既存行は A。B・C の架空職員（`b01..b03`, `c01..c03`）は起動時に upsert。

## Android の最小フロー（v1 のまま）
1. 起動時 `GET /api/staff` → 職員選択
2. 5秒ごと `GET /api/staff/:id/deliveries`
3. 「確認しました」→ `POST /api/deliveries/:id/ack`
4. 設定でサーバURL変更可
