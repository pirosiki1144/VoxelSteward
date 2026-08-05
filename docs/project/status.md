# プロジェクト状況

この文書は、mainに実装済みの主要機能、現在の制約、検証記録への入口を示します。
現在作業のscope、受入条件、依存関係、進捗はGitHub Issuesを正本とし、この文書へ重複記載しません。

## 実装済みの基盤

### 読み取り専用runtime

- Bedrockサーバーへの読み取り専用接続、spawn、telemetry観測
- BOT識別子単位の`InstanceLock`
- 接続timeoutと上限付き再接続
- SIGINT・SIGTERMによるcheckpoint保存と安全切断
- normal modeでの他player検知時の即時停止と非再接続
- debug smokeでの参加・退出観測継続
- runtime、smoke、operator serviceのDocker imageとCompose構成
- normal・MySQL有効・非再起動を固定する検証環境向けCompose overrideと非秘密な構成検査

### 状態・通知・永続化

- immutableな状態snapshot、revision、状態変更event
- runtime、Minecraft接続、telemetry、task、停止理由の状態連携
- 外部service非依存の通知port、mapper、順序付きsubscriber
- Discord Incoming Webhook adapterと有限timeout・retry・rate-limit処理
- MySQL Repository、version管理migration、transaction rollback
- runtime run、snapshot、履歴、task checkpoint、通知outboxの冪等保存
- outboxの排他claim、有限lease回収、配送結果更新、再起動後の未配送通知再処理
- run ID・revision順の状態、履歴、checkpointをallow-list投影する読み取り専用operator照会

### operator task loop

- schema version 1の`verify_arrival`・`record_position`
- ローカルoperator entrypointによる冪等enqueue、cancel、状態照会
- priority付きFIFO queueとtransaction claim
- 共通安全policy通過後だけclaimする読み取り専用executor
- server観測位置だけを使う実行とMySQL checkpoint保存
- 完了済みtaskの非再実行と、claimed残留taskのmanual review分類
- 専用test serverと隔離MySQLによる読み取り専用loop受入

### 後続機能のoffline境界

- 有限stepのmovement plan、`MovementPort`、`MovementCoordinator`、Fake
- Bedrock 1.26.30限定のmovement frame schema検証と既定disabled binding
- block・held item・dimensionの読み取り専用観測adapter
- 単一dirt配置の型、観測port、安全coordinator、永続phase
- block配置protocolのevidence matrixとfail-closed capability評価

## 現在の制約

- 通常runtimeのmovementとblock-operation bindingはdisabledで、実移動・block変更を行わない
- 実frame providerと障害物検知は未完成
- block配置のface、transaction envelope、item action、authoritative frameの意味論は未確定
- Capture関連実装はmainへ含めず、`spike/golden-capture-investigation`に保管している
- Minecraftへ作用するexecutor、外部network指示入力、祝日判定は未実装
- 体力・空腹度低下時の食事・退避などのgame内回復操作は未実装
- MySQL outboxはat-least-onceで、配送成功後・結果更新前の停止時には重複し得る
- runtime用readiness endpointは未実装

## 現在のGitHub Issues

検証環境への適用、MySQL運用ログ、時刻制御を現在の優先工程とします。

- [#4 検証環境向け通常runtime構成](https://github.com/pirosiki1144/VoxelSteward/issues/4)
- [#5 MySQL運用ログと安全な照会](https://github.com/pirosiki1144/VoxelSteward/issues/5)
- [#6 平日運用スケジューラーdomain](https://github.com/pirosiki1144/VoxelSteward/issues/6)
- [#7 スケジュールに従うMinecraft接続・切断runtime](https://github.com/pirosiki1144/VoxelSteward/issues/7)
- [#8 Fake Clock・Fake Minecraft・隔離MySQL統合検証](https://github.com/pirosiki1144/VoxelSteward/issues/8)
- [#9 検証環境での実接続受入試験](https://github.com/pirosiki1144/VoxelSteward/issues/9)

Issueのstate、本文、comment、linked Pull Requestを現在進捗の正本とします。

## 検証記録

- [検証環境向け通常runtime構成](../verification/verification-runtime.md)
- [通常運転runtime](../verification/runtime-readonly.md)
- [読み取り専用operator task loop](../verification/read-only-operator-loop.md)
- [MySQL状態・履歴保存](../verification/mysql-persistence.md)
- [Discord Incoming Webhook](../verification/discord-webhook.md)
- [Movement protocol設計](../verification/movement-protocol-design.md)
- [Block配置protocol evidence](../verification/block-placement-protocol-evidence.md)

実player名、BOT account情報、server endpoint、認証情報は状態文書や検証記録へ保存しません。
