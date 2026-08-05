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

通知outboxの統合testはmigration 004の適用・rollback、並行dispatcherの排他claim、
worker crash相当のlease切れ回収、再起動相当の配送再開、最大試行回数後の`failed`終端化を
検証します。実Webhookは使わずFake portだけを注入します。

通常runtimeで永続化する場合は`MYSQL_PERSISTENCE_ENABLED`を厳密に`true`とし、host、port、
database、user、passwordを秘密管理された環境から注入します。既定の`false`では他のMySQL
設定を検証せずDB接続もしません。`persistence.write_failed`はcode、retryable、revision、
attemptsだけを記録し、生のDB errorや接続情報を出力しません。
起動時の`persistence.task_recovery_audited`は`claimable`、`manualReview`、`terminal`の件数だけを
記録します。`recoveredLeases`は期限切れ所有権の回収件数です。`claimed`は自動でqueuedへ戻さず、
operator確認までmanual reviewとします。終端済みtaskは
再実行対象に戻しません。

### 検証環境向け通常runtime

`compose.verification.yaml`は通常`runtime`へ重ねる検証環境専用overrideです。`BOT_MODE=normal`、
`MYSQL_PERSISTENCE_ENABLED=true`、`restart: "no"`を固定し、基底serviceのread-only filesystem、
非root user、認証volume、MySQL・通知設定境界をそのまま継承します。認証volumeを初期化・再作成
せず、`smoke`や他のMinecraft接続serviceを依存関係として起動しません。

構成検査は`.env`を読ませず、値を表示しない次のcommandで行います。

```bash
npm run verify:runtime-compose
docker compose --env-file /dev/null -f compose.yaml -f compose.verification.yaml config --quiet
docker compose --env-file /dev/null -f compose.yaml -f compose.verification.yaml build runtime
```

実接続は専用test serverへの接続承認後だけ、設定済み`.env`を使ってruntime 1 serviceを明示します。
`--no-deps`により不要serviceを起動しません。

```bash
docker compose -f compose.yaml -f compose.verification.yaml up -d --no-deps runtime
docker compose -f compose.yaml -f compose.verification.yaml logs --no-log-prefix runtime
docker compose -f compose.yaml -f compose.verification.yaml stop runtime
docker compose -f compose.yaml -f compose.verification.yaml ps runtime
```

logではevent名、reason、outcome、exitCode、revision、件数だけを確認し、環境変数、接続先、
player名、BOT情報、task内容を転載しません。起動時はmigration、task復旧監査、InstanceLock取得後に
Minecraftへ接続します。SIGTERMでは新規task・outbox claimを止め、StateStoreの停止eventとtask
checkpointを有限時間で永続化し、Minecraftを一度だけ切断します。`runtime.finished`の後も
`restart: "no"`により再起動しません。

状態確認では`runtime.started`、`minecraft.spawn_completed`、`persistence.task_recovery_audited`、
`runtime.finished`を使用します。`claimed`残留は件数だけをmanual reviewとして扱い、自動再実行や
手動SQL更新をしません。DB・通知障害は安全切断を妨げません。停止後も認証volumeを削除しないで
ください。

### MySQL運用ログの安全な照会

`operator-log`はMySQLを読み取るだけの管理entrypointです。run一覧、最新状態、revision昇順の履歴、
task checkpointを有限件数で返します。Minecraft接続、認証volume、migration、task claim、outbox配送を
開始しません。設定済みのローカルまたは承認済み環境から次のいずれかを実行します。

```bash
npm run build
npm run operator-log -- runs --limit 20
npm run operator-log -- status --run-id <run-id>
npm run operator-log -- history --run-id <run-id> --after-revision 0 --limit 100
npm run operator-log -- checkpoints --run-id <run-id> --limit 100
```

Containerから照会する場合もserviceを1つだけ指定します。

```bash
docker compose --profile operator run --rm operator-log runs --limit 20
```

出力はJSON Linesで、run ID、revision、UTC時刻、runtime・接続・spawn・telemetry状態、位置、dimension、
体力、空腹度、他player検知boolean、型付きtask状態、allow-list済み停止理由・error codeだけを含みます。
player名、BOT情報、server endpoint、credential、生Error、stack、接続文字列、snapshot raw JSON、自由文の
進捗・error messageは返しません。不明なDB値は固定errorにするかfieldを省略し、内容を転載しません。

履歴を追う場合は直前の最大revisionを次回の`--after-revision`へ指定します。`--limit`はrunsが1～100、
history・checkpointsが1～500です。`run-id`はUUID形式だけを受理し、未知flagや余分なfieldを拒否します。
DB障害時は`OPERATIONAL_LOG_UNAVAILABLE`等の固定codeだけを出力します。照会失敗を理由にruntime、DB、
task状態を変更しません。

### ローカルoperator指示

`npm run build`後、MySQL設定を秘密管理された環境から注入し、`npm run operator-task --`に続けて
`enqueue record-position`、`enqueue verify-arrival`、`status`、`cancel`のいずれかを実行します。
完全な引数例は[作業指示と作業キュー](task-queue.md)を参照してください。コンテナ利用時は
`operator-task` serviceを明示的に`docker compose run --rm`で起動します。このserviceはMinecraft認証volumeを
mountせず、指示投入だけではruntimeやMinecraft接続を開始しません。

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

### 平日schedulerの現在の運用境界

平日09:00～17:00（JST）の枠判定と開始・停止intent生成はdomainとして実装済みです。ただし、通常runtime
への接続、常駐timer、Compose serviceによる自動起動はまだ有効化していません。現時点で時刻到達だけを
理由にMinecraftへ自動接続することはありません。境界と後続統合条件は
[平日運用スケジューラー](scheduling.md)を参照してください。

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

MySQL有効時は通知をprocess内subscriberから直接送らず、状態eventと同じtransactionで
outboxへ保存します。dispatcherは250ms間隔でrevision順に1件ずつclaimし、30秒lease、
最大5試行、1秒起点・60秒上限のbackoffで配送します。これらは運用環境から無制限に
拡張できない内部既定値です。SIGINT・SIGTERMで新規claimを停止し、取得済み配送の後に
RepositoryとWebhook bindingをcloseします。

運用中は`delivery_status`、`delivery_attempts`、`next_attempt_at`、`lease_expires_at`、
`last_error_code`の秘密を含まなfieldだけを確認します。`delivered`と`failed`は終端です。
`delivering`が30秒を超えて残っても手動でSQL更新せず、次のdispatcherによるlease回収を確認します。
`failed`の無制限な再投入は行わず、安全なcodeとDiscord側障害の解消を調査します。

配送はat-least-onceです。Webhook送信成功後にDBへ`delivered`を書く前にプロセスが失われた
場合は重複し得るため、Discord上の`Notification ID`を用いて同一通知を識別します。
MySQL無効時は従来のprocess内best effortであり、再起動後の配送再開はありません。

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

移動基盤はoffline serializer・Fake transport検証まで完了していますが、通常runtimeのbindingは
disabledで、実frame providerもありません。通常runtimeへmovement executorを接続してはいけません。
実移動試験を行う前に、packet仕様、速度、座標確定、停止方法、障害物・落下時の中止条件を記載した
専用テストサーバー試験計画を作成し、実Minecraft接続とgame操作の承認を得ます。視点変更、jump、
採掘、設置、攻撃、item、chat、commandを移動試験へ混在させません。
段階、packet上限、中止条件は[実移動受入計画](verification/movement-acceptance-plan.md)に従います。

block操作は現在offline Fake検証だけで、通常runtimeから有効化できません。将来の単一dirt配置試験は
[受入計画](verification/block-placement-acceptance-plan.md)に従い、専用区域と個別承認を必要とします。
型付き配置指示が`claimed`で残った場合は、送信前か送信後かを推測してqueuedへ戻しません。
`execution_phase`とserverの対象blockをoperatorが照合するまでmanual reviewとし、新しいtask IDでの
再投入も行いません。

world・inventory観測bindingも通常runtimeでは既定disabledです。実観測試験では
[観測受入計画](verification/world-observation-acceptance-plan.md)に従い、接続とgame内での変更ごとに
明示承認を得ます。観測logへraw packet、NBT、player/BOT情報、接続先を出力しません。
timeoutや結果不明時は再送せず、自動採掘によるrollbackも行いません。

item registryとheld itemのoffline検証では、registryのNBT、custom item名、生packetをログへ出しません。
registry不整合、dimension変更、disconnect、transaction用extra不足では配置資格を失います。face数値と
transaction envelopeの選択根拠が未解決のため、既存runtimeを実配置試験へ流用してはいけません。

専用`block-placement-acceptance` serviceはprofileで隔離し、通常runtimeやsmokeの代用を禁止します。現在は
protocol capabilityがunsupportedのため起動対象ではなく、起動してもMinecraft関連の外部副作用より前に
停止するpreflightだけが実装済みです。実server試験は
[単一dirt配置の受入計画](verification/block-placement-acceptance-plan.md)のgateとoperator checklistを満たし、
段階ごとの承認を得た後だけ実施します。

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
