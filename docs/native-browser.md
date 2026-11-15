# 原生侧栏上下文

Paper Margin 将当前会话原生侧栏的资料清单通过 DSH 动态上下文提供给 Agent。清单包含网页、文件和侧聊的标题、活动/可见状态及可用的来源信息，不包含文件正文或聊天记录。资料关闭或状态改变后更新；不同会话分别处理。多个窗口或分栏同时可见时，Agent 需要区分来源。

同包只读工具 paper_margin_browser 直接观察 DSH Desktop 当前已加载的原生侧栏网页。它使用现有页面和登录状态，不重新抓取 URL，也不启动其他浏览器。文件清单提供解码路径和来源会话，文件正文仍由已有文件/文档工具读取。

## 使用

可以直接说「看看侧栏这份内容」，无需先划选。Agent 可从当前清单定位资料，先整体观察，再按问题深入。划选并点击「添加到对话」仍用于指出具体评论位置，引用保留 URL、来源会话和 Sidebar page 标识。

工具动作：

- list：列出发起调用会话的原生网页和资料元数据；主对话与侧聊分别处理。文件清单不要求预览已完成解析。
- observe：网页的常规首步；传入 pageId 和 expectedUrl，返回整页已加载主文档的标题层级、图片/Canvas/表格数量，以及开头正文。标题最多60项、每项160字符，超限明确标记。数量只表示元素存在，不代表读到了图像或图表。
- read：传入 pageId 和 expectedUrl，读取正文的一段。默认 12000 字符，单次最多 20000 字符。
- find：在同一页面查找精确、区分大小写的 query，返回最多五处匹配及附近文字。

读取结果包含 readAt、version、scope、totalCharacters、readableCharacters、textLimitReached 和 nextOffset。需要继续时，把 nextOffset 作为下一次的 offset，并传回同一个 version。页面刷新或文字变化会使旧版本失效，应从 0 重新读取。搜索也支持同样的版本续读。

短文可在一次 observe 中读全；长文按 nextOffset 和 version 继续 read。标题结构覆盖初始正文窗口之外的已加载章节。观察与读取覆盖已加载主文档的可渲染文字，不是截图或整个网站。图片、Canvas、嵌入框架和尚未加载的内容不在正文范围；结果会报告嵌入框架数量。单页最多提供前 100 万字符，达到上限时明确返回 textLimitReached: true。

## 页面归属

工具从 DSH 的执行上下文取得发起会话，模型不能通过参数指定另一个会话。页面以独立 id 识别，同网址的两个标签不会混用。页面关闭、移到另一个会话或跳到其他网址后，旧引用的补读会返回原因，不自动换页。

页面 id 属于当前窗口中的这次标签实例。关闭再重开或重启应用后，旧引用仍保留选文和来源，但应重新列出并确认原网址；不能用旧 id 读取新实例。

## 实现

Host 使用 DSH 0.2.2 的 connection.fetch.register，沿用官方 /api 鉴权、owner Peer 和卸载生命周期。客户端复用 sidebarRight 的实时标签清单与状态；Host 复用 systemPrompt.context，在模型请求前提供对应会话的最新元数据，清单最多展示16项并标记截断，完整清单可通过 list 查看。

客户端在同源请求中等待命令，空闲长轮询只传元数据；不扫描正文、不监听网页内容变化、不执行滚动时提取。状态没有变化的焦点事件不触发新请求。只有 observe / read / find 执行原生 webview 的只读脚本。

原生 guest 的 executeJavaScript 与页面发现方式参考 MIT 项目 dsh-browser-bridge 和 dsh-sidebar-browser-agent，出处与许可保存在 THIRD_PARTY_NOTICES.txt 和 licenses。未引入它们的外部浏览器、交互控制或截图模块，也无需再安装一个插件。

