---
title: Universal-AI-Protocol-Bridge
description: 一个跑在 Cloudflare Workers 上的网关，把 OpenAI、Anthropic、Gemini、Bedrock、Azure、Ollama 的 chat 接口互相翻译并路由。
category: AI
cover: ../../assets/covers/lamp.svg
coverAlt: 黄铜台灯的光晕
date: 2026-07-16
tags: [Cloudflare Workers, LLM, 网关, TypeScript]
link: https://github.com/LING71671/Universal-AI-Protocol-Bridge
featured: false
---

各家大模型的 chat 接口都长得不太一样。OpenAI 有自己的一套请求体，Anthropic 是另一套，Gemini、Bedrock、Azure、Ollama 又各有各的字段和鉴权方式。写应用时如果直接对接某一家，换供应商就得改代码。

这个网关做的是中间那层翻译。它跑在 Cloudflare Workers 上，接收某种格式的请求，翻译成目标供应商的格式发出去，再把响应翻译回来。这样上层应用只需要认一套接口，底下换成哪家模型都不影响。流式响应也做了对齐，各家的 SSE 分块格式不同，网关会统一成一致的输出。

选 Cloudflare Workers 是因为它离用户近、冷启动快，而且不用自己维护服务器。路由规则可以按模型名或者请求内容来配，方便做多供应商的负载和回退。这个东西本来是自己用的，把几家不同的 key 收拢到一个入口后，切换模型做对比测试省了很多事。
