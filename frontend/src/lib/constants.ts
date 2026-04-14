export const modelOptions = [
  { label: "gpt4o", value: "openai/gpt-4o" },
  { label: "gpt4o-mini", value: "openai/gpt-4o-mini" },
  { label: "gpt5.4nano", value: "openai/gpt-5.4-nano" },
  { label: "gpt5.4mini", value: "openai/gpt-5.4-mini" },
  { label: "gemini3 flash", value: "google/gemini-3-flash-preview" },
] as const;

export const languageOptions = [
  { label: "自动识别", value: "auto" },
  { label: "简体中文", value: "Chinese (Simplified)" },
  { label: "English", value: "English" },
  { label: "日本語", value: "Japanese" },
  { label: "한국어", value: "Korean" },
  { label: "Français", value: "French" },
  { label: "Deutsch", value: "German" },
  { label: "Español", value: "Spanish" },
] as const;

export const translationStyles = [
  { label: "自然流畅", value: "natural" },
  { label: "忠实直译", value: "faithful" },
] as const;
