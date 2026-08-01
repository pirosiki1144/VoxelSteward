# プロジェクト状況

## 基準

- 基準コミット: `899c100b722c664b2504f745551845edb67bdc1b`
- 完成マイルストーン: MySQL稼働記録の通常runtime統合と再起動復旧監査
- 現在の工程: 承認済み専用test serverでのMySQL有効・読み取り専用runtime検証待ち

## 完成済み

- Bedrockサーバーへの読み取り専用接続
- BOT識別子単位の`InstanceLock`
- 接続タイムアウトと上限付き指数バックオフ再接続
- SIGINT、SIGTERMによる正常終了
- 接続後の他プレイヤー参加時の安全切断
- スポーン前に受信した初期プレイヤー一覧のスポーン時検査
- 他プレイヤー安全停止後の再接続禁止
- runtimeとsmokeの競合防止
- Fake接続による自動テスト
- runtimeとsmokeのDockerイメージ
- 実サーバー試験A～C
- コマンド駆動の状態・進捗ストア
- freeze済みスナップショットと非同期状態変更購読
- runtimeの接続、spawn、telemetry、安全停止、再接続、エラー状態連携
- 外部サービス非依存の通知message、mapper、port、順序付きsubscriber
- No-op通知portとテスト専用Fake通知port
- revisionと有界notificationId履歴によるプロセス内重複防止
- 通知失敗のruntime・安全切断からの隔離
- 通知無効時のNo-opと有効時のIncoming Webhook切り替え
- 厳格なWebhook設定検証と秘密値を含めない配送エラー
- 5秒／最大3試行／総15秒の上限付き配送、429・限定5xx・通信失敗の再試行
- runtime終了時の進行中HTTP・待機中断
- 専用DiscordチャンネルとMinecraftテストサーバーによるWebhook受入試験1～3
- MySQL Repository portと状態イベント起点の直列永続化subscriber
- run ID・revisionによるsnapshot、履歴、作業checkpoint、通知outboxの冪等保存
- version管理されたMySQL migrationとtransaction rollback
- 隔離されたtmpfs MySQL 8.4によるmigration・Repository統合試験
- `pending`・`delivering`・`delivered`・`failed`を持つ通知outbox migration 004
- Repository portとMySQL transactionによるrevision順の排他claim、配送成功・失敗の永続化
- 30秒leaseのcrash回収、最大5試行、1秒起点・60秒上限のbackoff、上限後の終端化
- MySQL有効時のoutbox dispatcherと無効時のprocess内subscriberの排他的なruntime経路
- 並行dispatcherの重複claim抑制、再起動相当の配送再開、lease回収を含むFake・隔離MySQL検証
- 通常runtime相当の接続、spawn、telemetry、作業状態、安全停止をrevision順に保存する隔離MySQL検証
- runtime起動時にqueued・claimed・終端済みtaskを変更せず集計する復旧監査
- 完了済みtaskの再実行抑止と、claimed残留をmanual reviewとするFake・隔離MySQL検証
- 永続化の恒久障害と有限retry失敗を他player安全切断から隔離するFake runtime検証
- 型付き作業指示とpriority付きFIFO queue
- cancel、終端化、最大試行回数による有限の再キュー
- TaskQueue Repository portとMySQL transactionによる排他的claim
- task ID単位の冪等enqueueとmigration 002
- StateSnapshotだけを入力とするfail-closedな作業安全policy
- runtime、接続・spawn、他player、停止要求、体力・空腹度による開始・継続判定
- 安全判定後だけclaimする`SafetyControlledTaskQueue`
- 他player・signal停止後の再claim禁止とtask停止のプロセス内重複抑制
- 有限stepの同一dimension移動planと座標・上限検証
- Minecraft非依存の`MovementPort`とテスト専用Fake
- 各step前後の共通安全policy再評価、cancel、timeout、後続step抑止
- StateStoreと永続queueを一度だけ終端化する`MovementCoordinator`
- 1.26系movement packet候補、禁止方式、serializer要件、段階的受入試験の設計確認
- 1.26.30限定のPlayerAuthInput frame検証・schema serializeとBedrock transport adapter
- server観測・補正・単調tick・Abort・listener cleanupのnetwork非依存検証
- runtimeの既定disabled movement bindingと終了cleanup境界
- block変更を伴わないnavigate／到達確認／位置記録の型付きsimple-work domain
- 単一dirt配置の厳格なinstruction、観測port、Fake、安全coordinator
- 配置前後のserver観測契約、最大1回送信、retryなし、既定unsupported runtime binding
- 1.26.30限定のblock update・own held item・dimension変更の読み取り専用adapter
- freeze済み観測snapshot、revision、最大128件cache、同値・古いsequence抑制
- spawn前・dimension移行中・disconnect後のfail-closed無効化とlistener障害隔離
- schema version 1の単一dirt配置指示を完全復元するMySQL migration 003
- 世界変更直前の`delivery_started`とserver検証後の`verified`永続phase
- 再起動後のclaimed指示をmanual reviewとし自動再送しない復旧分類
- 1.26.30 `inventory_transaction`候補のoffline schema serialize検証
- 明示的な専用試験注入だけを許すblock-operation runtime binding
- 接続generation付きitem registry検証と`minecraft:dirt`の一意なitem network ID同定
- own `ItemNew`のmetadata・stack ID・block runtime ID・空extraのallow-list投影
- transaction用`Item`候補への送信なし限定変換と、両envelopeのoffline構文検証
- face数値・envelope選択規則が固定schemaにないことを明示するfail-closed capability評価

実サーバー試験の詳細は
[通常運転ランタイム検証](../verification/runtime-readonly.md)を参照してください。
Discord実送信の計画は
[Discord Incoming Webhook受入計画](../verification/discord-webhook-plan.md)を参照してください。
非秘密な試験結果は
[Discord Incoming Webhook受入結果](../verification/discord-webhook.md)を参照してください。
MySQLの非秘密なローカル検証結果は
[MySQL状態・履歴保存のローカル検証](../verification/mysql-persistence.md)を参照してください。

## 現在の制約

- 実移動frame providerと有効化設定はなく、通常runtimeのmovement bindingはdisabledで読み取り専用
- block変更packet adapter、full inventory、queue consumerはなく通常bindingもdisabled
- authoritative frame排他所有と専用acceptance preflightはoffline実装済み
- Geyser・Cloudburst・PrismarineJSの固定commitを比較したProtocol Evidence Matrixと、絶対座標・tick・
  runtime IDを残さない匿名Golden Fixture観測境界を実装済み。実fixture取得とproduction adapter有効化は未実施
- decoded packet capture bridge、専用entrypoint、proxy安全性調査はmainへ採用せず、検討用branch
  `spike/golden-capture-investigation`（commit `b2ee072`）へ分離して保管
- Golden Capture機能と実fixture取得は見送り。安全な一次根拠がない状態でproxyやcapture sourceを推測実装しない
- 配置用frame意味論、face対応、transaction envelope選択が未確定で、実server試験A～Eは未実施
- 汎用作業executor、外部指示入力、claim lease回収、スケジュール制御はない
- 体力・空腹度低下時の食事、退避、切断などの回復動作はない
- MySQL無効時は状態イベントを永続化しない
- MySQL無効時のDiscord通知はprocess内best effortで、再起動後の配送はない
- MySQL outbox配送はat-least-onceであり、送信成功後・配送済み更新前のcrash windowには重複し得る
- runtime用のreadinessエンドポイントはない

## 次の完了条件

1. 承認済み専用test serverと隔離MySQLを用意し、実接続承認を得る
2. `MYSQL_PERSISTENCE_ENABLED=true`でBOT 1体の読み取り専用runtimeを1回だけ起動する
3. 接続、spawn、telemetry、安全停止のrevision順履歴を秘密情報なしで確認する
4. normal modeの他player安全停止、SIGTERM、二重起動防止を維持する
5. 実接続を伴わない次工程としてローカルoperator向け読み取り専用指示入力の設計を進める

Capture関連コードはmainへ取り込まず、production block配置adapterとruntime consumerは
`unsupported`／disabledのまま維持します。face、envelope、item action、authoritative frameを推測値で
実装しません。実fixture取得、Minecraft接続、game操作は引き続き承認必須です。

## 未決定事項

- outboxのat-least-once重複をDiscord受信側で表示または抑制するか
- Webhook URLの本番secret管理方式
- 作業IDの生成責務と外部指示の形式
- JST表示をアプリケーション、通知アダプター、UIのどこで担当するか
