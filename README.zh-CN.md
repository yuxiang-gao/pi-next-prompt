<p align="center">
  <img src="assets/banner.png" alt="Pi Next Prompt — 可编辑的下一条消息建议，不自动发送" width="100%">
</p>

# Pi Next Prompt

[English](README.md) · [配置参考](docs/configuration.md) · [调试](docs/debugging.md)

为 Pi 提供类似 Claude Code 的下一条消息建议。当前对话模型回答结束时提出回复草稿；只有一条时，以**暗色虚拟文本显示在空输入框内**。

- **Tab 或右方向键**插入建议，再修改或 Enter 发送。
- **输入时隐藏，清空后恢复**，不会重新请求模型。
- **Esc** 忽略本轮建议。
- 配置两三条建议后，使用 **↑/↓ 选择**，再 Tab/右方向键接受。

接受不会发送或执行操作。已有草稿不会被覆盖。

## 获得第一条建议

```sh
pi install git:github.com/yuxiang-gao/pi-next-prompt
```

重启 Pi 或 `/reload`，然后执行：

```text
/next-prompt init
/next-prompt enable
```

完成一次任务并保持输入框为空。有合适建议时会显示在光标处。一条建议没有额外标签；多条使用输入框上方的紧凑列表。无法识别光标的自定义编辑器使用暗色备用行。

`init` 先备份已有配置，再生成禁用的新模板；`enable` 立即保存开关，本身不调用模型。配置位于 `~/.pi/agent/next-prompt.json`，遵循 `PI_CODING_AGENT_DIR`。默认 `generate` 模式不需要分类器密钥。

需要 **Pi 1.3.0+**、**Node.js 22.19+** 和交互终端。Print/JSON/RPC 不注入建议提示词。

## 工作方式

自动 `generate` / `hybrid` 模式向正常系统提示词添加一小段命名指令，让**当前对话模型**在答案末尾追加 `<next>建议回复</next>`。多条使用重复标签行。插件在助手消息保存前去掉这些元数据，并在内存中保留草稿。

**自动建议不增加聊天生成请求**，但指令和建议文本仍消耗正常回答的 tokens。流式输出时标签可能短暂可见，消息结束后移除；最终助手消息不含生成的元数据，指令仍属于系统提示词状态。

问题、选择、澄清都可以产生建议，模型也可以不建议。失败或中断不显示。提交、新任务、模型/会话/分支/上下文改变、禁用或 reload 会使旧建议失效；普通编辑只隐藏。接受后再清空草稿，也可恢复尚未发送或忽略的建议。

## 模式

| 模式 | 自动 | 手动 `/next-prompt suggest` |
| --- | --- | --- |
| `generate`（默认） | 使用正常答案中的 `<next>` 草稿 | 当前模型额外请求一次，生成新草稿 |
| `classifier` | Jev 按含义选择用户配置的回复类别 | 重新分类，不调用聊天模型 |
| `hybrid` | Jev 选择配置回复或真实 `<next>` 草稿 | 当前模型先生成新草稿，再交给 Jev 选择 |

所有生成均使用 Pi 当前模型，不再提供独立生成模型选择器。分类和混合模式使用独立配置的 System One endpoint/key。**不内置任何回复类别**，请在配置中定义选项、含义和回复文本。

仅手动使用时设置 `autoSuggest: false`，保留 `enabled: true`。正常轮次不注入建议指令；手动请求遵循模式，要求成功对话、空闲会话和空输入框。请求不新增对话轮次、不执行工具、不发送消息；额外生成可能计费，用量独立记录。

## 命令

| 命令 | 行为 |
| --- | --- |
| `/next-prompt` 或 `/next-prompt status` | 模式、就绪情况、建议和额外调用用量；保留当前建议 |
| `/next-prompt suggest` | 按所选模式请求新建议 |
| `/next-prompt enable` / `/next-prompt disable` | 保存并立即应用总开关 |
| `/next-prompt mode [generate\|hybrid\|classifier]` | 选择策略 |
| `/next-prompt reload` | 应用手动配置修改，使旧建议失效 |
| `/next-prompt init` | 备份原始字节后创建禁用模板 |

旧 `generator` 字段会被忽略并提示迁移，后续保存配置时移除。旧 `/next-prompt model` 只提示使用 Pi `/model`，不修改模型。

[完整配置](docs/configuration.md) 包括自定义类别、数量和 System One；[调试文档](docs/debugging.md) 包括 Jev 分数和未显示原因。

## 安装、更新和卸载

只试用一次：

```sh
pi -e git:github.com/yuxiang-gao/pi-next-prompt
```

```sh
pi update git:github.com/yuxiang-gao/pi-next-prompt
pi remove git:github.com/yuxiang-gao/pi-next-prompt
```

更改后重载或重启。卸载不会删除配置及备份。

## 开发

```sh
npm ci --ignore-scripts
npm run check
pi -e ./src/extension.ts
```

[架构和测试指南](docs/development.md)。无新增运行依赖，Pi 提供 peer packages。测试使用本地模拟模型/HTTP；POSIX 终端冒烟测试需要 `expect`，无需云端密钥或付费请求。问题反馈见 [GitHub Issues](https://github.com/yuxiang-gao/pi-next-prompt/issues)，请勿附带私有对话或密钥。

## 许可证

[MIT](LICENSE)。第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 致谢

标签式下一条消息生成和 Claude Code 风格的虚拟文本交互参考了 **Spencer Boucher** 的 [justmytwospence/pi-next-prompt](https://github.com/justmytwospence/pi-next-prompt)。编辑器绘制方式按 MIT 许可改编自该项目。本次重构采用了 [Ponytail](https://github.com/dietrichgebert/ponytail) 的简化原则。
