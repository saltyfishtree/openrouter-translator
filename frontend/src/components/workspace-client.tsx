"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { logout, requestCurrentUser, type CurrentUser } from "@/lib/api";
import {
  languageOptions,
  modelOptions,
  translationStyles,
} from "@/lib/constants";

export function WorkspaceClient() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
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

  useEffect(() => {
    let active = true;

    async function loadUser() {
      try {
        const currentUser = await requestCurrentUser();

        if (!currentUser) {
          router.replace("/login");
          return;
        }

        if (active) {
          setUser(currentUser);
        }
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "获取登录状态失败。",
          );
        }
      } finally {
        if (active) {
          setCheckingAuth(false);
        }
      }
    }

    void loadUser();

    return () => {
      active = false;
    };
  }, [router]);

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
      const response = await fetch("/api/translate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          sourceLanguage,
          targetLanguage,
          translationStyle,
          sourceText,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? "翻译失败，请稍后再试。");
        return;
      }

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
    } catch {
      setError("翻译服务不可用，请稍后再试。");
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

  if (checkingAuth) {
    return (
      <section className="auth-card">
        <span className="eyebrow">Authenticating</span>
        <h1>正在加载工作台</h1>
        <p>系统会先校验服务端会话，再显示翻译功能。</p>
      </section>
    );
  }

  return (
    <div className="workspace-shell">
      <section className="hero-card">
        <div>
          <span className="eyebrow">Python API + TypeScript UI</span>
          <h1>流式翻译工作台</h1>
          <p>
            当前登录用户 <strong>{user?.username ?? "-"}</strong>。请求会从前端发到
            Python 后端，再由后端安全代理 OpenRouter。
          </p>
        </div>
        <button className="ghost-button" onClick={handleLogout} type="button">
          退出登录
        </button>
      </section>

      <section className="control-grid">
        <label className="field">
          <span>翻译模型</span>
          <select value={model} onChange={(event) => setModel(event.target.value)}>
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
        </article>
      </section>

      {error ? <p className="form-error workspace-error">{error}</p> : null}
    </div>
  );
}
