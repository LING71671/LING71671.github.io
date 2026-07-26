---
title: Open-ClaudeCode
description: 从 npm 发布的 source map 里，把 Claude Code 的源码和运行时结构重建出来的一份考古档案。
category: 逆向
cover: ../../assets/covers/ink.svg
coverAlt: 墨色晕染
date: 2026-07-25
tags: [逆向工程, source-map, Claude Code, TypeScript]
link: https://github.com/LING71671/Open-ClaudeCode
featured: true
---

Claude Code 是闭源的，但它发布到 npm 的包里带着 source map。source map 本来是给浏览器调试用的，会把打包压缩后的代码映射回原始文件名、变量名和目录结构。把这些映射反过来用，就能还原出相当接近原貌的源码树。

这个仓库做的就是这件事：拉取每个版本的 npm 包，解析里面的 source map，把还原出的文件按目录归档，再逐版本对比，看官方在两次发布之间改了什么。它不是一份运行得起来的代码，而是一份可以查阅的档案，用来回答一些具体的问题，比如某个功能是怎么实现的、系统提示词长什么样、工具调用的调度逻辑是怎么写的。

做这件事的动机是想弄清楚一个成熟的 agent 产品在工程上到底是怎么组织的。读别人的成品比读教程有用得多，尤其是这种每周都在迭代的项目，能看到很多真实约束下的取舍。仓库里也整理了跨版本的 diff，方便追踪某个模块的演化。

需要说明的是，这是研究用途的重建，一切以官方发布的 source map 为准，不包含任何未公开的内容。
