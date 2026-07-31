# アーキテクチャ上の意思決定

## ADR-001: Node.js 24, TypeScript, and npm

- ステータス: 承認済み
- 決定: Node.js 24 LTS、厳格なTypeScript設定、npmのロックファイルを使用します。
- 理由: 候補となるMinecraftライブラリはNode.jsエコシステムに属しており、ロック
  ファイルによってCIとデプロイの再現性を確保できるためです。

## ADR-002: ポートとアダプター

- ステータス: 承認済み
- 決定: ドメインコードとアプリケーションコードは、Minecraft、リポジトリ、
  チェックポイント、インスタンスロックのインターフェースに依存します。
- 理由: 安全ロジックをテスト可能な状態に保ち、タスクの動作を書き換えずに
  インフラストラクチャを変更できるためです。

## ADR-003: 初期の永続化候補としてPostgreSQLを採用

- ステータス: ADR-011により置換
- 決定: ComposeでPostgreSQLを提供します。アプリケーション用ドライバーは、
  永続化コードを実装する段階で追加します。
- 理由: PostgreSQLはトランザクション、マイグレーション、永続的なチェックポイント、
  データベースを利用したリースに対応しており、ローカル、VPS、AWSの各環境へ移行
  できるためです。

## ADR-004: 読み取り専用接続へのbedrock-protocol導入

- ステータス: 承認済み
- 決定: 読み取り専用スモークテストに`bedrock-protocol` 3.57.0を固定バージョンで
  使用します。ゲーム内行動を送信する機能は実装しません。
- 理由: 3.57.0は対象となるMinecraft Bedrock 1.26.30を明示的にサポートし、
  Microsoft認証、暗号化、サーバーバージョンの自動判定を提供するためです。

## ADR-005: 安全ポリシーを設定で変更できない設計

- ステータス: プレイヤー検知時のdebug観測動作に限りADR-009により置換、その他は承認済み
- 決定: プレイヤー検知、戦闘回避、テスト優先のロールアウト、安全な終了処理には、
  迂回用の設定を設けません。
- 理由: 実行時に迂回できると、不変条件が単なる運用上の選択肢となり、本番環境で
  許容できないリスクが生じるためです。

## ADR-006: stdoutへのJSONログ出力とHTTPヘルスチェック

- ステータス: 承認済み
- 決定: 改行区切りのJSONをstdoutへ出力し、HTTPヘルスチェックエンドポイントを
  公開します。
- 理由: どちらもローカル環境で動作し、Docker、systemd、AWSのログおよび
  ヘルスチェックシステムと容易に統合できるためです。

## ADR-007: バージョン管理されたマイグレーションとRepository限定のDBアクセス

- ステータス: 承認済み
- 決定: すべてのスキーマ変更にマイグレーションを使用し、アプリケーションコードと
  ドメインコードは`Repository`インターフェースを介してのみデータへアクセスします。
- 理由: スキーマの状態を再現可能にし、永続化の詳細を分離できるためです。

## ADR-008: debugでも安全停止を維持

- ステータス: ADR-009により置換
- 決定: `BOT_MODE=debug`は詳細な観測ログだけを有効にし、他プレイヤー検知時の
  安全な切断を無効化しません。
- 理由: 実行モードによって安全ポリシーを迂回できる設計は、ADR-005および
  プロジェクトの安全不変条件に反するためです。

## ADR-009: 読み取り専用debug観測モードのプレイヤー接続維持

- ステータス: 承認済み
- 決定: `BOT_MODE`を`normal | debug`の検証済み型として扱います。`normal`は他プレイヤー
  検知時に停止し、`debug`は参加・退出と接続継続を記録して接続を維持します。
  タイムアウト、シグナル、接続エラーの停止制御と読み取り専用制約は両モードで維持します。
- 理由: 専用テストサーバー上で、他プレイヤー検知の継続的な観測試験を実施するためです。
  判断をMinecraftイベント変換から独立したポリシーへ分離し、既定値を`normal`とすることで、
  通常運用の安全停止を維持します。

## ADR-010: normal通常運転の上限付き再接続

- ステータス: 承認済み
- 決定: 読み取り専用の通常運転を`normal`固定で提供します。接続close、スポーンまでの
  タイムアウト、構造化された一時ネットワークエラーだけを上限付き指数バックオフで
  再試行します。未知エラー、他プレイヤー検知、シグナルでは再接続しません。
- 理由: 一時障害からは自動復旧しつつ、認証障害や安全停止を無制限に繰り返さないためです。
  Composeは`restart: "no"`とし、ランタイム自身の制限をDockerが迂回しないようにします。

## ADR-011: 将来の永続化先をMySQLとする

- ステータス: 承認済み、実装は将来工程
- 決定: 状態と作業履歴の永続化先はMySQLとし、domainとapplicationコードは
  Repositoryインターフェースだけに依存します。
- 理由: 現在の運用計画で選定された永続化基盤へ正本を合わせるためです。外部DB接続、
  ドライバー追加、スキーマ、マイグレーションは状態管理工程に含めません。

## ADR-012: コマンド駆動のプロセス内状態ストア

- ステータス: 承認済み
- 決定: 状態をdomain層の単一スナップショットで管理し、任意patchではなく型付きコマンドで
  遷移させます。変化はプロセス内イベントとして購読可能にし、同一状態の通知を抑制します。
- 実装: スナップショットと変更イベントを再帰的にfreezeし、注入ClockでUTC時刻を
  一元化します。subscriberはmicrotaskで分離し、同期例外とPromise rejectionを
  エラー報告コールバックへ隔離します。RuntimeSupervisorは状態更新失敗時にも安全切断を
  継続します。
- 理由: 不正遷移を防ぎ、MinecraftをDiscordやMySQLへ直結せず、同じ状態変化を複数の
  adapterが安全に利用できるようにするためです。

## ADR-013: 状態イベント起点の通知ポート

- ステータス: 承認済み（通知基盤の判断。DiscordアダプターはADR-014で追加済み）
- 決定: 通知は`StateChangeEvent`だけを起点とし、変更前後の実値を固定テンプレートの
  `NotificationMessage`へ変換します。外部配送は`NotificationPort`へ分離し、
  runtime標準は外部通信しないNo-op、テストは明示注入するFakeを使用します。
- 順序と重複防止: revisionが単調増加するイベントだけを直列配送し、決定論的な
  `notificationId`を既定256件の有界履歴で重複排除します。古いrevisionは送信しません。
- 障害境界: 状態dispatchは配送を待たず、同期例外とPromise rejectionは
  `onNotificationError`へ隔離します。通知失敗はruntimeやMinecraftの安全切断を妨げません。
- この段階での未実装範囲: プロセス再起動後の重複防止と永続配送、Discord実アダプター、
  認証、定時報告。Discord実アダプターの後続判断と現在の実装状態はADR-014に記録します。
- 将来方針: 429の`Retry-After`、一時的な5xx・通信失敗だけの上限付き指数バックオフと
  jitter、認証・不正リクエストの再試行禁止を実アダプターで実装します。永続保証が
  必要になった時点でMySQL等のoutboxを検討します。
- 理由: Minecraftと外部通知を結合せず、通知障害から安全停止を隔離し、将来の配送先を
  差し替え可能にするためです。

## ADR-014: Discord Incoming Webhook通知アダプター

- ステータス: 承認済み（受入試験1～3完了）
- 決定: 専用チャンネルへの一方向通知にはIncoming Webhookを使用し、Node.js 24の標準
  `fetch`で`NotificationPort`を実装します。Discord SDK、Botユーザー、Gateway接続、
  embed、添付は導入せず、`allowed_mentions.parse`を空にした2,000文字以内の
  プレーンテキストだけを`wait=true`で送信します。
- 設定境界: 通知は既定で無効です。有効化フラグとWebhook URLは起動時に一度だけ読み、
  有効時の不正URLはInstanceLock取得やMinecraft接続より前に固定メッセージで拒否します。
  URLは秘密情報として状態、通知、ログ、例外へ含めません。
- 配送境界: 1試行5秒、初回を含む最大3試行、レート制限待機とバックオフを含む総15秒を
  上限とします。429はDiscordの待機指定、一時的な500・502・503・504、通信失敗、
  timeoutだけを再試行し、認証・不正要求とその他の応答は再試行しません。Discordの
  limit値は固定せず、レスポンスヘッダーを使用します。
- 終了と障害隔離: runtime bindingの`close()`で進行中HTTP、レート制限待機、バックオフを
  Abortし、配送完了を待ちません。配送失敗は許可済み分類、status、attemptsだけをログへ
  投影し、StateStoreへ再投入しません。Minecraftの安全停止は配送に依存しません。
- 検証: 承認済みの専用テスト環境で実Discord送信を含む受入試験1～3が完了しています。
  非秘密な結果は[Discord Incoming Webhook受入結果](verification/discord-webhook.md)に
  記録します。
- 未実装: Bot API、双方向操作、定時報告、outbox dispatcher、再起動後の重複防止、永続的な
  配送保証。outbox記録はADR-016で追加します。
- 理由: 現在は一方向通知だけが必要であり、既存ポートへ小さなHTTPアダプターとして接続し、
  Discord障害を安全制御から分離できるためです。

## ADR-015: 開発工程におけるエージェントの自律実行範囲を拡大する

- ステータス: 承認済み
- 背景: 調査、修正、再検証、ローカルservice検証、commitの各段階で一律に承認を待つと、
  安全境界に影響しない日常開発も中断され、ロードマップの進行が遅くなります。
- 決定: [開発権限と承認ゲート](project/governance.md)を正式な権限情報源とし、依頼または
  ロードマップの現在工程に含まれる編集、検証、修正、再検証を自律実行します。
- 依存関係: 直接必要で、Node.js 24との互換性、install script、license、保守・securityを
  確認した固定versionだけを追加・更新し、package fileとlock fileを同時更新して全検証します。
  major互換性変更、主要framework置換、新service・認証方式は承認対象です。
- DockerとDB: image build、隔離されたlocal test service、network、使い捨てDB、migration、
  rollback、Repository統合testを自律実行します。認証・永続volume、本番Docker、外部・共有DB、
  破壊的migrationは対象外です。
- Discord: 設定済みIncoming Webhookと既存固定templateによる回数限定の開発・受入送信は、
  timeoutとretryを有限にし、秘密・mentionを含めず、安全停止から隔離する条件で自律実行します。
  WebhookやDiscord側resourceの変更、Bot API、双方向通信、大量送信は承認対象です。
- Git: 必要な検証と秘密情報・差分確認が完了したtask-owned変更だけをlocal commitできます。
  push、pull、merge、rebase、tag、releaseその他のremote操作は引き続き承認対象です。
- 安全境界: 実Minecraft接続、game操作、外部DB、本番・cloud、認証volume、主要architecture・
  security境界の変更には事前承認が必要です。秘密情報の表示・記録、player/BOT/server情報の
  保存、安全制御の無効化、停止後の再接続、無制限retry、destructive Gitは常に禁止します。
- Codex設定: `workspace-write`、interactiveな`on-request`、`auto_review`、workspace内networkを
  使用します。これは上位のCodex policy、sandbox、実行環境を緩和または回避するものではなく、
  上位制約を回避しません。自律範囲のDocker test service、localhost test、image build、明示stage、
  local commitで権限昇格が必要な場合は、ユーザーへ会話上の再承認を求めず`auto_review`へ直接提出
  します。上位system自身が人間判断を強制する場合だけ、そのsystem承認を表示します。
- 効果とrisk: 安全な日常開発を連続実行できる一方、local service、network、dependency、commitの
  影響範囲が広がります。固定version、有限回数、隔離環境、task-owned差分、全検証、秘密情報
  allow-listを条件としてriskを制限します。

## ADR-016: 状態イベントをMySQLへtransaction保存する

- ステータス: 承認済み（隔離MySQL検証完了）
- 決定: `StateChangeEvent`を唯一の永続化起点とし、application層の直列subscriberから
  `StatePersistenceRepository`を呼びます。domain、RuntimeSupervisor、Minecraft adapterは
  MySQL、SQL、transactionへ依存しません。
- スキーマ: runtime起動ごとのUUIDを`run_id`とし、最新snapshot、revision履歴、作業checkpoint、
  通知outboxを保存します。`(run_id, revision)`と`(run_id, notification_id)`で冪等化し、
  snapshotとcheckpointを古いrevisionで後退させません。
- transaction: 1状態eventのhistory、snapshot、checkpoint、outboxを単一transactionで更新し、
  途中失敗時はrollbackします。schemaは連番up/down migrationと`schema_migrations`で管理します。
- 障害境界: 一時的な接続喪失、timeout、deadlock、lock timeoutだけを最大3試行で再試行し、
  恒久障害は安全なcodeへ変換します。失敗をStateStoreへ再投入せず、Minecraft安全停止を
  待たせません。終了時flushは安全切断後の最大1秒です。
- 依存関係: ORMやmigration frameworkを追加せず、MIT licenseでNode.js 24と互換性がある
  `mysql2` 3.23.2を固定使用します。
- 秘密境界: snapshot、history、checkpoint、outbox、fixtureへplayer名、BOT情報、server endpoint、
  credentialを含めません。DB errorや接続設定をログへ渡しません。
- 未実装: outbox dispatcher、配送済み更新、再起動後のDiscord再送、外部・共有・本番DBへの
  migration、永続dataのbackup/restore運用。
- 理由: 状態変更と通知候補を原子的かつ再現可能に保存しながら、DB障害をMinecraftの安全制御から
  隔離するためです。

## ADR-017: 作業指示を有限状態の永続queueとして分離する

- ステータス: 承認済み（最小実装）
- 決定: 作業指示は任意payloadを持たない型付きcommandとして受付し、priority降順、同順位は
  FIFOのqueueで管理します。enqueueはtask ID単位で冪等化し、claim、cancel、release、終端化を
  明示commandに限定します。
- 状態と試行: queued、claimed、completed、failed、stopped、cancelledを使用します。releaseは
  最大試行回数未満だけqueuedへ戻し、上限到達時はfailedへ終端化します。終端状態からの暗黙の
  再開は許可しません。
- 永続化: application serviceは`TaskQueueRepository`だけに依存します。MySQL adapterは
  transaction内の`FOR UPDATE SKIP LOCKED`で1件を排他的にclaimし、多重workerでも同じ指示を
  二重取得しません。
- 安全境界: 現在のclaimはキュー状態の変更だけで、Minecraft操作を開始しません。外部入力、
  executor、claim lease回収、scheduleは未実装です。秘密、player/BOT/server情報をqueueへ
  入れられる任意フィールドは設けません。
- 理由: 将来の作業実行を、安全制御と永続化から独立して順序付け、無制限再試行と二重実行を
  防ぐ土台を先に確立するためです。

## ADR-018: StateSnapshot起点の共通作業安全境界

- ステータス: 承認済み（最小実装）
- 決定: 作業の開始と継続は、Minecraftやtask固有実装ではなく、StateStoreの単一snapshotを
  入力とする`DefaultWorkSafetyPolicy`で判定します。将来executorのqueue claimは
  `SafetyControlledTaskQueue`を経由し、安全判定を通過するまでRepositoryを更新しません。
- fail-closed: runtime ready、Minecraft spawned、spawn完了、他player未検知、停止要求なし、
  体力10以上、空腹度6以上をすべて必要とします。telemetryの未取得、非有限、0～20範囲外を
  許可せず、閾値は設定で無効化できません。
- 停止と再開: 作業中に条件を失った場合はstopとし、同一taskの重複停止をprocess内で抑制します。
  他player検知とoperator・signal停止は非再開可能で、同じprocessで再claimしません。
- 競合: claimの前後で最新snapshotを評価し、その間に安全条件を失った場合はclaimed taskを即時に
  stoppedへ終端化してexecutorへ渡しません。
- 互換性: normal runtimeのPlayerDetectionPolicy、上限付き再接続、StateStoreの原子的な
  他player停止、安全切断を変更しません。debug smokeは読み取り専用観測例外のままで、作業実行
  policyへ接続しません。
- 未実装: executor、Minecraft操作、食事・退避などの回復動作、追加危険入力、分散worker間の
  停止冪等性、claim lease回収。
- 理由: 将来のtask実装が安全条件を個別解釈または迂回することを防ぎ、不明な状態では動作しない
  一貫した境界を、game操作の導入前に確立するためです。

## ADR-019: 実packet adapterより先に有限移動portと安全coordinatorを確立する

- ステータス: 承認済み（Fakeによる最小基盤）
- 決定: 移動はMinecraft非依存の型付きplan、`MovementPort`、application coordinatorに分離します。
  planは同一dimension内の直線を有限stepへ分割し、座標範囲、最大step距離・数、timeout、到達許容差を
  送信前に検証します。
- 安全境界: coordinatorは各stepの前後で`DefaultWorkSafetyPolicy`を最新snapshotへ適用します。
  他player、signal/operator停止、接続・spawn不成立、health・hunger危険、telemetry欠損・不正では
  portを一度だけ停止し、後続stepを送りません。cancel、timeout、port障害も有限の終端結果にし、
  自動retryしません。
- 状態整合: 正常経路では開始した作業のStateStoreと永続queueをcompleted、failed、stoppedの
  いずれかへ各1回だけ終端化します。移動の観測位置とdimensionをStateStoreへ反映し、進捗を
  step完了率で更新します。
  両者は単一transactionではないため、Repository障害時は`finalization_error`で有限終了し、
  StateStoreをterminalへ保ちます。queueが`claimed`で残る場合のlease回収は後続工程とし、曖昧な
  自動retryや二重終端化を行いません。
- adapter: 現在はFakeだけを実装します。bedrock-protocolの送信packetを推測せず、一次仕様、dependency
  の型、専用テストサーバーでの段階的検証を準備できるまで実adapterとruntime executorを追加しません。
- 対象外: 異dimension移動、経路探索、障害物・落下・危険block・敵対MOB検知、視点変更、jump、
  採掘、設置、攻撃、item、chat、command。
- 理由: game protocolの誤った推測による暴走を避け、安全制御を迂回できない中断・状態整合の境界を
  外部接続なしで先に検証するためです。
