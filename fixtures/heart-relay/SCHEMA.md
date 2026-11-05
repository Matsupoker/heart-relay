# HEART RELAY 利用者拡張 schemaVersion 1

HARMONIZE2のバックアップを変更せず、利用者IDをキーに追加情報を持つ架空フィクスチャです。正本の利用者200名と `users` / `attendance.records` のID集合が一致し、各配列内でIDは一意です。キーはすべて必須で、未設定値は以下の空文字列・空配列を使います。

## トップレベル

| キー | 型・値 |
|---|---|
| `format` | 固定文字列 `heart-relay-user-extension` |
| `schemaVersion` | 整数 `1` |
| `sourceBackup` | `harmonize2_backup_fictional200.json`（`../harmonize2/` 内の正本） |
| `generatedAt` | ISO UTC日時。正本の `createdAt` と一致 |
| `statusDefinitions` | `serviceStatus: ["利用中", "中止中", "終了"]`, `attendance: ["出席", "欠席", "対象外"]` |
| `users` | 下記利用者拡張の配列、200名 |
| `attendance` | 下記当日出欠オブジェクト |

## users の各要素

| キー | 型・規則 |
|---|---|
| `id` | 正本と同一の4桁文字列。先頭ゼロ保持 |
| `serviceStatus` | `利用中` / `中止中` / `終了`。150/30/20名 |
| `statusSince` | 有効な `YYYY-MM-DD`。状態の開始日。正本の `firstAddedAt` のUTC日付以降、2026-11-05以前 |
| `weeklyPattern` | 重複のない曜日文字列配列。利用中は月〜土の1〜3曜日、月→土順。中止中・終了は `[]` |
| `transportRoute` | `"1"` / `"2"` / `"3"` / `"4"` / `""`。このフィクスチャでは施設居住者を空、自宅居住者は必須 |
| `transportNote` | 30文字以内の短い架空の送迎注意、または `""`。全体の20%に設定 |

`serviceStatus === "利用中"` と正本の `usageStatus === "利用中"` は同値です。それ以外の正本 `usageStatus` は `""`。正本は中止中と終了の区別を保持しません。

## attendance

| キー | 型・規則 |
|---|---|
| `date` | 有効な `YYYY-MM-DD`、固定 `2026-11-10` |
| `records` | 全200名の当日出欠配列 |

各レコードのキーは次の3つです。

| キー | 型・規則 |
|---|---|
| `id` | 正本・拡張usersに存在する4桁文字列 |
| `status` | 当日の曜日予定を持つ利用中の人だけ `出席` / `欠席`。他は必ず `対象外` |
| `reason` | 欠席時だけ `受診` / `体調不良` / `家族都合`、それ以外は `""` |

曜日は `date` をUTC暦日として計算します。依頼文の括弧内曜日に誤記があるため、2026-11-10は**火曜日**として扱います。対象予定34名、欠席は `Math.round(34 * 0.1) = 3` 名です。利用中の人も当日予定がなければ `対象外` です。欠席しても `serviceStatus`・正本の `usageStatus`・`mobilityId` は変更しません。

## 予約キー（今回は含めない）

以下は将来追加予定です。**schemaVersion を上げて追加**し、型・配置先・必須性をその版で確定します。v1の生成JSONにはキー自体を含めません（`null`・空文字列でも追加しません）。

| キー | 意味 | 導入 |
|---|---|---|
| `primaryDoctor` | 主治医 | 将来追加予定・schemaVersion を上げて追加 |
| `familyDoctor` | かかりつけ医 | 将来追加予定・schemaVersion を上げて追加 |
| `careLevel` | 要介護度 | 将来追加予定・schemaVersion を上げて追加 |
| `emergencyContact` | 緊急連絡先 | 将来追加予定・schemaVersion を上げて追加 |
