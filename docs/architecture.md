# アーキテクチャ

## 1. 設計目標

このアーキテクチャでは、Minecraft、永続化、ホスティングに関する選択がタスクロジックへ
影響しないように、ポートとアダプターを使用します。安全ポリシーはアプリケーション境界に
配置し、アダプターから迂回できないようにします。

## 2. 目標とするコンポーネントモデル

```text
Entrypoint / lifecycle
        |
Application coordinator ---- Safety policy
        |                         |
        +---- Domain tasks -------+
        |
        +---- Minecraft port ---- bedrock-protocol adapter (read-only smoke)
        +---- Repository ports -- MySQL state persistence repository
        +---- Task queue service -- TaskQueueRepository -- MySQL task queue
        +---- Checkpoint records - current MySQL repository; resume API (future)
        +---- Instance lock ----- DB lease/advisory lock (future)
```

将来推奨されるソース構成は次のとおりです。

```text
src/
  application/   orchestration, lifecycle, safety policy
  domain/        task state and rules without infrastructure imports
  ports/         Minecraft and Repository interfaces
  adapters/
    minecraft/   bedrock-protocol read-only integration
    persistence/ MySQL repositories and migrations
  infrastructure/ configuration, logging, health, signals
```

初期段階のソースは意図的に小さく保ちます。ディレクトリは、そこに配置するコードが
存在するようになった時点で導入します。

## 3. ライフサイクルと安全状態

将来実装するコーディネーターは、次の明示的な状態機械を持ちます。

```text
STARTING -> READY -> WORKING -> STOPPING -> STOPPED
                         \-> SAFETY_STOP -/
```

`normal`でのプレイヤー検知、安全でないワールド状態、ロックの喪失、または回復不能な
アダプターエラーが発生した場合は、`SAFETY_STOP`へ移行します。この状態では作業をキャンセルし、
安全に実行できる場合はチェックポイントを記録してからログアウトし、終了します。
`SAFETY_STOP`から`WORKING`へ戻る遷移はありません。

SIGTERMを受けた場合も、上限時間が設定された同じ停止処理を実行します。

## 4. 永続化

アプリケーションコードはSQLクライアントではなく、`Repository`インターフェースに
依存します。トランザクションとSQLは永続化アダプター内に留めます。スキーマ変更は、
順序付けされたマイグレーションファイルとして管理し、デプロイ手順の一環として適用
します。チェックポイントには、タスク識別子、バージョン、安全に再開できる位置、
状態ペイロード、タイムスタンプを含めます。

永続化先はMySQLです。現在はruntime run、状態、作業checkpoint、通知outboxを保存します。
作業queueは独立したRepository portを介し、MySQL transactionでpriority付きFIFOの1件を
排他的にclaimします。queueのclaimは作業実行を意味せず、Minecraft adapterへ接続しません。
読み取り専用executorのclaim leaseはmigration 005で有限化し、期限切れ時は所有権だけを回収して
claimed taskをmanual reviewへ残します。分散デプロイ用の一般的なDB leaseは未実装です。将来追加する場合も識別情報自体を保存せず、安全な
内部IDをlease keyに使用し、lease取得・更新失敗時は作業を実行せず安全に切断します。

## 5. 認証データ

Minecraftアダプターは、設定から認証キャッシュのパスを受け取ります。
ローカル環境では、リポジトリ外のバインドマウントまたは名前付きボリュームを使用します。
AWSでは、暗号化されたシークレット、またはライブラリに適した永続ストレージで管理する
必要があります。キャッシュの内容をログへ出力してはいけません。

## 6. 可観測性

プログラムは、Dockerまたはクラウドのログドライバーで収集できるように、JSONログを
stdoutへ出力します。現在、`/health`はプロセスの生存状態を返します。将来の準備状態には、
秘密情報を公開することなく、設定、インスタンスリース、データベース、Minecraftセッション
の状態を含めます。

## 7. デプロイの可搬性

アプリケーションは、リポジトリと外部の認証キャッシュを除いてステートレスです。環境変数
から設定を受け取り、stdoutへログを出力し、SIGTERMを処理し、HTTPヘルスチェックを公開
します。これにより、同じ成果物をCompose、systemd、ECS、またはその他のLinuxコンテナ
ランタイムで実行できます。

## 8. 読み取り専用スモークテスト

スモークテストのアプリケーション層は`ReadonlyMinecraftConnection`だけに依存します。
bedrock-protocolアダプターは受信パケットを型付きイベントへ変換し、ゲーム内行動を
送信するメソッドを公開しません。ライブラリが接続維持に必要として送信する応答と、
明示的な切断だけを許可します。

プレイヤー一覧イベントの変換はMinecraftアダプターが担当し、接続継続または停止の判断は
Minecraftへ依存しない`PlayerDetectionPolicy`が担当します。初期プレイヤー一覧はBOTの
認証名が確定したスポーン時に評価し、自身を除外します。`normal`は停止要求へ変換し、
`debug`は観測ログだけを出して接続を維持します。

認証キャッシュとインスタンスロックは、BOTアカウント識別子ごとの名前付きDocker
volumeへ保存します。実行コンテナは非rootかつread-onlyとし、認証volumeと一時的な
`/tmp`だけを書き込み可能にします。

## 9. 読み取り専用通常運転

`RuntimeSupervisor`は接続Factoryと中断可能な待機関数に依存し、Minecraftライブラリから
独立して接続試行、プレイヤー安全停止、シグナル停止、上限付き再接続を調整します。
各試行のイベントリスナーと接続タイマーは試行終了時に解除され、同時に複数の接続試行を
開始しません。`BedrockReadonlyConnection`は受信パケットの型付きイベント変換と
明示的な切断だけを担当します。

再試行対象は接続close、接続タイムアウト、およびエラーコードで明確に識別できる一時的な
ネットワークエラーです。未知エラーは安全側で回復不能と扱います。通常運転とsmokeは同じ
`InstanceLock`と認証volumeを使い、同じBOT識別子の同時使用を防ぎます。
検証環境用`compose.verification.yaml`は同じruntime imageと認証volumeを再利用し、normal mode、
MySQL永続化、非再起動policyだけを固定します。別のMinecraft client実装や安全policyを持たず、
`--no-deps runtime`で他の接続serviceから分離します。

## 10. 状態・進捗管理

状態管理はMinecraft、Discord、MySQLから独立したdomainモジュールとし、コマンドによる
検証済み遷移、読み取り専用スナップショット、プロセス内の変更イベントを提供します。
`RuntimeSupervisor`は接続イベントを状態コマンドへ変換します。MySQL Repositoryは同じイベントを
直列購読します。Discord通知はMySQL無効時だけ直接購読し、有効時はoutbox経由で配送します。
各runtime runをUUIDで分離し、history、最新snapshot、作業checkpoint、通知outboxを
単一transactionで保存します。Minecraft adapterとRuntimeSupervisorはSQLを知りません。
subscriber障害は安全切断経路から隔離します。
管理用`operator-log`は専用`OperationalLogRepository`だけに依存し、MySQL adapterがsnapshotとhistoryの
JSONから許可済みfieldをSQLで投影します。raw JSON、自由文message、接続情報をapplication層へ渡さず、
run IDとrevisionによる有限・昇順照会だけを提供します。このentrypointはmigrationやMinecraft adapterを
参照しません。
MySQL有効時の起動時にはtask queueを読み取り、`queued`を未開始のclaim候補、`claimed`を
結果不明のmanual review、完了・失敗・停止・cancel済みを終端として件数だけ監査します。
監査はtaskを変更せず、task IDや指示内容をログへ出しません。

### 平日運用スケジューラー

`domain/scheduler`は注入ClockのUTC時刻をJSTへ変換し、平日の午前・切替・午後・時間外を判定します。
前回評価時刻と日付付きwindow IDを保持し、枠変更時に停止、開始の順でimmutableなintentを返します。
時計の巻戻りではintentを抑止し、飛越しでは過去の全境界を再生せず現在枠への最小遷移だけを返します。
Minecraft、MySQL、process signal、timerには依存しません。

application層の`ScheduledRuntimeController`は、開始intentごとに再利用可能な`RuntimeSession`を作成し、
停止intentでは`RuntimeSupervisor`へ`schedule_window_ended`を渡します。旧sessionのruntime終了、task停止、
永続化flush、adapter cleanup、InstanceLock解放をawaitした後だけ次sessionを開始します。通常`runtime.ts`も
同じsession factoryを使用するため、接続・通知・MySQL・task executor・安全停止を複製しません。scheduler
intentはStateStore eventとなり、接続状態と停止理由と同じrun ID・revision履歴へ保存されます。詳細は
[平日運用スケジューラー](scheduling.md)を参照してください。

ローカルoperator entrypointはMySQL queueへ`verify_arrival`と`record_position`だけを冪等投入します。
通常runtimeの読み取り専用executorは共通安全policyを通過後に対象typeだけをclaimし、server観測済み位置を
StateStoreの作業状態とcheckpointへ反映します。Minecraft送信portは参照しません。
スナップショットとイベントは実行時に再帰的にfreezeし、時刻は注入可能なClockから
UTCで取得します。subscriberはmicrotaskで呼び出し、同期例外と非同期rejectionを
観測可能なエラー報告へ隔離します。詳細は[状態・進捗管理](state-management.md)を
参照してください。

## 11. 通知基盤

通知は`StateChangeEvent`だけを起点とし、MinecraftアダプターやRuntimeSupervisorから
送信ポートを直接呼びません。application層のmapperが変更前後の状態を固定テンプレートの
`NotificationMessage`へ変換します。MySQL無効時は`NotificationSubscriber`、有効時は
永続outboxの`OutboxDispatcher`がrevision順に`NotificationPort`へ直列配送します。

通常runtimeは起動時に通知設定を一度だけ検証し、無効時は`NoopNotificationPort`、
有効時はNode標準`fetch`を用いる`DiscordWebhookNotificationPort`を共有StateStoreへ
接続します。Discord固有処理はadapter層に限定し、HTTP transport、単調時計、待機、jitterを
テストから差し替えられます。送信例外とPromise rejectionは安全な分類へ変換して通知エラー
callbackへ隔離し、安全切断や状態dispatchを待たせません。

MySQL有効時は状態eventと通知候補を同一transactionで保存し、Repository portが1件ずつ
排他claimします。`pending`、`delivering`、`delivered`、`failed`の状態、有限lease、最大
試行回数、次回試行時刻をMySQLに保持し、並行workerの重複claimとcrash後の放置を防ぎます。
送信成功後のDB更新前crash windowは残るため、契約はat-least-onceです。

runtime終了時はsubscriberまたはdispatcherの新規受付・claimを止め、取得済み配送の終了後に
bindingをcloseします。Webhook URLは状態、通知本文、ログへ渡しません。Discord Bot APIと定時報告は
未実装です。詳細は[通知基盤](notifications.md)を参照してください。

## 12. 共通の安全制御

`DefaultWorkSafetyPolicy`はStateStoreの単一snapshotから、作業開始と継続の可否を純粋なdomain
判定として返します。runtime ready、Minecraft spawned、他player未検知、停止要求なし、取得済みで
正常範囲の体力・空腹度をすべて満たした場合だけ許可します。未知・不正telemetryはfail-closedで、
開始前はblock、継続中はstopです。他player検知とoperator・signal停止は非再開可能です。

application層の`SafetyControlledTaskQueue`は、将来executorに公開するqueue claim境界です。
安全判定を通過するまでRepositoryのclaimを呼ばず、claim後の停止判定はtaskを一度だけstoppedへ
終端化します。現在のread-only runtimeはStateStoreへ接続・spawn・telemetry・停止を反映するだけで、
queue consumerやMinecraft操作を開始しません。debug smokeの観測例外は作業実行境界へ接続しません。
詳細は[共通の安全制御](safety-controls.md)を参照してください。

## 13. 移動基盤

domainの移動planは現在位置から同一dimensionの目標位置までを有限stepへ分割し、座標、step距離、
step数、timeout、到達許容差を検証します。applicationの`MovementCoordinator`は各step前後で
`DefaultWorkSafetyPolicy`を評価し、許可された場合だけ`MovementPort`を呼びます。cancelまたは
安全条件喪失後はportを一度だけ停止し、新規stepを送りません。

`MovementPort`はMinecraft adapter境界です。固定versionのframe factoryと
`BedrockMovementPort`は、厳格検証済みの1 tick frameを注入transportへqueueし、own entityの
server観測を待ちます。目標からphysics入力を推測するframe providerは未実装で、runtime bindingは
既定disabled、queue consumerとruntime executorもありません。この分離により、実移動を有効化せず
serializer、tick、補正、Abort、listener cleanupを検証できます。詳細は[移動基盤](movement.md)を
参照してください。

StateStoreと外部queue Repositoryは同一transactionではありません。正常経路は各1回だけ終端化し、
Repository障害時はStateStoreをterminalへ保ったまま`finalization_error`を返し、曖昧な自動retryを
行いません。queueの`claimed`残留回収はclaim leaseとともに後続工程で扱います。

## 14. 簡単な作業domain

`simple-work` domainは`navigate_to`、`verify_arrival`、`record_position`だけを判別可能な型で表し、
任意payloadやworld変更操作を持ちません。application coordinatorはnavigateだけを既存の
MovementCoordinator境界へ渡し、確認・記録は注入されたserver観測位置を読みます。runtime、queue
consumer、Minecraft connectionには未接続です。詳細は[簡単なMinecraft内作業](simple-work.md)を
参照してください。

## 15. 最初のブロック操作

`domain/block-operation`は単一dirt配置の座標・block・事前事後条件を厳格に定義し、
`BlockOperationPort`はserver block観測と1回の配置要求をMinecraft adapterから分離します。
PlayerAuthInput streamは接続単位のauthoritative frame排他境界でmovementとblock placementの同時所有を防ぎます。
この境界はtick単調性と観測鮮度を検査しますが、配置packetの未確定な意味論を補完しません。
application coordinatorはqueue claim、StateStore、共通安全policy、reach、support、TOCTOU再評価、
server事後観測を統合します。migration 003はversion付き指示と送信直前・検証済みphaseを保存し、
claimed残留を自動再送しません。実packet adapterはなく、通常runtime bindingは`unsupported`かつ
disabledです。専用試験bindingはsupported portの明示注入時だけ生成できます。
詳細は[最初のブロック操作](block-operations.md)を参照してください。

## 16. Bedrock world・inventory観測

`domain/world-observation`はMinecraft packetに依存しないimmutable snapshot、revision、block cache、
inventoryの安全な最小表現を管理します。`WorldObservationPort`はworld mutation portと分離した
読み取り境界です。Bedrock adapterは1.26.30のprimary layer block更新とown entityのheld itemだけを
変換し、生packet、NBT、表示名をdomainへ渡しません。

dimension変更とdisconnectではcacheを破棄し、spawn前と移行中をfail-closedにします。runtimeは
既定disabled bindingのcleanupだけを持ち、自動作業やpacket送信へ接続しません。詳細は
[Bedrock world・inventory観測基盤](world-observation.md)を参照してください。

`item_registry`は接続generation単位の読み取り正本として検証し、`minecraft:dirt`だけを安全なmappingへ
投影します。`mob_equipment`の`ItemNew`はtransactionに必要な固定fieldと空extraだけを投影しますが、
full inventoryの`ItemV4.extra_data`はopaqueなため使用しません。block palette IDとは型と利用箇所を分離します。

配置protocolのadapter層は、faceとenvelopeを別々のcapability evidenceとして扱います。固定schema内に
`up`の数値enumおよびauthority設定からenvelopeを選択する規則がないため、両候補をoffline serializeできても
production portは`unsupported`のままです。
