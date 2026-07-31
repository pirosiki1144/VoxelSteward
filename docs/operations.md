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

### 自律実行できるローカル検証

ロードマップまたは割り当てられた作業範囲内では、`npm ci`、format、typecheck、lint、test、
build、`docker compose config`、Docker image buildを継続して実行できます。失敗時は原因を
調査し、範囲内の修正と再検証まで進めます。同じ失敗を無制限に繰り返しません。

隔離された開発・テスト用Compose service、container、networkと、認証情報やユーザー永続dataを
持たない作業専用の一時test volumeは自律的に作成・使用・停止できます。
実Minecraft serverへ接続する`runtime`と`smoke`、本番service、所有者不明のDocker資源は
含みません。今回の作業で作成した一時container、network、使い捨てtest volumeだけを整理し、
認証またはユーザー永続dataを持つvolumeは削除しません。

Docker socket、localhost通信、Git index書込みなどでsandbox権限昇格が必要でも、この節のlocal検証、
隔離serviceの起動・health確認・対象限定停止、image build、および検証済みlocal commitについて、
ユーザーへ追加の会話承認は求めません。対象を限定した権限昇格をautomatic reviewerへ直接提出して
継続します。上位systemが人間判断を強制した場合は、そのsystem承認に従います。

### ローカルテストデータベース

隔離された空のローカルテストDBでは、migration適用・rollback、Repository統合テスト、
非秘密なtest data投入・削除、test schema再作成を自律実行できます。実在するplayer名、
server情報、account情報、credentialは使用しません。外部・共有・staging・本番DBへの接続、
migration、実data変更、破壊的migrationは承認が必要です。

MySQL Repository統合テストは、runtimeとsmokeを起動せず、tmpfsだけを使う`mysql-test`
serviceで実行します。`.env`を補間に使わない場合は空のenv fileを明示します。

```bash
docker compose --env-file /dev/null --profile test up -d --no-deps mysql-test
MYSQL_INTEGRATION_TEST=true npm test -- --run tests/mysql-persistence.integration.test.ts
docker compose --env-file /dev/null --profile test stop mysql-test
docker compose --env-file /dev/null --profile test rm -f mysql-test
```

統合testはmigrationの再適用、transaction rollback、revision冪等性に加え、作業queueの
priority付きFIFO、冪等enqueue、並行claim、有限試行を検証し、最後にdown migrationでschemaを
除去します。`docker compose down`や`--remove-orphans`は同じprojectのruntimeへ影響し得るため、
この局所cleanupには使用しません。

通常runtimeで永続化する場合は`MYSQL_PERSISTENCE_ENABLED`を厳密に`true`とし、host、port、
database、user、passwordを秘密管理された環境から注入します。既定の`false`では他のMySQL
設定を検証せずDB接続もしません。`persistence.write_failed`はcode、retryable、revision、
attemptsだけを記録し、生のDB errorや接続情報を出力しません。

## 通常運転

通常運転イメージをビルドし、`normal`固定の`runtime`サービスを起動します。
image buildは自律実行できますが、`runtime`起動は実Minecraft serverへ接続するため
事前承認が必要です。

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
配送と待機を中断し、Minecraftの安全切断を待たせません。

設定済みWebhookと既存の固定templateを使う開発・テスト・受入送信は、事前に回数を限定し、
既存timeout・retry上限を維持する場合に自律実行できます。URLや`.env`の値を表示せず、
mention、自由文、秘密情報を送信しません。WebhookやDiscord側resource・権限の変更、Bot API、
双方向通信、大量送信は承認が必要です。

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

## commit前の確認

割り当てられた作業をlocal commitする前に、必要なformat check、typecheck、lint、test、build、
`git diff --check`を成功させます。`git status`、差分、対象file、秘密情報を確認し、今回の
task-owned変更だけを明示的にstageします。検証失敗、未解決警告、意図しない差分、既存変更と
安全に分離できない状態ではcommitしません。commit後はhash、message、file一覧を報告します。
明示stageやcommitにsandbox外の`.git`書込みが必要な場合も、条件を満たすlocal commitは追加の
会話承認なしでautomatic reviewerへ提出します。

push、pull、merge、rebase、tag、release、remote branchまたはGitHub resourceの変更には
個別承認が必要です。

## 承認が必要な操作

実Minecraft/BDS接続、game内操作、認証cache・認証volume変更、外部または共有DB、本番・cloud
環境、Discord側resourceやWebhook設定、新しい外部service、主要architecture・安全境界の変更、
remote Git操作は開始前に承認を得ます。正式な区分は
[開発権限と承認ゲート](project/governance.md)を参照してください。

秘密情報を確認するときは値を出力せず、fileの存在、変数名、終了code、allow-list済みlog field、
秘密を含まないfingerprintだけを使用します。`.env`、認証cache、Webhook URLを開いたり
command outputへ表示したりしません。

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
