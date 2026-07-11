import type { MessageTree } from "../types";

/** Partial pack — missing keys fall back to English. */
const ja: MessageTree = {
  brand: { tagline: "ローカル映画アーカイブ" },
  nav: {
    narrative: "ナラティブ",
    commercial: "CM",
    social: "ソーシャル",
    archives: "アーカイブ",
    discovery: "ディスカバリー",
    favorites: "お気に入り",
    bin: "ゴミ箱",
    settings: "設定",
  },
  topbar: {
    ingest: "取り込み",
    refresh: "更新",
    tour: "ツアー",
    appearance: "外観",
    themeDark: "ダーク",
    themeLight: "ライト",
    themeSlate: "スレート",
  },
  discovery: {
    title: "ディスカバリー",
    searchPlaceholder: "映画・技法・ムードを検索… (⌘K)",
    loading: "読み込み中…",
  },
  favorites: {
    title: "お気に入り",
    empty: "まだお気に入りがありません",
    loading: "読み込み中…",
  },
  bin: {
    title: "ゴミ箱",
    restore: "復元",
    deleteForever: "完全に削除",
  },
  detail: {
    title: "ショット詳細",
    connections: "つながり",
    translate: "翻訳",
    showOriginal: "原文を表示",
    translating: "翻訳中…",
    save: "保存",
  },
  language: {
    label: "言語",
    core: "不足キーは英語にフォールバック",
    autoTranslate: "コンテンツを自動翻訳",
    sectionHint: "UI の言語。ショット本文は別途自動翻訳できます。",
  },
  common: {
    create: "作成",
    cancel: "キャンセル",
    delete: "削除",
    close: "閉じる",
    clearAll: "すべてクリア",
    search: "検索",
    next: "次へ",
    back: "戻る",
    skip: "スキップ",
  },
  filters: {
    dialIn: "フィルター",
    composition: "構図",
    favoritesOnly: "お気に入りのみ",
  },
  archives: { title: "アーカイブ", newArchive: "新規アーカイブ" },
  settings: {
    title: "設定",
    appearance: "外観",
    language: "言語",
  },
  tour: {
    label: "ツアー",
    skip: "スキップ",
    next: "次へ",
    finish: "はじめる",
    welcomeTitle: "Cinekive へようこそ",
  },
};

export default ja;
