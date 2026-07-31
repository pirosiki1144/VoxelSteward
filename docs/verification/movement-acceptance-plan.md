# Bedrock実移動受入計画

## 目的と承認ゲート

この文書は専用テストサーバーで移動adapterを段階的に昇格するためのレビュー済み計画です。
試験はまだ実施していません。実Minecraft接続と各game内操作は各段階の開始前に個別承認を得ます。
前段階が合格し、非秘密な結果を記録するまで次段階へ進みません。

全段階で、平坦かつ封鎖され、崖、溶岩、水、portal、敵対MOB、壊れ得る設備のない専用区域を使います。
player名、BOT名、server endpoint、認証情報、packet本文は記録しません。packet event名、回数、tick差、
経過時間、匿名化した相対変位、終了理由だけを記録します。想定外packet、無制限送信、複数接続、
安全条件喪失、world変更を検知した場合は即時切断し、同じ承認で再試験しません。

## 共通開始条件

- buildと全自動testが合格している
- normal mode、InstanceLock、他player検知、安全policyが有効である
- health・hunger・position・dimensionが有効なserver観測値である
- 1.26.30 capabilityとserver-authoritative movement modeを確認できる
- packet上限を試験コードで固定し、timeout後に追加送信しない
- rollback不能な転落、衝突、knockback、位置ずれの可能性を受け入れられる専用区域である

## 段階A: neutral frame

- 上限: 1接続、neutral frame 1件、5秒
- 操作: move vector・delta・input flagsが空のframeを1 tickだけ送る
- 合格: server観測位置とrotationが許容誤差内で不変、補正・kick・world変更なし
- 中止: 位置変化、補正、未知packet、timeout、他player検知

## 段階B: 水平0.1 block

- 上限: movement frame 1件、neutral追加送信なし、5秒
- 操作: 検証済みframe providerから水平0.1 block以内の入力を1回だけ送る
- 合格: own server observationが同一dimensionで有限、変位が0.1 block以内、目標との整合を確認
- 中止: 垂直変位、許容超過、補正、対象外flag・packet、server観測欠損

## 段階C: 1 block以内の複数tick

- 上限: 最大10 movement frame、各tick最大1件、総10秒、catch-upなし
- 操作: 前回のserver観測を起点に次frameを生成する
- 合格: tickが単調増加し、全観測が同一dimension、最終位置が許容差内
- 中止: 観測前の次frame、tick重複・後退、補正、timeout、軌道逸脱

## 段階D: server補正

- 上限: 最大3 frame、補正受信直後に送信停止
- 合格: `correct_player_move_prediction`を成功扱いせず、後続frame 0件で有限失敗する
- 中止: 補正後の送信、補正前申告位置で到達扱い、listener残留

## 段階E: cancelとSIGTERM

- 上限: 各ケース最大3 frame、signal後は0件
- 合格: cancelまたはSIGTERM後に新規packetを送らず、listenerを解除し安全切断・正常終了する
- 中止: neutralを含む追加送信、再接続、多重disconnect、終了timeout

## 段階F: 他playerとtelemetry危険

- 他player試験だけ別playerの参加を明示承認し、それ以外はBOT単独で行う
- 上限: 検知前最大3 frame、検知・危険判定後0件
- 合格: 他player、healthまたはhunger閾値、invalid telemetryのいずれでも即時停止し再開しない
- 中止: 後続frame、再claim、再接続、対象外game操作

## 段階G: timeoutと切断

- 上限: 1 frame、step timeout 5秒、retry 0回
- 合格: server観測欠損または接続切断を有限失敗とし、listener・timerを解放する
- 中止: retry、catch-up、多重接続、未処理Promise rejection

## 完了判定

全段階の合格後にだけ、frame providerの固定規則とruntime有効化設計を別レビューします。合格しても
採掘、設置、攻撃、item、inventory、chat、command、jump、sprint、sneak、視点変更は許可されません。
通常runtimeの既定を読み取り専用から変更する判断も別承認です。
