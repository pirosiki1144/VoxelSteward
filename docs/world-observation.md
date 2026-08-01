# Bedrock world・inventory観測基盤

## 実装範囲

固定依存`bedrock-protocol` 3.57.0のBedrock 1.26.30受信schemaを根拠に、`start_game`、`spawn`、
`update_block`、own entityの`mob_equipment`、`item_registry`、`change_dimension`、`close`だけを安全な
snapshotへ変換します。held itemからnetwork ID、count、metadata、block runtime ID、存在する場合だけ
stack IDを取り込みます。transaction用extraはNBTなし、can-place-on/can-destroyが空の形だけを`empty`と
判定し、内容自体は保持しません。NBT、display name、lore、自由入力field、生packet、player名は保持しません。
各数値は固定schemaのli16、lu16、varint、zigzag32範囲を検査します。非空stack IDはschema commentに従い
正数だけを候補とし、0、負数、32-bit超過を配置候補へ昇格しません。

`inventory_content`は`ItemV4`ですが、配列slotとhotbarの安全な対応を固定schemaだけでは確定できないため、
full inventoryは`unsupported`です。stack IDがpacketにない場合も推測せず`unsupported`とします。
`mob_equipment.slot`と`selected_slot`は別fieldですが、固定schemaだけではinventory slotとの対応を
確定できないため、slotは妥当性だけを検査して公開値は`unsupported`にします。不正なown equipmentは
以前のknown itemを残さず`inconsistent`へ無効化します。

1.26.30では`item_registry`がitemstatesの正本です。全entryの識別子とruntime IDが一意で有効であることを
検査し、allow-list対象の`minecraft:dirt`とnetwork IDだけを保持します。registryのNBTやcustom item名は
保持しません。item network IDとblock palette/runtime IDは別の名前空間として扱います。

## snapshotと利用条件

`WorldObservationStore`はrevision、UTC時刻、接続generation、availability、dimension、selected slot、held item、
接続generationに紐づくdirt registry、
最大128件のblock観測をfreeze済みsnapshotとして公開します。同一値はeventを生成せず、古いsequenceを
破棄します。block cacheは同一座標更新時に置換し、上限到達時は最古を削除します。

block観測を利用できるのはspawn後の`ready`かつ同じdimensionだけです。spawn前、dimension移行中、
disconnect後は取得できません。dimension変更とdisconnectではcache、inventory、registryを即時に破棄します。
固定依存の`spawn` eventは初回接続時だけのため、dimension変更後は推測でreadyへ戻さず、再接続まで
利用不能にします。
subscriberはmicrotaskで非同期通知し、同期例外とPromise rejectionを隔離します。

Bedrock 1.26.30のair runtime IDは固定protocol dataの`blocks.json`にある13094を使用します。
別versionを受け付けず、primary layer以外や不正fieldを観測済み状態へ昇格しません。

## 未実装

- full inventory、hotbar全slot、container、offhand、armorの追跡とslot対応
- custom item registryの公開・永続化
- block chunk全体の初期scanと任意block名への変換
- block配置・採掘・inventory操作packetの送信
- block operation coordinatorへの自動接続とruntime consumer
- 実Minecraftサーバーでの観測検証

通常runtimeにはcleanup可能なbinding境界だけを追加し、既定disabledのため既存の読み取り専用動作を
変更しません。
