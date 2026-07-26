---
title: SurveyController
description: 面向问卷星、腾讯问卷、Credamo 见数平台的纯 HTTP 高并发提交程序。
category: 工具
cover: ../../assets/covers/paper.svg
coverAlt: 奶油纸张
date: 2026-07-22
tags: [asyncio, httpx, PySide6, 高并发]
link: https://github.com/LING71671/SurveyController
featured: false
---

给问卷平台做批量提交，最笨的办法是开浏览器自动化，一份一份点。但浏览器很重，几十个并发就把机器拖垮了。这个程序换了个思路：不碰浏览器，直接分析问卷平台的提交接口，用纯 HTTP 请求把答案发过去。

这样做的代价是要把每个平台的提交协议摸清楚。问卷星、腾讯问卷、Credamo 见数的接口各不一样，有的答案要编码成特定格式，有的带时间戳校验，有的对提交频率有限制。程序里为这几个平台分别写了适配层，把题目结构和答案规则抽象出来，配置好之后就能按设定的分布随机生成答案再提交。

并发这块用的是 asyncio 加 httpx，好处是单机就能撑起很高的并发量，不用为每个请求开线程。真正麻烦的不是发请求，是控制节奏：太快会触发平台的风控，答案分布太规整又会露馅。所以程序里加了不少细节，比如随机化提交间隔、模拟真实的作答耗时、让选项分布带上合理的噪声。界面用 PySide6 和 QFluentWidgets 做，配置和进度都能直接看到。
