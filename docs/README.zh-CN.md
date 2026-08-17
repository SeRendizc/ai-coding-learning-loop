# AI Coding Learning Loop 中文说明

本项目解决的不是“AI 能不能写代码”，而是“AI 写完以后，用户是否真正获得了可迁移的理解”。

它提供四种委托模式：`GUIDED`、`HUMAN_LED`、`AI_LED`、`DELEGATED`。无论委托多少，实现都必须先通过工程验证，再进入教授式 Deliver；Deliver 讲清后，Gate 才能验证 Explain、Predict、Apply。工程结果与学习结果始终分开：测试通过不等于用户已经掌握。

DeepSeek Harness 用户通过 `/ownership start` 建立 Learning Contract。启动时现在明确区分两件事：

- **编码任务**：这次到底要让 AI Coding 帮你完成什么；
- **学习目标**：你最想通过这次工作学会什么。

用户只需各用一句话回答。拿到真实输入后，系统再自动判断中英文，并用本地化标签询问实现分工与熟悉程度。中文分工从“用户全实现”到“AI 全实现”依次为：`用户实现（GUIDED）`、`用户主导核心（HUMAN_LED）`、`AI 主导实现（AI_LED）`、`AI 全权实现（DELEGATED）`；熟悉程度为 `入门（BEGINNER）`、`熟练（PRACTITIONER）`、`专家（EXPERT）`。

最终 Learning Contract 使用人类可读摘要展示编码任务、学习目标、分工、熟悉程度和 Gate，而不是直接暴露内部 JSON。接受 Contract 只确认任务和责任边界，**不等于批准实现**。

Contract 接受后，插件通过 Harness `Agent.followup()` 自动排入下一轮，不再要求用户手工输入“继续”。Skill 首先调用 `ownership_lifecycle status` 读取正式合同上下文，不需要搜索私有 evidence 目录。之后按 Brief → Planning 形成 Plan；`submit_plan` 使用严格 Schema，必须同时给出实现步骤、验证方案、学习锚点和已知风险。

在交互式 Harness 中，Plan 会通过真正的原生 Plan Review UI 单独交给用户审核：

- `批准方案`：进入 `PLAN_APPROVED`，随后才允许 Build；
- `要求修改`：退回 Planning，AI 必须按反馈重做并再次提交 Plan。

修改意见只在当前交互中传给 AI，不写入 durable ledger；持久化 Plan 审核证据只保留 `decision + plan_ref`。若宿主没有可用的人机交互 Provider，则回退到新的直接用户消息审批路径。

Plan 边界不仅存在于 Skill Prompt。只要当前 session 已存在 Ownership Contract，插件会在 Harness `tools/pre-execute` 层执行额外约束：读取、搜索等 discovery 工具仍可用，但副作用/执行类工具只有在 `BUILDING`、`VERIFYING`、`REVISING` 阶段才允许继续。未经 Plan 批准，AI 不能靠绕过状态机直接写文件或执行实现命令。

完整内部流程为：

```text
DISCOVER
→ CONTRACTED
→ BRIEFED
→ PLANNING
→ AWAITING_PLAN_REVIEW
→ PLAN_APPROVED
→ BUILDING
→ VERIFYING
→ DELIVERING
→ AWAITING_GATE
→ CLOSED
```

Deliver 必须完整讲清范围、阅读顺序、数据流、设计理由、不变量、失败/恢复路径、验证证明了什么、已有知识连接、迁移示例和已知缺口。Gate 只接受用户对当前问题的实质作答；“当作我全部答对”“直接标记 PASS”等自我声明或测试授权不能形成学习 PASS。Gate 的自由文本答案也不会写入 sidecar evidence。

用户无需手工调用 `ownership_lifecycle`。可以随时通过 `/ownership status` 查看工程/学习双重状态，通过 `/ownership report` 生成证据报告。

当前 DeepSeek Harness 锁定兼容基线为 `0.1.0-rc.7`。Linux/Windows 回归、pinned Harness provider-free live acceptance 和确定性 evaluation 已自动化；新的 Provider-backed Web 视觉/交互体验仍需要在干净 session 中做最终人工验收。详细边界见 `compatibility.md` 与 `limitations.md`。
