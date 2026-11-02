# HEART RELAY Android アプリ（プロトタイプ）

介護施設の連絡事項を、職員ごとに個別化して受け取り、「確認しました」をバックエンドへ記録するAndroidアプリです（Built with Claude: Japan 2026 ハッカソン用）。
架空データでの動作確認用で、認証は職員アカウント選択のみです。

- Kotlin / Jetpack Compose (Material 3) / minSdk 26 / targetSdk 35 / OkHttp
- applicationId: `jp.heartrelay.app`
- API契約: `../docs/api.md`

## ビルド

### Android Studio（Windows）
1. Android Studio で `android` フォルダを開く（Open）。
2. SDK（Android 35）が未導入なら案内に従いインストール。`local.properties` は Android Studio が自動生成します（`sdk.dir=...`）。
3. `app` を選び Run、またはメニュー Build > Build APK(s)。

### コマンドライン
```
cd android
./gradlew assembleDebug        # Windows: gradlew.bat assembleDebug
./gradlew testDebugUnitTest    # 単体テスト
```
SDKの場所は環境変数 `ANDROID_HOME` か `android/local.properties`（`sdk.dir=...`）で指定します。
出力: `app/build/outputs/apk/debug/app-debug.apk`（リポジトリ同梱コピー: `../dist/heart-relay-debug.apk`）

## 実機へのインストール
- USBデバッグ有効のスマホをPCに接続し、`adb install -r dist/heart-relay-debug.apk`
- または APK をスマホへコピーし、端末のファイル管理アプリから開いてインストール（「提供元不明のアプリ」の許可が必要）。

## 実機とPCバックエンドを接続する
1. スマホとPCを**同じWi-Fi**に接続する。
2. PCのIPアドレスを調べる: コマンドプロンプトで `ipconfig` → 「IPv4 アドレス」（例 `192.168.1.10`）。
3. バックエンド（ポート8787）を起動。Windowsファイアウォールで**受信ポート TCP 8787 を許可**する（初回起動時の許可ダイアログで「プライベートネットワーク」を許可、または 受信の規則 で 8787 を追加）。
4. アプリの設定画面でサーバURLに `http://192.168.1.10:8787`（自分のIP）を入力 → 「接続確認」。`接続OK` と解析モード（claude / mock）が出ればOK。
5. 表示された職員一覧（職種ごと）から自分のアカウントをタップ → 受信箱へ。右上「職員を切り替える」で選び直せます。

エミュレータの場合は既定の `http://10.0.2.2:8787`（エミュレータからPCのlocalhost）のままで接続できます。

## 使い方
- 受信箱: 5秒ごとに自動更新（アプリが前面にある間のみ）。未確認が上、新しい順。下へ引いて更新も可。
- カードをタップで詳細。「確認しました」で `POST /api/deliveries/{id}/ack` を送信。失敗時は再試行できます。
- 通知: ポーリングで新しい未確認の連絡を見つけると端末通知（チャンネル「連絡事項」）。職員選択後の最初の取得分は通知せず既読扱いにします。Android 13以降は通知許可ダイアログが出ます。通知タップで該当の詳細を開きます。

## 手動テスト用フェイクサーバ
バックエンド未起動でも画面を試せます（Node 18+、依存なし）。
```
node android/dev/fake-server.mjs          # :8787
curl -X POST http://localhost:8787/dev/send -H "Content-Type: application/json" \
  -d "{\"staff_id\":\"s05\",\"title\":\"通知テスト\",\"body\":\"本文\",\"urgency\":\"high\"}"
```
職員 s01〜s06 が使えます（s05 運転手に初期データあり）。`/dev/send` は開発専用で本番APIにはありません。

## 検証状況
- 検証済み（ビルド環境上）: コンパイル、単体テスト（JSONパース、JST時刻整形、並び順、新着判定ロジック）、APKのパッケージ名・権限の確認、フェイクサーバのAPI応答（curl）。
- **未検証（実機・エミュレータでの動作確認は未実施）**: 画面表示・操作感、通知の表示と通知タップ遷移、通知許可ダイアログ、実機でのLAN接続、実バックエンドとの結合。

## 制限事項
- 通信は http（開発用に平文許可）。認証なし。
- 通知はアプリのプロセスが生きていてポーリング中のときのみ（バックグラウンド常駐・FCMは未対応）。
- 画面はポートレート想定。配布物はデバッグ署名のAPKのみ。
