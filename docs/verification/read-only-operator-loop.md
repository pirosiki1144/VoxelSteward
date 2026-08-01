# 読み取り専用operator task loopの実サーバー検証

## 検証対象

- 実施日: 2026-08-01
- 環境: 接続許可を得た専用テストサーバーとtmpfs隔離MySQL
- 接続条件: `normal` mode、BOT 1体、再接続0回

サーバー接続情報、BOTアカウント名、実プレイヤー名、認証情報、観測座標は記録しません。

## 結果

| 確認項目                            | 結果                                                    |
| ----------------------------------- | ------------------------------------------------------- |
| MySQL有効状態で接続・spawn・待機    | 合格                                                    |
| `record_position`の読み取り専用実行 | 1回で完了                                               |
| `verify_arrival`の読み取り専用実行  | 1回で完了                                               |
| taskごとのcheckpoint保存            | 2件を確認                                               |
| 状態履歴のrevision順保存            | revision 1～20の20件を重複なく確認                      |
| SIGTERMによる安全切断               | `reason=signal_sigterm`、`outcome=normal`、`exitCode=0` |
| 再接続・多重接続                    | なし                                                    |

Minecraftへの移動、視点変更、block操作、攻撃、item操作、chat、command送信は行っていません。
試験用runtimeコンテナと隔離MySQLは終了後に停止し、今回作成したruntimeコンテナだけを削除しました。
既存の認証volumeは変更、削除、初期化していません。

## 受入判断

ローカルoperatorから投入した2種類の型付き指示を、共通安全制御下の読み取り専用executorが
server観測値だけで処理し、task結果、checkpoint、状態履歴、停止理由を隔離MySQLへ保存できました。
この結果は読み取り専用loopの受入であり、Minecraft内の送信系操作や本番サーバー利用を承認するものではありません。
