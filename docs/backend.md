# 后端 API 文档

> **技术栈**：Python 3.11+ · FastAPI · Supabase（存储） · OpenRouter

---

## 项目结构

```
backend/
└── app/
    ├── config.py      # 环境变量配置（pydantic-settings）
    ├── database.py    # Supabase Client 工厂
    ├── schemas.py     # Pydantic 请求/响应模型
    ├── security.py    # 密码哈希、Session token 生成
    ├── services.py    # 业务逻辑（Session 管理、邀请码同步）
    └── main.py        # FastAPI 应用 & 所有路由定义

api/
└── index.py           # Vercel Python Serverless 入口（重导出 app）
```

---

## 环境变量

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `SUPABASE_URL` | ✅ | Supabase 项目地址，例如 `https://PROJECT.supabase.co` |
| `SUPABASE_KEY` | ✅ | 服务端 Supabase key；也兼容 `SUPABASE_ANON_KEY` |
| `OPENROUTER_API_KEY` | ✅ | 从 [openrouter.ai/keys](https://openrouter.ai/keys) 获取 |
| `AUTH_SECRET` | ✅ | 至少 16 位随机字符串，用于 Session token HMAC 签名 |
| `DEFAULT_INVITE_CODES` | — | 逗号分隔，默认 `zjxai`，首次启动自动写入数据库 |
| `OPENROUTER_SITE_URL` | — | 应用基础 URL，默认 `http://localhost:3000` |
| `OPENROUTER_APP_NAME` | — | 显示在 OpenRouter 控制台，默认 `OpenRouter Translator` |

---

## 本地开发

```bash
# 1. 进入项目根目录
cd translator

# 2. 激活 Python 虚拟环境
source backend/.venv/bin/activate

# 3. 安装依赖（首次）
pip install -e "backend[dev]"

# 4. 复制并填写环境变量
cp .env.example .env  # 编辑 .env，填入真实值

# 5. 启动后端
SUPABASE_URL=https://your-project.supabase.co SUPABASE_KEY=your-key uvicorn backend.app.main:app --port 8000 --reload

# 6. 启动前端（新终端）
npm run dev
```

---

## API 接口

所有接口基础路径：`/api`（通过 Vercel rewrite 转发到 Python serverless）

### 认证

#### `GET /api/auth/me`
返回当前登录用户信息。

**响应 200：**
```json
{ "username": "alice" }
```

**响应 401：**
```json
{ "error": "请先登录。" }
```

---

#### `POST /api/auth/register`
注册新用户（需要邀请码）。

**请求体：**
```json
{
  "username": "alice",
  "password": "my-password",
  "inviteCode": "zjxai"
}
```

**规则：**
- 用户名：3-20 位字母/数字/下划线/横线，自动转小写
- 密码：至少 8 位
- 邀请码每人只能使用一次

**响应 200：** 设置 `translator_session` Cookie，返回 `{ "ok": true }`

**错误码：**
- `400` 用户名格式不合规 / 邀请码无效或已用
- `409` 用户名已存在

---

#### `POST /api/auth/login`
登录已有账号。

**请求体：**
```json
{ "username": "alice", "password": "my-password" }
```

**响应 200：** 设置 Cookie，返回 `{ "ok": true }`

**错误码：** `401` 用户名或密码错误

---

#### `POST /api/auth/logout`
退出登录，清除服务端 Session 和 Cookie。

**响应 200：** `{ "ok": true }`

---

### 翻译

#### `POST /api/translate`
发起一次流式翻译请求。

**需要登录**（Cookie 鉴权）

**请求体：**
```json
{
  "model": "openai/gpt-4o",
  "sourceLanguage": "auto",
  "targetLanguage": "Chinese (Simplified)",
  "translationStyle": "natural",
  "sourceText": "Hello, world!",
  "threadId": null,
  "contextDepth": 8
}
```

| 字段 | 说明 |
|------|------|
| `model` | 必须在允许列表中（见下方） |
| `sourceLanguage` | `"auto"` 或具体语言名 |
| `translationStyle` | `"natural"` 或 `"faithful"` |
| `threadId` | 传 `null` 自动创建新会话，传 ID 则追加到该会话 |
| `contextDepth` | 携带历史上下文条数（0-20），默认 8 |

**允许的模型：**
- `openai/gpt-4o`
- `openai/gpt-4o-mini`
- `openai/gpt-5.4-nano`
- `openai/gpt-5.4-mini`
- `google/gemini-3-flash-preview`

**响应：** `text/plain; charset=utf-8` 流式输出译文
响应头包含 `X-Thread-Id: <会话ID>`，前端用于后续追加到同一会话。

**错误码：** `400` 模型不在列表 / `401` 未登录 / `502` OpenRouter 请求失败

---

### 历史会话

#### `GET /api/translations/threads`
获取当前用户的翻译历史会话列表，支持关键词搜索。

**需要登录**

**查询参数：**
- `q`（可选）：关键词，模糊匹配会话标题（大小写不敏感）

**响应 200：**
```json
[
  {
    "id": "uuid",
    "title": "Hello, world!",
    "created_at": "2026-04-17T10:00:00Z",
    "updated_at": "2026-04-17T10:05:00Z",
    "lastPreview": "Hello, world!",
    "messageCount": 3
  }
]
```

最多返回 80 条，按 `updated_at` 倒序。

---

#### `DELETE /api/translations/threads/{thread_id}`
删除指定会话及其所有消息。

**需要登录**，只能删除自己的会话。

**响应：** `204 No Content`

**错误码：** `404` 会话不存在或不属于当前用户

---

#### `PATCH /api/translations/threads/{thread_id}`
重命名指定会话。

**需要登录**

**请求体：**
```json
{ "title": "新会话名称" }
```

**响应 200：** 返回更新后的会话对象（同 GET /threads 列表格式）

---

#### `GET /api/translations/threads/{thread_id}/messages`
获取指定会话的所有翻译消息。

**需要登录**

**响应 200：**
```json
[
  {
    "id": "uuid",
    "threadId": "uuid",
    "model": "openai/gpt-4o",
    "sourceLanguage": "auto",
    "targetLanguage": "Chinese (Simplified)",
    "translationStyle": "natural",
    "sourceText": "Hello, world!",
    "translatedText": "你好，世界！",
    "createdAt": "2026-04-17T10:00:00Z"
  }
]
```

最多返回 500 条，按时间升序。

---

## 数据模型

### users（用户）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID 主键 |
| username | VARCHAR(20) | 唯一，小写 |
| password_hash | VARCHAR(255) | argon2 哈希 |
| created_at | TIMESTAMP | 注册时间 |
| updated_at | TIMESTAMP | 最后更新时间 |

### sessions（会话 token）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID 主键 |
| token_hash | VARCHAR(64) | HMAC-SHA256，唯一 |
| user_id | VARCHAR(36) | 外键→users |
| expires_at | TIMESTAMP | 过期时间（30 天） |

### invite_codes（邀请码）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID 主键 |
| code | VARCHAR(64) | 规范化后的邀请码，唯一 |
| used_at | TIMESTAMP | NULL 表示未使用 |
| used_by_id | VARCHAR(36) | 外键→users，唯一 |

### translation_threads（翻译会话）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID 主键 |
| user_id | VARCHAR(36) | 外键→users |
| title | VARCHAR(120) | 取自首条原文前 42 字符 |
| created_at / updated_at | TIMESTAMP | — |

### translation_messages（翻译消息）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID 主键 |
| thread_id | VARCHAR(36) | 外键→translation_threads |
| user_id | VARCHAR(36) | 外键→users |
| model | VARCHAR(120) | OpenRouter 模型 ID |
| source_language | VARCHAR(60) | 原文语言 |
| target_language | VARCHAR(60) | 目标语言 |
| translation_style | VARCHAR(30) | natural / faithful |
| source_text | TEXT | 原文 |
| translated_text | TEXT | 译文（流结束后存储） |
| created_at | TIMESTAMP | — |

---

## Vercel 部署步骤

1. 在 [supabase.com](https://supabase.com) 创建项目，获取 PostgreSQL 连接字符串
2. 将代码推送到 GitHub，在 Vercel 导入项目
3. 在 Vercel 项目设置 → **Environment Variables** 填入所有必填变量
4. 生成 AUTH_SECRET：
   ```bash
   python3 -c "import secrets; print(secrets.token_hex(32))"
   ```
5. 部署完成后访问 `https://your-app.vercel.app`
6. 数据库表首次请求时自动建立（FastAPI `lifespan` 事件触发）
