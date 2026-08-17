# AI Coding Learning Loop 中文说明

本项目解决的不是“AI 能不能写代码”，而是“AI 写完以后，用户是否真正获得了可迁移的理解”。

它提供四种委托模式：`GUIDED`、`HUMAN_LED`、`AI_LED`、`DELEGATED`。无论委托多少，实现都必须先通过工程验证，再进入教授式 Deliver；Deliver 讲清后，Gate 才能验证 Explain、Predict、Apply。

工程结果与学习结果始终分开。测试通过但 Gate 未通过时，工程仍可为 PASS，学习状态返回补教或记录为 PARTIAL/BLOCKED。

DeepSeek Harness 用户可通过 `/ownership start` 建立 Learning Contract，随后在同一会话提交编码任务。Skill 会通过内部 `ownership_lifecycle` Tool 按顺序记录 Brief、Build、Verify、Deliver 与 Gate；用户无需手工调用该 Tool。用户直接回答 Gate 后，可通过 `/ownership status` 查看双重状态，通过 `/ownership report` 生成报告。当前版本使用明确标注的 sidecar evidence backend；详细边界见 `compatibility.md` 与 `limitations.md`。
