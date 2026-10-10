# Magpie / DeepSeek Flash

默认启用“使用本机连接配置”。插件原生进程读取
`~/.config/chat-translate/provider.json`，密钥不进入渲染进程或 Vencord 设置。
这个文件位于仓库外，POSIX 权限必须为 0600；它是本机明文配置，不是钥匙串。
仓库和构建产物不包含家庭地址或个人密钥。

如果本机 Paseo 已接入你的 Magpie，可以显式复制该端点和网关密钥：

```sh
npm run configure:magpie -- --from-paseo
```

脚本使用 Paseo 的 Codex provider 连接，配置模型
`deepseek/deepseek-v4-flash` 和 `low` 思考档位。只支持 HTTPS 源地址，
不输出密钥；如果文件已经存在，保留原文件并退出。它不修改 Paseo 或 Magpie。

也可在仓库外创建该配置：

```json
{
    "endpoint": "https://your-magpie-host/v1/chat/completions",
    "model": "deepseek/deepseek-v4-flash",
    "apiKey": "your-gateway-key",
    "reasoningEffort": "low"
}
```

端点、模型和密钥整体来自该文件；插件界面里的自定义地址不参与合并，
避免把本机密钥发送到另一个地址。超时和最大输出 token 仍由界面控制。
每次请求重新读取文件，更新密钥会替换原生翻译器。配置错误明确报错，
不会静默改用其他服务。

Electron 使用系统网络栈。家庭 CA 须先得到操作系统信任；插件保留证书验证，
不提供忽略证书错误的开关。单独 Node 测试与 Electron 信任行为不同。

`low` 是思考强度，不代表关闭思考或零思考 token。网关可能转换协议和模型名，
只解析 `choices[0].message.content` 的 JSON 译文，独立思考内容不显示。
官方关闭参数、精确思考预算的文档边界和当前网关探测见
[DeepSeek 思考调研](DEEPSEEK-THINKING.md)。

## 可选真实请求验收

下列验证使用独立 Electron，无 Discord 窗口或账号，只发送合成文本。
它调用真实配置的服务并消耗相应翻译 token，不在 CI 中运行。

```sh
npm install --prefix .cache --no-audit --no-fund --package-lock=false electron@42.11.1
npm run build
npm run test:magpie
```

覆盖带上下文的接收翻译、中文草稿译成英文、50 条输入中的 45 条待译＋5 条上下文、
ID 完整性、金额和占位符。结果保存在忽略的 `.cache/magpie-smoke.json`，
不包含密钥。测试句中的出金状态完全是合成示例，不能用于判断任何服务器的出金状态。
独立 Electron 验证仍不等于 Discord 内 IPC、视窗或草稿按钮验收。

回退连接配置时，关闭“使用本机连接配置”并填写自定义服务；
或者移除本机 profile 后重新配置。客户端安装单独进行。
