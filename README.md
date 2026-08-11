# 错题本

从 PDF 截图粘进来，AI 转成可搜索的 LaTeX 文字，自动标考点、判难度、归章节。

数据存在本地，配合 Ollama 可完全离线；桌面版录入，出门用网页版看题。

[下载 Windows 版](https://github.com/Yoasobisong/MistakeBook/releases) · [网页只读版](https://cuotiben.yqsony0130.top) · [项目文档](docs/)

---

## ✨ 截图

![主界面（网页只读版）](screenshots/main.png)

---

## 功能

- **Ctrl+V 粘贴截图直接建题**，自动裁白边；题目 / 答案 / 补充三个槽位
- **截图 → LaTeX**：视觉模型转录题目，流式显示、可手改
- **自动标注**：考点、难度（1–5 评分标准）、章节，直接写入
- **就题目对话**：问思路、让 AI 挑错；考点标签自动复用，不打乱统计
- **从目录建章节**：粘贴教材目录，自动解析层级
- **组织**：书籍 → 多级章节树；拖卡片归类；全文搜索（含 LaTeX 正文）
- **筛选**：错题/好题 · 星标 · 缺解析 · 未提取 · 未分析 · 难度 · 掌握度 · 错因
- **批量**：Shift 段选 / Ctrl+A，批量提取、分析、移动、设掌握度、删除
- **复习**：掌握度三档 + 复习记录 + 统计看板（薄弱章节 / 错因 / 知识点分布）
- **打印导出 PDF**：文字版（可搜索）或截图版（保留原排版）
- **其他**：暗色模式（截图自动反相）、回收站、增量备份（网盘友好）

---

## 下载与运行

- 安装版：`Cuotiben-Setup-x.y.z.exe`（带快捷方式，推荐）
- 免安装版：`Cuotiben-Portable-x.y.z.exe`（解压即用，启动慢几秒）

[前往 Releases 下载](https://github.com/Yoasobisong/MistakeBook/releases)

### 从源码运行

```bash
npm install
npm run dev        # 浏览器版，localhost:5173
npm run dev:app    # Electron 版
npm run dist       # 打包 exe，产物在 release/
```

---

## 网页版与隐私

网页版是云端的**只读镜像**，桌面版点「云同步」推数据。手机打开 [cuotiben.yqsony0130.top](https://cuotiben.yqsony0130.top) 即可看题。

| 数据 | 是否上云 |
| --- | --- |
| 题目原始截图 | ❌ 只在本地 |
| 题目提取文字 | ✅ |
| 答案解析 / 补充（文字+截图） | ✅ |
| 书籍 / 章节 / 考点 / 批注 | ✅ |

云端有令牌保护；部署细节见 [docs/cloudflare-setup.md](docs/cloudflare-setup.md)。

---

## AI 配置

设置 → AI。两个独立槽位：**提取**（截图→文字，需视觉模型）、**分析**（考点/难度/章节，纯文本即可）。可混搭：本地 Ollama 做提取 + 云端模型做分析。

```bash
ollama pull qwen2.5vl:7b   # 本地视觉模型
```

支持所有 OpenAI 兼容接口（Ollama / DeepSeek / 硅基流动 / OpenRouter / 智谱 / Kimi…），换服务商只改三个字段。API Key 在桌面版用 Windows DPAPI 加密存储。

> ⚠️ DeepSeek 只能在桌面版用（无 CORS 头）；浏览器调本地 Ollama 需设 `OLLAMA_ORIGINS=*`。

---

## 数据与备份

| | 位置 |
| --- | --- |
| 桌面版 | `%APPDATA%\cuotiben\` |
| 浏览器版 | 该站点 IndexedDB |

**自动备份**（设置 → 备份）：增量格式——图片按 id 只写一次，元数据每次一份快照。把目录设成网盘同步文件夹，就只传新题的截图，不重传几百 MB。默认保留 30 份，误删可翻快照找回。

---

## 已知限制

- 几何图形转不了文字（视觉模型留 `[图：…]` 描述占位，截图仍在不影响阅读）
- 复杂公式偶尔认错，提取后可手动改
- 本地 7B 模型较慢（几十秒/图），批量默认串行
- 网页版只读；题目截图不上云（网页版看的是提取的文字）

---

## 技术栈

Vite · 原生 ES Modules · IndexedDB · KaTeX · Electron · Cloudflare（Worker + D1 + KV + Pages）
