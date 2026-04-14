"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { login } from "@/lib/api";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await login({ username, password });
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
    <form className="auth-card" onSubmit={handleSubmit}>
      <div className="auth-copy">
        <span className="eyebrow">Welcome Back</span>
        <h1>登录翻译台</h1>
        <p>用户名密码仅经由 Python 后端处理，密码只会以安全哈希形式存储。</p>
      </div>

      <label className="field">
        <span>用户名</span>
        <input
          autoComplete="username"
          placeholder="例如 zjx"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
      </label>

      <label className="field">
        <span>密码</span>
        <input
          type="password"
          autoComplete="current-password"
          placeholder="至少 8 位"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button" type="submit" disabled={submitting}>
        {submitting ? "登录中..." : "登录"}
      </button>

      <p className="form-footer">
        没有账号？<Link href="/register">去注册</Link>
      </p>
    </form>
  );
}
