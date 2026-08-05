# 错题本 (Cuotiben)

本地优先的错题管理工具，支持 AI 提取与分析。

## 功能

- 书籍/章节树
- 粘贴录题 / 拖文件导入
- 自动裁白边 / 三槽位图片
- Markdown + KaTeX 批注
- 筛选 / 搜索 / 四种排序 / 三种视图
- 详情页三槽位图片增删移
- 打印导出三种范围
- 备份导出与恢复
- 快捷键支持
- **AI 能力**（Phase 2 已完成）
  - 截图 → LaTeX（视觉模型）
  - 考点 / 难度 / 章节 / 总结（纯文本模型）
  - 就题目对话

## 技术栈

- Vite 8（前端）
- Electron 43（桌面端）
- IndexedDB（本地数据存储）
- OpenAI 兼容 API（适配 Ollama / DeepSeek / 智谱 / 硅基流动等）

## 快速启动

1. 安装 Node.js ≥ 18
2. 安装 Ollama 并拉取视觉模型（如 `qwen2.5vl:7b`）
3. 克隆/下载本仓库
4. 安装依赖：
   ```bash
   npm install
   ```
5. 启动开发版：
   ```bash
   npm run dev:app
   ```
6. 打包生成 exe：
   ```bash
   npm run dist
   ```

## 项目结构

```
.
├── electron/          # Electron 主进程代码
├── src/               # 前端源代码
│   ├── ai/            # AI 适配层 + 任务队列
│   ├── core/          # 工具函数与状态管理
│   ├── storage/       # 数据仓储（IndexedDB）
│   └── ui/            # 所有 UI 组件
├── dist-app/          # Electron 产物（构建后）
├── release/           # 打包输出（exe + installer）
├── .gitignore
└── README.md
```

## 后续计划

- Phase 3：GitHub Actions + Cloudflare Pages 部署网页版
- Phase 4：云同步（D1 + R2） + 跨设备 LWW 冲突解决
- Phase 5：暗黑模式 + 黑白图片反色 + 更多模型适配

## 联系

有问题可以直接提 issue 或联系我。