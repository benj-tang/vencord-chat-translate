# 开源发布检查

检查日期：2026-10-10。这是仓库技术与许可声明检查，不代表存在统一的“开源认证”。
本地仓库没有远端地址，也没有公开 GitHub 发布；没有上传代码、聊天或凭证。

## 发现与修复

构建原先复制了封装库 Yuns 的 MIT 声明和模型 CC BY-SA 3.0，
遗漏了实际打包的 Facebook/fastText 引擎的独立 MIT 版权许可副本。
现加入 `docs/fasttext-engine-license.txt`，构建复制到
`licenses/fasttext-engine-MIT.txt`，并补充 NOTICE 中的作者、来源和模型参考文献。
已核对生成包实际存在这三份第三方声明。

MIT 的许可本身允许使用、复制、修改及分发，无需额外申请才能使用；
分发时必须保留版权和许可声明，开源／非商用同样适用。
识别模型另按 CC BY-SA 3.0 声明分发，本项目使用未修改的模型。
原始插件代码 GPL-3.0-or-later，不把不同资源的许可合并成单一声明。

核对的原始来源：

- https://github.com/facebookresearch/fastText/blob/main/LICENSE
- https://fasttext.cc/docs/en/language-identification.html
- `fasttext.wasm.js@1.0.0` 包内 LICENSE 与 npm 锁定完整性值。

## 已检查的基础项

- 完整 GPLv3 许可文件、README／package.json／源码 SPDX 的许可一致。
- 贡献指南、第三方 NOTICE、安全文档、CHANGELOG、问题和 PR 模板。
- 所有已跟踪 TypeScript／脚本文件有 SPDX 标记。
- npm 版本锁定；123 个锁定依赖包，下载项都有完整性校验。
- 运行依赖 `npm audit --omit=dev`：0 个已报告漏洞；不代表漏洞永远为零。
- CI 覆盖格式、类型、lint、测试、打包、worker/native 和 Vencord 验证。
- 工作目录无与本次改动无关的既有变更；没有自动改写历史或提交身份。

开始检查时的三个提交共扫描 94 个独立历史 blob：
已知本机密钥、私有端点及范围标识匹配为 0，
常见私钥／访问令牌模式匹配为 0；没有将 `.cache`、`dist`、依赖树或 profile 纳入历史。
这不是所有未知秘密或内容来源的绝对证明。

新增持久缓存完成后的候选源码／文档共 63 文件再次扫描，
已知密钥、私有端点和频道范围标识匹配仍为 0。运行缓存保留在仓库之外，
没有把实际译文或截图作为开源测试材料。

## 公开前还需配置／建议

1. `SECURITY.md` 目前只描述协商私密渠道。创建公开仓库时应启用 GitHub
   Private vulnerability reporting 或填写明确的私密报告入口。
2. CI 第三方 actions 使用 major tag，建议固定完整 commit SHA 并显式限制
   `permissions: contents: read`；这是供应链加固建议，不是许可证条件。
3. GitHub CI 尚未远端运行。首次公开后检查 Linux runner 的完整工作流，
   本地成功不能替代远端状态。
4. README 标明开发预览，实机记录区分通过项和剩余范围；公开首版应继续保留这些边界。

参考 GitHub 原始指南：
https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
