# 阅读批注接口

Paper Margin 捕获原文和来源，配套 sidenote 管理注释、草稿和发送。两个插件通过同一页面的 `CustomEvent` 交换数据。

事件名：`dsh-sidenote:external-annotation:v1`。

| action | 参数 | 作用 |
| --- | --- | --- |
| `probe` | `reply` | 查询接口是否可用 |
| `add` | `capture, reply` | 添加选区，或更新同一个捕获 |
| `list` | `sessionId, reply` | 读取该会话的外部注释 |
| `edit` | `sessionId, id, point?, reply` | 打开原位编辑器 |
| `remove` | `sessionId, id?, captureId?, reply` | 删除注释，支持重复确认 |

`capture` 包含 `id?`、`sessionId`、`text`、`note?`、`source`、`point?` 和 `edit?`。`source` 包含 `label`、`address?`、`page?` 和文字锚点 `anchor?`。锚点保存 `exact/start/prefix/suffix`。

`sessionId` 是发送目标，文件地址是引用来源。捕获 id 标识同一次选区；发送或删除后的重试不会新建注释，新选区使用新 id。修改已有记录时校验会话归属，提交期间保留未确认的编辑队列。

`reply` 同步返回 `{accepted,id?,items?}`。数据变化后派发 `dsh-sidenote:external-annotations-changed`；回源通过 `dsh-sidenote:reveal-external:v1`，携带 `{sessionId,source,text}`。

发送内容采用 sidenote 的注释前缀：`<annotation>` 包含 `<quote>` 和可选 `<note>`。文本进行 XML 转义。宿主确认消息进入目标会话或队列后，该批次才转为已发送；原文高亮随之移除，消息保留当次快照。
