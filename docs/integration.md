# 单包集成

从 2.5.8 起，Paper Margin 的阅读器、注释与侧聊在同一仓库构建，发布为一个 `dsh-paper-margin` 包。运行和构建均不需要另一个 sidenote 仓库或安装包。

## 来源

`src/integrations/sidenote/` 来自 [g-yixuan/dsh-sidenote](https://github.com/g-yixuan/dsh-sidenote)，基于阅读集成分支提交 `20734db862495db26a50e0f9d836a9b1e696db0c`（0.8.5-reader.5）。保留原作者 gyixuan 的 MIT 许可，见 `licenses/sidenote.txt`。

集成调整包括：统一宿主与客户端入口、CSS Modules 构建、合并设置页和配置 schema。阅读捕获、文字定位和 PDF 渲染仍位于 `src/client/`；注释的保存、原生发送事务与侧聊生命周期位于内置模块。测试直接导入运行源码。

## 旧版升级

使用本仓库的 Windows 安装脚本升级旧双包安装。脚本校验单个 tgz，备份目标 profile 的包清单、锁文件和 Cordis 配置，然后调用 DSH 官方命令替换包、移除旧 `dsh-sidenote` 依赖并迁移对应覆盖项。

融合后的唯一运行 entry id 保留为 `side-chat`，包名为 `dsh-paper-margin`。这是宿主设置的历史地址。旧 `paper-margin` 配置迁入同一 entry，旧侧聊设置一并保留；若两者均有覆盖项，合并有效配置，适配宿主的整段 config 替换规则。其他插件的配置保持原样。

原有 `dsh-sidenote:*` 本地存储键、事件名、会话元数据和消息来源标识保留，避免丢失记录或破坏历史显示。安装器不删除浏览器站点数据和会话文件。手工 insert 的旧插件配置需先改为标准 bundle 安装，安装器会在替换前报告该情况。

DSH 保存本地包的 `file:` 来源，安装脚本把校验后的包保存在 `DSH_HOME/plugin-archives/paper-margin`。元数据备份位于 `DSH_HOME/plugin-backups/paper-margin`。无需把两个包拼装起来。

## 构建与验证

```sh
npm ci
npm run check
npm pack
```

产物的 `lib/index.js`、`lib/client.js` 和配置迁移 helper 全在同一 tgz。React、原生 UI 控件等宿主共享模块由 DSH 提供；PDF.js worker 和其他运行代码已打入包内。安装器是可选的安装辅助脚本，不是第二个插件。

升级失败时保留屏幕上打印的元数据备份路径。关闭 DSH 后可用旧 Release 的包回退，再只恢复本插件的配置；不要用完整旧 profile 覆盖其他插件的新设置。
