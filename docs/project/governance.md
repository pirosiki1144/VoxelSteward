# 開発権限と承認ゲート

この文書は、VoxelStewardでエージェントが実行できる操作の正式な情報源です。
ロードマップ、要件、既存設計、またはユーザーから割り当てられた作業範囲内で適用します。
Codexの上位ポリシー、sandbox、実行環境の制約がこの文書より厳しい場合は、上位制約を
回避しません。ただし、この文書で自律実行可能な操作について、Docker socket、localhost通信、
Git index書込み、networkその他のsandbox権限が必要という理由だけで、会話上のユーザー許可を
改めて求めません。必要最小限の権限昇格を設定済みのautomatic reviewerへ直接提出し、承認後は
作業を継続します。上位system自身が人間の判断を強制する場合だけ、そのsystem承認を表示します。

## 自律操作とsandbox権限昇格

次の操作は、各節の安全条件を満たす限り、sandbox外実行が必要でも追加の会話承認を求めません。

1. 隔離されたlocal test service・container・networkの起動
2. local test serviceのhealth・log確認と、localhostを使うintegration test
3. 今回起動したlocal test service・container・networkの対象限定停止と整理
4. Docker image buildとCompose設定検証
5. task-owned fileだけの明示的なstagingとcached差分検査
6. 必須検証合格後のtask-owned local commit
7. 上記の失敗原因を解消した後の有限回の再検証

エージェントはこれらを実行する前に「実行してよいですか」とユーザーへ質問せず、コマンドと
対象を限定してautomatic reviewerへ渡します。広範囲なcleanup、所有者不明resource、認証・永続
volume、実Minecraft接続、外部DB、production、remote Gitはこの規則の対象外です。

## 自律実行可能

### 調査・実装・修正

- リポジトリ内のコード、テスト、設定、文書、Git履歴、差分、ローカルログの読み取り
- 秘密値を表示しない設定ファイルの存在確認と環境変数名の確認
- 割り当てられた作業、またはロードマップの現在工程に必要なコード、テスト、設定、文書の変更
- Fake、Mock、Stub、fixtureを使う単体・統合テストの追加と実行
- 依頼範囲内の不具合調査、修正、リファクタリング、再検証
- format、typecheck、lint、test、buildエラーの原因調査と修正
- 自分が今回の作業中に作成した一時ファイルとテスト生成物の削除

所有者不明の変更や作業開始前からあるユーザー変更は保護します。同じ失敗を無制限に
再試行せず、進展できない場合は原因と確認結果を報告します。

### ローカル検証

- `npm ci`、format、format check、typecheck、lint、unit test、integration test、build
- `docker compose config`とDockerイメージbuild
- VoxelStewardの開発・テスト用Composeサービス、コンテナ、ネットワークの起動と停止
- 今回の作業専用で、認証情報やユーザー永続dataを持たない一時test volumeの作成と使用
- ローカルテスト用サービスのヘルスチェックとログ確認
- 今回の作業で作成した一時コンテナ、ネットワーク、使い捨てtest volumeの停止と整理

ローカルサービスは隔離された開発・テスト用途に限定します。実Minecraftサーバーへ接続する
runtimeまたはsmokeの起動は含みません。用途や所有者を確認できないDocker資源は変更しません。

### ローカルテストデータベース

- Dockerまたはローカル環境内の隔離された開発・テスト用DBの起動と停止
- Repository、DB adapter、migration、状態履歴、checkpoint、通知outboxの実装
- 空のローカルテストDBへのmigration適用とrollback検証
- Repository統合テスト、非秘密なテストデータの投入と削除、テスト用schemaの再作成

実在するプレイヤー名、サーバー情報、Microsoftアカウント情報、認証情報をテストDBへ
保存しません。

## 条件付きで自律実行可能

### npm依存関係

次をすべて満たす追加・更新は自律実行できます。

- 現在の依頼、ロードマップ、要件に直接必要で、用途と必要性を説明できる
- `latest`ではなく互換性を確認した固定バージョンを使用する
- Node.js 24 LTSと現在のTypeScript設定に対応する
- `package.json`と`package-lock.json`を同時に更新する
- install script、license、保守状況、既知のsecurity riskを確認する
- 追加後にtypecheck、lint、test、buildを実行し、理由とversionを報告する

無関係な本番依存、主要frameworkの置換、互換性影響が大きいmajor update、新しい外部serviceや
認証方式、ゲーム内操作、安全制御を弱める依存関係は承認必須です。

### Discord Incoming Webhookへの実送信

既に設定されたIncoming Webhookと既存の固定通知templateを使い、開発・テスト・受入確認に
必要な回数限定の実送信は自律実行できます。次をすべて満たします。

- 送信回数を事前に有限化し、既存の5秒timeout、最大3試行、総15秒上限を維持する
- `allowed_mentions.parse`を空にし、自由文や仕様外messageを送らない
- Webhook URL、token、channel ID、接続先、プレイヤー名、BOT情報、認証情報を表示・記録・送信しない
- 配送結果は許可済みfieldだけの構造化logで確認する
- 配送失敗をruntimeとMinecraftの安全停止から隔離する

Webhook URLの作成・変更・rotation・削除、Discord側のchannel、Webhook、Bot、role、権限、
server設定の変更、Bot APIや双方向通信の導入、大量送信は承認必須です。

### ローカルGit commit

割り当てられた作業が完了し、必要なformat check、typecheck、lint、test、build、
`git diff --check`が成功した場合は、その作業で変更したfileだけをlocal commitできます。
commit前に差分、秘密情報、意図しない変更、既存変更との分離を確認し、repositoryの慣例に
沿うmessageを選びます。commit後にhash、message、file一覧を報告します。

検証失敗、未解決警告、秘密情報の疑い、意図しない差分、安全な分離不能がある場合は
commitしません。pushを含むremote Git操作はこの許可に含みません。

stageやcommitで`.git`へのsandbox外書込みが必要でも、上記条件を満たすtask-owned変更について
ユーザーへ追加許可を求めません。対象fileを明示し、automatic reviewerへ必要最小限の権限昇格を
提出します。

## ユーザー承認必須

### Minecraft・認証

- 実在するMinecraft/BDS serverへの接続、実接続試験、Microsoft/Xbox device code認証
- 認証cacheまたは認証volumeの作成、変更、移動、初期化、削除
- 移動、視点変更、jump、採掘、設置、item使用・投棄・保管、攻撃、chat、command、
  自動応答その他のgame内操作
- 自動再接続方針の変更、他player検知時の安全停止を弱める変更、本番server検証

### 外部service・infrastructure

- 外部・共有・staging・本番DBへの接続、書き込み、migration適用、実dataの変更・移行
- 破壊的migration、cloud DB resource、credentialの作成・変更・rotation
- AWS、VPS、cloud、本番環境へのdeployまたはresource、network、権限、serviceの変更
- Discord側resourceやWebhook設定の変更、新しい外部service連携
- 本番containerまたは本番serviceの起動、停止、再起動、Docker設定変更

### Git・設計

- `push`、`pull`、`merge`、`rebase`、tag、release、remote branch操作
- GitHubのIssue、Pull Request、Release、settings、Secretsなどの変更
- ロードマップや依頼から外れる大規模機能、主要architecture、安全・security境界の変更
- Repository境界やdomainのinfrastructure非依存方針の撤廃、新しい運用modeの追加

## 常に禁止

- `.env`、token、secret key、Cookie、認証cache、Webhook URL、接続文字列の内容表示、記録、送信、commit
- 実在するplayer名、server address、BOT account情報をstate、test、文書、Discordへ記録・送信
- 認証volume、ユーザー永続data、所有者不明のvolumeやresourceの削除・初期化
- `docker system prune`などの広範囲な破壊操作、無関係なDocker資源の削除
- safety controlの無効化、他player検知後またはoperator停止後の自動再接続、無制限retry
- ユーザー変更を破棄するreset・checkout、無断の履歴書き換え、force push
- 今回の依頼と無関係なfile変更、既存未commit変更の削除、秘密情報を含むcommit

`.env`や認証cacheは存在と必要な変数名の確認までに限定し、値を開きません。過去の検証記録に
記載された個別承認は履歴として保持し、現在の権限判断にはこの文書を使用します。
