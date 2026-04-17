export type CurrentUser = {
  username: string;
};

export type TranslationThread = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  lastPreview: string;
  messageCount: number;
};

export type TranslationMessage = {
  id: string;
  threadId: string;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationStyle: string;
  sourceText: string;
  translatedText: string;
  createdAt: string;
};

async function parseError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function requestCurrentUser() {
  const response = await fetch("/api/auth/me", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await parseError(response, "获取登录状态失败。"));
  }

  return (await response.json()) as CurrentUser;
}

export async function login(payload: { username: string; password: string }) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "登录失败。"));
  }
}

export async function register(payload: {
  username: string;
  password: string;
  inviteCode: string;
}) {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "注册失败。"));
  }
}

export async function logout() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "退出登录失败。"));
  }
}

export async function requestTranslationThreads() {
  const response = await fetch("/api/translations/threads", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "加载翻译历史失败。"));
  }

  return (await response.json()) as TranslationThread[];
}

export async function requestTranslationMessages(threadId: string) {
  const response = await fetch(`/api/translations/threads/${threadId}/messages`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "加载会话详情失败。"));
  }

  return (await response.json()) as TranslationMessage[];
}

export async function translateStream(
  payload: {
    model: string;
    sourceLanguage: string;
    targetLanguage: string;
    translationStyle: string;
    sourceText: string;
    threadId?: string | null;
    contextDepth?: number;
  },
  signal?: AbortSignal,
) {
  const response = await fetch("/api/translate", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "翻译失败，请稍后再试。"));
  }

  return {
    response,
    threadId: response.headers.get("X-Thread-Id"),
  };
}

export async function searchTranslationThreads(q: string) {
  const params = new URLSearchParams({ q });
  const response = await fetch(`/api/translations/threads?${params}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "搜索历史失败。"));
  }

  return (await response.json()) as TranslationThread[];
}

export async function deleteTranslationThread(threadId: string) {
  const response = await fetch(`/api/translations/threads/${threadId}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "删除会话失败。"));
  }
}

export async function renameTranslationThread(threadId: string, title: string) {
  const response = await fetch(`/api/translations/threads/${threadId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "重命名失败。"));
  }

  return (await response.json()) as TranslationThread;
}
