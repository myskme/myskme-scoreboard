/* =====================================================================
   王老师的英语课 · MYSKME 记分系统 — 在线发布 Worker（Cloudflare Workers）
   作用：浏览器(管理员)把数据 POST 给它；它校验管理员密码后，用藏在服务器端的
        GitHub 令牌把 data.json 提交到仓库。令牌永远不出现在浏览器/公开代码里。

   部署后要在 Worker 的 Settings → Variables and Secrets 里设置：
     【加密(Secret)】GH_TOKEN        GitHub 细粒度令牌(对本仓库 Contents 读写)
     【加密(Secret)】ADMIN_PASSWORD  发布密码：必须是【强随机长口令】，且【不要】等于网页解锁密码 mrwolf！
                                     (网页 mrwolf 是公开软锁，谁都看得到；这个才是真正的写入凭证)
     【普通(Text)】 REPO            形如  myskme/myskme-scoreboard
     【普通(Text)】 BRANCH          一般  main
     【普通(Text)】 DATA_PATH       一般  data.json
     【普通(Text)·可选】ALLOWED_ORIGIN  你的网站域名(如 https://myskme.github.io)，留空=允许任意来源
   强烈建议：在 Cloudflare 仪表盘给本 Worker 配一条 Rate Limiting 规则(如每 IP 每分钟 5 次)，防暴力猜密码。
   详细步骤见同目录 ../worker-setup.md
   ===================================================================== */

function corsHeaders(env, req) {
  const allow = (env && env.ALLOWED_ORIGIN || "").trim();
  let origin = "*";
  if (allow) {
    const o = req.headers.get("Origin") || "";
    origin = allow.split(",").map(s => s.trim()).includes(o) ? o : allow.split(",")[0].trim();
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...(cors || {}) },
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 把 UTF-8 字符串编码为 base64（Workers 的 btoa 只认 latin1，中文必须先转字节）
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export default {
  async fetch(req, env) {
    const CORS = corsHeaders(env, req);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") return json({ error: "只支持 POST" }, 405, CORS);

    let body;
    try { body = await req.json(); }
    catch (e) { return json({ error: "请求不是有效 JSON" }, 400, CORS); }

    // 1) 校验发布密码（必须已配置；失败固定延时拖慢暴力穷举）
    if (!env.ADMIN_PASSWORD) return json({ error: "Worker 未配置 ADMIN_PASSWORD" }, 500, CORS);
    if (typeof body.password !== "string" || body.password !== env.ADMIN_PASSWORD) {
      await sleep(700);
      return json({ error: "发布密码不对" }, 401, CORS);
    }

    // 2) 基本校验数据
    const data = body.data;
    if (!data || !Array.isArray(data.seasons))
      return json({ error: "数据格式不对（缺 seasons）" }, 400, CORS);
    // 体积保护（避免误传超大体）
    const text = JSON.stringify(data, null, 1);
    if (text.length > 4_000_000) return json({ error: "数据过大" }, 413, CORS);

    // 3) 配置
    const repo = env.REPO;
    const branch = env.BRANCH || "main";
    const path = env.DATA_PATH || "data.json";
    if (!repo || !env.GH_TOKEN)
      return json({ error: "Worker 未配置 REPO 或 GH_TOKEN" }, 500, CORS);

    const api = `https://api.github.com/repos/${repo}/contents/${path}`;
    const gh = {
      "Authorization": "Bearer " + env.GH_TOKEN,
      "User-Agent": "myskme-scoreboard-worker",
      "Accept": "application/vnd.github+json",
    };

    // 4) 取当前文件 sha（更新已存在文件时需要）
    let sha;
    try {
      const cur = await fetch(`${api}?ref=${branch}`, { headers: gh });
      if (cur.status === 200) { sha = (await cur.json()).sha; }
      else if (cur.status !== 404) {
        const t = await cur.text();
        return json({ error: "读取 data.json 失败(" + cur.status + "): " + t.slice(0, 200) }, 502, CORS);
      }
    } catch (e) { return json({ error: "连接 GitHub 失败" }, 502, CORS); }

    // 5) 提交
    const payload = {
      message: "publish scoreboard @ " + new Date().toISOString(),
      content: toBase64(text),
      branch,
    };
    if (sha) payload.sha = sha;

    let put;
    try { put = await fetch(api, { method: "PUT", headers: gh, body: JSON.stringify(payload) }); }
    catch (e) { return json({ error: "提交失败：连接 GitHub 出错" }, 502, CORS); }

    if (!put.ok) {
      const t = await put.text();
      return json({ error: "GitHub 拒绝(" + put.status + ")：" + t.slice(0, 240) }, 502, CORS);
    }
    return json({ ok: true }, 200, CORS);
  },
};
