"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { requestCurrentUser } from "@/lib/api";

export function LandingClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const user = await requestCurrentUser();

        if (user && active) {
          router.replace("/workspace");
          return;
        }
      } catch {}

      if (active) {
        setLoading(false);
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [router]);

  if (loading) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <span className="eyebrow">Loading</span>
          <h1>正在检查登录状态</h1>
          <p>如果已经登录，会自动进入翻译工作台。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-copy">
          <span className="eyebrow">Open Source Translator</span>
          <h1>前端 TypeScript，后端 Python</h1>
          <p>
            使用 OpenRouter 做统一模型接入，支持流式翻译、邀请码注册、服务端会话和
            Supabase Postgres。
          </p>
        </div>

        <div className="stack-actions">
          <Link className="primary-button button-link" href="/login">
            去登录
          </Link>
          <Link className="ghost-button button-link" href="/register">
            去注册
          </Link>
        </div>
      </section>
    </main>
  );
}
