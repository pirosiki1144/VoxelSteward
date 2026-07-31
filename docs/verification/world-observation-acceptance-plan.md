# Bedrock world・inventory観測受入計画

## 目的

専用Minecraftテストサーバーで、Bedrock 1.26.30の受信packetからblockとheld itemを読み取り専用で
観測できることを確認します。この文書は計画であり、実試験結果ではありません。

## 事前条件

- 実接続と各game操作についてユーザーの明示承認を得る
- 専用テストサーバーを使用し、他playerがいないことを確認する
- Webhook URL、認証情報、接続先、player/BOT情報を記録しない
- runtimeからblock操作、移動、chat、inventory操作を開始しない

## 段階

1. spawn前のpacketが利用可能な観測へ昇格しないことを確認する。
2. spawn後、選択slotとheld itemの安全な数値fieldだけを確認する。
3. operatorが隔離区域の既知1 blockを変更し、block更新を1件観測する。
4. dimension変更時に旧cacheが破棄され、安全な復帰根拠がないため再接続まで利用できないことを確認する。
5. SIGTERMで切断し、cache・inventory無効化とlistener解放を確認する。

## 合格条件

- server受信packetだけが正本で、生packet・NBT・自由値を保存しない
- primary layerのblock更新だけを取得し、cache上限を超えない
- own entity以外のequipmentを保持しない
- spawn前、dimension移行中、disconnect後はqueryが結果を返さない
- 観測工程からMinecraft操作packetを一切送信しない
