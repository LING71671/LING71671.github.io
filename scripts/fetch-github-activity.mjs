/**
 * 抓取 GitHub 提交活跃度，生成 public/data/github-activity.json。
 * 3D 桌上的日历在运行时读取它绘制提交热力格。
 * 用法: node scripts/fetch-github-activity.mjs [username]
 * 需要已登录的 gh CLI（无 token 时回退为未认证请求，配额较低）。
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const user = process.argv[2] ?? 'LING71671';
const DAYS = 91; // 13 周

/** 用 GITHUB_TOKEN（CI）或 gh auth token（本地）认证；都没有就走未认证请求 */
async function ghApi(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'desk-blog' };
  // CI 环境：GITHUB_TOKEN 自动注入
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  } else {
    try {
      const token = execFileSync(
        process.env.COMSPEC ?? 'cmd.exe',
        ['/c', 'gh auth token'],
        { encoding: 'utf8' },
      ).trim();
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {
      /* 未登录时走未认证请求 */
    }
  }
  const res = await fetch(`https://api.github.com/${path}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

const counts = new Map();
let latestRepo = null;
let latestAt = null;

// events API 只回溯约 90 天 / 300 条，够画热力格
for (let page = 1; page <= 3; page++) {
  let events;
  try {
    events = await ghApi(`users/${user}/events?per_page=100&page=${page}`);
  } catch {
    break;
  }
  if (!Array.isArray(events) || events.length === 0) break;
  for (const ev of events) {
    if (ev.type !== 'PushEvent') continue;
    const day = ev.created_at.slice(0, 10);
    const commits = ev.payload?.commits?.length ?? 1;
    counts.set(day, (counts.get(day) ?? 0) + commits);
    if (!latestAt || ev.created_at > latestAt) {
      latestAt = ev.created_at;
      latestRepo = ev.repo?.name?.split('/').pop() ?? null;
    }
  }
}

// 生成最近 DAYS 天的连续序列（无活动补 0）
const today = new Date();
const days = [];
for (let i = DAYS - 1; i >= 0; i--) {
  const d = new Date(today);
  d.setDate(d.getDate() - i);
  const key = d.toISOString().slice(0, 10);
  days.push({ date: key, count: counts.get(key) ?? 0 });
}

const total = days.reduce((sum, d) => sum + d.count, 0);
const payload = {
  user,
  generatedAt: today.toISOString(),
  days,
  total,
  latest: latestAt ? { at: latestAt, repo: latestRepo } : null,
};

await mkdir('public/data', { recursive: true });
await writeFile('public/data/github-activity.json', JSON.stringify(payload));
console.log(
  `github-activity.json: ${days.length} 天, ${total} 次提交, 最近 ${latestRepo ?? '无'}`,
);
