---
title: open-reverselab
description: 一个给 AI agent 用的逆向工程实验室：197 篇知识库文章、MCP 工具，以及 CTF / APK / PE 的自动化流程。
category: 逆向
cover: ../../assets/covers/mountain.svg
coverAlt: 远山与晨雾
date: 2026-07-26
tags: [逆向工程, MCP, CTF, Frida, Ghidra, Android]
link: https://github.com/LING71671/open-reverselab
featured: true
---

逆向工程的知识很碎，散在博客、writeup 和各种工具的文档里。做这个仓库的起点是把自己这些年攒下的笔记整理成一套能被检索、能被复用的东西，最后长成了一个 197 篇文章的知识库，覆盖静态分析、动态调试、脱壳、协议还原、恶意样本分析这些主题。

光有文章还不够。真正让它变成一个「实验室」的，是把这些知识接到 agent 上。仓库里带了一组 MCP 工具，让模型能直接驱动 Ghidra、Frida 这类工具去做分析，而不是只给出文字建议。配套的自动化流程覆盖了几类常见任务：CTF 逆向题的解题、APK 的静态与动态分析、PE 文件的脱壳与结构解析。

这样组织的好处是，知识库和工具是互相咬合的。文章里讲的方法，能对应到具体可执行的工具调用；agent 在跑流程时遇到不熟悉的点，又能回到知识库里检索。逆向本来是很吃经验的活，把经验沉淀成文章、把操作沉淀成工具，是想让这个过程不那么依赖某一个人的记忆。
