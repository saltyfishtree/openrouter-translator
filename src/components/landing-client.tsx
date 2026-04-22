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
      <section className="auth-card product-card">
        <div className="auth-copy">
          <span className="eyebrow">Translator Workspace</span>
          <h1>面向文档工程师的 AI 工作台</h1>
          <p>翻译、润色、问答，在同一套工作流里完成。</p>
        </div>

        <div className="product-points">
          <article className="product-point">
            <strong>长文翻译</strong>
            <span>面向技术文档</span>
          </article>
          <article className="product-point">
            <strong>术语统一</strong>
            <span>保留固定词法</span>
          </article>
          <article className="product-point">
            <strong>流式输出</strong>
            <span>结果实时返回</span>
          </article>
        </div>

        <div className="stack-actions">
          <Link className="primary-button button-link" href="/login">
            进入工作台
          </Link>
          <Link className="ghost-button button-link" href="/register">
            注册新账号
          </Link>
        </div>
      </section>
    </main>
  );
}
