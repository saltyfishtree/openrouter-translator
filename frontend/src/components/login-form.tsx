"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { login } from "@/lib/api";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const canSubmit =
    !submitting && username.trim().length > 0 && password.length >= 8;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");

    try {
      await login({ username: username.trim(), password });
      router.replace("/workspace");
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "登录失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit} noValidate>
      <div className="auth-copy">
        <span className="eyebrow">Sign In</span>
        <h1>回到你的工作台</h1>
        <p>继续处理翻译、润色和芯片文档问答。历史记录、上下文和个人术语偏好都会自动恢复。</p>
      </div>

      <label className="field">
        <span>用户名</span>
        <input
          autoComplete="username"
          placeholder="例如 zjx"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoFocus
          required
        />
      </label>

      <label className="field">
        <span className="field-header">
          密码
          <button
            type="button"
            className="text-button tiny"
            onClick={() => setShowPassword((value) => !value)}
            tabIndex={-1}
          >
            {showPassword ? "隐藏" : "显示"}
          </button>
        </span>
        <input
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          placeholder="至少 8 位"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={8}
          required
        />
      </label>

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button" type="submit" disabled={!canSubmit}>
        {submitting ? "登录中..." : "继续"}
      </button>

      <div className="auth-note">
        <strong>安全说明</strong>
        <span>密码仅由后端处理并以安全哈希保存，浏览器不会直接接触模型密钥。</span>
      </div>

      <p className="form-footer">
        没有账号？<Link href="/register">去注册</Link>
      </p>
    </form>
  );
}
