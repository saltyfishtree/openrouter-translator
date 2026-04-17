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
  translationStyles,
} from "@/lib/constants";

const MAX_SOURCE_CHARS = 12000;
const PREFS_STORAGE_KEY = "translator:prefs:v1";
const DRAFT_STORAGE_KEY = "translator:draft:v1";

type Prefs = {
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationStyle: string;
};

function loadPrefs(): Prefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Prefs;
  } catch {
    return null;
  }
}

function savePrefs(prefs: Prefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
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

export function WorkspaceClient() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [threads, setThreads] = useState<TranslationThread[]>([]);
  const [messages, setMessages] = useState<TranslationMessage[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [model, setModel] = useState<string>(modelOptions[0].value);
  const [sourceLanguage, setSourceLanguage] = useState<string>(
    languageOptions[0].value,
  );
  const [targetLanguage, setTargetLanguage] = useState<string>(
    languageOptions[1].value,
  );
  const [translationStyle, setTranslationStyle] = useState<string>(
    translationStyles[0].value,
  );
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

  const overLimit = sourceText.length > MAX_SOURCE_CHARS;
  const sameLanguage =
    sourceLanguage !== "auto" && sourceLanguage === targetLanguage;

  useEffect(() => {
    const prefs = loadPrefs();
    if (prefs) {
      if (modelOptions.some((m) => m.value === prefs.model)) setModel(prefs.model);
      if (languageOptions.some((l) => l.value === prefs.sourceLanguage))
        setSourceLanguage(prefs.sourceLanguage);
      if (
        languageOptions.some(
          (l) => l.value === prefs.targetLanguage && l.value !== "auto",
        )
      )
        setTargetLanguage(prefs.targetLanguage);
      if (translationStyles.some((s) => s.value === prefs.translationStyle))
        setTranslationStyle(prefs.translationStyle);
    }
    try {
      const draft = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (draft) setSourceText(draft);
    } catch {}
  }, []);

  useEffect(() => {
    savePrefs({ model, sourceLanguage, targetLanguage, translationStyle });
  }, [model, sourceLanguage, targetLanguage, translationStyle]);

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
      setError("请输入需要翻译的内容。");
      return;
    }
    if (overLimit) {
      setError(`原文长度超过 ${MAX_SOURCE_CHARS} 字符上限，请分段翻译。`);
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
          sourceLanguage,
          targetLanguage,
          translationStyle,
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
        setNotice("已停止当前翻译。");
      } else {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "翻译服务不可用，请稍后再试。",
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
    setNotice("已新建空白会话。");
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
    setNotice("已载入历史记录为草稿。");
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

  if (checkingAuth) {
    return (
      <section className="auth-card">
        <span className="eyebrow">Authenticating</span>
        <h1>正在加载工作台</h1>
        <p>系统会先校验会话，再加载翻译历史与上下文。</p>
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
    <div className="workspace-shell history-ready">
      <section className="hero-card">
        <div>
          <span className="eyebrow">Python API + TypeScript UI</span>
          <h1>支持上下文的流式翻译工作台</h1>
          <p>
            当前登录用户 <strong>{user?.username ?? "-"}</strong>
            。历史会话与原文/译文都会持久化，同一会话可以携带上下文持续翻译。
            <span className="hint"> 快捷键：⌘/Ctrl + Enter 发起翻译。</span>
          </p>
        </div>
        <div className="hero-actions">
          <button className="ghost-button" onClick={handleNewThread} type="button">
            新建会话
          </button>
          <button className="ghost-button" onClick={handleLogout} type="button">
            退出登录
          </button>
        </div>
      </section>

      <section className="workspace-layout">
        <aside className="history-panel">
          <div className="history-header">
            <h2>翻译历史</h2>
            <span>{threads.length} 条会话</span>
          </div>
          <div className="history-list">
            {threads.length === 0 ? (
              <p className="placeholder">还没有历史，先翻译一段内容吧。</p>
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
        </aside>

        <div className="main-panel-stack">
          <section className="control-grid">
            <label className="field">
              <span>翻译模型</span>
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
                disabled={streaming}
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
                目标语言
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
              </span>
              <select
                value={targetLanguage}
                onChange={(event) => setTargetLanguage(event.target.value)}
                disabled={streaming}
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
              <span>翻译风格</span>
              <select
                value={translationStyle}
                onChange={(event) => setTranslationStyle(event.target.value)}
                disabled={streaming}
              >
                {translationStyles.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {sameLanguage ? (
            <p className="inline-warning">
              原文与目标语言相同，翻译会失去意义，请调整语言选项。
            </p>
          ) : null}

          <section className="editor-grid">
            <article className="panel">
              <div className="panel-header">
                <h2>原文</h2>
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
                className="editor"
                placeholder="输入需要翻译的文本，⌘/Ctrl + Enter 发起翻译..."
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                onKeyDown={handleEditorKeyDown}
                aria-label="原文输入"
              />
              <div className="button-row">
                <button
                  className="primary-button"
                  onClick={handleTranslate}
                  type="button"
                  disabled={translateDisabled}
                >
                  {streaming ? "翻译中..." : "开始翻译"}
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

            <article className="panel">
              <div className="panel-header">
                <h2>译文</h2>
                <button
                  className="text-button"
                  onClick={handleCopy}
                  type="button"
                  disabled={!resultText}
                >
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
              <div className="result-box" ref={resultRef} aria-live="polite">
                {resultText ? (
                  <>
                    {resultText}
                    {streaming ? <span className="caret" aria-hidden="true" /> : null}
                  </>
                ) : (
                  <span className="placeholder">
                    {streaming
                      ? "正在请求模型..."
                      : "译文会在这里按流式实时出现。"}
                  </span>
                )}
              </div>
              {activeThread ? (
                <p className="thread-indicator">
                  当前会话：{activeThread.title}
                </p>
              ) : (
                <p className="thread-indicator">
                  当前会话：新会话（首次翻译后自动创建）
                </p>
              )}
            </article>
          </section>

          <section className="timeline-panel">
            <div className="timeline-header">
              <h2>上下文消息</h2>
              <span>{messages.length} 条</span>
            </div>
            {loadingMessages ? (
              <p className="placeholder">正在加载会话内容...</p>
            ) : messages.length === 0 ? (
              <p className="placeholder">
                当前会话还没有消息，完成一次翻译后会自动保存。
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
                        <b>原文：</b>
                        {message.sourceText}
                      </p>
                      <p>
                        <b>译文：</b>
                        {message.translatedText}
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => handleUseMessage(message)}
                      type="button"
                    >
                      使用这条作为草稿
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
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
