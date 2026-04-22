"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { register } from "@/lib/api";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,20}$/;

export function RegisterForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const usernameValid = USERNAME_PATTERN.test(username.trim());
  const passwordValid = password.length >= 8;
  const inviteValid = inviteCode.trim().length > 0;
  const canSubmit = !submitting && usernameValid && passwordValid && inviteValid;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      await register({
        username: username.trim(),
        password,
        inviteCode: inviteCode.trim(),
      });
      router.replace("/workspace");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit} noValidate>
      <div className="auth-head">
        <h1>注册</h1>
      </div>

      <label className="field">
        <span className="field-label">用户名</span>
        <input
          className="input"
          autoComplete="username"
          placeholder="3-20 位字母数字_-"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          required
        />
        {username && !usernameValid ? (
          <small className="field-error">格式:3-20 位字母、数字、下划线或横线。</small>
        ) : null}
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
          autoComplete="new-password"
          placeholder="至少 8 位"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        {password && !passwordValid ? (
          <small className="field-error">至少 8 位。</small>
        ) : null}
      </label>

      <label className="field">
        <span className="field-label">邀请码</span>
        <input
          className="input"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          required
        />
      </label>

      {error ? <p className="error-banner">{error}</p> : null}

      <button className="btn btn-primary btn-block" type="submit" disabled={!canSubmit}>
        {submitting ? "注册中…" : "注册"}
      </button>

      <p className="auth-footer">
        已有账号?<Link href="/login">登录</Link>
      </p>
    </form>
  );
}
