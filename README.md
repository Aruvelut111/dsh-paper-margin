# Paper Margin

在 DeepSeek Harness 侧栏阅读文件，划选原文、就地写评论，再随下一条消息一起发给 Agent。

[English](README_EN.md) · [下载](https://github.com/Aruvelut111/dsh-paper-margin/releases) · [接口文档](docs/reader-bridge.md)

## 使用

1. 在右侧打开文件或原生浏览器网页，选中一段文字，点击**添加到对话**。
2. 在原文旁写评论。Enter 确认，Shift+Enter 换行，也可以只引用原文。
3. 主输入框显示 **N 条注释**，可以编辑、删除或点击来源回到原文。
4. 写下问题并发送。Agent 会收到原文、评论、文件地址和可用的页码/单元格信息。

待发送选区显示蓝色高亮和 1、2、3… 编号。编号按会话和批次排列，删除后补齐。发送成功后清除原文标记，已发内容从消息的「批注 ×N」回看。切换文件、会话和刷新保留未发送注释；关闭侧栏时收起高亮与浮窗。

插件内置侧边聊天，其中的划选加入该侧聊的输入框，随该侧聊发送。主会话与侧聊各自编号、保存和发送。

### 对照多份资料

可以从不同文件或网页连续添加引用，放进同一会话的这一批注释，再写「对照这几处，说明适用条件和分歧」。每条引用保留自己的编号、来源和评论。侧聊已有「带回主对话」和「整段回流」，可将选中的回答或整段问答加入主会话的待发送内容。

### Agent 收到哪些内容

发送的是选区、评论和来源信息。文件引用同时提供可读路径，Agent 会收到按需调用已有工具补读来源的指引；PDF 和 Office 文件需要可用的文档解析或转换工具。相对路径属于来源会话的工作目录，引用地址本身不授予文件访问权限。

网页引用包含选文、URL 和原生页面标识。需要更多上下文时，Agent 可调用包内的 `paper_margin_browser`，直接读取同一张已打开网页，沿用它的登录态和动态内容，也可查找原句附近文字、分段继续读取。正文按需传给 Agent，返回读取时间、范围和页面版本。读取范围为已加载的主文档文字；图片、Canvas、内嵌框架和尚未加载的内容不在其中。[原生网页补读说明](docs/native-browser.md)。

## 安装

需要 DSH **0.2.2 系列**，已在 **0.2.2-rc.1** 验证。

### 一键安装（Windows）

先退出 DSH，在 PowerShell 中运行：

```powershell
irm https://github.com/Aruvelut111/dsh-paper-margin/releases/download/v2.6.0/install.ps1 | iex
```

脚本下载并校验一个完整安装包，调用官方插件安装命令。旧双包用户也用这条命令升级：脚本会备份配置、移除旧配套包并保留注释和侧聊记录。完成后重新打开 DSH。[查看脚本](scripts/install.ps1)。

### 新安装或手动下载

首次安装可直接使用单个 URL：

```sh
dsh plugin --profile desktop add https://github.com/Aruvelut111/dsh-paper-margin/releases/download/v2.6.0/dsh-paper-margin-2.6.0.tgz --ignore-scripts --save-exact
```

Web 版将 `desktop` 改成 `web`。Windows Web 版升级可下载脚本后运行 `./install.ps1 -Profile web`。

也可从 [v2.6.0 Release](https://github.com/Aruvelut111/dsh-paper-margin/releases/tag/v2.6.0) 下载 **`dsh-paper-margin-2.6.0.tgz`**，在 DSH 的「插件 → 添加插件」中安装这一个文件。阅读器、网页批注、注释清单和侧聊均已包含，无需配套包。

旧版分包安装请使用上面的一键脚本，以同时迁移旧 entry 覆盖项。配置迁移和来源见 [集成说明](docs/integration.md)。

## 文件支持

| 文件 | 阅读与注释 |
| --- | --- |
| PDF | Paper Margin 阅读器，分段读取大文件，文字选区带页码 |
| Markdown、代码、文本、Diff | 使用 DSH 预览，直接划选 |
| Excel | 选中单元格或区域，记录表名、范围和所选值 |
| Word | 使用 DSH 的 Office 转换和可选文字层 |
| HTML | 「打开方式 → HTML 批注阅读」，适合静态文档 |
| 图片 | 整图文字评论与文件来源 |
| 原生浏览器网页（桌面版） | 划选网页正文、就地写评论、回到来源；Agent 可按需补读同一张已登录页面 |

扫描 PDF 需要文字层或外部 OCR。HTML 批注阅读保留内嵌样式，禁用原文脚本和外部资源。PPT 转换仍依赖宿主，尚未完成专项实测。图片评论目前不自动发送图片像素。

网页支持 DSH 桌面版原生侧栏浏览器的正文，不接管外部 Chrome、夸克或其他浏览器插件。跨域内嵌框架、Canvas 和封闭 Shadow DOM 不在此次支持范围。网页改变原文后可能无法重新定位；注释本身仍保留。登录与网页功能使用 DSH 原生策略，不读取外部浏览器登录态。

## 开发

Node.js 24.9 或更新版本：

```sh
npm ci
npm run check
npm pack
```

`check` 运行模块边界、类型、构建和单元测试。测试直接覆盖包内注释源码、阅读协议和旧 profile 迁移。真实宿主验证过侧栏关闭、双会话编号与发送隔离、删除重排及刷新恢复；原生网页补读另测登录态、动态内容、查找、切页与会话隔离。

PDF 本地读取检查：`npm run verify:open -- /path/to/book.pdf`。

## 项目与许可

Paper Margin 内置文件阅读、文字定位、注释清单、持久化、原生发送事务和侧聊。原生查看器仍可从打开方式菜单选择。注释保存在当前浏览器站点的 localStorage，清除站点数据会删除本地注释。

项目使用 [MIT](LICENSE) 许可证。感谢 [dsh-sidenote](https://github.com/g-yixuan/dsh-sidenote) 的注释与侧聊实现、[dsh-cite-lens](https://github.com/adithyanraj03/dsh-cite-lens) 的引用定位算法、[dsh-browser-bridge](https://github.com/alvinlui-hk/dsh-browser-bridge) 和 [dsh-sidebar-browser-agent](https://github.com/Hesitate-P/dsh-sidebar-browser-agent) 的原生网页桥接方案，以及 PDF.js、DOMPurify、Schemastery 和 Cosmokit。来源、改编范围和许可证见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。
