---
title: CyberSilenter
description: 一个本地的 Windows 小工具，用来隐藏 ChatGPT 桌面端的界面，并自动接续中断的任务。
category: 工具
cover: ../../assets/covers/wood.svg
coverAlt: 深色木纹
date: 2026-07-20
tags: [Windows, 自动化, Python, 桌面]
link: https://github.com/LING71671/CyberSilenter
featured: false
---

用 ChatGPT 桌面端跑长任务时有两个小烦恼。一个是窗口老占着屏幕，想让它在后台安静地跑；另一个是任务偶尔会停下来等你确认，或者跑到一半卡住，得手动去点一下才能继续。

CyberSilenter 就是为了解决这两件事做的本地工具。它能把 ChatGPT 桌面端的界面藏起来，让它不打扰你手头的别的事；同时会盯着任务的状态，发现停下来了就自动把它接续上，不用你守在旁边。

实现上它是个纯本地的 Windows 助手，靠识别窗口状态和界面元素来判断该做什么，所有操作都在自己机器上完成，不碰任何远程接口。做这个纯粹是因为自己有让它挂机跑活的需求，与其每隔一会儿去看一眼，不如写个小程序替我盯着。代码不复杂，是那种解决具体麻烦的顺手工具。
