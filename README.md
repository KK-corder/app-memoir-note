# MemoirNote

iPhone で過去の思い出ノートを毎日 1 件見返して書き足す PWA

| 項目 | 内容 |
|---|---|
| カテゴリ | アプリ |
| 状態 | 公開済み（iPhone での確認待ち） |
| 作る環境 | Mac（Dev） |
| 公開 | https://kk-corder.github.io/app-memoir-note/ （リポジトリ `KK-corder/app-memoir-note` は公開。中身はコードと作り物のデモだけ） |

<!-- 型の決まりは ~/Dev/_system/rules/repo_format.md §4。見出しの名前と順番を変えない -->

## 何か

本人専用。過去の旅行・ライブの思い出ノート（Mac の WorkSpace にある）を、毎晩 21 時のリマインダーから iPhone で開き、問いかけ → 本文と写真の順に見返して、思い出したことや写真をその場で足す。足した分は Mac がノートに取り込む。要件は `~/Dev/_system/docs/20261029-思い出ノート要件.md`。

## 使い方

（公開後）Safari で `https://kk-corder.github.io/app-memoir-note/` を開き、共有 →「ホーム画面に追加」。Google でログインする。確認用は `?demo=1`（作り物のデータ）。

今日の問いかけを読んで「思い出してから開く」を押す。本文の下から追記・写真の追加ができる。一覧では題・場所・本文を検索できる。設定の置き場は `思い出ノート/_app` が既定。Mac がこの中の `memoir.json`・写真・空の `inbox/` を用意する。

未送信の追記は端末に残り、次回起動時か「もう一度送る」で再送する。送信済みの追記・写真は、Mac の取り込みが `applied` で確認できるまで反映待ちとして表示する。写真の送信に失敗した場合は選び直す。

## 構成

```text
index.html / styles.css    アプリの画面とスマホ向け表示
config.js                 PaperReader と共通の OAuth クライアント ID
js/                       ログイン・Drive・端末保存・追記・写真・画面
demo/                     作り物のノート 8 件と SVG 画像
icons/ / sw.js             PWA のアイコンとアプリの殻のキャッシュ
tests/                    Node 標準機能だけの検証（偽の DOM・Drive を含む）
AGENTS.md          プロジェクトのルール（両エージェント共通の正）
CLAUDE.md          Claude Code の入口（AGENTS.md を取り込む）
_TODO.md           タスクの状態
docs/briefs/       Codex へ渡す実装ブリーフ
docs/decisions.md  設計判断の記録
docs/reports/     実装結果・検証結果・未検証項目
```

## 開発と検証

ルールは `AGENTS.md`。

```bash
node --test tests/
find . -name '*.mjs' -not -path './vendor/*' -exec node --check {} \;
find . -name '*.js' -not -path './vendor/*' -exec node --check {} \;
git diff --check
cd ~/Dev/4_アプリ && python3 -m http.server 8080 --bind 127.0.0.1   # → http://localhost:8080/MemoirNote/?demo=1
```

依存追加・ビルドは不要。`startApp({ clientId, defaultPath, now, fetcher })` で設定・日時・通信を差し替えられる。保存キーは `memoir-note-v1` の 1 つ。デモと本番、Drive の道筋ごとに追記を分ける。ノート本文と写真本体を端末に保存せず、Google への通信は Service Worker で横取りしない。

画面は Claude が 390×844・844×390 とダークモードで確認する。実際のログイン・Drive・写真の変換・ホーム画面からの起動は本人の iPhone で確認する。公開前に Google Cloud へ承認済みリダイレクト URI を追加する。

## 状態と次の一手

- 2026-11-04 作成。初版のブリーフ `docs/briefs/20261104-01-first-version.md`。Mac 側は WorkSpace への依頼書 `~/Dev/_system/docs/20261104-思い出ノート-書き出しと取り込み要件.md`。細かい TODO は `_TODO.md`
- 2026-11-04 初版を実装。Node の検証を完了し、Claude の画面・差分レビュー待ち。詳細は `docs/reports/20261104-first-version.md`。コミット・公開・本番の接続確認は未実施。
