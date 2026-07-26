---
title: grok2web
description: 一个跑在 Cloudflare Workers 上的 Grok MCP 服务，带持久 cookie 会话，用于联网和授权范围内的 CTF 工作流。
category: AI
cover: ../../assets/covers/plant.svg
coverAlt: 窗边的绿植
date: 2026-07-08
tags: [MCP, Cloudflare Workers, Grok, TypeScript]
link: https://github.com/LING71671/grok2web
featured: false
---

想让 agent 用上 Grok 的联网能力，但直接调它的会话有个麻烦：登录态是靠 cookie 维持的，短命的请求每次都要重新处理认证很别扭。grok2web 把这一层封装成一个 MCP 服务，跑在 Cloudflare Workers 上，帮你把 cookie 会话持久地保存下来。

作为 MCP 服务，它把 Grok 的能力包成 agent 能直接调用的工具，模型这边不用关心底下的认证和会话细节。持久会话让多轮的联网检索能连续进行，不会每次都从头开始。它主要用在两类场景：一般的联网信息获取，以及授权范围内的 CTF 工作流，后者常常需要一边搜资料一边推进解题。

选 Workers 还是那几个老理由，部署简单、离得近、不用自己养机器。这个仓库和前面的协议网关、grok 相关的几个东西是一条线上的：都是在琢磨怎么把各家模型的能力，用统一的方式接到自己的工具链里。
