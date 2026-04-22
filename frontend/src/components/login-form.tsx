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
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit} noValidate>
      <div className="auth-head">
        <h1>登录</h1>
      </div>

      <label className="field">
        <span className="field-label">用户名</span>
        <input
          className="input"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          required
        />
      </label>

      <label className="field">
        <span className="field-label">
          密码
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={-1}
          >
            {showPassword ? "隐藏" : "显示"}
          </button>
        </span>
        <input
          className="input"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
      </label>

      {error ? <p className="error-banner">{error}</p> : null}

      <button className="btn btn-primary btn-block" type="submit" disabled={!canSubmit}>
        {submitting ? "登录中…" : "登录"}
      </button>

      <p className="auth-footer">
        没有账号？<Link href="/register">注册</Link>
      </p>
    </form>
  );
}
