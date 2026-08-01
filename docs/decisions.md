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
- この段階での未実装範囲（後にADR-014・ADR-029で解消）: プロセス再起動後の配送とDiscord実アダプター、
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
- この決定時の未実装: Bot API、双方向操作、定時報告、outbox dispatcher。outbox記録は
  ADR-016、dispatcherとat-least-once配送はADR-029で後に追加しました。
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
- この決定時の未実装: outbox dispatcherと配送結果更新はADR-029で後に追加しました。
  外部・共有・本番DBへのmigrationと永続dataのbackup/restore運用は未実装です。
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
- 安全境界: この決定時点のclaimはキュー状態の変更だけで、Minecraft操作を開始しませんでした。
  ローカルoperator入力、読み取り専用executor、claim lease回収は後続のADR-031で追加しています。
  scheduleとMinecraftへ作用するexecutorは未実装です。秘密、player/BOT/server情報をqueueへ
  入れられる任意フィールドは設けません。
- 理由: 将来の作業実行を、安全制御と永続化から独立して順序付け、無制限再試行と二重実行を
  防ぐ土台を先に確立するためです。

## ADR-018: StateSnapshot起点の共通作業安全境界

- ステータス: 承認済み（最小実装）
- 決定: 作業の開始と継続は、Minecraftやtask固有実装ではなく、StateStoreの単一snapshotを
  入力とする`DefaultWorkSafetyPolicy`で判定します。executorのqueue claimは
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
- 後続状況: この決定時点で未実装だった読み取り専用executorとclaim lease回収はADR-031で
  追加しました。Minecraft操作、食事・退避などの回復動作、追加危険入力、分散worker間の
  停止冪等性は未実装です。
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

## ADR-020: 1.26系移動はPlayerAuthInputを候補とし座標だけの送信を禁止する

- ステータス: 設計確認済み、実adapterは保留
- 根拠: 固定依存の1.26系schemaでは`player_auth_input`がserver-authoritative movement用の
  server-bound packetで、positionに加えてtick、入力vector、rotation、input flags、delta、camera
  orientationを毎tick整合させる必要があります。serverは`correct_player_move_prediction`でtick単位の
  補正を返します。
- 決定: `move_player`または`player_auth_input.position`へstep目標だけを設定する実装を禁止します。
  version別frame生成、単調tick、neutral input、補正処理、serializer testを確立するまで実adapterを
  追加せず、通常runtimeを読み取り専用に維持します。
- 観測: own entityのserver観測位置と補正packetを正本とし、送信した申告位置だけで到達成功にしません。
  correction、timeout、dimension変化、tick異常では後続入力を止め、retryしません。
- 安全停止: cancel後は新規movement inputを生成せず、安全停止時はneutral input完了より既存の切断を
  優先します。jump、sprint、sneak、item、block、attack、chat等のflag・packetは対象外です。
- 理由: Bedrockのserver-authoritative movementを単純な位置teleportとして扱うと、server reject、
  巻戻し、継続移動、誤到達判定を起こし、安全policyを満たせないためです。

## ADR-021: Bedrock移動adapterを検証済みframe注入境界として準備する

- ステータス: 承認済み（実接続前の準備）
- 決定: 固定依存と同じ1.26.30だけをallow-listし、完全な1 tick分の`player_auth_input` frameを
  厳格検証するfactoryと、bedrock client transportへqueueしてserver観測を待つMovementPort adapterを
  実装します。targetからinput vector、delta、rotation、tickをadapterで推測しません。
- packet安全性: input flagsは空、conditional transaction・item・block fieldは生成せず、modeを固定します。
  tick後退・重複、非有限field、未知versionは送信前に拒否します。1 move呼出しは最大1 frameで、
  catch-up loopと自動retryを持ちません。
- 観測と中断: own entityのserver観測だけを結果とし、補正、異dimension、invalid observation、切断、
  Abortは有限失敗です。stop後はneutralを含む新規送信をせずlistenerを解除します。
- runtime: movement bindingのcleanup境界だけを追加し、既定はdisabledです。frame provider、queue consumer、
  executor、設定による有効化は専用サーバー受入まで追加しません。
- 理由: schema・transportの検証可能部分を先に固定しながら、未確定のphysicsを推測して実ゲーム操作を
  有効化する危険を避けるためです。

## ADR-022: 最初の作業domainを非破壊な3種類に限定する

- ステータス: 承認済み（runtime未接続）
- 決定: 最初の作業は`navigate_to`、`verify_arrival`、`record_position`だけを型付きで表します。
  navigateだけが共通安全policy付きMovementCoordinatorへ委譲でき、確認と記録はserver観測位置だけを
  使用します。navigateは観測originと同じdimension・同じYの水平目標だけに限定します。任意payloadや
  block・entity・inventory操作を表す型を設けません。
- 境界: この決定時点で未実装だった読み取り専用runtime consumerとqueue終端化統合は
  ADR-031で追加しました。外部network指示APIと実Minecraft操作は未実装です。
- 理由: 世界を変更しない作業からdomain契約と観測結果の扱いを検証し、採掘・設置等を安全境界確立前に
  混入させないためです。

## ADR-023: 最初のblock変更を単一dirt配置のoffline境界に限定する

- ステータス: 承認済み（Fakeによるoffline安全境界、実adapter未実装）
- 比較: 採掘は既存block消失、drop、tool、複数tickのserver-authoritative breakingを伴い、結果不明時の
  rollbackが困難です。配置もinventory slot、stack ID、block runtime ID、support faceが必要ですが、
  airとsupportを事前観測し、server観測したdirtだけを成功にする限定契約を先に検証できます。
- 決定: 1 commandを`place_single_dirt`の1座標、target air、直下solid support、up face、最大3 block reach、
  有限timeoutへ固定します。任意block、payload、range、wildcard、複数操作、採掘は表現しません。
- 安全性: 共通安全policy、claimed task、normal ready、spawn・telemetry、同一dimensionを要求し、事前観測後の
  操作直前にも再評価します。配置要求は最大1回で、timeout、disconnect、cancel、結果不明を再試行しません。
  serverの同一座標dirt観測だけを完了条件にします。
- adapter: 1.26.30 schemaにはinventory/hotbar/stack ID、clicked block runtime ID等が必要ですが、現在の接続は
  それらを追跡しません。値を推測せず、実adapterは`unsupported`、runtime bindingはdisabledに保ちます。
- 理由: 不可逆な採掘よりrollback可能性をoperatorへ残し、実world変更を有効化せずに安全・観測・終端化の
  application境界を先に確立するためです。

## ADR-024: Bedrock観測を有界な読み取り専用snapshotへ変換する

- ステータス: 承認済み（offline Fake検証、実server未検証）
- 根拠: 1.26.30 schemaの`update_block`は座標・runtime ID・layer、`mob_equipment`はown runtime entity、
  selected slot、`ItemNew`のnetwork ID・count・stack ID・block runtime IDを持ちます。
- 決定: Minecraft非依存の`WorldObservationStore`と読み取り専用portへ変換し、revision、UTC時刻、
  最大128件FIFO block cacheを持たせます。primary layerとown entityだけを受け付け、dimension変更と
  disconnectでcache・inventoryを破棄します。
- fail-closed: spawn前・dimension移行中・disconnect後、古いsequence、不正fieldは利用しません。
  固定依存の`spawn` eventは初回だけのため、dimension変更後は再接続まで利用不能にします。
  full inventoryとhotbar対応は推測せず`unsupported`です。NBT、表示名、raw packet、player/BOT/server情報は
  保存しません。
- runtime: cleanup可能な既定disabled bindingだけを追加し、block操作、inventory操作、consumer、送信packetを
  接続しません。
- 理由: 世界変更前にserver観測の正本と寿命を固定し、不明なinventory情報や古いdimension cacheによる
  誤配置を防ぐためです。

## ADR-025: 単一block指示をversion付きで永続化しprotocol不足時は実送信しない

- ステータス: 承認済み（offline実装。実server受入は未開始）
- 永続化: `place_single_dirt`はschema version 1の完全な指示をstrict codecで`task_queue`へ保存します。
  任意payloadを許可せず、未知version、余分なfield、task ID・type不一致、`maxAttempts`が1以外の指示は
  enqueue時と復元時にfail-closedで拒否します。
- 結果不明境界: 世界変更要求の直前に`delivery_started`、server事後観測後に`verified`を永続化します。
  process crashで`claimed`が残った場合は送信有無を推測せずmanual review対象とし、自動release、再claim、
  再送を行いません。
- protocol判断: 固定1.26.30 schemaで`inventory_transaction`候補の構造的serializeは確認しました。ただし
  item registryによるdirt同定、transaction用held item完全形、faceの数値意味、standalone transactionと
  PlayerAuthInput埋込みの選択、authoritative frameとの合成は一次根拠が不足しています。serialize成功を
  server受理の根拠にせず、production adapterは`unsupported`を維持します。
- runtime: 通常runtimeはdisabledのままです。supported port、共通安全policy、StateStore、永続queueを
  明示注入する専用受入bindingだけを準備し、consumerや自動実行を追加しません。
- 理由: crash後の二重配置と、protocol値の推測による誤操作を防ぎながら、検証可能な永続化・cleanup境界を
  実server接続前に固定するためです。

## ADR-026: item registryを接続単位で検証し未定義の配置protocol値は推測しない

- ステータス: 承認済み（offline実装、実adapterは保留）
- 一次根拠: 固定`bedrock-protocol` 3.57.0の1.26.30 schemaでは、`mob_equipment`のitemは`ItemNew`、
  item mappingは独立した`item_registry`、配置候補のheld itemは異なる`Item`形です。`ItemNew`から
  metadata、stack ID、block runtime ID、NBTなし・制約listなしのextraだけをallow-list投影します。
- registry: 接続generationごとに全entryの識別子とruntime IDの一意性・範囲を検証し、
  `minecraft:dirt`のitem network IDだけを保持します。NBT、custom item名、生packetを保存せず、dimension
  transitionとdisconnectで無効化します。item IDとblock palette runtime IDを同一視しません。
- slot: `mob_equipment.slot`と`selected_slot`は別fieldですが、固定schemaからinventory slot対応を
  確定できないため、両fieldの構造だけを検査し、inventory slotは`unsupported`のままにします。
- face: `TransactionUseItem.face`は`u8`ですが方向enumが固定dependencyにありません。domain上の`up`を
  数値へ変換せず、targetがsupport直上、整数座標、block-local click位置が0～1であることだけをoffline検証します。
- envelope: standalone `inventory_transaction`と`player_auth_input` item-interactは両方schema上有効です。
  `server_authoritative_inventory`、movement authority、tickからどちらを選ぶ規則はschemaにないため、
  capability evaluatorはambiguousを`unsupported`として返し、自動fallbackや二重送信を許しません。
- 境界: offline serializeは構文だけの検証で、server受理・face意味・配置成功を証明しません。
  authoritative frame統合も未完了のためproduction portと通常runtimeはdisabledを維持します。
- 理由: 接続ごとに変わり得るitem IDはserver観測から確定しつつ、一次根拠のないfaceとenvelopeを推測して
  誤座標・重複packet・意図しないworld変更を起こすことを防ぐためです。

## ADR-027: 配置acceptanceをauthoritative frame排他境界と外部副作用前preflightで隔離する

- ステータス: 承認済み（offline境界のみ。実配置は保留）
- 背景: movementとblock placementは同じPlayerAuthInput streamを共有しますが、固定schemaは配置用frameの
  意味論、face数値、transaction envelope選択を定義しません。実serverで推測値を試すことはworld変更と
  二重frameの危険があります。
- 決定: 接続単位の排他所有境界でmovement／block placementを直列化し、tick単調性、観測revision、dimension、
  reach、安全停止を検査します。専用acceptance entrypointは通常runtimeとsmokeから分離し、既定無効、normal、
  operator確認、最大1試行を要求します。production capabilityがunsupportedの間はInstanceLock、client生成、
  認証、接続より前に固定理由で終了します。
- 結果: offlineで競合と誤起動を防止できますが、配置packetは生成・送信できません。face、envelope、配置frameの
  一次根拠が揃うまで実server試験A～Eはblockedであり、runtimeへ自動consumerを追加しません。

## ADR-028: 固定参照実装と匿名Golden Fixtureの一致を配置protocol採用条件とする

- ステータス: 承認済み（調査・観測境界のみ。実server取得は未実施）
- 背景: 固定`bedrock-protocol` schemaはwire構造を定義しますが、face方向、support／target／clickの意味、
  envelope選択、item action生成、authoritative frame同期を一意に定めません。schema serialize成功だけで
  production packetを生成することはできません。
- 固定根拠: Geyser `3aeedfa6f207691d92d4f20106bc586b2ab883d4`、Cloudburst Protocol
  `97fd7dce91a69e9a1f3f6bd7c1b8c790f2bbd8f7`、PrismarineJS bedrock-protocol 3.57.0の
  `1b38211b69e44ed6abee620d995e5364967c9103`、minecraft-data 3.112.0の
  `ee5b8c8e6e6e6af2a117d5273fce9a7096dda39f`を参照します。将来のHEADを暗黙に採用しません。
- faceと座標: Geyserはfaceを`DOWN, UP, NORTH, SOUTH, WEST, EAST`のordinalとして検査し、受信した
  `block_position`をsupport、face隣接位置をtarget、`click_position`をsupport-relativeとして処理します。
  これにより参照実装上の`UP=1`を得ましたが、同じ1.26.30環境のGolden Fixtureと一致するまでは
  production定数に昇格しません。
- envelopeとframe: GeyserとCloudburstはstandaloneとPlayerAuthInput埋込みの両経路を扱うため、参照コード
  だけではクライアント側選択を一意に決定できません。authority modeを含む匿名Golden Fixtureを必須とします。
- 観測境界: fixtureはsupportを原点化し、tickを0起点へ変換します。item／stack／block runtime IDは実値を
  保存せず、一致booleanだけを残します。player名、BOT名、server endpoint、認証情報、生packet、NBTを
  入出力型から除外し、1回だけ取得します。
- 採用条件: Evidence Matrixの各項目について固定参照実装と匿名fixtureが一致し、offline testと独立安全
  reviewを通過した場合だけ、別の決定でproduction adapterをsupportedへ変更します。不一致、複数envelope、
  不明結果では`unsupported`を維持し、自動fallbackや再試行を行いません。
- 理由: 外部実装の慣例だけをコピーせず、対象server構成の観測と突合しながら、fixture自体から秘密情報と
  個人情報を排除するためです。

## ADR-029: MySQL outboxを有限leaseでclaimしat-least-once配送する

- ステータス: 承認済み（offline・隔離MySQL実装）
- 経路: MySQL有効時は状態event起点のoutbox保存とdispatcherだけを使い、プロセス内
  `NotificationSubscriber`の直接配送は行いません。MySQL無効時は従来のprocess内経路を保ちます。
- 状態: `pending`、`delivering`、`delivered`、`failed`の4状態とし、後ろ2つを終端とします。
  migration 004で最大試行回数、次回試行時刻、lease owner・期限を追加します。
- claim: DB advisory lockでclaim操作を直列化し、MySQL transaction内の`FOR UPDATE`で未終端の
  最古1件を排他claimします。先頭がretry待ちまたは有効lease中なら後続を追い越しません。leaseは30秒で、
  crash後の期限切れ`delivering`を回収します。worker IDとleaseが一致するclaimだけが結果を更新できます。
- 有限性: 最大5試行、250ms poll、1秒起点・60秒上限の指数backoffを内部既定値とします。
  上限到達後は`failed`へ終端化し、無限再試行しません。
- エラー境界: 最終エラーは`[A-Z0-9_]{1,64}`の安全なcodeだけを保存し、生Error、stack、
  URL、HTTP応答本文を保存・ログ出力しません。通知障害はruntimeとMinecraftの安全停止から隔離します。
- 配送契約: 送信成功後、`delivered`更新前のcrash windowは回避できないためat-least-onceです。
  `notificationId`による受信側の識別はできますが、exactly-onceとは表示しません。
- 終了: SIGINT・SIGTERM後は新規claimを停止し、取得済みの1件をportの有限timeout境界で終えて
  Repositoryとportをcloseします。
- 理由: 状態変更と配送候補の原子性、再起動後の再開、並行workerの排他を得ながら、
  外部通知障害をMinecraftの安全制御から切り離すためです。

## ADR-030: runtime起動時のtask復旧監査は読み取り専用で分類する

- ステータス: 承認済み（Fake・隔離MySQL検証）
- 決定: MySQL有効時の通常runtimeはMinecraft接続前にtask queueをRepository経由で読み取り、
  `queued`を未開始のclaim候補、`claimed`を結果不明のmanual review、その他を終端として集計します。
- 安全境界: 監査はstatus、phase、attemptsを変更しません。特に`claimed`を自動release・再claimせず、
  完了済みtaskをqueuedへ戻しません。ログは区分ごとの件数だけとし、task IDと指示内容を含めません。
- 障害時: 起動時監査に失敗した場合はMinecraft client生成・接続前に起動を失敗させます。稼働中の状態保存失敗は
  subscriber内の有限retryと安全なerror callbackへ隔離し、他player検知やsignalによる切断を妨げません。
- 理由: crash後の実行結果を推測せずoperator判断へ送り、永続化障害時もworld操作と安全停止の双方を
  fail-closedに保つためです。

## ADR-031: operator指示とexecutorを読み取り専用typeへ限定する

- ステータス: 承認済み（専用テストサーバー受入完了）
- 入力: ローカルoperator専用entrypointはschema version 1の`verify_arrival`と`record_position`だけを
  MySQL queueへ冪等投入します。HTTP、Minecraft chat、Discord双方向入力を使わず、未知type、余分なfield、
  自由文、秘密情報を拒否します。
- 実行: 通常runtimeのexecutorは`SafetyControlledTaskQueue`を唯一のclaim境界とし、ready、spawn、
  telemetry、health、hunger、他player、停止要求を共通policyで評価します。server観測済み位置だけを読み、
  Minecraft送信portを呼びません。
- leaseと復旧: claim所有権は30秒で期限切れとし、migration 005で永続化します。期限切れ所有権は回収しますが、
  taskをqueuedへ戻さず`claimed`のmanual reviewに残し、crash後の無条件再実行を防ぎます。
- 永続化: claim、作業状態、進捗、完了・失敗・停止をStateStore eventとqueueへ反映し、snapshot、history、
  checkpoint、通知outboxを既存Repository経路で保存します。DB障害は安全切断から隔離します。
- 理由: 実移動やblock操作を有効化する前に、operator入力から安全判定、server観測、永続結果までの最小loopを
  world変更なしで検証するためです。
- 検証: `docs/verification/read-only-operator-loop.md`に専用テストサーバーでの受入結果を記録しています。
