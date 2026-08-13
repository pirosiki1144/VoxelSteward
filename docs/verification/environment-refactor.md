# 環境分離リファクタリングの受入状況

対象Issue: [#44](https://github.com/pirosiki1144/VoxelSteward/issues/44)、
[#45](https://github.com/pirosiki1144/VoxelSteward/pull/45)、
[#46](https://github.com/pirosiki1144/VoxelSteward/issues/46)

## 現在の判定

2026-08-13時点では、#44〜#46を完了扱いにしません。環境設定の名称と既存volumeの
参照方法に不整合が残っており、実Minecraft接続の受入条件も未達です。

正式なプロジェクト名称は`VoxelSteward`に固定します。`voxel-steward`や
`voxel_steward`などの別表記を新たに使用しません。

## Issue #44

- 環境分離の方針と、既存volumeを削除・初期化・renameせず再利用する条件をIssueへ追記済みです。
- 開発・staging・本番の命名整合は未完了です。
- `compose.evaluation.yaml`と`compose.verification.yaml`は作業ツリー上で削除扱いです。
- `compose.stg.yaml`はstaging overlayとして追加済みですが、Issue #44の全受入条件を満たしたとは判定していません。

## Pull Request #45

- 環境分離リファクタリングのPRは未完了です。
- PRに記録された静的検証結果とは別に、現在のvolume名・Compose overlay・envファイル名の実在状態を再確認する必要があります。
- 直接mainへ反映せず、レビューと受入条件の確認後に扱います。

## Issue #46（開発環境）

実施済み:

- `compose.yaml + compose.dev.yaml`の非接続Compose構成検証
- 既存開発MySQLコンテナのhealthcheck確認（healthy）
- 既存volumeを削除・初期化・renameしない確認

未実施・未達:

- 専用開発test serverへの実Minecraft接続
- runtime起動時に`PERSISTENCE_FATAL`で終了し、Minecraft接続前に停止した
- 開発Composeが現在の設定値から既存volume名と異なる認証volumeを作成したため、既存認証volumeの再利用条件を満たしていない

## 再開条件

1. `VoxelSteward`表記、envファイル名、Compose project名、service名、image名の対応表を確定する。
2. 既存認証volumeと既存MySQL data volumeの名前・mount・用途を読み取り確認する。
3. 既存volumeを削除・初期化・renameせず参照できるCompose設定へ修正する。
4. 開発MySQLのhealthcheckとruntimeの永続化接続を再検証する。
5. その後、専用開発test serverへの実Minecraft接続を明示承認のもとで1回実施する。

認証情報、Webhook URL、server endpoint、player名、volume内容はこの記録へ保存しません。
