export const modelOptions = [
  { label: "GPT-4o", value: "openai/gpt-4o" },
  { label: "GPT-4o mini", value: "openai/gpt-4o-mini" },
  { label: "GPT-5.4 nano", value: "openai/gpt-5.4-nano" },
  { label: "GPT-5.4 mini", value: "openai/gpt-5.4-mini" },
  { label: "Gemini 3 Flash", value: "google/gemini-3-flash-preview" },
] as const;

export const taskModeOptions = [
  { label: "翻译", value: "translate" },
  { label: "润色", value: "polish" },
  { label: "问答", value: "ask" },
] as const;

export const languageOptions = [
  { label: "自动", value: "auto" },
  { label: "简体中文", value: "Chinese (Simplified)" },
  { label: "English", value: "English" },
  { label: "日本語", value: "Japanese" },
  { label: "한국어", value: "Korean" },
  { label: "Français", value: "French" },
  { label: "Deutsch", value: "German" },
  { label: "Español", value: "Spanish" },
] as const;

export const translationStyles = [
  { label: "自然", value: "natural" },
  { label: "直译", value: "faithful" },
] as const;
