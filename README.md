# 🤖 Twist Toolkit Skill

**Twist Toolkit** is an **AI-native skill (extension)** designed for AI agents to interact with [Twist](https://twist.com/) workspaces autonomously, supporting user communication.

AI can use this tool to summarize threads, extract key mentions, organize inboxes, reply on behalf of the user, and share files programmatically.

## 🔥 Capabilities

Empowering your AI agent with this skill enables:

- **Autonomous Inbox Management:** AI understands and executes requests like "Check unread threads and archive low-priority ones."
- **Intelligent Search:** Cross-search months of threads to help the AI research project history or past decisions.
- **Reply Assistant:** AI analyzes context and posts appropriate messages directly to channels or DMs.
- **Resource Management:** AI integrates channel creation, member invitations, and file uploads into your workflow.

## 🚀 Onboarding (Connecting to AI Agent)

### 1. Placement
Place this repository in a directory accessible to your AI agent (e.g., `skills/`).

### 2. Initial Setup (Conversation-based Auth)
To allow the AI to access Twist, a human performs a one-time authentication through **prompts** to the AI.

**Pre-requisite:**
First, install the Twist integration to your workspace via [this link](https://twist.com/integrations/install/7598_fede8f25e6ac33e8b89557aa).

1. **User:** Ask the AI to "Login to Twist."
2. **AI:** Provides a URL to open in your browser.
3. **User:** Authorize in the browser and copy the `code` displayed after redirect.
4. **User:** Send the authentication code to the AI.
5. **AI:** Completes the authentication internally.

### 3. Environment Recognition
After authentication, ask the AI to "Setup my workspace." The AI will autonomously identify your workspaces and set the default one.

## 🧠 AI-Ready Interface (SKILL.md)

Full functionality is defined in [SKILL.md](./SKILL.md) in a format readable by AI.
The AI understands command arguments (like optional workspace IDs) and parses JSON responses to decide its next action.

## 🔐 Security
- Auth tokens are saved locally in `.twist_toolkit_auth.json`.
- This file is automatically protected by `.gitignore` and will never be leaked externally.

## 🛠️ Technical Specs
- **Engine:** Node.js (v14+)
- **API:** Twist API v3 (Field-Tested / Doc-Gap resolved)
- **Coverage:** 100% functional test verified (`npm test`)

---

# 🤖 Twist Toolkit Skill (日本語版)

**Twist Toolkit** は、AIエージェントが [Twist](https://twist.com/) のワークスペースを自在に操作し、ユーザーのコミュニケーションを自律的にサポートするための **AI専用スキル（拡張機能）** です。

AIはこのツールを介して、スレッドの要約、重要なメンションの抽出、インボックスの整理、返信の代行、ファイルの共有などをプログラムレベルで実行できるようになります。

## 🔥 AIができること

このスキルをAIに与えることで、以下のようなタスクを自動化・高度化できます。

- **自律的なインボックス整理:** 「未読スレッドを確認して、重要度の低いものはアーカイブして」といった指示を理解し実行。
- **インテリジェント検索:** 過去数ヶ月のスレッドを横断検索し、特定のプロジェクトや意思決定の経緯をAIが調査。
- **返信アシスタント:** AIが文脈を汲み取り、適切なチャンネルやDMへ直接メッセージを投稿。
- **リソース管理:** チャンネルの作成、メンバーの招待、ファイルのアップロードなどをAIがワークフローに組み込み。

## 🚀 導入（AIエージェントへの接続）

### 1. スキルの配置
AIエージェント（Gemini CLI等）がアクセス可能なディレクトリ（`skills/` 等）に本リポジトリを配置します。

### 2. 初期セットアップ（対話による認証）
AIがTwistにアクセスできるよう、初回のみ人間がAIへの **「プロンプト」** を通じて認証を行います。

**事前準備:** 
まず最初に、[こちらのリンク](https://twist.com/integrations/install/7598_fede8f25e6ac33e8b89557aa) からTwist連携をワークスペースにインストールしてください。

1. **ユーザー:** 「Twistにログインして」とAIに依頼。
2. **AI:** ブラウザを開くURLを提示。
3. **ユーザー:** ブラウザで承認し、リダイレクト後に表示された `code` をコピー。
4. **ユーザー:** 認証コードをAIに送信。
5. **AI:** 内部的に認証を完了。

### 3. 環境認識
認証完了後、AIに「ワークスペースをセットアップして」と依頼することで、AIが自律的に所属ワークスペースを特定し、デフォルトの設定を行います。

## 🧠 AI向けインターフェース (SKILL.md)

本ツールの全機能は、AIが読み取り可能な形式で [SKILL.md](./SKILL.md) に定義されています。
AIは各コマンドの引数（ワークスペースIDの省略ルール等）を理解し、JSON形式のレスポンスを解析して、次のアクションを判断します。

## 🔐 セキュリティ
- 認証トークンはローカルの `.twist_toolkit_auth.json` に保存されます。
- このファイルは `.gitignore` により自動的に保護され、外部へ流出することはありません。

## 🛠️ 技術仕様
- **Engine:** Node.js (v14+)
- **API:** Twist API v3 (Field-Tested / Doc-Gap resolved)
- **Coverage:** 100% functional test verified (`npm test`)
