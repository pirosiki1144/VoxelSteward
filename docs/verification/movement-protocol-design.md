# Bedrock移動プロトコル設計確認

## 結論

現在の1.26系Bedrock接続で、実player移動の第一候補は`player_auth_input`です。ただし、位置だけを
補間して送るadapterは実装しません。tick、入力vector、rotation、input flag、server補正、停止時の
neutral inputを一貫して扱う根拠が不足しており、現時点ではfail-closedとして実adapterを保留します。

通常runtimeは引き続き読み取り専用です。この確認ではMinecraftへ接続せず、packetを送信していません。

## 確認した根拠

固定依存`bedrock-protocol` 3.57.0と同梱`minecraft-data`の1.26系schemaを確認しました。

- `Client.queue(name, params)`は次のbatchへpacketを追加し、`write`は即時送信します。
- `move_player`はplayer位置、rotation、mode、on-ground、ridden entity、tickを持ちます。
- `player_auth_input`はserver-authoritative movement用のserver-bound packetで、通常は毎tick送ります。
- `player_auth_input`にはpositionだけでなく、move vector、pitch、yaw、head yaw、input flags、input mode、
  play mode、interaction model、interaction rotation、tick、delta、analogue/raw vectors、camera orientationが
  必要です。
- `correct_player_move_prediction`はserverがtick単位で位置・delta・rotationを補正するpacketです。
- 1.21.80以降のschemaではserver movementが最低要件と記載され、1.26系で単純なclient-authoritative
  `move_player`だけへ固定する根拠はありません。
- `bedrock-protocol`の公開TypeScript APIはpacket payloadを`object`としており、field欠落をcompile時に
  検出できません。version別schemaを使うserializer testが必要です。

## 採用しない方式

### `move_player`の座標だけを送る

server authority modeを無視し、tick・physics・補正と整合しないため採用しません。

### `player_auth_input.position`へstep目標を直接設定する

入力vectorやdeltaと矛盾し、serverによるreject・巻戻し・kickを起こし得ます。障害物、落下、速度を
無視した位置申告にもなるため採用しません。

### 実通信を自動testにする

認証、server状態、player状態へ依存し、安全停止の再現性を損なうため採用しません。

## 実adapterの必須設計

1. `start_game`からruntime ID、初期位置、dimension、current tickを安全に取得する。
2. 接続versionとschema capabilityを起動時に確認し、未知versionは移動不可とする。
3. 1.26系は`player_auth_input`を使い、tickを単調増加させる。
4. 送信周期はBedrock tickに同期し、processの遅延時にpacketを無制限に追送しない。
5. move vector、delta、input flags、rotation、camera orientationを同一frameから生成する。
6. jump、sprint、sneak、item interaction、block actionなど対象外flagを常に無効にする。
7. serverから観測したown `move_player`と`correct_player_move_prediction`を位置の正本とする。
8. 補正、dimension変化、想定外position、tick後退、応答timeoutでstepを失敗させ、後続送信を止める。
9. cancel時は新しい移動inputを止め、必要なneutral inputを有限回だけ送る。安全停止ではneutral送信の
   完了を待たず、既存のMinecraft切断を優先する。
10. 送信packet生成とnetwork送信を分離し、version別serializerとFake clockで検証する。

## 実装前に追加する自動test

- 1.26系schemaでmovement/neutral payloadをserializeできる
- 必須field欠落、非有限値、tick後退を通信前に拒否する
- tickごとに最大1 packetで、遅延時に無制限catch-upしない
- 対象外input flagとconditional transactionを含めない
- cancel後にmovement inputを生成しない
- server補正を次frameへ反映し、補正前位置を成功扱いにしない
- own entity以外の移動packetを無視する
- timeout、correction、disconnect、安全停止でlistenerとtimerを解放する
- serializer failureにpacket内容や接続情報を含めない

## 専用サーバーでの段階的受入案

実接続と実移動は別途ユーザー承認後に実施します。

1. neutral inputだけを有限tick送信し、位置・rotation・game状態が変化しないことを確認する。
2. 平坦で封鎖された安全区域において水平0.1 block相当の入力を1回だけ試す。
3. server観測位置と補正packetを記録し、送信申告位置ではなく観測位置で到達判定する。
4. 1 block以内の複数tick移動を確認する。
5. 移動中のcancel、SIGTERM、他player検知で後続packetが止まり、安全切断することを確認する。
6. server補正、応答timeout、接続切断時にretryせず有限失敗することを確認する。

試験区域には崖、溶岩、水、portal、敵対MOB、壊れ得る設備を置かず、別playerは安全停止試験以外では
参加させません。試験結果へplayer名、BOT名、server endpoint、認証情報を記録しません。

## 未決定事項

- 1.26系で要求される正確な初期tickとframe生成規則
- server設定ごとのauthority mode判別方法
- neutral inputの必要tick数
- rotationを固定したままworld-relative入力を安全に表現できるか
- collision、gravity、knockbackを含む次位置予測の責務

これらはversion別serializer testと専用サーバーでの最小packet観測を経て決定します。
