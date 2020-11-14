---
title: "我的私有云概览"
date: 2020-10-28T9:28:09+08:00
tags: [Cloud]
draft: false
---



因为自己实在是太想拥有一个自己专属的私有云了，并且之前看到一个开源项目`NextCloud`，感觉很对我胃口。我就是喜欢这种大而全的一站式云解决方案，刚好手头的阿里云闲置了，就拿出来搞点事情。顺便又折腾了一下一些其他服务的搭建。

下列我对自己网站的功能要求，及解决方案：

- 安全性：`NextCloud`和其他搭建的服务都有一定的安全性保障
- 文件存储和同步：`NextCloud`核心功能就是这个
- 日历功能：`NextCloud`自带的就OK，还支持[CalDAV](https://en.wikipedia.org/wiki/CalDAV))
- 邮件客户端web mail：`NextCloud`有个挺漂亮的邮件客户端，但是中文存在编码问题，搭了个[RainLoop](https://www.rainloop.net/)来满足这一需求
- 联系人：`NextCloud`自带的挺不错，支持[CardDAV](https://en.wikipedia.org/wiki/CardDAV)
- 离线下载：使用[Aria2](https://github.com/aria2/aria2)提供多线程的下载，使用[Aria2-NG](https://github.com/mayswind/AriaNg)做Web客户端
- 任务、看板：`NextCloud`自带
- RSS阅读：用[tiny-tiny-rss](https://tt-rss.org/)搭建了RSS阅读器客户端，还搭了一个[RSSHub](https://github.com/DIYgod/RSSHub)用来生成一些特殊网站的订阅源
- 媒体管理和播放：暂时用的[Plex](https://www.plex.tv/)，但是免费版移动端播放有限制
- Markdown编辑和同步：`NextCloud`的编辑器凑活能用，但是还是[Joplin](https://joplinapp.org/)比较好用，还支持多端同步
- 思维导图：`NextCloud`的`MindMap`应用就不错
- 网站服务状态监控：用的[uptime robot](https://uptimerobot.com/)

配置方面不想写，可以参考网上的教程。
