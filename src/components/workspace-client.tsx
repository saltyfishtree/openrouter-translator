"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  logout,
  requestCurrentUser,
  requestTranslationMessages,
  requestTranslationThreads,
  translateStream,
  type CurrentUser,
  type TranslationMessage,
  type TranslationThread,
} from "@/lib/api";
import {
  languageOptions,
  modelOptions,
  taskModeOptions,
  terminologyPresets,
  translationStyles,
} from "@/lib/constants";

const MAX_SOURCE_CHARS = 12000;
const PREFS_STORAGE_KEY = "translator:prefs:v3";
const DRAFT_STORAGE_KEY = "translator:draft:v2";

type TaskMode = "translate" | "polish" | "ask";

type Prefs = {
  taskMode: TaskMode;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationStyle: string;
  terminologyPreferences: string;
};

type ModeCopy = {
  badge: string;
  title: string;
  description: string;
  inputLabel: string;
  inputPlaceholder: string;
  outputLabel: string;
  actionLabel: string;
  helper: string;
  promptIdeas: string[];
};

function prefsStorageKey(username: string) {
  return `${PREFS_STORAGE_KEY}:${username.trim().toLowerCase()}`;
}

function loadPrefs(username: string): Prefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(prefsStorageKey(username));
    if (!raw) return null;
    return JSON.parse(raw) as Prefs;
  } catch {
    return null;
  }
}

function savePrefs(username: string, prefs: Prefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(prefsStorageKey(username), JSON.stringify(prefs));
  } catch {}
}

function countGlossaryRules(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean).length;
}

function formatTimeLabel(value: string) {
  const date = new Date(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function modeCopy(taskMode: TaskMode): ModeCopy {
  if (taskMode === "polish") {
    return {
      badge: "English Editing",
      title: "英文润色工作台",
      description:
        "适合把原始英文技术文稿改写成更像正式文档的版本，尤其适合芯片文档、规格说明和发布说明。",
      inputLabel: "待润色英文",
      inputPlaceholder:
        "粘贴原始英文内容，例如 draft paragraph、release note、邮件草稿或 datasheet 文段。",
      outputLabel: "润色结果",
      actionLabel: "开始润色",
      helper: "系统会默认保留原意、提高清晰度，并尽量使用稳定的技术写作风格。",
      promptIdeas: [
        "Please polish the following release-note paragraph for a customer-facing audience.",
        "Rewrite this app-note introduction to be clearer and more technically precise.",
        "Tighten this internal engineering summary without changing the meaning.",
      ],
    };
  }

  if (taskMode === "ask") {
    return {
      badge: "Chip Copilot",
      title: "芯片问答工作台",
      description:
        "把它当成文档工程师的芯片领域 copilot，用来理解术语、整理思路、比较方案，或者先起草一段说明。",
      inputLabel: "问题或任务",
      inputPlaceholder:
        "例如：请解释 chiplet 与 monolithic die 的主要取舍；请帮我写一段更容易理解的 PLL 说明。",
      outputLabel: "回答",
      actionLabel: "开始提问",
      helper: "更适合概念解释、写作辅助、术语辨析和半导体技术场景问答。",
      promptIdeas: [
        "请比较 chiplet 与 monolithic die 在成本、封装和验证上的差异。",
        "请帮我解释 leakage current 与 static power 的关系，面向非设计背景读者。",
        "请给我一版更适合 datasheet 的 ESD 保护说明。",
      ],
    };
  }

  return {
    badge: "Document Translation",
    title: "文章翻译工作台",
    description:
      "适合处理 datasheet、app note、whitepaper、邮件、博客和长段技术资料，支持上下文连续翻译。",
    inputLabel: "原文",
    inputPlaceholder:
      "粘贴待翻译内容。系统会保留标题、列表、换行、代码块和术语结构。",
    outputLabel: "译文",
    actionLabel: "开始翻译",
    helper: "如果你经常处理固定芯片词汇，可以把术语偏好写在右侧，模型会尽量保持统一。",
    promptIdeas: [
      "Please translate the following datasheet section into Simplified Chinese.",
      "Translate this app-note paragraph and preserve all list structure.",
      "Translate this customer email into natural Chinese while keeping technical terms precise.",
    ],
  };
}

function applyModeDefaults(taskMode: TaskMode) {
  if (taskMode === "polish") {
    return {
      sourceLanguage: "English",
      targetLanguage: "English",
      translationStyle: "natural",
    };
  }

  if (taskMode === "ask") {
    return {
      sourceLanguage: "auto",
      targetLanguage: "Chinese (Simplified)",
      translationStyle: "natural",
    };
  }

  return {
    sourceLanguage: "auto",
    targetLanguage: "Chinese (Simplified)",
    translationStyle: "natural",
  };
}

export function WorkspaceClient() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [threads, setThreads] = useState<TranslationThread[]>([]);
  const [messages, setMessages] = useState<TranslationMessage[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [taskMode, setTaskMode] = useState<TaskMode>("translate");
  const [model, setModel] = useState<string>(modelOptions[1].value);
  const [sourceLanguage, setSourceLanguage] = useState<string>(
    languageOptions[0].value,
  );
  const [targetLanguage, setTargetLanguage] = useState<string>(
    languageOptions[1].value,
  );
  const [translationStyle, setTranslationStyle] = useState<string>(
    translationStyles[0].value,
  );
  const [terminologyPreferences, setTerminologyPreferences] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [resultText, setResultText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads],
  );
  const copy = useMemo(() => modeCopy(taskMode), [taskMode]);
  const glossaryRuleCount = useMemo(
    () => countGlossaryRules(terminologyPreferences),
    [terminologyPreferences],
  );
  const sameLanguage =
    taskMode === "translate" &&
    sourceLanguage !== "auto" &&
    sourceLanguage === targetLanguage;
  const overLimit = sourceText.length > MAX_SOURCE_CHARS;

  useEffect(() => {
    try {
      const draft = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (draft) setSourceText(draft);
    } catch {}
  }, []);

  useEffect(() => {
    if (!user?.username) return;
    savePrefs(user.username, {
      taskMode,
      model,
      sourceLanguage,
      targetLanguage,
      translationStyle,
      terminologyPreferences,
    });
  }, [
    model,
    sourceLanguage,
    targetLanguage,
    taskMode,
    terminologyPreferences,
    translationStyle,
    user,
  ]);

  useEffect(() => {
    try {
      if (sourceText) window.localStorage.setItem(DRAFT_STORAGE_KEY, sourceText);
      else window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {}
  }, [sourceText]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (resultRef.current) {
      resultRef.current.scrollTop = resultRef.current.scrollHeight;
    }
  }, [resultText]);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const currentUser = await requestCurrentUser();
        if (!currentUser) {
          router.replace("/login");
          return;
        }
        if (!active) return;
        setUser(currentUser);

        const prefs = loadPrefs(currentUser.username);
        if (prefs) {
          setTaskMode(prefs.taskMode);
          if (modelOptions.some((m) => m.value === prefs.model)) setModel(prefs.model);
          if (languageOptions.some((l) => l.value === prefs.sourceLanguage)) {
            setSourceLanguage(prefs.sourceLanguage);
          }
          if (
            languageOptions.some(
              (l) => l.value === prefs.targetLanguage && l.value !== "auto",
            )
          ) {
            setTargetLanguage(prefs.targetLanguage);
          }
          if (translationStyles.some((s) => s.value === prefs.translationStyle)) {
            setTranslationStyle(prefs.translationStyle);
          }
          setTerminologyPreferences(prefs.terminologyPreferences ?? "");
        }

        const historyThreads = await requestTranslationThreads();
        if (!active) return;
        setThreads(historyThreads);
        if (historyThreads.length > 0) {
          setActiveThreadId(historyThreads[0].id);
        }
      } catch (requestError) {
        if (!active) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "初始化工作台失败，请刷新重试。",
        );
      } finally {
        if (active) setCheckingAuth(false);
      }
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    let active = true;

    async function loadMessages() {
      if (!activeThreadId) {
        setMessages([]);
        return;
      }

      setLoadingMessages(true);
      try {
        const nextMessages = await requestTranslationMessages(activeThreadId);
        if (!active) return;
        setMessages(nextMessages);
      } catch (requestError) {
        if (!active) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "加载会话消息失败。",
        );
      } finally {
        if (active) setLoadingMessages(false);
      }
    }

    void loadMessages();
    return () => {
      active = false;
    };
  }, [activeThreadId]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const refreshThreads = useCallback(
    async (preferredThreadId?: string | null) => {
      const nextThreads = await requestTranslationThreads();
      setThreads(nextThreads);

      if (preferredThreadId) {
        setActiveThreadId(preferredThreadId);
        return;
      }
      if (!activeThreadId && nextThreads.length > 0) {
        setActiveThreadId(nextThreads[0].id);
      }
    },
    [activeThreadId],
  );

  const handleTranslate = useCallback(async () => {
    const trimmed = sourceText.trim();
    if (!trimmed) {
      setError("请先输入正文、英文草稿或问题。");
      return;
    }
    if (overLimit) {
      setError(`输入内容超过 ${MAX_SOURCE_CHARS} 字符上限，请拆分后再处理。`);
      return;
    }
    if (streaming) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setStreaming(true);
    setError("");
    setCopied(false);
    setResultText("");

    try {
      const { response, threadId } = await translateStream(
        {
          model,
          taskMode,
          sourceLanguage,
          targetLanguage,
          translationStyle,
          terminologyPreferences,
          sourceText,
          threadId: activeThreadId,
          contextDepth: 8,
        },
        controller.signal,
      );

      const reader = response.body?.getReader();
      if (!reader) {
        setError("当前环境不支持流式读取。");
        return;
      }

      const decoder = new TextDecoder();
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setResultText(fullText);
      }

      const nextThreadId = threadId ?? activeThreadId;
      try {
        await refreshThreads(nextThreadId);
        if (nextThreadId) {
          const nextMessages = await requestTranslationMessages(nextThreadId);
          setMessages(nextMessages);
        }
      } catch {}
    } catch (requestError) {
      if (controller.signal.aborted) {
        setNotice("已停止当前处理。");
      } else {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "服务暂时不可用，请稍后再试。",
        );
      }
    } finally {
      setStreaming(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [
    activeThreadId,
    model,
    overLimit,
    refreshThreads,
    sourceLanguage,
    sourceText,
    streaming,
    targetLanguage,
    taskMode,
    terminologyPreferences,
    translationStyle,
  ]);

  function handleStop() {
    abortRef.current?.abort();
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      router.replace("/login");
    }
  }

  async function handleCopy() {
    if (!resultText) return;
    try {
      await navigator.clipboard.writeText(resultText);
      setCopied(true);
    } catch {
      setError("复制失败，浏览器可能禁用了剪贴板权限。");
    }
  }

  function handleNewThread() {
    abortRef.current?.abort();
    setActiveThreadId(null);
    setMessages([]);
    setSourceText("");
    setResultText("");
    setError("");
    setNotice("已切换到空白工作区。");
  }

  function handleSwapLanguages() {
    if (sourceLanguage === "auto") {
      setNotice("自动识别时无法互换，请先选择具体的原文语言。");
      return;
    }
    const nextSource = targetLanguage;
    const nextTarget = sourceLanguage;
    setSourceLanguage(nextSource);
    setTargetLanguage(nextTarget);
    if (sourceText && resultText) {
      setSourceText(resultText);
      setResultText(sourceText);
    }
  }

  function handleUseMessage(message: TranslationMessage) {
    setModel(message.model);
    setSourceLanguage(message.sourceLanguage);
    setTargetLanguage(message.targetLanguage);
    setTranslationStyle(message.translationStyle);
    setSourceText(message.sourceText);
    setResultText(message.translatedText);
    setNotice("已把这条历史载入当前工作区。");
  }

  function handleClearSource() {
    setSourceText("");
    setResultText("");
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleTranslate();
    }
  }

  function handleModeSwitch(nextMode: TaskMode) {
    if (streaming) return;
    setTaskMode(nextMode);
    const defaults = applyModeDefaults(nextMode);
    setSourceLanguage(defaults.sourceLanguage);
    setTargetLanguage(defaults.targetLanguage);
    setTranslationStyle(defaults.translationStyle);
    setNotice(`已切换到${taskModeOptions.find((item) => item.value === nextMode)?.label}模式。`);
  }

  function handleUsePromptIdea(value: string) {
    setSourceText(value);
    setNotice("已填入示例草稿，你可以直接修改后使用。");
  }

  function handleApplyTerminologyPreset(value: string) {
    setTerminologyPreferences((current) =>
      current.trim() ? `${current.trim()}\n${value}` : value,
    );
    setNotice("已追加一组术语偏好。");
  }

  function handleResetTerminologyPreferences() {
    setTerminologyPreferences("");
    setNotice("已清空当前账号的术语偏好。");
  }

  if (checkingAuth) {
    return (
      <section className="auth-card">
        <span className="eyebrow">Workspace Loading</span>
        <h1>正在准备文档工作台</h1>
        <p>系统会先恢复登录态，再加载你的会话历史与常用偏好。</p>
      </section>
    );
  }

  const charCountClass = overLimit
    ? "char-count over"
    : sourceText.length > MAX_SOURCE_CHARS * 0.85
      ? "char-count warning"
      : "char-count";

  const translateDisabled =
    streaming || !sourceText.trim() || overLimit || sameLanguage;

  return (
    <div className="workspace-shell doc-shell">
      <section className="doc-hero">
        <div className="doc-hero-copy">
          <span className="eyebrow">{copy.badge}</span>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <div className="doc-hero-meta">
          <div className="identity-chip">
            <span>当前账号</span>
            <strong>{user?.username ?? "-"}</strong>
          </div>
          <div className="hero-actions">
            <button className="ghost-button" onClick={handleNewThread} type="button">
              新建工作区
            </button>
            <button className="ghost-button" onClick={handleLogout} type="button">
              退出登录
            </button>
          </div>
        </div>
      </section>

      <section className="doc-layout">
        <aside className="doc-sidebar">
          <section className="sidebar-card">
            <div className="sidebar-card-header">
              <h2>任务模式</h2>
              <span>面向文档工程师</span>
            </div>
            <div className="mode-list">
              {taskModeOptions.map((item) => (
                <button
                  key={item.value}
                  className={`mode-card ${taskMode === item.value ? "active" : ""}`}
                  onClick={() => handleModeSwitch(item.value)}
                  type="button"
                >
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="sidebar-card">
            <div className="sidebar-card-header">
              <h2>会话历史</h2>
              <span>{threads.length} 条</span>
            </div>
            <div className="history-list">
              {threads.length === 0 ? (
                <p className="placeholder">还没有历史，先处理一段内容吧。</p>
              ) : (
                threads.map((thread) => (
                  <button
                    key={thread.id}
                    className={`history-item ${
                      activeThreadId === thread.id ? "active" : ""
                    }`}
                    onClick={() => setActiveThreadId(thread.id)}
                    type="button"
                  >
                    <strong>{thread.title}</strong>
                    <span>{thread.lastPreview || "暂无预览"}</span>
                    <small>
                      {thread.messageCount} 条 · {formatTimeLabel(thread.updated_at)}
                    </small>
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>

        <main className="doc-main">
          <section className="main-card mode-banner">
            <div className="mode-banner-copy">
              <span className="section-kicker">当前模式</span>
              <h2>{copy.title}</h2>
              <div className="mode-tags">
                <span>{taskModeOptions.find((item) => item.value === taskMode)?.label}</span>
                <span>芯片文档优先</span>
                <span>支持流式输出</span>
              </div>
            </div>
            <p>{copy.helper}</p>
          </section>

          <section className="quick-prompt-strip">
            {copy.promptIdeas.map((idea) => (
              <button
                key={idea}
                className="quick-prompt"
                onClick={() => handleUsePromptIdea(idea)}
                type="button"
              >
                {idea}
              </button>
            ))}
          </section>

          <section className="workbench-grid">
            <article className="main-card composer-card">
              <div className="panel-header">
                <h2>{copy.inputLabel}</h2>
                <div className="panel-meta">
                  <span className={charCountClass}>
                    {sourceText.length.toLocaleString()} /{" "}
                    {MAX_SOURCE_CHARS.toLocaleString()}
                  </span>
                  {sourceText ? (
                    <button
                      className="text-button"
                      onClick={handleClearSource}
                      type="button"
                      disabled={streaming}
                    >
                      清空
                    </button>
                  ) : null}
                </div>
              </div>

              <textarea
                className="editor doc-editor"
                placeholder={copy.inputPlaceholder}
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                onKeyDown={handleEditorKeyDown}
                aria-label={copy.inputLabel}
              />

              <div className="button-row">
                <button
                  className="primary-button"
                  onClick={handleTranslate}
                  type="button"
                  disabled={translateDisabled}
                >
                  {streaming ? "处理中..." : copy.actionLabel}
                </button>
                {streaming ? (
                  <button
                    className="ghost-button"
                    onClick={handleStop}
                    type="button"
                  >
                    停止
                  </button>
                ) : null}
              </div>
            </article>

            <article className="main-card result-card">
              <div className="panel-header">
                <h2>{copy.outputLabel}</h2>
                <button
                  className="text-button"
                  onClick={handleCopy}
                  type="button"
                  disabled={!resultText}
                >
                  {copied ? "已复制" : "复制结果"}
                </button>
              </div>

              <div className="result-box doc-result-box" ref={resultRef} aria-live="polite">
                {resultText ? (
                  <>
                    {resultText}
                    {streaming ? <span className="caret" aria-hidden="true" /> : null}
                  </>
                ) : (
                  <span className="placeholder">
                    {streaming ? "正在请求模型..." : "输出会在这里实时出现。"}
                  </span>
                )}
              </div>

              <div className="result-footer">
                <p className="thread-indicator">
                  当前会话：
                  {activeThread ? activeThread.title : "新会话（首次提交后自动创建）"}
                </p>
                <p className="thread-indicator">
                  快捷键：⌘/Ctrl + Enter
                </p>
              </div>
            </article>
          </section>

          {sameLanguage ? (
            <p className="inline-warning">
              在“文章翻译”模式下，原文与目标语言相同会让翻译失去意义，请调整语言选项。
            </p>
          ) : null}

          <section className="main-card timeline-panel doc-timeline">
            <div className="timeline-header">
              <h2>上下文与历史消息</h2>
              <span>{messages.length} 条</span>
            </div>
            {loadingMessages ? (
              <p className="placeholder">正在加载会话内容...</p>
            ) : messages.length === 0 ? (
              <p className="placeholder">
                当前会话还没有消息，完成一次处理后会自动保存。
              </p>
            ) : (
              <div className="timeline-list">
                {messages.map((message) => (
                  <article className="timeline-item" key={message.id}>
                    <header>
                      <strong>{formatTimeLabel(message.createdAt)}</strong>
                      <span>{message.model}</span>
                    </header>
                    <div className="timeline-text">
                      <p>
                        <b>输入：</b>
                        {message.sourceText}
                      </p>
                      <p>
                        <b>输出：</b>
                        {message.translatedText}
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => handleUseMessage(message)}
                      type="button"
                    >
                      载入当前工作区
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="doc-rail">
          <section className="rail-card">
            <div className="sidebar-card-header">
              <h2>工作配置</h2>
              <span>按任务微调</span>
            </div>
            <div className="field-stack">
              <label className="field">
                <span>模型</span>
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  disabled={streaming}
                >
                  {modelOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>原文语言</span>
                <select
                  value={sourceLanguage}
                  onChange={(event) => setSourceLanguage(event.target.value)}
                  disabled={streaming || taskMode === "polish"}
                >
                  {languageOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field-header">
                  输出语言
                  {taskMode === "translate" ? (
                    <button
                      className="swap-button"
                      onClick={handleSwapLanguages}
                      type="button"
                      disabled={streaming || sourceLanguage === "auto"}
                      title="互换原文与目标语言"
                      aria-label="互换原文与目标语言"
                    >
                      ↔
                    </button>
                  ) : null}
                </span>
                <select
                  value={targetLanguage}
                  onChange={(event) => setTargetLanguage(event.target.value)}
                  disabled={streaming || taskMode === "polish"}
                >
                  {languageOptions
                    .filter((item) => item.value !== "auto")
                    .map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                </select>
              </label>

              <label className="field">
                <span>输出偏好</span>
                <select
                  value={translationStyle}
                  onChange={(event) => setTranslationStyle(event.target.value)}
                  disabled={streaming || taskMode !== "translate"}
                >
                  {translationStyles.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="rail-card">
            <div className="sidebar-card-header">
              <h2>个人术语本</h2>
              <span>按账号保存</span>
            </div>
            <div className="glossary-summary">
              <strong>{glossaryRuleCount}</strong>
              <span>
                条固定词法 / 风格规则会一起送给模型，适合术语统一、芯片缩写保留和固定译法。
              </span>
            </div>
            <label className="field">
              <span>术语映射 / 风格规则</span>
              <textarea
                className="mini-editor"
                value={terminologyPreferences}
                onChange={(event) => setTerminologyPreferences(event.target.value)}
                placeholder="例如：\nChiplet -> 小芯粒\nTape-out -> 流片\nBring-up -> 板级 bring-up"
              />
            </label>
            <div className="glossary-actions">
              <button
                className="ghost-button"
                onClick={handleResetTerminologyPreferences}
                type="button"
                disabled={!terminologyPreferences.trim()}
              >
                清空术语本
              </button>
              <p>同一账号下会自动记住，不需要重复填写。</p>
            </div>
            <div className="preset-stack">
              {terminologyPresets.map((preset) => (
                <button
                  key={preset.label}
                  className="preset-chip"
                  onClick={() => handleApplyTerminologyPreset(preset.value)}
                  type="button"
                >
                  <strong>{preset.label}</strong>
                  <span>{preset.hint}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </section>

      {error ? (
        <p className="form-error workspace-error" role="alert">
          <span>{error}</span>
          <button
            className="dismiss-button"
            type="button"
            onClick={() => setError("")}
            aria-label="关闭提示"
          >
            ×
          </button>
        </p>
      ) : null}
      {notice ? <p className="workspace-notice">{notice}</p> : null}
    </div>
  );
}
