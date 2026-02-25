export const WORKFLOW_TEMPLATES: Record<string, string> = {
  chain: `---
name: Sequential Chain
description: Agents process input one after another
trigger: manual
steps:
  - id: step1
    agent: agents/processor-1.md
    prompt: "Process this input: {input}"
    outputs: [result]
  - id: step2
    agent: agents/processor-2.md
    depends_on: [step1]
    prompt: "Refine this: {step1.result}"
    outputs: [result]
  - id: step3
    agent: agents/processor-3.md
    depends_on: [step2]
    prompt: "Finalize this: {step2.result}"
    outputs: [result]
---
# Sequential Chain
Each agent processes the output of the previous one.
`,

  'fan-out': `---
name: Fan-Out / Fan-In
description: One agent distributes work, parallel workers process, collector gathers results
trigger: manual
steps:
  - id: distribute
    agent: agents/distributor.md
    prompt: "Break this task into parts: {input}"
    outputs: [parts]
  - id: worker1
    agent: agents/worker.md
    depends_on: [distribute]
    prompt: "Process part 1: {distribute.parts}"
    outputs: [result]
  - id: worker2
    agent: agents/worker.md
    depends_on: [distribute]
    prompt: "Process part 2: {distribute.parts}"
    outputs: [result]
  - id: collect
    agent: agents/collector.md
    depends_on: [worker1, worker2]
    prompt: "Combine results: {worker1.result} and {worker2.result}"
    outputs: [final]
---
# Fan-Out / Fan-In
Distributes work to parallel agents and collects results.
`,

  debate: `---
name: Debate
description: Two agents argue positions, a judge decides
trigger: manual
steps:
  - id: position_a
    agent: agents/debater-a.md
    prompt: "Argue FOR this position: {topic}"
    outputs: [argument]
  - id: position_b
    agent: agents/debater-b.md
    prompt: "Argue AGAINST this position: {topic}"
    outputs: [argument]
  - id: judge
    agent: agents/judge.md
    depends_on: [position_a, position_b]
    prompt: "Judge these arguments:\\nFOR: {position_a.argument}\\nAGAINST: {position_b.argument}"
    outputs: [verdict]
---
# Debate
Two agents take opposing sides, a third judges.
`,

  'review-loop': `---
name: Review Loop
description: Author writes, reviewer critiques, author revises
trigger: manual
steps:
  - id: draft
    agent: agents/author.md
    prompt: "Write a draft about: {topic}"
    outputs: [content]
  - id: review
    agent: agents/reviewer.md
    depends_on: [draft]
    prompt: "Review this draft critically: {draft.content}"
    outputs: [feedback]
  - id: revise
    agent: agents/author.md
    depends_on: [draft, review]
    prompt: "Revise your draft based on this feedback: {review.feedback}\\n\\nOriginal: {draft.content}"
    outputs: [final]
---
# Review Loop
Author drafts, reviewer critiques, author revises.
`,
};
