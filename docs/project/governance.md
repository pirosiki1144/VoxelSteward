# 開発権限と承認ゲート

## 自律実行できる範囲

- リポジトリ、Git履歴、要件、コード、テスト、文書の読み取り調査
- 承認済みスコープ内のコード、テスト、文書の編集
- 外部接続を行わないFake、Mock、Stubによるテスト
- format、typecheck、lint、unit test、ローカルintegration test、build
- `docker compose config`による設定検証
- Dockerサービスを起動しないイメージビルド
- テスト用一時ファイルの作成と後片付け
- 承認済み範囲の不具合調査と修正

テスト失敗を削除、skip、条件緩和で隠してはいけません。

## 事前承認が必要な操作

- 実Minecraftサーバーへの接続
- Dockerサービスまたはコンテナの起動
- Discordへの実送信
- 外部DBへの接続、書き込み、マイグレーション適用
- 本番依存パッケージの追加または大規模更新
- 認証処理または認証volumeの変更
- commit、push、merge、release
- GitHub上のIssue、Pull Request、Releaseなどの変更
- 既存仕様を大きく変更する設計判断
- Minecraft内の移動、採掘、設置、攻撃、保管などの操作

commitとpushは別々に承認を得ます。

## 禁止事項

- `.env`、トークン、秘密鍵、Cookie、認証キャッシュの内容表示
- BOTアカウント名、実プレイヤー名、サーバー接続情報の不要な記録
- 認証volumeの削除、初期化、再作成
- force push、`git reset --hard`、所有者不明の変更の破棄
- 安全停止テストの削除または弱体化
- 他プレイヤー検知後の自動再接続
- 実サーバーを自動テストの接続先にする
- 複数Agentによる同一作業ツリーの同時編集

`.env`は存在とファイル名だけを確認し、内容を開きません。
