# MemoirNote

iPhone で過去の思い出ノートを毎日 1 件見返して書き足す PWA

| 項目 | 内容 |
|---|---|
| カテゴリ | アプリ |
| 状態 | 試作中 |
| 作る環境 | Mac（Dev） |
| 公開 | 非公開 |

<!-- 型の決まりは ~/Dev/_system/rules/repo_format.md §4。見出しの名前と順番を変えない -->

## 何か

本人専用。過去の旅行・ライブの思い出ノート（Mac の WorkSpace にある）を、毎晩 21 時のリマインダーから iPhone で開き、問いかけ → 本文と写真の順に見返して、思い出したことや写真をその場で足す。足した分は Mac がノートに取り込む。要件は `~/Dev/_system/docs/20261029-思い出ノート要件.md`。

## 使い方

（公開後）Safari で `https://kk-corder.github.io/app-memoir-note/` を開き、共有 →「ホーム画面に追加」。Google でログインする。確認用は `?demo=1`（作り物のデータ）。

## 構成

```text
AGENTS.md          プロジェクトのルール（両エージェント共通の正）
CLAUDE.md          Claude Code の入口（AGENTS.md を取り込む）
_TODO.md           タスクの状態
docs/briefs/       Codex へ渡す実装ブリーフ
docs/decisions.md  設計判断の記録
```

## 開発と検証

ルールは `AGENTS.md`。

```bash
node --test tests/
cd ~/Dev/4_アプリ && python3 -m http.server 8080 --bind 127.0.0.1   # → http://localhost:8080/MemoirNote/?demo=1
```

## 状態と次の一手

- 2026-11-04 作成。初版のブリーフ `docs/briefs/20261104-01-first-version.md`。Mac 側は WorkSpace への依頼書 `~/Dev/_system/docs/20261104-思い出ノート-書き出しと取り込み要件.md`。細かい TODO は `_TODO.md`
