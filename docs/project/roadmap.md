# 開発ロードマップ

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
   - outbox dispatcherと永続配送保証（後続工程）
4. 作業指示と作業キュー（最小実装完了）
   - 型付き指示、priority付きFIFO、cancel、終端化、有限回の再キュー（完了）
   - Repository port、MySQL migration、transaction claim、冪等enqueue（完了）
   - 外部指示入力、executor、claim lease回収（後続工程）
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
   - runtime consumer、queue終端化統合、実移動による受入（後続・承認必須）
8. 最初のブロック操作（offline安全境界完了）
   - 単一dirt配置の型、port、Fake、安全coordinator、既定unsupported binding（完了）
   - inventory・block runtime ID観測、実adapter、専用server受入（後続・承認必須）
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
