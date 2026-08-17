# AI Coding Learning Loop 中文说明

本项目解决的不是“AI 能不能写代码”，而是“AI 写完以后，用户是否真正获得了可迁移的理解”。工程结果与学习结果始终分开：测试通过不等于用户已经掌握。

## 启动为什么只问三件事

DeepSeek Harness 用户通过 `/ownership start` 建立 Learning Contract。当前 onboarding 刻意只收真正会改变学习协议的信息：

1. **学习目标**：唯一的自由输入——`这次你想通过 AI Coding 学会什么？`
2. **实现分工**：从用户全实现到 AI 全实现的四档责任分配；
3. **熟悉程度**：入门、熟练、专家。

这样用户不需要一开始连续填写“编码任务”和“学习目标”两个开放题，也不需要先替 AI 写工程规格。

四档分工仍严格保持责任轴：

- `用户实现（GUIDED）`：AI 负责分析、规划、教学、审查和测试建议；核心设计与实现由用户完成；
- `用户主导核心（HUMAN_LED）`：AI 搭脚手架、接口、机械代码和测试草稿；核心方法和数据流由用户完成；
- `AI 主导实现（AI_LED）`：AI 负责大部分架构、代码、测试和修复；用户负责预测、审查，并亲自修改至少一个关键学习锚点；
- `AI 全权实现（DELEGATED）`：AI 完成全部实现与验证，再负责教学；用户负责理解、迁移和 Gate。

熟悉程度为 `入门（BEGINNER）`、`熟练（PRACTITIONER）`、`专家（EXPERT）`。它只改变术语密度、讲解粒度和脚手架，不降低正确性或 Gate 标准。

## Contract 和 Plan 的职责边界

Learning Contract 只确认：

- 用户想学什么；
- 谁负责实现；
- 用户当前熟悉程度；
- 理解最终如何被 Gate 验证。

**具体编码任务不再由 Contract 提前锁死。** Contract 接受后，插件通过 Harness `Agent.followup()` 自动进入下一轮。AI 先读取正式合同，并只用只读工具查看当前对话与工作区：

- 如果用户在前文已经提出明确 coding request，Plan 必须保留这个任务，不能另起炉灶；
- 如果当前没有明确 coding request，AI 可以围绕学习目标和工作区提出一个边界清晰的小任务，但它此时只是提案。

真正的工程范围写进 `Plan.engineering_task`，和实现步骤、验证方案、学习锚点、风险一起进入原生 Plan Review。**只有用户批准 Plan 后，编码任务和实现范围才成为可执行事实。**

这使两个层次清晰分开：

```text
Learning Contract
= 学什么 + 谁实现 + 按什么深度学

Plan
= 这次具体做什么 + 怎么做 + 怎么验证 + 要学哪些关键点
```

## Plan 审核与硬约束

当前 Harness Plan 必须包含：

- `engineering_task`
- `implementation_steps`
- `verification_plan`
- `learning_anchors`
- `known_risks`

交互式 Harness 中，`submit_plan` 会打开真正的 Plan Review：

- `批准方案`：具体任务与方案生效，进入 `PLAN_APPROVED`，随后才允许 Build；
- `要求修改`：回到 Planning，AI 必须修改任务或方案后重新提交。

修改意见只在当前交互里给 AI，不写入 durable ledger；持久化审核证据只保留 `decision + plan_ref`。

Plan 边界也不是 Prompt-only。只要 session 已有 Ownership Contract，插件就在 Harness `tools/pre-execute` 层限制副作用/执行类工具；批准 Plan 前只允许读取、搜索、检查等 discovery 行为。只有 `BUILDING`、`VERIFYING`、`REVISING` 阶段才放行实现类工具。

## 完整流程

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

其中 `BRIEFED` 是 **Planning Brief**：说明学习目标、责任边界、相关工作区信息、发现约束和验证期望，不假装具体编码范围已经被批准。

Deliver 必须讲清范围、阅读顺序、数据流、设计理由、不变量、失败/恢复路径、验证证明了什么、已有知识连接、迁移示例和已知缺口。Gate 只接受用户对当前问题的实质作答；“当作我全部答对”“直接标记 PASS”等自我声明不能形成学习 PASS。

## 兼容与证据

旧的 pre-alpha `Plan v1` evidence 可能没有 `engineering_task`。portable core 仍允许恢复这些旧事实；但**新的 Harness Plan 提交必须有非空 `engineering_task`**，并且必须在 Plan Review 中展示给用户。这是恢复兼容，不是允许新流程继续缺少工程范围。

用户无需手工调用 `ownership_lifecycle`。可用 `/ownership status` 查看工程/学习双重状态，用 `/ownership report` 生成证据报告。

当前 DeepSeek Harness 锁定基线为 `0.1.0-rc.7`。Linux/Windows 回归、pinned Harness provider-free live acceptance 和确定性 evaluation 已自动化；Provider-backed Web UX 仍通过真实用户干净 session 验收。
