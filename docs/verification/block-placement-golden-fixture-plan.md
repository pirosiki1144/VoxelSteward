# ブロック配置 Golden Fixture取得計画

## 目的

専用テスト環境で正常なBedrock 1.26.30クライアントがdirtを1個配置した際のdecoded interactionを、秘密情報・
個人情報・絶対座標を含まない最小fixtureへ変換します。この計画は観測のみを目的とし、VoxelStewardからpacketを
送信しません。

## 事前条件

- 専用テストサーバーと隔離区域を使用する
- 実行前に他プレイヤーがいないことを確認する
- 人間の通常クライアントがdirtを1個だけ配置する
- targetはair、supportはsolid、配置後に人間がrollbackできる
- Bedrock versionとprotocolが1.26.30／1001である
- Webhook URL、認証情報、server endpoint、player名、BOT名を観測出力へ渡さない
- 生packet、暗号化前後のbyte列、NBT、item表示情報を保存しない

## 観測境界

`BedrockBlockPlacementGoldenObserver`はdecoderでallow-list済みの候補だけを1回受け付けます。次は入力型にも
出力にも存在しません。

- player／BOT識別情報、server address／port、認証情報
- 生packet／接続object、NBT、display name、lore
- item network ID、stack ID、block runtime IDの実値
- absolute world coordinate、absolute tick

保存する情報:

- envelope種別、authority mode、face数値
- supportを`(0,0,0)`としたplayer offset
- block-local click position、pitch、yaw、head yaw、hotbar slot
- dirt registry、stack、support runtime IDの一致boolean
- count、metadata、action数、action source／slot／old itemの整合boolean
- new item count delta

tickは最初の観測を`0`へ正規化します。観測は最大1件で、2件目、close後、不正field、余分なfieldを拒否します。

`BedrockBlockPlacementCaptureBridge`はdecoded sourceの汎用`packet`イベントを受けますが、各callback内で
packet名を確認し、必要fieldだけを即時投影します。raw objectを保存・返却・ログ出力するAPIはありません。
standalone interactionは直前のPlayerAuthInput frame、埋込みinteractionは同じframeを使います。
`start_game`のauthority設定、dirt item registry、primary-layer support block観測が揃わない候補は採用しません。

既定timeoutは60秒、最大decoded packet数は10,000です。取得成功、timeout、packet上限、明示closeのすべてで
listenerと一時観測を解放します。出力前に禁止keyとURL形式を再検査し、Git worktree外のOS一時領域へ
owner-only（0600）で保存します。

専用`golden-fixture-capture` entrypointは通常runtime、smoke、placement acceptanceと別processです。Composeの
`capture` profile、`restart: "no"`、network無効、認証volumeなしで構成し、標準入力からdecoded streamだけを
受けます。capture用途専用InstanceLockを使用し、Minecraft client生成、認証、packet送信、再接続を持ちません。

通常clientは別clientのserver-bound packetを受信しないため、安全なproxy／test server relayは後続工程です。
relayは各decoded packetをnewline-delimited JSONとして一度だけ転送し、raw byte、接続情報、識別情報を保存・
ログ出力してはいけません。relayが完成するまではEntry Pointを実取得へ使用しません。

固定`bedrock-protocol` 3.57.0の標準Relayを安全レビューした結果、認証情報のdecode／cache、接続先debug、
parse失敗時dump、decode後の再serialize、queue、packet改変APIが確認されたため不採用としました。詳細は
[Golden Capture proxy安全性レビュー](block-placement-proxy-safety-review.md)を参照してください。
安全なserver-side projectionまたは監査済みrelayの一次根拠が得られるまで、実取得はblockedです。

## 実施段階

1. 観測ツールの単体テストと全回帰テストを通す。
2. 専用decoder接続コードを安全レビューし、raw packetをloggerへ渡す経路がないことを確認する。
3. 実サーバー接続前に、出力先がGit管理外の一時領域であることを確認する。
4. 人間の通常クライアントで、隔離区域へdirtを1個だけ配置する。
5. 観測ツールが1件だけ生成し、自動的に受付を閉じる。
6. 元の一時出力を秘密情報検査し、安全なfixtureだけを手動レビューする。
7. 安全なfixtureをテストへ追加し、Evidence Matrixの一致条件を判定する。
8. 人間が配置したdirtを手動でrollbackする。

## 合格条件

- face、support／target／click関係が固定Geyser実装と一致する
- envelopeが1種類に確定し、authority modeとframe情報が同じ観測内にある
- held itemとactionの関係が矛盾しない
- outputに禁止情報と絶対座標・絶対tick・runtime ID実値がない
- captureは1回だけで、再接続・再試行・別packet送信を行わない
- production adapterは、この結果だけで自動的に有効化されない

## 中止条件

- decoderがraw packetを出力する
- player名、接続先、認証情報、NBTの混入が疑われる
- protocol／authority構成が想定と異なる
- 他プレイヤーが参加する
- 1回の配置以外の操作が必要になる
- envelopeが複数観測される、または結果が不明になる

中止後に自動再試行しません。原因を調査し、計画と安全レビューを更新してから別の承認済み試験として扱います。
