# 原生侧栏网页补读

Paper Margin 自带只读工具 paper_margin_browser，直接读取 DSH Desktop 当前已加载的原生侧栏网页。它使用现有页面和登录状态，不重新抓取 URL，也不启动其他浏览器。

## 使用

照常划选并点击「添加到对话」，再让 Agent 结合原页解释。引用会带上 URL、来源会话和 Sidebar page 标识；Agent 可据此补读同一个页面。旧引用没有页面标识时，可先列出页面，核对唯一匹配的网址。

工具动作：

- list：列出发起调用的会话所拥有的已挂载原生网页；主对话与侧聊分别处理。
- read：传入 pageId 和 expectedUrl，读取正文的一段。默认 12000 字符，单次最多 20000 字符。
- find：在同一页面查找精确、区分大小写的 query，返回最多五处匹配及附近文字。

读取结果包含 readAt、version、scope、totalCharacters、readableCharacters、textLimitReached 和 nextOffset。需要继续时，把 nextOffset 作为下一次的 offset，并传回同一个 version。页面刷新或文字变化会使旧版本失效，应从 0 重新读取。搜索也支持同样的版本续读。

这是已加载主文档的可渲染文字，不是截图或整个网站。图片、Canvas、嵌入框架和尚未加载的内容不在返回范围；结果会报告嵌入框架数量。单页最多提供前 100 万字符，达到上限时明确返回 textLimitReached: true。

## 页面归属

工具从 DSH 的执行上下文取得发起会话，模型不能通过参数指定另一个会话。页面以独立 id 识别，同网址的两个标签不会混用。页面关闭、移到另一个会话或跳到其他网址后，旧引用的补读会返回原因，不自动换页。

页面 id 属于当前窗口中的这次标签实例。关闭再重开或重启应用后，旧引用仍保留选文和来源，但应重新列出并确认原网址；不能用旧 id 读取新实例。

## 实现

Host 使用 DSH 0.2.2 的 connection.fetch.register，沿用官方 /api 鉴权、owner Peer 和卸载生命周期。客户端在同源请求中等待命令，空闲长轮询只传页面元数据；不扫描正文、不监听网页内容变化、不执行滚动时提取。只有 read / find 执行原生 webview 的只读脚本。

原生 guest 的 executeJavaScript 与页面发现方式参考 MIT 项目 dsh-browser-bridge 和 dsh-sidebar-browser-agent，出处与许可保存在 THIRD_PARTY_NOTICES.txt 和 licenses。未引入它们的外部浏览器、交互控制或截图模块，也无需再安装一个插件。

