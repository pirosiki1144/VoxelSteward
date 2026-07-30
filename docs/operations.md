# 運用

## ローカル環境の前提条件

- WSL2上のUbuntu
- Node.js 24 LTSおよびnpm
- Composeプラグインを導入したDocker Engine

## 開発

```bash
cp .env.example .env
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

デフォルトのヘルスチェックエンドポイントは`http://127.0.0.1:3000/health`です。

## 通常運転

通常運転イメージをビルドし、`normal`固定の`runtime`サービスを起動します。

```bash
docker compose build runtime
docker compose up -d runtime
docker compose logs -f runtime
```

他プレイヤーをスポーン時または接続後に検知すると
`minecraft.other_player_detected`を記録し、`reason: "other_player_detected"`、
`exitCode: 0`で安全に切断します。`restart: "no"`のため、安全停止後に自動起動しません。

安全な停止にはSIGTERMを使います。

```bash
docker compose stop runtime
```

`signal.received`、`runtime.stopping`、`minecraft.disconnecting`、
`runtime.finished`の順に確認します。認証volumeは削除しないでください。

再接続設定は次のとおりです。

- `RUNTIME_MAX_RETRIES` — 初回接続を除く最大再試行回数、既定値3
- `RUNTIME_RECONNECT_INITIAL_DELAY_MS` — 初回待機、既定値1000ミリ秒
- `RUNTIME_RECONNECT_MAX_DELAY_MS` — 待機上限、既定値30000ミリ秒
- `RUNTIME_CONNECTION_TIMEOUT_MS` — スポーンまでの上限、既定値15000ミリ秒

`reconnect.scheduled`で次の試行番号と待機時間を確認できます。上限到達時は
`reconnect.exhausted`と、`reason: "reconnect_exhausted"`、`exitCode: 1`の
`runtime.finished`を記録します。設定・認証・未知の接続エラー、他プレイヤー検知、
SIGINT、SIGTERMでは再接続しません。

### Discord Incoming Webhook通知

通知は既定で無効です。`DISCORD_NOTIFICATIONS_ENABLED=false`ではWebhook URLを
検証・使用せず、外部通信しません。専用チャンネルと秘密情報管理が承認された環境だけで、
Webhook URLを秘密値として注入し、フラグを厳密に`true`とします。URLやtokenをログ、
チャット、Gitへ記録してはいけません。不正なフラグまたは有効時の不正URLはMinecraft接続
より前に`INVALID_DISCORD_WEBHOOK_CONFIG`として終了します。

配送失敗時の`notification.delivery_failed`は、安全な`code`、`classification`、
`status`（存在時）、`attempts`と通知IDだけを記録します。応答本文や生Errorは記録しません。
1試行5秒、最大3試行、レート制限待機を含む総15秒が上限です。runtime停止時は未完了の
配送と待機を中断し、Minecraftの安全切断を待たせません。実Discord送信試験は別途承認を
得て実施します。

接続状態を外部へ正確に示すreadinessエンドポイントはまだないため、`runtime`には
形だけのhealthcheckを設定していません。

読み取り専用スモークテスト用のDockerイメージをビルドします。

```bash
docker compose build smoke
```

`.env`へ接続許可を得たテスト用BDSの設定を記入した後、normalモードで実行します。

```bash
docker compose run --rm --name voxel-steward-smoke-run smoke
```

詳細ログが必要な場合は、1回の実行に限ってdebugを明示します。

```bash
docker compose run --rm --name voxel-steward-smoke-run -e BOT_MODE=debug -e LOG_LEVEL=debug smoke
```

`debug`では他プレイヤーの参加・退出を記録し、読み取り専用接続を維持します。
`minecraft.other_player_allowed`の`action`が`connection_continued`であることを確認して
ください。指定時間後は`reason: "timeout"`、`exitCode: 0`で安全に切断します。
smokeは単発検証であり、自動再接続しません。通常運転は`normal`固定でタイムアウト終了せず、
上限付き再接続を行う点が異なります。

## 設定と秘密情報

`.env.example`には、設定名と秘密情報を含まないローカル環境用のデフォルト値を記載
します。`.env`はローカル専用であり、Gitの管理対象外です。本番環境のパスワード、
Minecraftアカウント情報、トークン、認証キャッシュをソース管理に含めてはいけません。
認証キャッシュはこのリポジトリの外部に保存し、将来実装するアプリケーションコンテナ
だけに読み書き可能な状態でマウントします。

AWS/VPS環境では、シークレットマネージャー、またはデプロイ時に注入される秘密情報
ファイルを使用します。誤ってログへ出力またはcommitした認証情報は、必ず無効化して
更新してください。

Microsoft認証キャッシュは`BOT_ACCOUNT_ID`単位の名前付きDocker volumeへ保存します。
通常のコンテナ削除では失われません。volumeを削除すると再認証が必要になるため、
`docker compose down -v`と`docker volume rm`は実行しないでください。

## 安全なロールアウト

1. buildを実行し、すべての自動チェックを実行します。
2. テスト用データベースへマイグレーションを適用します。
3. 専用のテストサーバー設定を使用してデプロイします。
4. プレイヤー検知、安全停止、チェックポイントからの復旧、リース喪失、戦闘回避、
   SIGTERM受信時の動作を検証します。
5. 構造化ログを確認し、秘密情報の漏えいがなく、終了処理が完了していることを確認します。
6. 以上を完了した後に限り、個別の認証情報と設定を使用して、同じ検証済み成果物を
   本番環境へ昇格させます。

ロールアウトを完了するために、安全制御を無効化してはいけません。安全性テストに
失敗した場合は、本番環境への昇格を中止します。

## 終了処理

SIGTERMを送信し、設定された猶予期間を確保します。将来接続機能を実装したプロセスは、
新しい作業の受付停止、チェックポイントの保存、切断、リースの解放を行ってから終了
しなければなりません。SIGKILLではこの一連の処理を実行できないため、最後の手段として
のみ使用します。

## バックアップとマイグレーション

破壊的なマイグレーションを実行する前に、データベースをバックアップします。
マイグレーションは前方へバージョン管理され、新しいデータベースでも再現可能でなければ
なりません。チェックポイントとデータベースの復元を定期的にテストします。Dockerの
永続ボリュームは便利なローカルストレージですが、バックアップではありません。

## インシデント対応

予期しない動作や他のプレイヤーを確認した場合は、プロセスを停止してログとチェック
ポイントを保全し、本番環境では再起動しないでください。まずテストサーバーで問題を
再現し、修正内容を検証します。認証情報が露出した可能性がある場合は、追加のテストを
行う前に無効化して更新してください。
