# 最初のブロック操作

## 選択した操作

最初のブロック変更は、専用テスト区域で空気と確認された1座標へ`dirt`を1個だけ配置する
`place_single_dirt`に限定します。現段階はdomain、application coordinator、port、Fake、runtimeの
既定無効bindingまでであり、Bedrock packetを送る実adapter、inventory選択、queue consumer、実配置は
未実装です。

採掘は既存blockの不可逆な消失、drop entity、tool適合、server-authoritative breakingの複数tick操作を
伴います。配置もinventory slot、stack ID、block runtime ID、support faceの実測が必要ですが、空気と
supportを事前観測し、配置後に同じ座標のdirtをserver観測できた場合だけ成功とする契約を先に固定できます。
未確定値を推測したpacket実装は行わず、実adapterは`unsupported`としてfail-closedします。

## 指示と検証

- 1 commandは1座標、1 dirt配置だけを表し、複数座標、range、wildcard、任意payloadを持ちません。
- targetとsupportはdimension付き整数座標で、既存world境界内に限定します。
- supportはtarget直下、faceは上面、targetの期待状態はair、配置後はdirtへ固定します。
- player位置と同じdimensionで最大3 block以内だけを許可します。
- timeoutは1～30秒、queueの`maxAttempts`は実運用接続時に1へ固定します。
- task IDは内部照合にだけ使用し、player/BOT名、server endpoint、credentialをinstructionや観測へ
  格納しません。

## 安全境界

Coordinatorはclaimed済みの同一task type、StateStoreのidle、normal runtimeのready、spawn完了、
有効telemetry、体力・空腹度、他playerなし、停止要求なしを要求します。targetとsupportの事前観測後、
世界変更を要求する直前にも最新snapshotへ共通安全policyを適用します。

portへ配置を要求するのは最大1回で、timeout、disconnect、Abort、結果不明、観測不一致を自動再試行
しません。申告成功やinventory減少ではなく、serverから観測した同一座標のdirtだけを成功の正本に
します。cancelと安全停止はportを一度だけ停止し、後続送信を禁止します。StateStoreとqueueの終端化が
失敗しても2回目の配置は行いません。

## 未実装

- inventory/hotbar/stack IDとblock palette/runtime IDの安全な取得
- 1.26.30の`TransactionUseItem` payloadとserver block updateの相関
- 視点、face、support位置を実serverで検証するadapter
- typed instructionの永続化、queue consumer、runtime executor
- 実Minecraft配置、rollback、自動再試行

実adapterは[単一dirt配置の受入計画](verification/block-placement-acceptance-plan.md)を段階ごとに
レビューし、実接続とgame操作の承認を得るまで有効化しません。
