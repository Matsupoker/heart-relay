# HEART RELAY バックエンド（第一段階プロトタイプ）

介護・医療現場の連絡事項を解析し、必要な職員へ個別に届け、確認履歴を記録するバックエンドです。
**データはすべて架空です。実在の個人情報は入力しないでください。**

- Node.js 22 以上 / Express 4 / `node:sqlite`（組込み。起動時の ExperimentalWarning は npm スクリプトで抑止済み）
- API 仕様: `../docs/api.md`
- `../web` フォルダがあれば `/` で静的配信します（PC 用画面）

## 起動手順

```
cd backend
npm install
copy .env.example .env      (macOS/Linux: cp .env.example .env)
npm run seed                 # 架空の職員20名・利用者8名を投入（既にあればスキップ。作り直しは npm run seed -- --force）
npm start                    # http://localhost:8787
```

- `.env` に `ANTHROPIC_API_KEY` を書くと Claude で解析します。`.env` は絶対にコミットしないでください。
- 開発時は `npm run dev`（ファイル変更で自動再起動）、テストは `npm test`。
- 職員が空のままサーバーを起動した場合も、自動で架空シードを投入します。

## APIキー未設定時（モック解析）

`ANTHROPIC_API_KEY` が空だと、キーワードで振り分けるルールベースの **モック解析** で動作します（`/api/health` の `analyzer` が `mock`、起動ログにも警告）。
開発・テスト用であり、デモは Claude API で行います。モデルは `HEART_RELAY_MODEL`（既定 `claude-sonnet-5-5`）で変更できます。
Claude 解析が失敗した場合はモックに切り替えず、メッセージを `status=failed`（`error` に理由）で保存します。

## Windows で LAN（Android 実機）に公開する

1. サーバーは `0.0.0.0:8787` で待ち受けます。
2. Windows Defender ファイアウォールで TCP 8787 の受信を許可します（管理者の PowerShell）:
   ```
   New-NetFirewallRule -DisplayName "HEART RELAY 8787" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private
   ```
3. `ipconfig` を実行し、Wi-Fi アダプターの **IPv4 アドレス**（例 `192.168.1.23`）を確認します。
4. Android 実機（同じ Wi-Fi）のアプリ設定でサーバー URL を `http://192.168.1.23:8787` にします。エミュレータは `http://10.0.2.2:8787`。
5. 確認: スマホのブラウザで `http://192.168.1.23:8787/api/health` が開けること。

## 費用ログの見方

Claude を呼ぶたびに、サーバーのコンソールへ 1 行出ます:

```
2026-11-03T01:02:03.456Z [analyze] analyzer=claude model=claude-sonnet-5-5 in=1450 out=620 est_cost_usd=$0.009100 time=4210ms
```

- `in` / `out`: 入力・出力トークン数、`est_cost_usd`: 概算費用（USD）。単価表（100万トークンあたり入/出）: sonnet-5-5 = 2/10、opus-5-5 = 4/20、haiku-5-5 = 0.10/0.50、その他 3/15。
- 同じ値が各メッセージの `usage` にも保存され、`GET /api/messages` で確認できます。
- 解析は `POST /api/messages` と `/reanalyze` のみ。1 分あたりの上限は `ANALYZE_RATE_LIMIT_PER_MIN`（既定 10、超過は 429）。

## 環境変数

| 変数 | 既定 | 内容 |
|---|---|---|
| `ANTHROPIC_API_KEY` | (空) | 空ならモック解析 |
| `HEART_RELAY_MODEL` | `claude-sonnet-5-5` | 使用モデル |
| `PORT` | `8787` | 待ち受けポート |
| `ANALYZE_RATE_LIMIT_PER_MIN` | `10` | 解析の 1 分あたり上限 |
| `DB_PATH` | `./data/heart-relay.db` | SQLite ファイル |

## ファイル構成

- `src/server.js` — `createApp({dbPath, env})`（テスト用に export）。直接実行時のみ listen
- `src/routes.js` — 全エンドポイント / `src/db.js` — スキーマ / `src/seed.js`, `seedData.js` — 架空データと `DEMO_MESSAGES`
- `src/analyzer/` — `index.js`（切替）, `claude.js`（Tool Use）, `mock.js`, `common.js`（検証・費用計算）
- `test/` — `npm test`（モック解析・一時 DB で実行）
