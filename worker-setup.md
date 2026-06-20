# 在线发布设置（一次性，约 10 分钟）

目标：管理员在网页里点「**发布到网上**」，数据就保存到仓库的 `data.json`，**所有访客刷新即见最新**。GitHub 令牌藏在一个免费的 Cloudflare Worker 里，**永远不出现在浏览器/公开代码**。

数据流：`浏览器(管理员密码) → 你的 Worker(藏着令牌) → GitHub 提交 data.json → 所有人读取`

---

## 第 1 步 · 建一个 GitHub 细粒度令牌（只能写这一个仓库）

1. 打开 <https://github.com/settings/personal-access-tokens/new> （Fine-grained token）。
2. **Token name**：`myskme-scoreboard-publish`；**Expiration** 选个长一点（如 1 年）。
3. **Repository access** → 选 **Only select repositories** → 勾 `myskme/myskme-scoreboard`。
4. **Permissions** → **Repository permissions** → 找到 **Contents** → 设为 **Read and write**。（其它全部留 No access）
5. 点 **Generate token**，**复制**那串 `github_pat_…`（只显示一次）。

> 这个令牌最多只能改这一个仓库的文件，泄露的最坏后果也仅限于此。

## 第 2 步 · 建 Cloudflare Worker（免费）

1. 注册/登录 <https://dash.cloudflare.com> → 左侧 **Workers & Pages** → **Create** → **Create Worker**。
2. 起个名，如 `myskme-publish` → **Deploy**（先随便部署）→ 再点 **Edit code**。
3. 把本仓库 `worker/publish-worker.js` 的**全部内容**粘贴进去，覆盖原有代码 → 右上 **Deploy**。
4. 记下它的网址，形如 `https://myskme-publish.你的名字.workers.dev`。

## 第 3 步 · 给 Worker 配置变量

进入这个 Worker → **Settings** → **Variables and Secrets** → **Add**，逐个加：

| 名称 | 类型 | 值 |
|---|---|---|
| `GH_TOKEN` | **Secret（加密）** | 第 1 步复制的 `github_pat_…` |
| `ADMIN_PASSWORD` | **Secret（加密）** | **发布密码：一串强随机长口令**（如 `Wolf-7xQ2-mist-94Kd`）。⚠️ **不要用 `mrwolf`，也不要等于网页解锁密码**——网页那个是公开软锁、谁都看得到；这个才是真正能写数据的钥匙。 |
| `REPO` | Text | `myskme/myskme-scoreboard` |
| `BRANCH` | Text | `main` |
| `DATA_PATH` | Text | `data.json` |
| `ALLOWED_ORIGIN`（可选） | Text | `https://myskme.github.io` —— 只允许你的网站调用；留空=任意来源 |

加完点 **Deploy / Save**。

> 🔒 **两个密码别搞混**：网页右上角「解锁编辑」用的是软锁密码（`mrwolf`，只防误触）；点「发布到网上」时输入的是这里的 `ADMIN_PASSWORD`（强口令，真正决定能否写到网上）。两者应不同。
>
> 🛡 **强烈建议**：在该 Worker 的 **Settings → Rate limiting**（或 Cloudflare 的 Security/WAF）配一条限频规则，例如「每 IP 每分钟 5 次」，防止有人暴力猜发布密码。

## 第 4 步 · 把 Worker 网址填进网页

1. 打开 <https://myskme.github.io/myskme-scoreboard/> → 右上「**解锁编辑**」输入管理员密码。
2. 到「**数据·部署**」页 → 「保存到网上」卡片 → 点「**发布设置**」→ 粘贴第 2 步的 Worker 网址 → 保存。
   （这个网址不是机密，存在你浏览器里；也可以告诉我，我直接写进代码。）

## 完成！日常用法

- 改完分数/赛季 → 顶部出现金色「**● 发布到网上**」→ 点它 → 输**发布密码**（Worker 的 `ADMIN_PASSWORD`，不是网页解锁密码）→ 完成。
- 约 1 分钟后（GitHub Pages 重新构建），**所有人刷新**都看到最新。
- 你自己这台浏览器是立刻更新的。
- 没点「发布」前，改动只在你本机（顶部显示「有未保存改动」提醒你）。

## 常见问题

- **点发布报「发布密码不对」**：输入的要是 Worker 的 `ADMIN_PASSWORD`，不是网页解锁密码 `mrwolf`。
- **报「GitHub 拒绝 403/404」**：令牌的 Contents 权限没给「读写」，或 `REPO` 写错。
- **别人没看到更新**：等 1–2 分钟让 Pages 重建；或让他们强制刷新（Cmd/Ctrl+Shift+R）。
- **想换密码**：网页软锁密码改 `index.html` 里的 `ADMIN_HASH`（控制台 `hashPass('新密码')`）；发布密码改 Worker 的 `ADMIN_PASSWORD`。两者**独立**，不必相同。

## 安全说明

- **GitHub 令牌只在 Worker 服务器端**，浏览器/公开代码里都没有。
- **两道密码**：网页 `mrwolf` 是公开软锁（只防误触，能被绕过）；Worker 的 `ADMIN_PASSWORD` 是真正的写入钥匙——所以它**必须强、且不能等于 `mrwolf`**（否则等于把钥匙公开了）。
- 加上「令牌只能写这一个仓库」+「Rate limiting 限频」+「可选 ALLOWED_ORIGIN 限来源」，攻击面被压到很小。
