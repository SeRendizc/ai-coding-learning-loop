# AI Coding Learning Loop

**中文** | [EN](README.md)

一个配合DeepSeek Harness使用的AI编程学习插件。你可以选择将多少实现工作交给AI，审核方案，再结合完成的代码学习其中的设计。插件分别记录代码验证结果和学习进展。

工作流提供四种实现分工，从自己完成核心代码到全部交给AI。每种模式都有相应的理解检查：解释设计、预测行为，或将方法用到变化后的问题中。

> Alpha预览版。已测试的Harness基线为`0.1.0-rc.7`，已验证版本与测试项见[兼容性文档](docs/compatibility.md)。

## 安装

需要Node.js `^22.19.0 || >=24.0.0`、pnpm，以及经过测试的DeepSeek Harness版本。

```bash
dsh plugin --profile web add "github:SeRendizc/ai-coding-learning-loop#agent/h0-harness-compatibility"
dsh web
```

两条命令使用同一个`dsh`。打开`http://127.0.0.1:3080`，配置模型服务并新建会话。安装目标目前是可变的预览分支；固定版本命令、隔离profile和卸载方式见[安装文档](docs/install.md)。

## 使用

```text
/ownership start
```

插件会询问学习目标、实现分工和当前熟悉程度。确认学习协议后，Agent读取对话与工作区，再提出实现计划。如果你已经明确了编码任务，计划会沿用该任务。

审核具体任务、实现步骤、测试方法和关键学习点后，再批准执行。Agent按所选模式完成工作，代码验证通过后讲解设计，并请你回答理解检查。如果回答还不充分，会先回到教学，再继续尝试。

```text
学习协议 -> 方案审核 -> 实现 -> 验证 -> 讲解 -> 理解检查
```

`/ownership status`查看当前进度，`/ownership report`生成报告。代码测试通过与理解检查完成会分别显示。

## 实现分工

| 模式 | AI负责 | 你负责 | 理解检查 |
|---|---|---|---|
| `GUIDED` | 规划、讲解与审查 | 核心实现 | 解释 |
| `HUMAN_LED` | 脚手架和部分代码 | 核心方法与数据流 | 解释、预测 |
| `AI_LED` | 大部分实现与验证 | 审查并修改一个关键学习点 | 解释、预测、应用 |
| `DELEGATED` | 全部实现与验证 | 理解设计并迁移应用 | 解释、预测、应用 |

熟悉程度影响讲解的详细程度和脚手架多少，不会取消所选模式的理解检查。

## 工作原理

学习协议确定目标与分工，实现计划单独审核。协议建立后，Harness的`tools/pre-execute` hook会拦截执行类工具，直到工作流进入实现阶段；只读探索仍然可用。Harness本身的权限和沙箱规则继续生效。

理解检查绑定具体的讲解内容与实现版本。实现发生变化后，需要重新验证和讲解，再开启新的检查。

学习事件保存在独立的事件账本中，报告和快照由事件生成；快照无效时，通过回放账本恢复。默认保存引用与摘要，不保存源码、完整工具载荷或用户自由作答原文。细节见[架构](docs/architecture.md)、[工作流](docs/workflow.zh-CN.md)和[隐私文档](docs/privacy.md)。

## 开发

核心模块及其演示不依赖Harness，可以在不接入模型服务的情况下运行：

```bash
git clone https://github.com/SeRendizc/ai-coding-learning-loop.git
cd ai-coding-learning-loop
npm run check
npm run demo -- .local-test/comparison
```

演示生成Markdown/JSON对照报告，包含三个任务、四种分工模式和一个不使用Skill的基线。这些是脚本化协议样例，标记为`empirical_human_study: false`，并非对真实学习效果的测量。

完整的本地Harness集成检查使用`npm run test:local`，环境要求与准备步骤见[本地测试](docs/local-testing.md)。

当前版本一次处理一个工作单元，回答是否通过由评估器判断，证据存储尚无跨进程锁。工具分类采用名称模式，新接入的第三方工具可能需要单独适配。接入真实模型的Web流程验收和外部用户反馈仍列在[发布清单](docs/release-checklist.md)中。扩展适配器前，请阅读[已知限制](docs/limitations.md)。

相关实验：[Agent Runtime Lab](https://github.com/SeRendizc/agent-runtime-lab)研究工具执行的持久化，[Agent Eval Lab](https://github.com/SeRendizc/agent-eval-lab)研究模型接口行为。
