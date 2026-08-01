# Bedrockブロック配置 Protocol Evidence Matrix

## 目的

Bedrock 1.26.30でdirtを1個配置するprotocol値を推測せず、固定commitの参照実装と専用テスト環境で取得する
匿名Golden Fixtureの一致をproduction adapter有効化条件とします。本書は調査結果であり、packet送信を
許可するものではありません。

## 固定した一次ソース

| 実装                                 | 固定commit                                                                                                                                   | 用途                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Geyser                               | [`3aeedfa6f207691d92d4f20106bc586b2ab883d4`](https://github.com/GeyserMC/Geyser/tree/3aeedfa6f207691d92d4f20106bc586b2ab883d4)               | 受信したBedrock配置interactionの意味解釈 |
| Cloudburst Protocol                  | [`97fd7dce91a69e9a1f3f6bd7c1b8c790f2bbd8f7`](https://github.com/CloudburstMC/Protocol/tree/97fd7dce91a69e9a1f3f6bd7c1b8c790f2bbd8f7)         | protocol 1001のwire codec                |
| PrismarineJS bedrock-protocol 3.57.0 | [`1b38211b69e44ed6abee620d995e5364967c9103`](https://github.com/PrismarineJS/bedrock-protocol/tree/1b38211b69e44ed6abee620d995e5364967c9103) | VoxelStewardが使用するpacket serializer  |
| PrismarineJS minecraft-data 3.112.0  | [`ee5b8c8e6e6e6af2a117d5273fce9a7096dda39f`](https://github.com/PrismarineJS/minecraft-data/tree/ee5b8c8e6e6e6af2a117d5273fce9a7096dda39f)   | Bedrock 1.26.30 schema                   |

commitは調査時点の参照先として固定し、将来HEADの内容を暗黙に採用しません。

## Evidence Matrix

| 論点                  | Geyser                                                                                          | Cloudburst                                                            | PrismarineJS                                               | 現在の判定                            | production採用条件                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------ |
| face `UP`             | `Direction`の列挙順は`DOWN, UP, NORTH, SOUTH, WEST, EAST`で、受信faceを`values()[id]`として解釈 | v1001 codecはfaceをunsigned byteで読み書き                            | 1.26.30 schemaはfaceを`u8`として定義するが方向名は持たない | 参照実装上は`UP=1`。まだ`unsupported` | Golden Fixtureのfaceが1で、server観測targetがsupport直上であること |
| `block_position`      | 受信positionをsupportとして、face方向の隣接座標を配置targetとして算出                           | item-use codecでblock positionを伝送                                  | schemaの`block_position`をserialize可能                    | support座標である根拠あり             | Fixtureと`air → dirt`観測の相関                                    |
| `click_position`      | support座標へclick各成分を加算してworld上のclick位置を構築                                      | vector3fとして伝送                                                    | schemaでvector3f                                           | block-local座標である根拠あり         | 匿名Fixtureで各成分とsupport原点化後の関係を確認                   |
| target座標            | face方向のsupport隣接座標                                                                       | targetを別fieldで持たない                                             | targetを別fieldで持たない                                  | support + faceで導出                  | `UP=1`確認後、target offsetが`(0,1,0)`になること                   |
| standalone envelope   | `InventoryTransactionPacket`を独立translatorで処理                                              | v1001専用serializerが存在                                             | 1.26.30でoffline serialize可能                             | wire上は有効                          | 実クライアントFixtureがこのenvelopeを使用すること                  |
| PlayerAuthInput埋込み | `PERFORM_ITEM_INTERACTION`時に埋込みtransactionを処理                                           | protocol 1001が継承するv944系codecでconditional transactionを読み書き | 1.26.30でoffline serialize可能                             | wire上は有効                          | Fixtureがこのenvelopeを使用し、同じauthority構成であること         |
| envelope選択          | 両方の受信経路を実装し、クライアント側選択規則は示さない                                        | 両codecを実装するが選択規則は示さない                                 | schemaは両方を許可                                         | `unsupported`                         | Golden Fixtureで1方式を確定し、同一authority構成だけをallow-list   |
| action type           | block clickはitem-use action type 0として処理                                                   | action typeをwireへ伝送                                               | `click_block`をserialize可能                               | 一致                                  | Fixtureでaction typeを確認                                         |
| item action list      | held itemとhotbarを検査するが、clientが作るold/new actionの生成規則ではない                     | action listとItemStackをcodec化                                       | 構文serialize可能                                          | 意味論は未確定                        | source、slot、old/newの関係だけを匿名記録し一致確認                |
| held item             | 受信held itemと現在のhand itemを照合                                                            | network item descriptorを使用                                         | `ItemNew`とtransaction `Item`の形が異なる                  | 限定変換まで実装済み                  | registry dirt、slot、count、stack有無、runtime ID一致関係を確認    |
| authoritative tick    | PlayerAuthInputのtickと移動情報を処理                                                           | tick、position、rotation、interactionを保持                           | 構文確認可能                                               | 配置用同期規則は未確定                | interactionと同じframeのtick・position・rotation関係を確認         |
| retry／fallback       | 参照実装の受信処理はVoxelStewardの再送方針の根拠ではない                                        | 同左                                                                  | 同左                                                       | 送信1回、retry 0                      | 別envelopeへのfallbackを実装しない                                 |

## 参照箇所

- Geyserのface列挙と境界検査: [`Direction.java`](https://github.com/GeyserMC/Geyser/blob/3aeedfa6f207691d92d4f20106bc586b2ab883d4/core/src/main/java/org/geysermc/geyser/level/physics/Direction.java)
- Geyserのsupport、face、click位置解釈: [`BedrockInventoryTransactionTranslator.java`](https://github.com/GeyserMC/Geyser/blob/3aeedfa6f207691d92d4f20106bc586b2ab883d4/core/src/main/java/org/geysermc/geyser/translator/protocol/bedrock/BedrockInventoryTransactionTranslator.java)
- GeyserのPlayerAuthInput埋込み処理: [`BedrockPlayerAuthInputTranslator.java`](https://github.com/GeyserMC/Geyser/blob/3aeedfa6f207691d92d4f20106bc586b2ab883d4/core/src/main/java/org/geysermc/geyser/translator/protocol/bedrock/entity/player/input/BedrockPlayerAuthInputTranslator.java)
- Cloudburst protocol 1001 standalone codec: [`InventoryTransactionSerializer_v1001.java`](https://github.com/CloudburstMC/Protocol/blob/97fd7dce91a69e9a1f3f6bd7c1b8c790f2bbd8f7/bedrock-codec/src/main/java/org/cloudburstmc/protocol/bedrock/codec/v1001/serializer/InventoryTransactionSerializer_v1001.java)
- Cloudburstのprotocol 1001登録: [`Bedrock_v1001.java`](https://github.com/CloudburstMC/Protocol/blob/97fd7dce91a69e9a1f3f6bd7c1b8c790f2bbd8f7/bedrock-codec/src/main/java/org/cloudburstmc/protocol/bedrock/codec/v1001/Bedrock_v1001.java)
- protocol 1001が継承するPlayerAuthInput埋込みcodec: [`PlayerAuthInputSerializer_v944.java`](https://github.com/CloudburstMC/Protocol/blob/97fd7dce91a69e9a1f3f6bd7c1b8c790f2bbd8f7/bedrock-codec/src/main/java/org/cloudburstmc/protocol/bedrock/codec/v944/serializer/PlayerAuthInputSerializer_v944.java)

## 現在の結論

faceと座標の参照根拠は得られましたが、参照実装はMinecraftクライアントの送信生成器ではありません。
envelope、item action、authoritative frameを一意に決定するには、同じ1.26.30クライアントとauthority構成から
取得した匿名Golden Fixtureが必要です。それまではproduction capabilityを`unsupported`とします。
