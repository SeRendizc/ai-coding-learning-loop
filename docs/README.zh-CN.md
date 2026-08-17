# AI Coding Learning Loop 中文说明

本项目解决的不是“AI 能不能写代码”，而是“AI 写完以后，用户是否真正获得了可迁移的理解”。

它提供四种委托模式：`GUIDED`、`HUMAN_LED`、`AI_LED`、`DELEGATED`。无论委托多少，实现都必须先通过工程验证，再进入教授式 Deliver；Deliver 讲清后，Gate 才能验证 Explain、Predict、Apply。

工程结果与学习结果始终分开。测试通过但 Gate 未通过时，工程仍可为 PASS，学习状态返回补教或记录为 PARTIAL/BLOCKED。

DeepSeek Harness 用户可通过 `/ownership start` 建立 Learning Contract。用户只需用一句话写学习目标，再选择委托模式和当前熟悉程度；系统会从当前会话自动判断中英文，并让 AI 在 Plan 中拆解详细学习锚点。熟悉程度分为 `BEGINNER`、`PRACTITIONER`、`EXPERT`，只调整术语密度、讲解粒度和脚手架，不降低 Gate 标准。

Skill 会通过内部 `ownership_lifecycle` Tool 按顺序记录 Brief、Planning、Plan Review、Build、Verify、Deliver 与 Gate。Plan 是独立阶段：AI 给出实现步骤、验证方案、学习锚点和风险后必须暂停，只有用户明确 `APPROVE` 才能开始写代码；`REVISE` 会退回 Planning。用户无需手工调用内部 Tool。

Gate 只接受用户对当前问题的实质作答，“当作我全部答对”“直接标记 PASS”等自我声明或测试授权不能形成学习 PASS。用户直接回答 Gate 后，可通过 `/ownership status` 查看双重状态，通过 `/ownership report` 生成与会话语言一致的报告。当前版本使用明确标注的 sidecar evidence backend；详细边界见 `compatibility.md` 与 `limitations.md`。
