# Paper Margin

在 DeepSeek Harness 侧栏阅读文件，划选原文、就地写评论，再随下一条消息一起发给 Agent。

[English](README_EN.md) · [下载](https://github.com/Aruvelut111/dsh-paper-margin/releases) · [接口文档](docs/reader-bridge.md)

## 使用

1. 在右侧打开文件或原生浏览器网页，选中一段文字，点击**添加到对话**。
2. 在原文旁写评论。Enter 确认，Shift+Enter 换行，也可以只引用原文。
3. 主输入框显示 **N 条注释**，可以编辑、删除或点击来源回到原文。
4. 写下问题并发送。Agent 会收到原文、评论、文件地址和可用的页码/单元格信息。

待发送选区显示蓝色高亮和 1、2、3… 编号。编号按会话和批次排列，删除后补齐。发送成功后清除原文标记，已发内容从消息的「批注 ×N」回看。切换文件、会话和刷新保留未发送注释；关闭侧栏时收起高亮与浮窗。

侧边聊天由 sidenote 提供，其中的划选加入该侧聊的输入框，随该侧聊发送。主会话与侧聊各自编号、保存和发送。

## 安装

需要 DSH **0.2.2 系列**，已在 **0.2.2-rc.1** 验证。

### 一键安装（Windows）

先退出 DSH，在 PowerShell 中运行：

```powershell
irm https://github.com/Aruvelut111/dsh-paper-margin/releases/download/v2.5.7/install.ps1 | iex
```

脚本自动找到 DSH、下载并校验两个安装包，再调用官方插件安装命令。完成后重新打开 DSH。[查看脚本](scripts/install.ps1)。

已有 `dsh` 命令的终端可直接安装，无需手动下载：

```sh
dsh plugin --profile desktop add https://github.com/Aruvelut111/dsh-paper-margin/releases/download/v2.5.7/dsh-paper-margin-2.5.7.tgz https://github.com/Aruvelut111/dsh-paper-margin/releases/download/v2.5.7/dsh-sidenote-0.8.5-reader.5.tgz --ignore-scripts --save-exact
```

Web 版将 `desktop` 改成 `web`。

### 手动安装

从 [v2.5.7 Release](https://github.com/Aruvelut111/dsh-paper-margin/releases/tag/v2.5.7) 下载两个文件：

- `dsh-paper-margin-2.5.7.tgz`
- `dsh-sidenote-0.8.5-reader.5.tgz`

在 DSH 的「插件 → 添加插件」中安装这两个包，然后重启。已有 sidenote 时，配套包替换同名插件，保留原有侧聊和本地注释。它是基于 [g-yixuan/dsh-sidenote](https://github.com/g-yixuan/dsh-sidenote) 的阅读集成分支，源码在 [Aruvelut111/dsh-sidenote](https://github.com/Aruvelut111/dsh-sidenote/tree/fix/external-reader-annotations)。

CLI 也可以安装；文件路径按下载位置填写：

```sh
dsh plugin --profile desktop add ./dsh-paper-margin-2.5.7.tgz ./dsh-sidenote-0.8.5-reader.5.tgz --ignore-scripts --save-exact
```

## 文件支持

| 文件 | 阅读与注释 |
| --- | --- |
| PDF | Paper Margin 阅读器，分段读取大文件，文字选区带页码 |
| Markdown、代码、文本、Diff | 使用 DSH 预览，直接划选 |
| Excel | 选中单元格或区域，记录表名、范围和所选值 |
| Word | 使用 DSH 的 Office 转换和可选文字层 |
| HTML | 「打开方式 → HTML 批注阅读」，适合静态文档 |
| 图片 | 整图文字评论与文件来源 |
| 原生浏览器网页（桌面版） | 划选网页正文、就地写评论，按会话与完整 URL 保存，可点击来源重新打开定位 |

扫描 PDF 需要文字层或外部 OCR。HTML 批注阅读保留内嵌样式，禁用原文脚本和外部资源。PPT 转换仍依赖宿主，尚未完成专项实测。图片评论目前不自动发送图片像素。

网页支持 DSH 桌面版原生侧栏浏览器的正文，不接管外部 Chrome、夸克或其他浏览器插件。跨域内嵌框架、Canvas 和封闭 Shadow DOM 不在此次支持范围。网页改变原文后可能无法重新定位；注释本身仍保留。登录与网页功能使用 DSH 原生策略，不读取外部浏览器登录态。

## 开发

Node.js 24.9 或更新版本：

```sh
npm ci
npm run check
npm pack
```

`check` 运行模块边界、类型、构建和单元测试。测试包含可独立运行的 sidenote 协议快照。真实宿主验证过侧栏关闭、双会话编号与发送隔离、删除重排及刷新恢复。

PDF 本地读取检查：`npm run verify:open -- /path/to/book.pdf`。

## 项目与许可

Paper Margin 负责文件捕获和定位，配套 sidenote 负责注释清单、持久化及原生发送事务。原生查看器仍可从打开方式菜单选择。注释保存在当前浏览器站点的 localStorage，清除站点数据会删除本地注释。

项目使用 [MIT](LICENSE) 许可证。感谢 [dsh-sidenote](https://github.com/g-yixuan/dsh-sidenote) 的注释与侧聊实现、[dsh-cite-lens](https://github.com/adithyanraj03/dsh-cite-lens) 的引用定位算法，以及 PDF.js、DOMPurify、Schemastery 和 Cosmokit。来源、改编范围和许可证见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。
