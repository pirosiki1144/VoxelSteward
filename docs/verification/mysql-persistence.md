# MySQL状態・履歴保存のローカル検証

## 結果

- 実施日: 2026-07-31（JST）
- 対象: tmpfsだけを使用する隔離MySQL 8.4 Compose service
- 結果: migrationとRepository統合試験5 test caseに合格
- 外部・共有DB接続: なし
- 実Minecraft接続、Discord実送信: なし

## 確認内容

DB統合5 test caseで次の1～6を確認し、Fake runtime統合で7を確認しました。

1. 空DBへのup migrationと同一migrationの冪等再適用
2. history、最新snapshot、作業checkpoint、通知outboxのtransaction保存
3. 同じrun ID・revision・notification IDの重複抑制
4. 古いrevisionによるsnapshotとcheckpointの後退防止
5. transaction途中失敗時のrollback
6. down migrationによるtest schemaの除去
7. runtime永続化障害が他プレイヤー安全停止を妨げないFake統合試験

テストdataには実在するplayer名、BOT情報、server endpoint、認証情報を使用していません。

## Docker cleanupに関する記録

テストserviceのcleanup時、同じCompose projectに停止状態で残っていたruntime containerを
対象限定せず削除しました。認証volumeは削除せず、名前や内容を表示しないread-only確認で
維持を確認しています。runtimeを再作成・再起動しておらず、新しいMinecraft接続はありません。

以後の局所DB検証では`docker compose down`と`--remove-orphans`を使わず、`mysql-test`だけを
明示して`stop`と`rm`を実行します。runtimeの復旧は実Minecraft接続の承認が必要なため、
この工程では実施していません。
