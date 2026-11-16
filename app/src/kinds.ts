/** The aisles of the shelf: what kind of file a product is. Chosen by the creator when listing. */
export const KINDS = [
  { id: "template", label: "Templates", one: "Template", blurb: "Invoices, Notion and Canva templates, spreadsheets and pitch decks." },
  { id: "ebook", label: "Ebooks & guides", one: "Ebook", blurb: "Guides, checklists and short books you read once and keep." },
  { id: "course", label: "Courses", one: "Course", blurb: "Lessons and worksheets, sold as one download." },
  { id: "audio", label: "Beats & samples", one: "Sound pack", blurb: "Beats, drum kits, loops and one-shots for producers." },
  { id: "design", label: "Design assets", one: "Design asset", blurb: "Fonts, icons, mockups, presets and illustration packs." },
  { id: "other", label: "Everything else", one: "File", blurb: "Code, datasets, plugins: any file a buyer can download." },
] as const;

export type Kind = (typeof KINDS)[number]["id"];

export const isKind = (s: unknown): s is Kind => typeof s === "string" && KINDS.some((k) => k.id === s);

export const kindOf = (id: string) => KINDS.find((k) => k.id === id) ?? KINDS[KINDS.length - 1];

/** A best guess for products listed before creators chose a kind. */
export function guessKind(fileName: string): Kind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (["wav", "mp3", "aiff", "flac", "ogg"].includes(ext)) return "audio";
  if (["pdf", "epub", "md"].includes(ext)) return "ebook";
  if (["ttf", "otf", "woff", "woff2", "svg", "psd", "fig", "sketch", "xmp", "cube"].includes(ext)) return "design";
  if (["html", "xlsx", "csv", "docx", "pptx", "key", "numbers"].includes(ext)) return "template";
  return "other";
}
