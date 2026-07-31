# 移動基盤

## 現在の実装範囲

移動工程の最小実装は、Minecraftへ依存しない有限プランナー、`MovementPort`、共通安全policyを
各stepの前後で評価する`MovementCoordinator`、テスト専用Fakeで構成します。加えて、固定versionの
`player_auth_input` frameを厳格検証・serializeする境界と、注入されたbedrock client transportへ
1 tick分だけqueueしてserver観測を待つadapterを実装しました。通常runtimeは移動coordinatorを
起動せず、movement bindingも既定でdisabledです。

## 移動plan

- 現在位置と目標位置は`x`、`y`、`z`、dimensionを持ちます。
- 対応dimensionはoverworld、nether、endです。異dimension間のplanは拒否します。
- 座標は有限値に限定し、x/zは±30,000,000、yは-64～320です。
- 直線を最大step距離以下に分割し、最大step数を超えるplanを拒否します。
- 最大step距離は1 block以下、最大step数は10,000、1 step timeoutは30秒以下です。
- 到達判定は同一dimensionかつ設定した許容距離以内で行います。
- 各stepの観測位置をそのstep目標と照合し、逸脱またはdimension不一致時は後続stepを送りません。

上限は有限動作を保証する安全境界であり、実サーバーでの適切な速度を保証する値ではありません。
実adapter追加前に専用テストサーバーでpacket、速度、server側位置確定を検証します。

## 安全停止

各stepの送信前と、観測位置を受け取った直後に`DefaultWorkSafetyPolicy`を評価します。他player、
signal/operator停止、runtime・接続・spawn不成立、health・hunger低下、telemetry欠損・不正を検知
するとportを一度だけ停止し、以後のstepを送りません。cancelも同じ中断経路を使います。

完了時はStateStoreの作業状態と永続queueを`completed`、安全停止・cancel時は`stopped`、timeout、
port障害、不正位置、未到達時は`failed`へ一度だけ終端化します。stepの自動retryは行いません。
正常経路では各終端更新を1回だけ実行します。StateStoreと外部Repositoryは単一transactionではない
ため、queue永続化が失敗した場合は`finalization_error`で有限終了し、StateStoreをterminalにしたまま
queueが`claimed`で残る可能性があります。この場合は自動再実行せず、将来のclaim lease回収または
operator確認で回収します。

## Port境界

`MovementPort.move(step, signal)`は1 stepだけを実行し、serverで観測された位置を返す契約です。
`stop()`は現在の移動を停止します。domain/application層はBedrock packetを知りません。Fakeは
順序、timeout、cancel、安全状態変化、失敗、後続step抑止を外部接続なしで検証します。

## Bedrock adapterの準備状態

- 対応versionは固定依存と同じ`1.26.30`だけをallow-listし、未知versionは送信前に拒否します。
- payloadは有限値、非負tick、完全な固定fieldを要求し、item・block・attack等のconditional fieldを
  生成しません。input flagsは空、modeはmouse／normal／crosshairへ固定します。
- neutral frameはmove vectorとdeltaを0へ固定します。
- tickはadapter内で単調増加を要求し、同じtickへ2 packetをqueueしません。process遅延時のcatch-up
  loopや自動retryはありません。
- own entityの`move_player`とplayer用`correct_player_move_prediction`だけをtransportが正規化します。
  送信したpositionではなくserver観測だけを結果に使い、補正、異dimension、切断、invalid observation、
  Abortは有限失敗です。
- stop後はneutralを含む新規packetを送りません。listenerを解除し、未完了moveをAbortします。

frame factoryは目標座標から入力vector、delta、rotation、tickを推測しません。これらを整合させる
frame providerは専用サーバー検証まで本番構成へ用意せず、通常runtimeから実adapterを生成しません。
したがって現在の実装はprotocol境界とtransportの準備であり、実移動の有効化ではありません。
1.26.30の`move_player`には送信tickとの相関fieldがないため、adapterはframeをqueueした後に受けた最初の
own observationを結果候補にし、Coordinatorの目標照合を必須とします。この相関方法自体も実受入で
検証し、曖昧な場合は成功条件を拡張せずunsupportedのまま維持します。

## 未実装

- server physicsに合わせたframe providerと、実接続で検証済みの移動有効化
- 経路探索、障害物・落下・水・溶岩・敵対MOBの検知
- 視点変更、jump、採掘、設置、攻撃、item、chat、command
- queue consumerと通常runtimeへのexecutor接続（disabled bindingのcleanup境界だけ準備済み）
- 実Minecraft専用テストサーバーでの移動検証

実ゲーム内移動は、専用の[実移動受入計画](verification/movement-acceptance-plan.md)を段階ごとに
レビューし、ユーザー承認を得るまで実行しません。

protocol調査の結果、1.26系では`player_auth_input`が第一候補ですが、tick、input vector、rotation、
server補正を整合させる根拠が不足しています。座標だけを送るadapterは採用せず、実装前条件と
段階的受入案を[Bedrock移動プロトコル設計確認](verification/movement-protocol-design.md)に記録します。
