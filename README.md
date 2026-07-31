# VoxelSteward

VoxelStewardは、安全性を重視したMinecraft Bedrock Dedicated Server（BDS）向け
自動化クライアントの基盤です。現在は、TypeScriptツールチェーン、ドキュメント、
構造化ログ、HTTPヘルスチェックエンドポイント、Dockerから常駐する読み取り専用の
通常運転ランタイム、およびスモークテストを提供します。自律動作やゲーム内操作は
**行いません**。

通常運転の状態変化から安全な通知メッセージを生成し、任意でDiscord Incoming Webhookへ
配送する通知基盤もあります。既定は外部通信を行わないNo-opで、Discord SDKやBot APIは
使用しません。設定済みWebhookと既存templateによる回数限定の開発・受入送信は、
運用条件を満たす場合に自律実行できます。WebhookやDiscord側設定の変更は承認が必要です。詳細は
[通知基盤](docs/notifications.md)を参照してください。

## 前提環境

- Node.js 24 LTS
- npm 11以降
- Ubuntu/WSL2上のDocker EngineおよびDocker Compose
- 管理者から接続許可を得たテスト用BDS
- BOT専用のMicrosoftアカウント

## セットアップ

```bash
npm install
cp .env.example .env
npm run typecheck
npm run lint
npm test
npm run build
```

HTTPヘルスチェックを備えた最小構成のサービスを起動します。

```bash
npm start
curl http://127.0.0.1:3000/health
```

## スモークテスト

スモークテストは、BOTアカウント1体でテスト用BDSへ接続し、ログインとスポーンを
確認して、サーバーから受信できたBOT名、ディメンション、座標、体力、空腹度、
プレイヤー一覧を記録します。移動、視点変更、採掘、設置、攻撃、チャット、コマンド
など、ゲーム内の状態を変更する操作は実装していません。

実Minecraft serverへの接続とMicrosoft認証は、開始前に承認が必要です。

### `.env`の設定

既存の`.env`がなければ、例をコピーします。

```bash
cp .env.example .env
```

`.env`で次の項目を設定してください。値をGitへcommitしたり、チャットへ貼り付けたり
しないでください。

- `MINECRAFT_HOST` — 接続許可を得たテスト用BDS
- `MINECRAFT_PORT` — 通常は`19132`
- `MINECRAFT_VERSION` — 通常は空欄。サーバー広告から自動判定
- `BOT_ACCOUNT_ID` — 認証キャッシュを区別するローカル識別子
- `BOT_MODE` — 通常は`normal`
- `SMOKE_TIMEOUT_SECONDS` — `5`～`300`秒、既定値は`60`
- `AUTH_PROFILES_FOLDER` — Composeでは`/auth/profiles`のまま使用
- `LOG_LEVEL` — `debug`、`info`、`warn`、`error`

`BOT_ACCOUNT_ID`にはメールアドレスやGamertagではなく、`smoke-bot`のような
秘密情報ではないローカル識別子を使用してください。

## 通常運転ランタイム

通常運転は`normal`固定で接続を維持し、他プレイヤーを検知すると安全制御として終了します。
次の起動は実Minecraft serverへ接続するため、実行前に承認が必要です。

```bash
docker compose build runtime
docker compose up runtime
```

停止は前面実行中のCtrl+C、または別端末から次を実行します。

```bash
docker compose stop runtime
docker compose logs -f runtime
```

一時切断は`RUNTIME_MAX_RETRIES`回まで再試行します。待機は
`RUNTIME_RECONNECT_INITIAL_DELAY_MS`から指数的に増加し、
`RUNTIME_RECONNECT_MAX_DELAY_MS`を上限とします。
`RUNTIME_CONNECTION_TIMEOUT_MS`は接続開始からスポーンまでの上限です。認証・設定などの
回復不能エラー、他プレイヤー検知、SIGINT、SIGTERMでは再接続しません。
`reconnect.exhausted`と`runtime.finished`の`exitCode: 1`は再接続上限到達を示します。

### Discord通知

既定の`DISCORD_NOTIFICATIONS_ENABLED=false`ではWebhook URLを検証・使用せず、
外部通信しません。governanceの条件を満たす開発・テスト環境で通知を有効にする場合だけ、
秘密情報として管理された
Incoming Webhook URLを`DISCORD_WEBHOOK_URL`へ設定し、有効化フラグを厳密に`true`と
します。不正な設定はMinecraft接続前に終了します。URLをログやGitへ記録しないでください。

Webhook配送は1試行5秒、最大3試行、待機を含む総15秒を上限とします。429ではDiscordの
待機指定、一時的な500・502・503・504と通信失敗では上限付き再試行を行います。通知障害は
Minecraftの安全切断を妨げません。プロセス終了時は未完了配送を中断し、完了を待ちません。

### MySQL状態・履歴保存

`MYSQL_PERSISTENCE_ENABLED=false`（既定）ではDB接続を行いません。有効時はruntime起動時に
MySQL設定を検証し、version管理されたmigrationを適用してから、StateStoreの変更イベントを
revision順に保存します。保存対象はruntime run、最新snapshot、変更履歴、作業checkpoint、
通知outboxです。プレイヤー名、BOT情報、接続先、認証情報は保存しません。

設定値と隔離テスト方法は[運用手順](docs/operations.md)、スキーマと障害境界は
[状態管理](docs/state-management.md)を参照してください。outbox配送workerと再起動後の
Discord配送保証は未実装です。

### 作業指示と作業キュー

型付き作業指示をpriority付きFIFOで管理するdomain、application service、Repository port、
MySQL adapterがあります。claim、取消、有限回の再キュー、終端化だけを実装しており、
Minecraft内の操作や外部からの指示受付は行いません。詳細は
[作業指示と作業キュー](docs/task-queue.md)を参照してください。

### 共通の安全制御

将来の作業executorは、runtime、Minecraft接続・spawn、他player検知、停止要求、体力、空腹度を
共通policyで検査し、安全な場合だけqueueをclaimします。未知・不正telemetryはfail-closedで
拒否し、他player検知またはoperator停止後は再開しません。現在は判定境界だけで、Minecraft内の
操作はありません。詳細は[共通の安全制御](docs/safety-controls.md)を参照してください。

### Dockerイメージのビルド

```bash
docker compose build smoke
```

### normalモードでの実行

```bash
docker compose run --rm --name voxel-steward-smoke-run smoke
```

`normal`では、自分以外のプレイヤーを検知すると理由を記録し、安全に切断します。

### debugモードでの実行

```bash
docker compose run --rm --name voxel-steward-smoke-run -e BOT_MODE=debug -e LOG_LEVEL=debug smoke
```

`debug`ではプレイヤーの参加・退出を詳しく記録し、読み取り専用接続を維持します。
他プレイヤーを検知した場合は`minecraft.other_player_allowed`と
`action: "connection_continued"`を記録します。タイムアウト、シグナル、接続エラー時の
安全な切断は引き続き有効です。`debug`はコマンドで明示した1回だけ有効になり、
認証volumeには保存されません。

### 初回Microsoft認証

初回起動時は、ログに示されたMicrosoftの認証用URLをブラウザーで開き、標準エラー出力に
一時表示されるdevice codeをMicrosoftの画面へ入力してください。画面の
`Continue`（続行）などの案内に従い、BOT用アカウントで認証を完了します。パスワード、
トークン、認証オブジェクトはアプリケーションログへ出力しません。

認証キャッシュは、`BOT_ACCOUNT_ID`単位の名前付きDocker volume
`voxel-steward-auth-<BOT_ACCOUNT_ID>`へ保存されます。通常停止、`--rm`による
コンテナ削除、`docker compose down`の後も残り、次回の認証に再利用されます。
volumeを削除すると認証情報が失われるため、`docker compose down -v`や
`docker volume rm`は実行しないでください。

### 手動停止と成功判定

前面実行中にCtrl+Cを押すとSIGINT、`docker stop`ではSIGTERMが送信され、
安全な切断処理を実行します。次のイベントを確認できれば接続試験は成功です。

- `minecraft.authenticated`
- `minecraft.login_completed`
- `minecraft.spawn_completed`
- `minecraft.state_received`
- `smoke.finished`の`outcome`が`normal`、`exitCode`が`0`

プロトコルからまだ受信していない状態は`取得待ち`と表示され、推測値では補完しません。

### よくある失敗

- `MINECRAFT_HOST is required` — `.env`の`MINECRAFT_HOST`を確認します。
- ping timeout — BDSが起動していること、UDPポート、WSL2／ホスト側Firewallを確認します。
- unsupported version — `MINECRAFT_VERSION`を空欄に戻して自動判定を使用します。
- Microsoft認証に失敗する — BOT用アカウントのMinecraft所有状況、マルチプレイ設定、
  BDSのallowlistを確認します。
- another smoke test instance is active — 同じ`BOT_ACCOUNT_ID`のコンテナが実行中でないか
  確認します。無制限の自動再接続は行いません。

## スクリプト

- `npm run build` — TypeScriptをコンパイルし、`dist/`へ出力します
- `npm run typecheck` — ファイルを出力せずに型を検査します
- `npm run lint` — ESLintを実行します
- `npm test` — Vitestを1回実行します
- `npm run smoke` — build済みの読み取り専用スモークテストを実行します
- `npm run runtime` — build済みの通常運転ランタイムを実行します
- `npm run format` — Prettierで対応ファイルを整形します
- `npm run format:check` — ファイルが整形済みか確認します

## 安全性

本番環境で使用できる段階には達していません。スモークテストは接続許可を得た専用の
テストサーバーでのみ実行してください。`normal`のBOTは、他のプレイヤーを検知した
場合に作業を中断してログアウトします。`debug`は読み取り専用の観測試験に限って接続を
維持します。どちらのモードもゲーム内操作を行わず、同時に複数のプロセスから操作される
ことを防止し、SIGINTまたはSIGTERMを受けた場合に安全に終了します。

`.env`、認証情報、Minecraftアカウント情報、認証キャッシュ、実行時データ、ログは
commitしないでください。

詳しくは、[要件](docs/requirements.md)、[アーキテクチャ](docs/architecture.md)、
[運用手順](docs/operations.md)、[技術的な意思決定](docs/decisions.md)、
[状態管理](docs/state-management.md)、[通知基盤](docs/notifications.md)、
[作業指示と作業キュー](docs/task-queue.md)、
[共通の安全制御](docs/safety-controls.md)、
[現在の状況](docs/project/status.md)、[ロードマップ](docs/project/roadmap.md)を参照してください。
