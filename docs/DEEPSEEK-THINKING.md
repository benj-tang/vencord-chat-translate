# DeepSeek 思考参数与当前 Magpie 链路

调研日期：2026-10-10。区分官方协议、网关声明和实际响应。
检索工具未返回有效页面内容，因此直接读取下列官方页面进行核对：

- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)
- [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion)
- [Responses](https://api-docs.deepseek.com/api/create-response)

## 官方参数

Chat Completions 的明确关闭方式：

```json
{
    "thinking": { "type": "disabled" }
}
```

当前 Chat 参数页也列出 `reasoning_effort: "none"` 表示关闭思考。
Responses 使用：

```json
{
    "reasoning": { "effort": "none" }
}
```

`low`、`high`、`max` 控制思考强度，不承诺精确的思考 token 数。
本次核对的三页没有列出 `budget_tokens`、`thinking_budget` 或
`max_thinking_tokens` 等单独的思考预算参数；这不代表所有服务商都没有类似扩展。

Chat 的 `max_tokens` 最小为 1，是生成长度上限。
Responses 的 `max_output_tokens` 同时约束可见输出和思考输出。
将输出上限设为 0 不是上述官方关闭思考方式；减小总输出上限还可能截断 JSON 译文。

## 当前网关声明和实测

本机私密配置使用 `deepseek/deepseek-v4-flash`。读取当前 `/v1/models`
得到该路由声明支持思考，档位为 `low`、`high`、`max`，上游端点列为
`/v1/responses`；没有声明 `none`。实际返回模型名为 `deepseek-flash`。
没有改动网关、Paseo 或路由器配置。

使用插件实际提示词，分别探测 Chat `low` / `none` 和 Responses
`low` / `none`，均返回非零思考 token。另行探测：

| 请求                                                    | 待译＋上下文 | 耗时    | 思考 token | 总生成 token |
| ------------------------------------------------------- | ------------ | ------- | ---------- | ------------ |
| Chat 仅 `thinking: disabled`，不发送 `reasoning_effort` | 11＋5        | 4873 ms | 728        | 1182         |
| Responses `none`，模型别名 `deepseek/deepseek-flash`    | 11＋5        | 4879 ms | 663        | 1084         |

完整比较见 [实机及合成探测记录](LIVE-VALIDATION-2026-10-10.md)。
这些合成请求均成功返回并核对金额、ID 和保护符；少数 `none` 样本较快
不能证明关闭成功，也不能证明稳定提速。

另行读取了 Magpie v0.1.1130 的原始源码：`internal/gateway/ir.go`
的 `effortOf` 将 `none` / `minimal` 归到 `low`；跨协议转换仅在
关闭标记存在且模型支持 `none` 时恢复关闭；原协议也会按模型档位适配。
`internal/provider/modelprefs.go` 的 `SetModelEfforts` 对已知档位做限制，
不能据此声称用户覆盖配置能随意补出未声明的 `none`。
源码来自 [Magpie 项目](https://github.com/yetone/magpie)，本次读取版本
不等于已验证运行服务的精确版本或内部配置。

因此，当前插件继续保留 `low`，没有添加一个声称已生效的“零思考”开关。
后续排查应确认网关的能力登记、关闭标记和上游协议是否完整保留，
再以实际 `reasoning_tokens` 验证；不能只看请求参数或单次耗时。
