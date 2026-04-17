"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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
  const [copied, setCopied] = useState(false);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads],
  );

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const currentUser = await requestCurrentUser();
        if (!currentUser) {
          router.replace("/login");
          return;
        }
        if (!active) {
          return;
        }
        setUser(currentUser);

        const historyThreads = await requestTranslationThreads();
        if (!active) {
          return;
        }
        setThreads(historyThreads);
        if (historyThreads.length > 0) {
          setActiveThreadId(historyThreads[0].id);
        }
      } catch (requestError) {
        if (!active) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "初始化工作台失败，请刷新重试。",
        );
      } finally {
        if (active) {
          setCheckingAuth(false);
        }
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
        if (!active) {
          return;
        }
        setMessages(nextMessages);
      } catch (requestError) {
        if (!active) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "加载会话消息失败。",
        );
      } finally {
        if (active) {
          setLoadingMessages(false);
        }
      }
    }

    void loadMessages();

    return () => {
      active = false;
    };
  }, [activeThreadId]);

  async function refreshThreads(preferredThreadId?: string | null) {
    const nextThreads = await requestTranslationThreads();
    setThreads(nextThreads);

    if (preferredThreadId) {
      setActiveThreadId(preferredThreadId);
      return;
    }

    if (!activeThreadId && nextThreads.length > 0) {
      setActiveThreadId(nextThreads[0].id);
    }
  }

  async function handleTranslate() {
    if (!sourceText.trim()) {
      setError("请输入需要翻译的内容。");
      return;
    }

    setStreaming(true);
    setError("");
    setCopied(false);
    setResultText("");

    try {
      const { response, threadId } = await translateStream({
        model,
        sourceLanguage,
        targetLanguage,
        translationStyle,
        sourceText,
        threadId: activeThreadId,
        contextDepth: 8,
      });

      const reader = response.body?.getReader();
      if (!reader) {
        setError("当前环境不支持流式读取。");
        return;
      }

      const decoder = new TextDecoder();
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        fullText += decoder.decode(value, { stream: true });
        setResultText(fullText);
      }

      const nextThreadId = threadId ?? activeThreadId;
      await refreshThreads(nextThreadId);
      if (nextThreadId) {
        const nextMessages = await requestTranslationMessages(nextThreadId);
        setMessages(nextMessages);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "翻译服务不可用，请稍后再试。",
      );
    } finally {
      setStreaming(false);
    }
  }

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  async function handleCopy() {
    if (!resultText) {
      return;
    }
    await navigator.clipboard.writeText(resultText);
    setCopied(true);
  }

  function handleNewThread() {
    setActiveThreadId(null);
    setMessages([]);
    setSourceText("");
    setResultText("");
    setError("");
  }

  function handleUseMessage(message: TranslationMessage) {
    setModel(message.model);
    setSourceLanguage(message.sourceLanguage);
    setTargetLanguage(message.targetLanguage);
    setTranslationStyle(message.translationStyle);
    setSourceText(message.sourceText);
    setResultText(message.translatedText);
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

  return (
    <div className="workspace-shell history-ready">
      <section className="hero-card">
        <div>
          <span className="eyebrow">Python API + TypeScript UI</span>
          <h1>支持上下文的流式翻译工作台</h1>
          <p>
            当前登录用户 <strong>{user?.username ?? "-"}</strong>。历史会话与原文/译文
            都会持久化，可在同一会话里持续翻译并携带上下文。
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
              <span>目标语言</span>
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

          <section className="editor-grid">
            <article className="panel">
              <div className="panel-header">
                <h2>原文</h2>
                <span>{sourceText.length} chars</span>
              </div>
              <textarea
                className="editor"
                placeholder="输入需要翻译的文本..."
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
              />
              <button
                className="primary-button"
                onClick={handleTranslate}
                type="button"
                disabled={streaming}
              >
                {streaming ? "翻译中..." : "开始翻译"}
              </button>
            </article>

            <article className="panel">
              <div className="panel-header">
                <h2>译文</h2>
                <button className="text-button" onClick={handleCopy} type="button">
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
              <div className="result-box">
                {resultText || (
                  <span className="placeholder">译文会在这里按流式实时出现。</span>
                )}
              </div>
              {activeThread ? (
                <p className="thread-indicator">当前会话：{activeThread.title}</p>
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

      {error ? <p className="form-error workspace-error">{error}</p> : null}
    </div>
  );
}
