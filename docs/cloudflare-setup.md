# 错题本云端部署 · Cloudflare 面板操作手册

> 适用对象:首次使用 Cloudflare 的 Deric。
> 目标:把错题本的云端 API(Worker + D1 + KV)和只读网页版(Cloudflare Pages)部署到 Cloudflare,并绑上自己的域名。
> 本手册按操作顺序写,每一步都给出「进哪个页面 → 点什么 → 填什么 → 怎么验证」。照着做,大概 40 分钟能全部搞定。

---

## 0. 前置准备

动手之前,先确认三件事:

1. **Cloudflare 账号**:去 https://dash.cloudflare.com 注册/登录。免费版就够用。
2. **域名**:你的域名(比如 `example.com`)在域名注册商那儿,先别做任何解析,交给 Cloudflare 接管(见第 0.1 节)。
3. **网络**:你在国内,访问 Cloudflare 面板一般能开,但 Workers/D1/KV 后台和 `workers.dev` 域名可能慢或被墙。**全程开着 Clash 代理(127.0.0.1:7890)最省心**。命令行里用代理的办法见第 5 步。

### 0.1 把域名接入 Cloudflare(绑定自定义域的前置条件)

域名只有「加入 Cloudflare 并接管 DNS」之后,Pages 自定义域才能解析。这是第 11 步的前提,现在先做掉:

1. 登录面板 → 首页点 **「添加站点 / Add a site」**。
2. 输入你的域名 → 选 **免费计划 (Free)** → 继续。
3. Cloudflare 会扫描现有 DNS 记录,直接 **继续 / Continue**(域名还没绑过东西,大概率是空的)。
4. 页面会给你 **两个 NS 地址**(形如 `xxx.ns.cloudflare.com` 和 `yyy.ns.cloudflare.com`),**复制下来**。
5. 去你的**域名注册商**后台,把域名的 NS(名称服务器)改成这两个地址,保存。
6. 回到 Cloudflare 面板点 **「检查名称服务器 / Check nameservers」**。状态从 Pending 变成 **Active** 就说明接管成功(通常几分钟到几小时,不用干等,可以先做后面 1~10 步)。

> 验证:面板首页该域名状态显示 Active;在命令行 `nslookup -type=ns 你的域名` 能看到 `*.ns.cloudflare.com`。

---

## 第 1 步:登录面板,记下 Account ID

1. 打开 https://dash.cloudflare.com 登录。
2. 首页右侧信息栏(或 **Workers & Pages** 概览页右侧)能看到 **「账户 ID / Account ID」**,是一串 32 位十六进制字符(形如 `a1b2c3d4e5f60718293a4b5c6d7e8f90`)。
3. **复制保存到记事本**,后面 GitHub Actions 和 wrangler 都要用。

> 验证:把这串 ID 和第 4 步的 API Token 放一起,别搞混(Account ID 不是 Token,没有密钥性质,但后面要用)。

---

## 第 2 步:创建 D1 数据库 `cuotiben`

D1 是 Cloudflare 的 SQLite 数据库,存错题本的元数据(题目、章节、图片索引)。

1. 左侧菜单进 **「Workers & Pages」**(也可能显示为 **Workers 与 Pages**)。
2. 点左侧 **「D1」** → 点 **「创建 / Create」**。
3. 名称填 **`cuotiben`**,位置(Location)随便选(选 APAC 区域离你近一点) → **创建 / Create**。
4. 创建后进入数据库详情页,**复制「数据库 ID / database ID」**(32 位十六进制,和 Account ID 长得像但不一样,别混)。这个 ID 第 6 步要填进 `wrangler.toml`。

> 验证:列表页能看到 `cuotiben` 这一行,点进去有「控制台 / Console」可以执行 SQL(现在是空的,还没建表)。

---

## 第 3 步:创建 KV 命名空间 `cuotiben-images`(替代 R2,不绑卡)

KV 存错题图片的二进制文件(webp)。**为什么不用 R2:R2 开通要绑支付方式,而 KV 免费 1GB、零门槛**——错题本这点图片量完全够。

1. 左侧菜单进 **「存储和数据库 / Storage & Databases」→「KV」**(新版面板里 D1、R2、KV 都在这一个栏目下)→ 点 **「创建命名空间 / Create a namespace」**。
2. 名称填 **`cuotiben-images`**(注意是连字符)→ **创建 / Create**。
3. 创建后复制它的 **Namespace ID**(一长串 hex,后面第 6 步要填进 `wrangler.toml`)。
4. **KV 命名空间不能公开访问,也不需要公开**——本项目图片全部走 Worker 的 `/api/img/:id` 代理读出(见「常见坑」第 1 条)。

> ⚠️ 面板里可能看到 R2 显示「需要添加支付方式 / 试用」——**忽略它**,我们不用 R2。KV 直接建,不碰支付。

> 验证:列表页出现 `cuotiben-images`,点进去能看到「对象 / Objects」页面(空)。

---

## 第 4 步:创建 API Token(给 wrangler 和 GitHub Actions 用)

这个 Token 是命令行和自动部署的「钥匙」,权限不够后面部署会报 403,所以一步到位。

1. 右上角点头像 → **「我的个人资料 / My Profile」** → 左侧 **「API 令牌 / API Tokens」**。
2. 点 **「创建令牌 / Create Token」**。
3. 找到模板 **「编辑 Cloudflare Workers / Edit Cloudflare Workers」**,点右侧 **「使用模板 / Use template」**。
4. 在权限列表里,把模板自带的权限保留,再**手动添加/确认以下几项**(每项都要「添加更多 / Add more」):
   - **Account → Workers Scripts → Edit**(模板自带)
   - **Account → D1 → Edit**(要手动加)
   - **Account → Workers KV Storage → Edit**(要手动加)
   - **Account → Pages → Edit**(要手动加)
   - **Account → Account Settings → Read**(要手动加)
5. **账户资源(Account Resources)**:默认是「包含所有账户 / Include all accounts」。如果你只有一个账号,保持默认即可。
6. **账户级资源粒度(可选收窄,推荐)**:在权限明细里,Workers Scripts、D1、KV 都可以从「所有资源」收窄到具体资源:
   - Workers Scripts → **Include → Specific script → `cuotiben-api`**
   - D1 → **Include → Specific database → `cuotiben`**
   - KV → **Include → Specific namespace → `cuotiben-images`**
   - Pages 和 Account Settings 只能按账户粒度,保持默认。
   > 收窄后即使 Token 泄露,也只影响错题本这几个资源,影响面最小。
7. **继续以显示摘要 / Continue to summary** → **创建令牌 / Create Token**。
8. **立刻复制 Token 保存**(形如 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`,很长),**只显示这一次,关掉页面就再也看不到了**。存到记事本里,后面第 5 步和第 10 步方式 B 要用。

> 验证:创建完成后有个「测试 / Test」按钮,点一下显示 `status: active` 就说明 Token 有效。
> ⚠️ 如果之后 wrangler 部署时报 403(权限不足),回到这里点 Token 右侧 **「编辑 / Edit」**,把缺的权限(尤其 **D1:Edit、Workers KV Storage:Edit、Pages:Edit、Account Settings:Read**)补上,保存即可生效,不用重新建 Token。报错长什么样、怎么排查见「常见坑」第 3 条。

---

## 第 5 步:本地安装 wrangler 并登录

wrangler 是 Cloudflare 的命令行工具,部署 Worker、执行 D1 SQL 都靠它。你的机器是 Windows + git-bash,以下命令都在 git-bash 里跑。

1. 先给命令行挂代理(国内连 Cloudflare API 不稳,Clash 开着):

   ```bash
   export HTTPS_PROXY=http://127.0.0.1:7890
   export HTTP_PROXY=http://127.0.0.1:7890
   ```

2. 安装 wrangler(全局装一次,以后哪都能用):

   ```bash
   npm install -g wrangler
   ```

   不想全局装也可以全程用 `npx wrangler` 代替下面的 `wrangler`。

3. 登录授权(会弹浏览器,用你的 Cloudflare 账号确认):

   ```bash
   wrangler login
   ```

4. 确认登录状态:

   ```bash
   wrangler whoami
   ```

> 验证:`wrangler whoami` 显示你的邮箱和账号 ID 即成功。浏览器没自动弹出来的话,把终端里给的链接手动复制到浏览器打开。

---

## 第 6 步:把 D1 数据库 ID 和 KV Namespace ID 填进 wrangler.toml

1. 用 VS Code / 记事本打开 `D:\APP\MistakeBook\worker\wrangler.toml`。
2. 找到这两行:

   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "cuotiben"
   database_id = "PUT_YOUR_D1_DATABASE_ID_HERE"
   ```

3. 把 `PUT_YOUR_D1_DATABASE_ID_HERE` 替换成**第 2 步复制的真实数据库 ID**(保留引号),例如:

   ```toml
   database_id = "1a2b3c4d5e6f708192a3b4c5d6e7f809"
   ```

4. 保存。`kv_namespaces` 那段也顺手确认:`id = "PUT_YOUR_KV_NAMESPACE_ID_HERE"` 要换成第 3 步复制的 Namespace ID,`binding = "IMAGES"` 保持不动。

> 验证:再打开文件确认 `database_id` 和 KV 的 `id` 后面都不是 `PUT_YOUR...` 了。**这一步漏了或填错,第 7 步和第 9 步都会失败**(具体报错见「常见坑」第 2 条)。

---

## 第 7 步:初始化 D1 表结构

**D1 必须先用 `schema.sql` 建好表才能用**,不建表的话 Worker 一查就报 `no such table: problems`。

1. 打开 git-bash,进到 worker 目录:

   ```bash
   cd /d/APP/MistakeBook/worker
   ```

2. 执行建表(`--remote` 表示对**云端**数据库执行,不加就是只改本地):

   ```bash
   wrangler d1 execute cuotiben --file schema.sql --remote
   ```

3. 等输出出现 `Executing on remote database cuotiben` 和成功提示即可。

> 验证:查一下表建没建上:

```bash
wrangler d1 execute cuotiben --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

> 应该列出 `books`、`chapters`、`problems`、`images`、`syncmeta` 五张表。
> 如果报 `Could not find database "cuotiben"`,回到第 6 步检查 `database_id` 是否填对。

---

## 第 8 步:设置推送令牌 PUSH_TOKEN

PUSH_TOKEN 是桌面端/网页端调用写接口(`/api/push`、`/api/img` 上传等)的凭证,`index.js` 里比对 `x-push-token` 请求头。**这个令牌要记好,别弄丢——桌面端推送配置里也要填同一个值。**

1. 仍在 `worker` 目录下执行:

   ```bash
   wrangler secret put PUSH_TOKEN
   ```

2. 提示 `Enter a secret value:` 时,粘贴一串你自己定的强随机字符串(比如用浏览器密码生成器生成 32 位以上,或 `openssl rand -hex 24` 生成),回车。**输入时终端不回显,是正常的**。
3. 看到 `Successfully created secret for worker cuotiben-api` 即成功。

> 验证:

```bash
wrangler secret list
```

> 能看到 `PUSH_TOKEN` 这一条。注意 `wrangler secret list` 只显示名字不显示值,值存在 Cloudflare 侧,你本地没存的话就找不回来了——**现在就把这个值记进密码管理器**。

> ⚠️ **绝对不要把 PUSH_TOKEN 写进 wrangler.toml、`.dev.vars`、或任何会提交到 GitHub 的文件**。仓库的 `.gitignore` 已排除了构建产物和本地配置文件,但你自己新加的 `.dev.vars`(如果以后想本地调试)记得也加进 `.gitignore`。

---

## 第 9 步:部署 Worker 并用 curl 验证

1. 在 `worker` 目录下执行:

   ```bash
   wrangler deploy
   ```

2. 等输出出现 `Uploaded cuotiben-api` 和 `Deployed cuotiben-api` 以及一个 `https://cuotiben-api.<你的workers子域>.workers.dev` 地址。如果提示还没启用 Workers.dev 子域,去面板 **Workers & Pages** 首页,页面顶部会有 **「启用 Workers.dev / Enable Workers.dev」** 按钮,启用后重新 deploy 一次。
3. 用 curl 验证读接口(**读接口不需要令牌**,直接能访问):

   ```bash
   curl -x http://127.0.0.1:7890 https://cuotiben-api.<你的workers子域>.workers.dev/api/stat
   ```

   返回类似 `{"problems":0,"images":0,"bytes":0,"lastPush":0}` 的 JSON 就说明 Worker + D1 全通了。

4. 再验证一下全量快照接口:

   ```bash
   curl -x http://127.0.0.1:7890 https://cuotiben-api.<你的workers子域>.workers.dev/api/snapshot
   ```

   返回 `{"at":...,"books":[],"chapters":[],"problems":[],"images":[]}` 即正常(还没推送过数据,数组为空是对的)。

> 写接口验证(可选):`curl -x http://127.0.0.1:7890 -X POST https://.../api/stat` 不带令牌应返回 `{"error":"unauthorized"}`(401),说明令牌校验生效。

---

## 第 10 步:部署前端网页版

网页版是只读的,构建产物在 `dist-web/`(由 `npm run build:web` 生成,注意 vite 配置里 `--mode web` 输出到 `dist-web`,`--mode app` 输出到 `dist-app`,别搞混)。两种方式二选一:

### 方式 A:手动部署(一次性,先跑通)

1. 在项目根目录(`D:\APP\MistakeBook`)执行:

   ```bash
   cd /d/APP/MistakeBook
   npm run build:web
   ```

2. 部署到 Pages(首次会自动创建名为 `cuotiben` 的 Pages 项目):

   ```bash
   npx wrangler pages deploy dist-web --project-name=cuotiben
   ```

3. 输出会给你一个 `https://cuotiben.pages.dev` 地址,浏览器打开能看到网页版(此时还没有数据,空列表正常)。

### 方式 B:GitHub Actions 自动部署(以后推 main 就自动发版)

1. 把仓库推到 GitHub 并设为默认分支 `main`。
2. 打开 GitHub 仓库 → **Settings → Secrets and variables → Actions**,分两个 Tab 配置:

   **Secrets(密钥):**
   - `CLOUDFLARE_API_TOKEN` = 第 4 步创建的 API Token
   - `CLOUDFLARE_ACCOUNT_ID` = 第 1 步记下的 Account ID

   **Variables(变量):**
   - `API_BASE` = **留空**(推荐,走同域相对路径,见下方说明)

3. 之后每次 `git push` 到 main,`.github/workflows/deploy.yml` 会自动执行 `npm ci` → `npm run build:web` → 部署 Pages(`cuotiben`)和 Worker(`worker` 目录)。也可以在 GitHub 的 **Actions** 页面手动触发(workflow 里配了 `workflow_dispatch`)。

> **关于 API_BASE 为什么留空(重要):**
> 本项目的 Worker 代码**没有写 CORS 响应头**,如果网页版和 API 不同域,浏览器会直接拦截跨域请求,网页版一个数据都拉不到。所以网页版和 API **必须挂在同一个域名下**,前端用相对路径 `/api/...` 请求——`src/core/env.js` 里 `API_BASE` 为空时正好走相对路径,`src/storage/remote.js` 的 fetch 也带了 `credentials:'include'` 方便后面 Access 登录。同域的具体做法见第 11 步。
> 如果你坚持要跨域(比如 API 留在 `workers.dev`),需要先给 Worker 的响应加 `Access-Control-Allow-Origin` 头,并处理预检请求——不建议,徒增复杂度。

---

## 第 11 步:绑定域名(同域方案)

目标:网页版和 API 都挂在你的域名下,前端用相对路径调 API。做法是 **Pages 绑自定义域 + Workers 路由把 `/api/*` 引到 Worker**,两者用同一个主机名。

### 11.1 Pages 绑定自定义域

1. 面板 → **Workers & Pages** → 点 `cuotiben`(Pages 项目)。
2. 顶部 **「自定义域 / Custom domains」** → **「添加 / Add」** → 输入你想用的域名,例如 `cuotiben.example.com`(或直接用 `example.com`)。
3. Cloudflare 会自动创建 DNS 记录,等状态变成 **Active** 即可。
4. 浏览器打开 `https://cuotiben.example.com` 能看到网页版。

> 前提是第 0.1 节域名已经接入 Cloudflare(NS 已改),否则这里解析不了。

### 11.2 Workers 路由挂 `/api/*`

1. 面板 → **Workers & Pages** → 点 Worker `cuotiben-api` → 顶部 **「设置 / Settings」** → 左侧 **「路由 / Routes」**。
2. **「添加路由 / Add route」**,填:
   - **路由 / Route**:`cuotiben.example.com/api/*`(和 11.1 的域名**完全一致**)
   - **区域 / Zone**:选择你的域名
   - **Worker**:`cuotiben-api`
3. 保存。Cloudflare 路由里更具体的路径(`/api/*`)优先于 Pages 自定义域,所以 `/api/stat` 这类请求进 Worker,其余路径走 Pages 前端——同域方案就通了。

4. 验证(挂代理):

   ```bash
   curl -x http://127.0.0.1:7890 https://cuotiben.example.com/api/stat
   ```

   返回 JSON 即同域打通。再开浏览器访问 `https://cuotiben.example.com`,网页版应该能拉到数据(推送过的话)。

### 11.3 国内访问注意事项

- **Cloudflare 在国内没有节点**,你的域名解析会指向海外 IP,直连可能慢或被墙。你自己访问时**开着 Clash(127.0.0.1:7890)**,浏览器走系统代理即可;命令行 curl 记得加 `-x http://127.0.0.1:7890`(或前面 export 过代理)。
- 这属于 Cloudflare 免费版的固有限制,个人错题本够用就行;如果以后要面向国内用户,再考虑备案 + 国内 CDN,那是另一个话题。

---

## 第 12 步:只读保护(可选但推荐):Cloudflare Access

网页版只读接口(包括图片)是公开的,任何知道地址的人都能看。用 Zero Trust 的 Access 加一道「只能你自己邮箱登录」的墙:

1. 左侧菜单 **「Zero Trust」** → 如果提示选择计划,选 **免费 / Free**(50 个用户以内免费)→ 完成开通向导。
2. 进入 Zero Trust 后,左侧 **「Access」→「Applications / 应用程序」** → **「Add an application / 添加应用程序」** → 选 **「Self-hosted / 自托管」**。
3. **Application domain / 应用域**:填你绑定网页版的域名 `cuotiben.example.com`(也可以带路径精确到 `/`,把 `/api/*` 一起罩住)。一路 Next。
4. **Add a policy / 添加策略**:
   - Policy name:`only-me`
   - Action:**Allow**
   - 规则:**Include → Emails → 填你自己的邮箱**(比如 `deric@example.com`)
   - 保存。
5. 确认后保存应用。此时再访问 `https://cuotiben.example.com`,会先跳 Cloudflare 登录页,用你邮箱收到的一次性验证码登录后才进得去。

原理说明:

- 网页端的 `fetch` 都带了 `credentials:'include'`,Access 登录后的 cookie 会随每个请求自动带上,所以 **API 请求和图片请求(`/api/img/:id`)也能通过 Access**,不会被拦。
- 桌面端推送走的是 `x-push-token` 头、不是浏览器 cookie。如果你以后让桌面端直接推云端,且 Access 拦了 `/api/push`,桌面端会 302/401——到时候要么在 Access 策略里对写接口单独放行,要么桌面端保持走本地。目前桌面端是本地优先,不受影响。

> 验证:开代理访问 `https://cuotiben.example.com` 会跳到 Access 登录页;用 curl 不带 cookie 访问 `/api/stat` 会返回 302 跳转而不是 JSON,说明墙已生效。

---

## 第 13 步:免费额度说明

个人错题本完全在免费额度内,不用担心账单:

| 资源 | 免费额度 | 错题本用量预估 |
|---|---|---|
| Workers | **10 万请求/天** | 每天几十次,绰绰有余 |
| D1 | **5GB 存储**,另含每天 500 万行读 / 10 万行写 | 几万道题也就几十 MB |
| KV | **1GB 存储** + 每天 10 万次读 / 1000 次写(单键上限 25MB) | 几百张截图几十 MB;首次全量推图几百次写,日常增量推送很少,都在额度内 |

注意:免费额度超了不会扣钱,只是当月对应资源被停(Worker 会返回 1020 错误,下月自动恢复)。

---

## 常见坑

1. **KV 命名空间不能直接公开访问。**
   KV 没有公开读取的 URL,必须走 Worker 代理。本项目 `/api/img/:id` 就是干这个的——网页版 `<img>` 直接请求 `/api/img/<id>`,Worker 从 KV 里 `getWithMetadata(id)` 再返回。所以别去找什么公开权限开关,那是死路。

2. **`wrangler.toml` 里 `database_id` 没填对会部署失败。**
   典型报错:
   - `wrangler d1 execute` 时:`Could not find database "cuotiben"`(ID 还是占位符,或 ID 抄错)
   - `wrangler deploy` 时:`Error: Could not find D1 database with ID ...`
   排查:回到第 2 步的 D1 详情页重新复制 database ID(注意是**数据库 ID**,不是数据库名字,也不是 Account ID),确认 `wrangler.toml` 里 `database_id = "真实的32位ID"` 无误后重跑。

3. **API Token 权限不足的 403。**
   报错长这样:
   ```
   ✘ [ERROR] A request to the Cloudflare API (../accounts/.../d1/database) failed:
   Authentication format invalid
   ```
   或部署时直接 `You do not have permission to perform this operation. (10000)`,以及 GitHub Actions 里 wrangler-action 报 403。
   排查步骤:
   - `wrangler whoami` 确认登录的是对的账号;
   - 确认 Token 是在「我的个人资料 → API 令牌」里创建的,而不是什么奇怪来源;
   - 回第 4 步 **编辑** 该 Token,补齐 **D1:Edit、Workers KV Storage:Edit、Pages:Edit、Account Settings:Read** 这几项(模板「编辑 Cloudflare Workers」默认不含 D1/KV/Pages,这是最常见的漏项);
   - 保存后无需重建 Token,直接重跑命令/重新触发 Actions。

4. **secret 不要写进 wrangler.toml 或提交 git。**
   PUSH_TOKEN 只通过 `wrangler secret put` 存在 Cloudflare 侧,不进任何文件。`wrangler.toml` 里明确注释了「PUSH_TOKEN 不写在这里」;仓库 `.gitignore` 已排除构建产物等本地文件,你自己也不要新建会提交的 `.env`/`.dev.vars` 存令牌。令牌泄露 = 任何人能往你云端写数据,发现泄露就 `wrangler secret put PUSH_TOKEN` 换一个新值,并把桌面端配置同步更新。

5. **面板部分操作需要科学上网。**
   国内网络下 `dash.cloudflare.com` 面板一般能开,但 Workers 后台、D1 控制台、`workers.dev` 域名经常慢或打不开。对策:全程开 Clash(127.0.0.1:7890);命令行操作前 `export HTTPS_PROXY=http://127.0.0.1:7890`;curl 加 `-x http://127.0.0.1:7890`。`wrangler login` 弹不出浏览器时,也是代理问题,先 export 再试。

6. **部署后网页版打不开,先分 API 问题和前端问题。**
   按顺序 curl 两个接口:
   ```bash
   curl -x http://127.0.0.1:7890 https://<你的域名>/api/stat
   curl -x http://127.0.0.1:7890 https://<你的域名>/api/snapshot
   ```
   - 两个都返回 JSON → API 没问题,问题在前端(看浏览器 F12 控制台报错、`dist-web` 是否部署成功、API_BASE 是否被设置成了跨域地址)。
   - `/api/stat` 返回 302 跳转 → 是 Access 墙(第 12 步),浏览器里登录一次即可;curl 里带 cookie 或先忽略。
   - 返回 500 / `no such table` → D1 没建表,回第 7 步。
   - 返回 404 → Worker 路由没生效,检查第 11.2 步的路由是否添加、路径是否带 `/api/*`。
   - 浏览器能打开网页但白屏/空数据 → 打开 F12 看 `/api/snapshot` 请求是否被 CORS 拦截(说明 API_BASE 配了跨域地址,应该留空走同域)。

---

## 附:全流程验证清单(做完勾一遍)

- [ ] 域名在 Cloudflare 状态 Active(第 0.1 节)
- [ ] D1 数据库 `cuotiben` 已建,记下 database ID(第 2 步)
- [ ] KV 命名空间 `cuotiben-images` 已建,记下 Namespace ID(第 3 步)
- [ ] API Token 已建且含 D1/KV/Pages/Account Settings 权限(第 4 步)
- [ ] `wrangler whoami` 显示你的账号(第 5 步)
- [ ] `wrangler.toml` 的 database_id 已替换(第 6 步)
- [ ] D1 五张表已建(第 7 步)
- [ ] PUSH_TOKEN 已设置并记入密码管理器(第 8 步)
- [ ] `wrangler deploy` 成功,curl `/api/stat` 返回 JSON(第 9 步)
- [ ] 网页版已部署(方式 A 或 B),`cuotiben.pages.dev` 能开(第 10 步)
- [ ] 自定义域 + `/api/*` 路由已配,`https://你的域名/api/stat` 返回 JSON(第 11 步)
- [ ] (可选)Access 登录墙生效(第 12 步)
- [ ] GitHub Secrets/Variables 已配,推 main 自动部署跑通(第 10 步方式 B)
