# Bedrock world・inventory観測基盤

## 実装範囲

固定依存`bedrock-protocol` 3.57.0のBedrock 1.26.30受信schemaを根拠に、`start_game`、`spawn`、
`update_block`、own entityの`mob_equipment`、`change_dimension`、`close`だけを安全なsnapshotへ
変換します。held itemからnetwork ID、count、block runtime ID、存在する場合だけstack IDを
取り込みます。NBT、display name、lore、自由入力field、生packet、player名は保持しません。

`inventory_content`は`ItemV4`ですが、配列slotとhotbarの安全な対応を固定schemaだけでは確定できないため、
full inventoryは`unsupported`です。stack IDがpacketにない場合も推測せず`unsupported`とします。

## snapshotと利用条件

`WorldObservationStore`はrevision、UTC時刻、availability、dimension、selected slot、held item、
最大128件のblock観測をfreeze済みsnapshotとして公開します。同一値はeventを生成せず、古いsequenceを
破棄します。block cacheは同一座標更新時に置換し、上限到達時は最古を削除します。

block観測を利用できるのはspawn後の`ready`かつ同じdimensionだけです。spawn前、dimension移行中、
disconnect後は取得できません。dimension変更とdisconnectではcacheとinventoryを即時に破棄します。
固定依存の`spawn` eventは初回接続時だけのため、dimension変更後は推測でreadyへ戻さず、再接続まで
利用不能にします。
subscriberはmicrotaskで非同期通知し、同期例外とPromise rejectionを隔離します。

Bedrock 1.26.30のair runtime IDは固定protocol dataの`blocks.json`にある13094を使用します。
別versionを受け付けず、primary layer以外や不正fieldを観測済み状態へ昇格しません。

## 未実装

- full inventory、hotbar全slot、container、offhand、armorの追跡
- block chunk全体の初期scanと任意block名への変換
- block配置・採掘・inventory操作packetの送信
- block operation coordinatorへの自動接続とruntime consumer
- 実Minecraftサーバーでの観測検証

通常runtimeにはcleanup可能なbinding境界だけを追加し、既定disabledのため既存の読み取り専用動作を
変更しません。
