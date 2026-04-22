"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { requestCurrentUser } from "@/lib/api";

export function LandingClient() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const user = await requestCurrentUser();
        if (!active) return;
        router.replace(user ? "/workspace" : "/login");
      } catch {
        if (active) router.replace("/login");
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-head">
          <h1>Translator</h1>
          <p>正在进入…</p>
        </div>
      </div>
    </div>
  );
}
