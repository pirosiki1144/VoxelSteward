# Bedrock移動プロトコル設計確認

## 結論

現在の1.26系Bedrock接続で、実player移動の第一候補は`player_auth_input`です。位置だけを補間する
adapterは実装しません。設計確認後、1.26.30限定の厳格なframe／serializer／transport境界までを
実装しましたが、tick、入力vector、rotationを目標から生成するframe providerはfail-closedとして
保留し、通常runtimeではmovement bindingをdisabledにしています。

通常runtimeは引き続き読み取り専用です。この確認ではMinecraftへ接続せず、packetを送信していません。

## 確認した根拠

固定依存`bedrock-protocol` 3.57.0と同梱`minecraft-data`の1.26系schemaを確認しました。

- `Client.queue(name, params)`は次のbatchへpacketを追加し、`write`は即時送信します。
- 1.26.30の`move_player`はplayer位置、rotation、mode、on-ground、ridden entityを持ちますが、
  送信`player_auth_input`と相関できるtickは持ちません。
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

## adapter準備で実装した境界

1. 接続versionは1.26.30だけをallow-listし、未知versionは移動不可とします。
2. `player_auth_input`の全必須fieldを内部型で表し、固定schemaによるoffline serializeを検証します。
3. tickを単調増加させ、1 move呼出し最大1 frameとし、遅延時のcatch-upを行いません。
4. input flagを空へ固定し、jump、sprint、sneak、item、block等のconditional payloadを生成しません。
5. frameをqueueした後のown `move_player`だけをserver位置の候補とし、Coordinatorの目標照合を必須に
   します。`correct_player_move_prediction`はtickを相関して有限失敗にします。
6. dimension変化、invalid position、送信・補正tick後退、Abort、切断で後続送信を止め、listenerを
   解除します。
7. neutral frame factoryを用意しますが、stop・Abort後はneutralを含む新規送信をしません。
8. bedrock clientを小さなtransport境界へ閉じ込め、Fake transportでnetworkなしに検証します。

未実装のframe providerは`start_game`で得たauthority mode、初期tick、rotation、server観測を根拠に
move vectorとdeltaを生成する責務を持ちます。これを推測実装せず、専用サーバー受入結果から固定します。

## 追加済みの自動test

- 1.26系schemaでmovement/neutral payloadをserializeできる
- 必須field欠落、非有限値、tick後退を通信前に拒否する
- tickごとに最大1 packetで、遅延時に無制限catch-upしない
- 対象外input flagとconditional transactionを含めない
- stop・Abort後にmovement inputを生成しない
- server補正を有限失敗とし、補正前位置を成功扱いにしない
- own entity以外の移動packetを無視する
- timeout、correction、disconnect、安全停止でlistenerとtimerを解放する
- serializer failureにpacket内容や接続情報を含めない

## 専用サーバーでの段階的受入案

実接続と実移動は別途ユーザー承認後に、詳細な
[実移動受入計画](movement-acceptance-plan.md)に従って実施します。

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
