export const modelOptions = [
  { label: "gpt4o", value: "openai/gpt-4o" },
  { label: "gpt4o-mini", value: "openai/gpt-4o-mini" },
  { label: "gpt5.4nano", value: "openai/gpt-5.4-nano" },
  { label: "gpt5.4mini", value: "openai/gpt-5.4-mini" },
  { label: "gemini3 flash", value: "google/gemini-3-flash-preview" },
] as const;

export const taskModeOptions = [
  {
    label: "文章翻译",
    value: "translate",
    description: "适合 datasheet、app note、release note 与长文档片段。",
  },
  {
    label: "英文润色",
    value: "polish",
    description: "保留原意，优化英文表达、术语一致性与技术文风。",
  },
  {
    label: "芯片问答",
    value: "ask",
    description: "用作技术 copilot，适合概念解释、方案比较与写作辅助。",
  },
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

export const terminologyPresets = [
  {
    label: "制造基础",
    hint: "wafer / die / package",
    value: "Die -> 晶粒\nPackage -> 封装\nWafer -> 晶圆",
  },
  {
    label: "电源与时序",
    hint: "power rail / leakage / clock tree",
    value: "Power rail -> 电源轨\nLeakage current -> 漏电流\nClock tree -> 时钟树",
  },
  {
    label: "项目流程",
    hint: "yield / bring-up / tape-out",
    value: "Yield -> 良率\nBring-up -> 板级 bring-up\nTape-out -> 流片",
  },
] as const;
