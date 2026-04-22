"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  deleteTranslationThread,
  logout,
  renameTranslationThread,
  requestCurrentUser,
  requestGlossary,
  requestTranslationMessages,
  requestTranslationThreads,
  translateStream,
  updateGlossaryTerm,
  type CurrentUser,
  type GlossaryTerm,
  type TranslationMessage,
  type TranslationThread,
} from "@/lib/api";
import {
  languageOptions,
  modelOptions,
  taskModeOptions,
  translationStyles,
} from "@/lib/constants";

const MAX_SOURCE_CHARS = 12000;
const PREFS_KEY = "tx:prefs:v4";
const DRAFT_KEY = "tx:draft:v3";

type TaskMode = "translate" | "polish" | "ask";

type Prefs = {
  taskMode: TaskMode;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationStyle: string;
};

type DrawerView = null | "history" | "glossary" | "messages";

function prefsKey(username: string) {
  return `${PREFS_KEY}:${username.toLowerCase()}`;
}

function loadPrefs(username: string): Partial<Prefs> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(prefsKey(username));
    return raw ? (JSON.parse(raw) as Prefs) : null;
  } catch {
    return null;
  }
}

function savePrefs(username: string, prefs: Prefs) {
  try {
    window.localStorage.setItem(prefsKey(username), JSON.stringify(prefs));
  } catch {}
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function modeDefaults(mode: TaskMode) {
  if (mode === "polish") {
    return {
      sourceLanguage: "English",
      targetLanguage: "English",
      translationStyle: "natural",
    };
  }
  return {
    sourceLanguage: "auto",
    targetLanguage: "Chinese (Simplified)",
    translationStyle: "natural",
  };
}

function actionLabel(mode: TaskMode) {
  if (mode === "polish") return "润色";
  if (mode === "ask") return "提问";
  return "翻译";
}

function inputPlaceholder(mode: TaskMode) {
  if (mode === "polish") return "粘贴英文草稿…";
  if (mode === "ask") return "输入问题…";
  return "粘贴或输入原文…";
}

export function WorkspaceClient() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [booting, setBooting] = useState(true);

  const [threads, setThreads] = useState<TranslationThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TranslationMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [glossary, setGlossary] = useState<GlossaryTerm[]>([]);

  const [taskMode, setTaskMode] = useState<TaskMode>("translate");
  const [model, setModel] = useState<string>(modelOptions[1].value);
  const [sourceLanguage, setSourceLanguage] = useState<string>("auto");
  const [targetLanguage, setTargetLanguage] = useState<string>("Chinese (Simplified)");
  const [translationStyle, setTranslationStyle] = useState<string>("natural");

  const [sourceText, setSourceText] = useState("");
  const [resultText, setResultText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);

  const [drawer, setDrawer] = useState<DrawerView>(null);

  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [activeThreadId, threads],
  );
  const overLimit = sourceText.length > MAX_SOURCE_CHARS;
  const sameLanguage =
    taskMode === "translate" &&
    sourceLanguage !== "auto" &&
    sourceLanguage === targetLanguage;

  // Restore draft
  useEffect(() => {
    try {
      const draft = window.localStorage.getItem(DRAFT_KEY);
      if (draft) setSourceText(draft);
    } catch {}
  }, []);

  // Persist draft
  useEffect(() => {
    try {
      if (sourceText) window.localStorage.setItem(DRAFT_KEY, sourceText);
      else window.localStorage.removeItem(DRAFT_KEY);
    } catch {}
  }, [sourceText]);

  // Persist prefs
  useEffect(() => {
    if (!user?.username) return;
    savePrefs(user.username, {
      taskMode,
      model,
      sourceLanguage,
      targetLanguage,
      translationStyle,
    });
  }, [user, taskMode, model, sourceLanguage, targetLanguage, translationStyle]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [resultText]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  // Bootstrap
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const current = await requestCurrentUser();
        if (!current) {
          router.replace("/login");
          return;
        }
        if (!active) return;
        setUser(current);

        const prefs = loadPrefs(current.username);
        if (prefs) {
          if (prefs.taskMode) setTaskMode(prefs.taskMode);
          if (prefs.model && modelOptions.some((m) => m.value === prefs.model)) {
            setModel(prefs.model);
          }
          if (
            prefs.sourceLanguage &&
            languageOptions.some((l) => l.value === prefs.sourceLanguage)
          ) {
            setSourceLanguage(prefs.sourceLanguage);
          }
          if (
            prefs.targetLanguage &&
            languageOptions.some(
              (l) => l.value === prefs.targetLanguage && l.value !== "auto",
            )
          ) {
            setTargetLanguage(prefs.targetLanguage);
          }
          if (
            prefs.translationStyle &&
            translationStyles.some((s) => s.value === prefs.translationStyle)
          ) {
            setTranslationStyle(prefs.translationStyle);
          }
        }

        const [hist, terms] = await Promise.all([
          requestTranslationThreads(),
          requestGlossary().catch(() => [] as GlossaryTerm[]),
        ]);
        if (!active) return;
        setThreads(hist);
        setGlossary(terms);
        if (hist.length > 0) setActiveThreadId(hist[0].id);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "初始化失败。");
        }
      } finally {
        if (active) setBooting(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  // Load messages on thread change
  useEffect(() => {
    let active = true;
    (async () => {
      if (!activeThreadId) {
        setMessages([]);
        return;
      }
      setLoadingMessages(true);
      try {
        const msgs = await requestTranslationMessages(activeThreadId);
        if (active) setMessages(msgs);
      } catch {
        // ignore
      } finally {
        if (active) setLoadingMessages(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [activeThreadId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleTranslate = useCallback(async () => {
    const trimmed = sourceText.trim();
    if (!trimmed) {
      setError("请先输入内容。");
      return;
    }
    if (overLimit) {
      setError(`超过 ${MAX_SOURCE_CHARS} 字符上限。`);
      return;
    }
    if (sameLanguage) {
      setError("翻译模式下请选择不同的语言。");
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
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setResultText(full);
      }

      const nextId = threadId ?? activeThreadId;
      try {
        const nextThreads = await requestTranslationThreads();
        setThreads(nextThreads);
        if (nextId) {
          setActiveThreadId(nextId);
          const nextMsgs = await requestTranslationMessages(nextId);
          setMessages(nextMsgs);
        }
        // refresh glossary usage counts
        const nextTerms = await requestGlossary().catch(() => null);
        if (nextTerms) setGlossary(nextTerms);
      } catch {}
    } catch (err) {
      if (controller.signal.aborted) {
        setToast("已停止。");
      } else {
        setError(err instanceof Error ? err.message : "服务暂不可用。");
      }
    } finally {
      setStreaming(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [
    activeThreadId,
    model,
    overLimit,
    sameLanguage,
    sourceLanguage,
    sourceText,
    streaming,
    targetLanguage,
    taskMode,
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
      setError("复制失败。");
    }
  }

  function handleNewThread() {
    abortRef.current?.abort();
    setActiveThreadId(null);
    setMessages([]);
    setSourceText("");
    setResultText("");
    setError("");
    setToast("新会话");
  }

  function handleSwapLanguages() {
    if (sourceLanguage === "auto") {
      setToast("自动识别无法互换");
      return;
    }
    const s = targetLanguage;
    const t = sourceLanguage;
    setSourceLanguage(s);
    setTargetLanguage(t);
    if (sourceText && resultText) {
      setSourceText(resultText);
      setResultText(sourceText);
    }
  }

  function handleModeChange(next: TaskMode) {
    if (streaming) return;
    setTaskMode(next);
    const d = modeDefaults(next);
    setSourceLanguage(d.sourceLanguage);
    setTargetLanguage(d.targetLanguage);
    setTranslationStyle(d.translationStyle);
  }

  function handleEditorKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleTranslate();
    }
  }

  async function handleDeleteThread(id: string) {
    if (!window.confirm("删除这个会话？")) return;
    try {
      await deleteTranslationThread(id);
      const next = threads.filter((t) => t.id !== id);
      setThreads(next);
      if (activeThreadId === id) {
        setActiveThreadId(next[0]?.id ?? null);
        setMessages([]);
      }
      setToast("已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败。");
    }
  }

  async function handleRenameThread(id: string, currentTitle: string) {
    const next = window.prompt("新的标题", currentTitle);
    if (!next || !next.trim() || next.trim() === currentTitle) return;
    try {
      const updated = await renameTranslationThread(id, next.trim());
      setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)));
      setToast("已重命名");
    } catch (err) {
      setError(err instanceof Error ? err.message : "重命名失败。");
    }
  }

  async function handleAddTerm(sourceTerm: string, targetTerm: string, note: string) {
    try {
      const created = await createGlossaryTerm({
        sourceTerm: sourceTerm.trim(),
        targetTerm: targetTerm.trim(),
        note: note.trim(),
      });
      setGlossary((prev) => {
        const rest = prev.filter((t) => t.id !== created.id);
        return [created, ...rest];
      });
      setToast("已加入术语本");
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增失败。");
    }
  }

  async function handleDeleteTerm(id: string) {
    try {
      await deleteGlossaryTerm(id);
      setGlossary((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败。");
    }
  }

  async function handleEditTerm(term: GlossaryTerm) {
    const src = window.prompt("原文术语", term.sourceTerm);
    if (src === null) return;
    const tgt = window.prompt("译文术语", term.targetTerm);
    if (tgt === null) return;
    const note = window.prompt("备注（可选）", term.note) ?? "";
    try {
      const updated = await updateGlossaryTerm(term.id, {
        sourceTerm: src.trim() || term.sourceTerm,
        targetTerm: tgt.trim() || term.targetTerm,
        note: note.trim(),
      });
      setGlossary((prev) => prev.map((t) => (t.id === term.id ? updated : t)));
      setToast("已更新");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失败。");
    }
  }

  if (booting) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-head">
            <h1>载入中…</h1>
          </div>
        </div>
      </div>
    );
  }

  const charCountClass = overLimit
    ? "char-count over"
    : sourceText.length > MAX_SOURCE_CHARS * 0.85
      ? "char-count warn"
      : "char-count";

  const translateDisabled = streaming || !sourceText.trim() || overLimit || sameLanguage;

  return (
    <div className="ws">
      <header className="ws-header">
        <div className="ws-brand">Translator</div>

        <div className="mode-pills" role="tablist">
          {taskModeOptions.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={taskMode === item.value}
              className={`mode-pill ${taskMode === item.value ? "active" : ""}`}
              onClick={() => handleModeChange(item.value)}
              disabled={streaming}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="ws-header-spacer" />

        <div className="ws-header-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setDrawer("history")}
            aria-label="历史"
            title="历史"
          >
            <HistoryIcon />
            {threads.length > 0 ? (
              <span className="icon-btn-badge">{threads.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setDrawer("glossary")}
            aria-label="术语本"
            title="术语本"
          >
            <BookIcon />
            {glossary.length > 0 ? (
              <span className="icon-btn-badge">{glossary.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={handleNewThread}
            aria-label="新会话"
            title="新会话"
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={handleLogout}
            aria-label="退出"
            title={user?.username ?? ""}
          >
            <LogoutIcon />
          </button>
        </div>
      </header>

      <main className="ws-main">
        <div className="ws-toolbar">
          <select
            className="select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={streaming}
            aria-label="模型"
          >
            {modelOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          {taskMode !== "polish" ? (
            <>
              <select
                className="select"
                value={sourceLanguage}
                onChange={(e) => setSourceLanguage(e.target.value)}
                disabled={streaming}
                aria-label="原文语言"
              >
                {languageOptions.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>

              {taskMode === "translate" ? (
                <button
                  type="button"
                  className="swap-btn"
                  onClick={handleSwapLanguages}
                  disabled={streaming || sourceLanguage === "auto"}
                  aria-label="互换语言"
                  title="互换"
                >
                  ⇄
                </button>
              ) : null}

              <select
                className="select"
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value)}
                disabled={streaming}
                aria-label="目标语言"
              >
                {languageOptions
                  .filter((l) => l.value !== "auto")
                  .map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
              </select>
            </>
          ) : null}

          {taskMode === "translate" ? (
            <select
              className="select"
              value={translationStyle}
              onChange={(e) => setTranslationStyle(e.target.value)}
              disabled={streaming}
              aria-label="风格"
            >
              {translationStyles.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {error ? (
          <p className="error-banner" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="link-btn"
              onClick={() => setError("")}
              aria-label="关闭"
            >
              ×
            </button>
          </p>
        ) : null}

        <div className="ws-panels">
          <section className="panel">
            <div className="panel-head">
              <strong>{taskMode === "ask" ? "问题" : "输入"}</strong>
              <span className={charCountClass}>
                {sourceText.length.toLocaleString()} /{" "}
                {MAX_SOURCE_CHARS.toLocaleString()}
              </span>
            </div>
            <div className="panel-body input-body">
              <textarea
                className="input-editor"
                placeholder={inputPlaceholder(taskMode)}
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                onKeyDown={handleEditorKey}
                aria-label="输入"
              />
            </div>
            <div className="panel-foot primary">
              <span className="thread-hint">
                {activeThread ? activeThread.title : "新会话"}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                {streaming ? (
                  <button type="button" className="btn btn-ghost" onClick={handleStop}>
                    停止
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleTranslate}
                  disabled={translateDisabled}
                >
                  {streaming ? "处理中…" : `${actionLabel(taskMode)}  ⌘↵`}
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <strong>{taskMode === "ask" ? "回答" : "输出"}</strong>
              <div className="panel-head-actions">
                {resultText && taskMode === "translate" ? (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setDrawer("glossary")}
                    title="把术语加入术语本"
                  >
                    + 术语
                  </button>
                ) : null}
                <button
                  type="button"
                  className="link-btn"
                  onClick={handleCopy}
                  disabled={!resultText}
                >
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
            </div>
            <div className="panel-body output-box" ref={outputRef} aria-live="polite">
              {resultText ? (
                <>
                  {resultText}
                  {streaming ? <span className="caret" aria-hidden="true" /> : null}
                </>
              ) : (
                <span className="placeholder">
                  {streaming ? "正在请求模型…" : "输出将在这里实时显示。"}
                </span>
              )}
            </div>
            <div className="panel-foot">
              <span>{messages.length > 0 ? `${messages.length} 条历史` : "—"}</span>
              {messages.length > 0 ? (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setDrawer("messages")}
                >
                  查看上下文
                </button>
              ) : null}
            </div>
          </section>
        </div>
      </main>

      {drawer ? (
        <>
          <div
            className="drawer-backdrop"
            onClick={() => setDrawer(null)}
            aria-hidden="true"
          />
          <aside className="drawer" role="dialog" aria-modal="true">
            <div className="drawer-grabber" aria-hidden="true" />
            <div className="drawer-head">
              <h2>
                {drawer === "history"
                  ? "历史会话"
                  : drawer === "glossary"
                    ? "术语本"
                    : "当前会话上下文"}
              </h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setDrawer(null)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="drawer-body">
              {drawer === "history" ? (
                <ThreadList
                  threads={threads}
                  activeId={activeThreadId}
                  onSelect={(id) => {
                    setActiveThreadId(id);
                    setDrawer(null);
                  }}
                  onRename={handleRenameThread}
                  onDelete={handleDeleteThread}
                />
              ) : drawer === "glossary" ? (
                <GlossaryView
                  terms={glossary}
                  onAdd={handleAddTerm}
                  onEdit={handleEditTerm}
                  onDelete={handleDeleteTerm}
                />
              ) : (
                <MessageList messages={messages} loading={loadingMessages} />
              )}
            </div>
          </aside>
        </>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function ThreadList({
  threads,
  activeId,
  onSelect,
  onRename,
  onDelete,
}: {
  threads: TranslationThread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  if (threads.length === 0) {
    return <p className="list-empty">还没有历史</p>;
  }
  return (
    <>
      {threads.map((t) => (
        <div key={t.id} className={`thread-row ${activeId === t.id ? "active" : ""}`}>
          <button
            type="button"
            onClick={() => onSelect(t.id)}
            style={{
              textAlign: "left",
              display: "grid",
              gap: 4,
              background: "transparent",
            }}
          >
            <strong>{t.title}</strong>
            {t.lastPreview ? (
              <small style={{ color: "var(--muted)" }}>{t.lastPreview}</small>
            ) : null}
            <small>
              {t.messageCount} 条 · {formatTime(t.updated_at)}
            </small>
          </button>
          <div className="thread-row-actions">
            <button
              type="button"
              className="link-btn"
              onClick={() => onRename(t.id, t.title)}
            >
              重命名
            </button>
            <button
              type="button"
              className="link-btn"
              style={{ color: "var(--danger)" }}
              onClick={() => onDelete(t.id)}
            >
              删除
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

function MessageList({
  messages,
  loading,
}: {
  messages: TranslationMessage[];
  loading: boolean;
}) {
  if (loading) return <p className="list-empty">加载中…</p>;
  if (messages.length === 0) return <p className="list-empty">暂无上下文</p>;
  return (
    <>
      {messages.map((m) => (
        <article key={m.id} className="msg-item">
          <header>
            <span>{formatTime(m.createdAt)}</span>
            <span>{m.model.split("/")[1] ?? m.model}</span>
          </header>
          <p className="source">{m.sourceText}</p>
          <p>{m.translatedText}</p>
        </article>
      ))}
    </>
  );
}

function GlossaryView({
  terms,
  onAdd,
  onEdit,
  onDelete,
}: {
  terms: GlossaryTerm[];
  onAdd: (source: string, target: string, note: string) => void;
  onEdit: (term: GlossaryTerm) => void;
  onDelete: (id: string) => void;
}) {
  const [src, setSrc] = useState("");
  const [tgt, setTgt] = useState("");
  const [note, setNote] = useState("");

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!src.trim() || !tgt.trim()) return;
    onAdd(src, tgt, note);
    setSrc("");
    setTgt("");
    setNote("");
  }

  return (
    <>
      <form className="glossary-form" onSubmit={submit}>
        <div className="glossary-form-row">
          <input
            className="input"
            placeholder="原文术语"
            value={src}
            onChange={(e) => setSrc(e.target.value)}
          />
          <input
            className="input"
            placeholder="译文 / 首选表达"
            value={tgt}
            onChange={(e) => setTgt(e.target.value)}
          />
        </div>
        <input
          className="input"
          placeholder="备注（可选）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-block" disabled={!src.trim() || !tgt.trim()}>
          加入术语本
        </button>
      </form>

      {terms.length === 0 ? (
        <p className="list-empty">还没有术语。加几条你常用的词,下次翻译会自动带上。</p>
      ) : (
        terms.map((t) => (
          <div key={t.id} className="glossary-item">
            <div className="glossary-item-body">
              <div className="glossary-item-terms">
                <span>{t.sourceTerm}</span>
                <span className="sep">→</span>
                <span>{t.targetTerm}</span>
              </div>
              {t.note ? <div className="glossary-item-meta">{t.note}</div> : null}
              <div className="glossary-item-meta">
                用过 {t.usageCount} 次
                {t.lastUsedAt ? ` · ${formatTime(t.lastUsedAt)}` : ""}
              </div>
            </div>
            <div className="glossary-item-actions">
              <button type="button" className="link-btn" onClick={() => onEdit(t)}>
                编辑
              </button>
              <button
                type="button"
                className="link-btn"
                style={{ color: "var(--danger)" }}
                onClick={() => onDelete(t.id)}
              >
                删除
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );
}

/* --------- Icons --------- */

function HistoryIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4z" />
      <path d="M4 16a4 4 0 0 1 4-4h10" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 17l5-5-5-5" />
      <path d="M20 12H9" />
      <path d="M13 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}
