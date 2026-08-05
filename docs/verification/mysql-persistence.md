# MySQL状態・履歴保存のローカル検証

## 結果

- 実施日: 2026-07-31、2026-08-01（JST）
- 対象: tmpfsだけを使用する隔離MySQL 8.4 Compose service
- 結果: migrationとRepository統合試験15 test caseに合格
- 外部・共有DB接続: なし
- 実Minecraft接続、Discord実送信: なし

## 確認内容

DB統合15 test caseとFake runtime・executor・operator照会testで次を確認しました。

1. 空DBへのup migrationと同一migrationの冪等再適用
2. history、最新snapshot、作業checkpoint、通知outboxのtransaction保存
3. 同じrun ID・revision・notification IDの重複抑制
4. 古いrevisionによるsnapshotとcheckpointの後退防止
5. transaction途中失敗時のrollback
6. down migrationによるtest schemaの除去
7. 作業queueのpriority付きFIFO、task ID単位の冪等enqueue
8. transactionによる並行claim時の二重取得防止
9. 最大試行回数到達時のfailed終端化
10. version 1の単一dirt配置指示の完全復元
11. claimed指示の再起動後再claim禁止と未知instruction versionのfail-closed拒否
12. `verify_arrival`・`record_position`の冪等保存、対象type限定claim、migration 005の有限lease回収
13. 読み取り専用executorの完了結果、server観測位置、snapshot、checkpointの一貫保存
14. 通知outboxの並行worker排他claim、lease回収、有限試行と終端化
15. 通常runtime相当の接続、spawn、telemetry、作業状態、安全停止のrevision順保存
16. 最新snapshot、checkpoint、通知outboxが同じrunの履歴と整合すること
17. runtime永続化障害が他プレイヤー安全停止を妨げず、executorのDB障害もruntimeへ再投入しないFake統合試験
18. run一覧、最新状態、revision昇順履歴、task checkpointの安全なoperator照会
19. raw snapshot、自由文error、接続情報を返さないallow-list投影

テストdataには実在するplayer名、BOT情報、server endpoint、認証情報を使用していません。

## Docker cleanupに関する記録

テストserviceのcleanup時、同じCompose projectに停止状態で残っていたruntime containerを
対象限定せず削除しました。認証volumeは削除せず、名前や内容を表示しないread-only確認で
維持を確認しています。runtimeを再作成・再起動しておらず、新しいMinecraft接続はありません。

以後の局所DB検証では`docker compose down`と`--remove-orphans`を使わず、`mysql-test`だけを
明示して`stop`と`rm`を実行します。runtimeの復旧は実Minecraft接続の承認が必要なため、
この工程では実施していません。
