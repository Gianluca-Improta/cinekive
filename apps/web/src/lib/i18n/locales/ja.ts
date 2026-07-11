import type { MessageTree } from "../types";

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
  },
  discovery: {
    title: "ディスカバリー",
    searchPlaceholder: "映画・技法・ムードを検索… (⌘K)",
    loading: "読み込み中…",
  },
  favorites: { title: "お気に入り", empty: "まだお気に入りがありません", loading: "読み込み中…" },
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
    core: "コア：英語",
    autoTranslate: "コンテンツを自動翻訳",
  },
  common: { create: "作成", cancel: "キャンセル", delete: "削除", close: "閉じる" },
  filters: { dialIn: "フィルター", composition: "構図", favoritesOnly: "お気に入りのみ" },
  archives: { title: "アーカイブ", newArchive: "新規アーカイブ" },
};

export default ja;
