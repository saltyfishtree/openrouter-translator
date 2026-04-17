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
  const canSubmit =
    !submitting && usernameValid && passwordValid && inviteValid;

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
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "注册失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit} noValidate>
      <div className="auth-copy">
        <span className="eyebrow">Invite Only</span>
        <h1>注册账号</h1>
        <p>邀请码为一次性消耗，注册成功后自动登录。若无邀请码请联系管理员获取。</p>
      </div>

      <label className="field">
        <span>用户名</span>
        <input
          autoComplete="username"
          placeholder="3-20 位，支持字母数字下划线横线"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoFocus
          required
        />
        {username && !usernameValid ? (
          <small className="field-hint error">
            用户名需为 3-20 位字母、数字、下划线或横线。
          </small>
        ) : null}
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
          autoComplete="new-password"
          placeholder="至少 8 位"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={8}
          required
        />
        {password && !passwordValid ? (
          <small className="field-hint error">密码至少 8 位。</small>
        ) : null}
      </label>

      <label className="field">
        <span>邀请码</span>
        <input
          placeholder="请输入管理员下发的邀请码"
          value={inviteCode}
          onChange={(event) => setInviteCode(event.target.value)}
          required
        />
      </label>

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button" type="submit" disabled={!canSubmit}>
        {submitting ? "注册中..." : "注册并进入"}
      </button>

      <p className="form-footer">
        已有账号？<Link href="/login">去登录</Link>
      </p>
    </form>
  );
}
