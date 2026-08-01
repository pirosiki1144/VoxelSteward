# 最初のブロック操作

配置protocolの固定commit調査とproduction採用条件は、
[Protocol Evidence Matrix](verification/block-placement-protocol-evidence.md)に記録しています。参照実装上は
`UP=1`、`block_position`はsupport、`click_position`はsupport-relativeという根拠を得ましたが、匿名
Golden Fixtureと一致するまで実adapterは`unsupported`を維持します。

## 選択した操作

最初のブロック変更は、専用テスト区域で空気と確認された1座標へ`dirt`を1個だけ配置する
`place_single_dirt`に限定します。現段階はdomain、application coordinator、port、Fake、runtimeの
既定無効binding、version付き指示のMySQL永続化、専用試験からだけ注入できるruntime bindingまでです。
Bedrock packetを送る実adapter、inventory選択、queue consumer、実配置は未実装です。

採掘は既存blockの不可逆な消失、drop entity、tool適合、server-authoritative breakingの複数tick操作を
伴います。配置もinventory slot、stack ID、block runtime ID、support faceの実測が必要ですが、空気と
supportを事前観測し、配置後に同じ座標のdirtをserver観測できた場合だけ成功とする契約を先に固定できます。
未確定値を推測したpacket実装は行わず、実adapterは`unsupported`としてfail-closedします。

## 指示と検証

- 1 commandは1座標、1 dirt配置だけを表し、複数座標、range、wildcard、任意payloadを持ちません。
- targetとsupportはdimension付き整数座標で、既存world境界内に限定します。
- supportはtarget直下、faceは上面、targetの期待状態はair、配置後はdirtへ固定します。
- player位置と同じdimensionで最大3 block以内だけを許可します。
- timeoutは1～30秒、schema versionは1、queueの`maxAttempts`は1へ固定します。
- task IDは内部照合にだけ使用し、player/BOT名、server endpoint、credentialをinstructionや観測へ
  格納しません。

## 安全境界

Coordinatorはclaimed済みの同一task type、StateStoreのidle、normal runtimeのready、spawn完了、
有効telemetry、体力・空腹度、他playerなし、停止要求なしを要求します。targetとsupportの事前観測後、
世界変更を要求する直前にも最新snapshotへ共通安全policyを適用します。

世界変更要求の直前にqueueを`delivery_started`へ永続化し、事後観測後に`verified`へ進めます。
portへ配置を要求するのは最大1回で、timeout、disconnect、Abort、結果不明、観測不一致を自動再試行
しません。申告成功やinventory減少ではなく、serverから観測した同一座標のdirtだけを成功の正本に
します。process crashで`claimed`が残った場合は自動回収・再送せずmanual reviewとします。cancelと
安全停止はportを一度だけ停止し、後続送信を禁止します。StateStoreとqueueの終端化が
失敗しても2回目の配置は行いません。

## protocol前提の確認結果

1.26.30の`mob_equipment`が持つ`ItemNew`からmetadata、stack ID、block runtime ID、空のextraを
allow-list投影し、同じ接続generationの`item_registry`から`minecraft:dirt`を一意に同定できるように
しました。条件が完全に揃う場合だけ、送信を行わないoffline helperがtransaction用`Item`候補へ変換します。

固定schemaではstandalone `inventory_transaction`と`player_auth_input`内のitem-interact transactionの
両方を構文上serializeできます。しかし、support上面`up`の数値enumと、authority設定からどちらのenvelopeを
選ぶかという規則は固定dependency内にありません。authority flagを選択規則として推測せず、capabilityは
常に`unsupported`です。offline round-tripはserver受理や配置意味論を証明しません。

## 未実装

- full inventory/hotbar対応と、opaqueな`ItemV4.extra_data`の意味解析
- face数値対応、standalone transactionとPlayerAuthInput埋込みの選択、配置用frameの意味論
- 視点、face、support位置を実serverで検証するadapter
- queue consumer、runtime executor
- 実Minecraft配置、rollback、自動再試行

## authoritative frame排他境界

movementとblock placementが同じPlayerAuthInput streamへ同時送信しないよう、接続単位の排他所有境界を
追加しました。movementは送信前にtickをclaimし、実際にqueueした場合だけcommitします。block placement
候補は最新観測revision、同一dimension、3 block以内、安全policy許可、tick単調増加を満たす場合だけ同じ
境界をclaimできます。重複・逆行tick、stale観測、movement中、停止後は拒否します。

この境界は送信順序の安全性だけを提供し、配置用tick・rotation・head yaw・position、face数値、envelopeを
決定しません。そのためproduction配置adapterは引き続き`unsupported`です。

## 専用acceptance preflight

通常runtimeとsmokeから分離したprofile付きentrypointを追加しました。既定はdisabledで、enabled時もnormal、
operator確認、1回上限、1.26.30を厳格に要求します。現在はprotocol capabilityがunsupportedのため、
InstanceLock取得、Minecraft client生成、認証、接続より前に固定された安全な理由で終了します。

実adapterは[単一dirt配置の受入計画](verification/block-placement-acceptance-plan.md)を段階ごとに
レビューし、実接続とgame操作の承認を得るまで有効化しません。
