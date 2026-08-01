# 開発ロードマップ

## 最小運用loop（完了）

Captureとblock配置protocolの追加調査は現在の優先経路から外し、検討結果を
`spike/golden-capture-investigation`（commit `b2ee072`）に保管しました。次の最小運用loopは
専用テストサーバーでの受入まで完了しています。

```text
MySQLへ稼働記録を保存
→ 承認済み専用Minecraft serverへ読み取り専用で接続
→ operatorが型付き作業指示を投入
→ 共通安全制御下のexecutorが指示を実行
→ 結果・checkpoint・停止理由をMySQLへ保存
```

### 1. MySQL稼働記録（最優先）

通常runtime統合、revision順の隔離MySQL検証、障害隔離、起動時復旧監査まで完了しました。

- 既存のruntime run、状態snapshot、履歴、checkpoint、通知outboxを通常runtimeから確実に保存する
- 接続、spawn、telemetry、作業指示、claim、開始、完了、失敗、安全停止をrevision順に追跡できるようにする
- DBアクセスをRepository境界に限定し、schema変更をmigrationで管理する
- player名、BOT account情報、server endpoint、認証情報、raw packetを保存しない
- DB障害がMinecraftの安全停止や切断を妨げないことをFakeと隔離MySQLで検証する
- runtime再起動後も、完了済み作業を再実行せず、未完了作業をmanual reviewへ送れることを完了条件とする

### 2. MySQL有効状態での読み取り専用Minecraft接続

専用test serverと隔離MySQLによる1回限りの受入試験を完了しました。

- `MYSQL_PERSISTENCE_ENABLED=true`の構成をローカルの隔離MySQLで検証する
- その後、別途承認を得た専用test serverへBOT 1体で接続する
- login、spawn、位置、体力、空腹度、dimension、他player検知、切断理由を、取得できた範囲で状態へ反映する
- normal modeの他player安全停止、SIGINT、SIGTERM、timeout、二重起動防止を維持する
- Minecraft接続情報や認証情報をDB、log、文書へ保存しない
- 接続から安全切断までの状態・履歴・checkpointがMySQLで確認できることを完了条件とする

### 3. 最小の外部指示入力

ローカルoperator entrypoint、厳格なschema version 1、冪等enqueue、cancel、状態照会を実装し、
専用テストサーバーで読み取り専用taskの投入から完了まで確認済みです。

- 最初の入力経路はローカルoperator向けの明示的な管理entrypointとし、Minecraft chatやDiscord双方向操作を使わない
- 指示を型・schema version・task IDで検証し、MySQL queueへ冪等にenqueueする
- 最初に許可する指示を、世界を変更しない`verify_arrival`と`record_position`に限定する
- 自由文、未知のtask type、秘密情報、player名、server endpointを拒否する
- cancelと状態照会を用意し、入力しただけではMinecraft操作を開始しない

### 4. 読み取り専用task executor

対象type限定claim、共通安全policy、server観測位置、queue・StateStore・checkpoint終端化、有限lease回収まで
Fakeと隔離MySQLで実装し、専用test serverでの読み取り専用受入も完了しました。

専用test serverでは`verify_arrival`と`record_position`を各1件実行し、task終端状態、checkpoint、
revision順履歴、SIGTERM安全停止を確認済みです。

- executorは共通安全policyが許可した場合だけqueueをclaimする
- `verify_arrival`と`record_position`だけを実行し、移動、block操作、攻撃、chat、commandを送信しない
- claim、実行、完了、失敗、停止、checkpointをMySQLへ保存する
- 他player、operator停止、接続喪失、体力・空腹度の危険、SIGINT、SIGTERMでは作業を停止して安全に切断する
- claim leaseを有限時間で回収し、crash後に同じ作業を無条件で再実行しない
- Fake接続、隔離MySQL、承認済み専用test serverで1指示ずつ受入確認する（完了）

### 5. 読み取り専用loop完成後

- 実frame providerと障害物検知を完成させ、承認済み専用test serverで移動を段階検証する
- 移動の安全性確認後に、簡単なMinecraft内作業をexecutorへ接続する
- block配置はface、envelope、item action、authoritative frameの一次根拠が確定するまで`unsupported`を維持する
- Captureを再検討する場合だけ保管branchを起点に独立した安全レビューを行う

## 実装順序

1. 状態・進捗管理（最小実装完了）
2. Discord通知
   - 通知message、port、mapper、Fake、No-op、プロセス内重複防止（完了）
   - Incoming Webhookアダプター、設定検証、レート制限、上限付き再試行
     （ローカル実装・Fake検証完了）
   - 実Webhook資格情報設定と専用チャンネル送信試験
     （受入試験1～3完了）
3. MySQLへの状態・履歴保存（最小実装完了）
   - Repository port、状態snapshot・履歴・checkpoint・通知outbox（完了）
   - version管理migration、transaction、revision冪等性、隔離MySQL検証（完了）
   - outbox dispatcher、排他claim、有限lease回収、配送結果更新（完了）
   - 複数dispatcher・再起動相当の隔離MySQL検証と有限再試行（完了）
4. 作業指示と作業キュー（最小実装完了）
   - 型付き指示、priority付きFIFO、cancel、終端化、有限回の再キュー（完了）
   - Repository port、MySQL migration、transaction claim、冪等enqueue（完了）
   - ローカルoperator向け外部指示入力、読み取り専用executor、claim lease回収（専用テストサーバー受入完了）
5. 共通の安全制御（最小実装完了）
   - StateSnapshot起点の開始・継続判定と未知telemetryのfail-closed（完了）
   - queue claim境界、他player・operator停止後の再開禁止、重複停止抑制（完了）
   - 将来の危険入力、回復行動、分散worker停止連携（後続工程）
6. 移動機能（実接続前のadapter準備完了）
   - 有限step plan、座標・dimension・上限検証、MovementPort、Fake（完了）
   - step前後の共通安全再評価、cancel、timeout、状態・queue終端化（完了）
   - version限定frame factory、Bedrock transport adapter、runtime disabled binding（完了）
   - 実frame provider、障害物検知、専用サーバー受入試験（後続・承認必須）
   - 1.26系packet候補、禁止方式、serializer要件、段階的受入案（設計確認完了）
7. 簡単なMinecraft内作業（domain/application最小境界完了）
   - navigate、到達確認、位置記録の型・検証・Fake境界（完了）
   - `verify_arrival`・`record_position`の読み取り専用runtime consumerとqueue終端化統合（専用テストサーバー受入完了）
   - 実移動による受入（読み取り専用loop完成後・承認必須）
8. 最初のブロック操作（型付き永続化と実接続前gateまで完了）
   - 単一dirt配置の型、port、Fake、安全coordinator、既定unsupported binding（完了）
   - item registryによるdirt同定とtransaction用held item限定変換（完了、offline）
   - block face数値とtransaction envelope選択の一次根拠確定（固定schemaでは未解決）
   - selected held item・block runtime ID・dimensionの有界読み取り観測基盤（offline完了）
   - version付き指示のMySQL永続化、送信直前phase、再起動後の自動再送禁止（完了）
   - 1.26.30 transaction schemaのoffline serialize確認（完了、意味論未確定のためadapterはunsupported）
   - authoritative frame排他所有とacceptance preflight（完了、offline）
   - 固定参照実装のProtocol Evidence Matrixと匿名Golden Fixture観測境界（完了、実fixture取得は未実施）
   - Capture bridgeと専用entrypointの検討結果は別branchへ保管し、mainでの実装は見送り
   - face・envelope・配置frame意味論の一次根拠確定後、専用server受入A～E（後続・承認必須）
   - 単一block採掘、自動rollback、複数block操作（未実装）
9. 道路作成、探索、整地などの個別作業
10. 運用スケジュール制御

各段階は、外部接続を伴わない自動テスト、専用テストサーバーでの承認済み検証、
非秘密な検証記録の順に昇格させます。

## 将来の運用条件

- 平日09:00～17:00（JST）
- 作業時間単位は09:00～12:00と12:00～17:00
- 他プレイヤー検知時は即時停止し、自動再接続しない
- 戦闘を回避する
- 体力、空腹度、位置、作業状態、進捗、異常を記録する
- Discordへ定時報告と異常通知を行う
- MySQLへ状態と作業履歴を保存する

スケジュール制御は状態管理や安全停止より後に実装します。

## 将来の作業

- 道路の新規作成と修繕
- 探索、発見地点の再確認と安全化
- 整地
- 植林と伐採
- 耕作と収穫

道路の基本仕様はY=71、道幅6ブロック、両端2ブロックを路肩、松明3ブロック間隔、
空中施工時は土2段の土台とします。木や山があっても原則として計画線を維持します。
これらは現在の実装スコープ外であり、移動と共通安全制御の検証完了前に実装しません。
