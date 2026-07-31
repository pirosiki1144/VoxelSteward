# 単一dirt配置の実サーバー受入計画

## 前提

この文書は将来の専用Minecraftテストサーバー試験計画です。現工程では実接続・実配置を行いません。
各段階は個別に承認を得て、runtimeや通常作業queueへ自動接続せず、1回の操作上限を維持します。

- 他playerがいない隔離区域を用意する。
- targetは手の届く隣接空間1座標、事前状態はair、直下supportは既知のsolid blockとする。
- inventoryには試験用dirtを手動で1個以上準備し、slot・stack・runtime IDをログや文書へ記録しない。
- movement、jump、攻撃、採掘、chat、commandを同じ試験へ混在させない。
- player/BOT名、server endpoint、認証情報、実座標を検証記録へ残さない。

## 段階

1. 読み取りだけでtargetのair、support、距離、dimension、neutral状態を確認する。
2. 実packetを送らないoffline serializerで固定schemaと禁止fieldを確認する。
3. 個別承認後、専用区域でdirt配置要求を1回だけ送る。
4. server block updateで同一targetがdirtになったことを確認し、申告値だけで合格にしない。
5. 別試験で操作前のSIGTERM、他player検知、timeout、disconnectが送信0回または有限停止になることを確認する。

## 中止条件

- targetまたはsupportが期待と異なる
- inventory、hotbar、stack ID、runtime ID、face、server observationを確定できない
- 他player検知、signal、telemetry異常、体力・空腹度低下、接続異常
- packetの重複、再試行、意図しないmovement・item・block操作
- server観測結果が欠落または曖昧

timeoutやdisconnect後は配置済みか不明なため再送しません。配置済みの場合のrollbackは、試験終了後に
ユーザーが明示同意した手動回収だけとし、BOTによる自動採掘を行いません。異常時は同じ試験を自動で
再実行せず、安全切断と非秘密な結果記録を優先します。
