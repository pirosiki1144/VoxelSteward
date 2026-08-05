# 開発ロードマップ

この文書は、VoxelStewardの長期的な工程順序と段階間の依存関係を示します。個別taskのscope、
受入条件、進捗はGitHub Issuesを正本とします。完了した技術的判断は`docs/decisions.md`、
非秘密な受入結果は`docs/verification/`へ記録します。

## 完成済みの基盤

- 読み取り専用normal runtimeとdebug smoke
- 状態・進捗管理
- Discord Incoming Webhook通知
- MySQL状態履歴、checkpoint、通知outbox
- ローカルoperator指示、task queue、読み取り専用executor
- 共通安全policyと他player検知時の安全停止
- movement・block操作のoffline domain／adapter境界

詳細は[プロジェクト状況](status.md)を参照してください。

## Phase 1: 検証環境での定時運用

現在の最優先工程です。GitHub Issues #4～#9で管理します。

```text
検証環境runtime構成
→ MySQL運用ログと安全な照会
→ Fake Clockによる平日scheduler（domain実装済み）
→ schedulerと接続・切断runtimeの統合（offline実装済み）
→ Fake Minecraft・隔離MySQL統合試験
→ 承認済み専用test serverでの受入
```

運用時間は平日09:00～17:00（JST）とし、午前runを11:59に安全切断、12:00に午後runを
新規開始、17:00に安全切断します。旧runの切断完了前に次runを開始しません。他player検知または
operator停止後は、時刻到達だけを理由に自動再開しません。

## Phase 2: 移動機能の段階的有効化

Phase 1の検証環境運用が安定した後に着手します。

1. 実frame providerの完成
2. server観測に基づく障害物検知
3. packet送信直前・直後の共通安全policy再評価
4. Fake transportによる補正、timeout、disconnect、他player停止の検証
5. 承認済み専用test serverで単一stepから段階的に受入
6. `navigate` taskのoperator queue統合

通常runtimeのmovement bindingは、offline検証と実接続承認が完了するまでdisabledを維持します。

## Phase 3: 簡単なMinecraft内作業

移動機能の受入後、世界変更の小さい作業から段階的に追加します。

1. 到達確認と位置記録
2. 安全な探索・再確認
3. 単一block操作のprotocol判断gate
4. 根拠と受入試験が揃った操作だけをexecutorへ接続

block配置はface、transaction envelope、item action、authoritative frameの一次根拠が確定するまで
`unsupported`を維持します。Captureを再検討する場合は、保管branchを起点に独立したIssueと
安全reviewを作成します。

## Phase 4: 個別作業

- 道路の新規作成と修繕
- 探索、発見地点の再確認と安全化
- 整地
- 植林と伐採
- 耕作と収穫

道路の基本仕様は次のとおりです。

- Y=71固定
- 道幅6 block
- 両端2 blockを路肩とする
- 松明を3 block間隔で配置する
- 空中施工時は土2段の土台とする
- 木や山があっても原則として計画線を維持する

各作業は有限segment、checkpoint、共通安全policy、停止後の非再実行を持つ独立Issueとして
設計・実装・検証します。

## Phase 5: 運用拡張

- 日本の祝日判定
- 定時報告の拡張
- 外部network指示方式の検討
- runtime readiness・監視
- 分散worker間の停止冪等性
- outboxのat-least-once重複対策

新しい外部service、production環境、共有DB、実Minecraft server、game内操作を伴う段階は、
`docs/project/governance.md`の承認境界に従います。
