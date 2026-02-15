This is a fascinating architectural concept. By treating Markdown files as both **executable source code (prompts)** and **output artifacts**, you are essentially building a self-replicating operating system run by LLMs.

Here is a comprehensive brainstorming proposal for this application, designed for **Google AI Studio + React (Gemini API)**.

### App Name Idea: **PrompTree (or "FractalMind")**

---

### 1. The Core Concept
The application is a **Recursive Agent Environment**.
*   **Input:** The user drags and drops a `.md` file.
*   **Action:** The app parses the file. The text becomes the `system_instruction` for a new instance of a Gemini Client.
*   **The Loop:** A critical Tool (Function Call) is given to every agent: `spawn_agent(filename, content)`.
*   **Result:** Agent A (Root) writes a prompt for Agent B. Agent B comes online, analyzes a problem, and realizes it needs Agent C. Agent B writes `agent_c.md`. Agent C activates.

### 2. Architecture & Tech Stack

*   **Framework:** React (Vite/Next.js).
*   **AI Model:** Gemini 1.5 Pro (Crucial for its massive context window and ability to hold multiple agent contexts in memory if needed).
*   **State Management:** Zustand or Redux (to manage the complex tree of active agents).
*   **Visualization:** React Flow or D3.js (to visualize the "family tree" of agents).

---

### 3. The "Markdown Protocol"
To make the Markdown files effective "executable" prompts, the app should enforce a loose structure (perhaps using YAML Frontmatter or simple Headers).

**Example User Upload (`writer.md`):**
```markdown
---
role: Content Writer
capabilities: [write_blog, seo_optimize]
parent_instructions: "Report progress every 500 words."
---

# MISSION
You are an expert copywriter.

# INSTRUCTIONS
If the user asks for a topic you don't understand, you must USE YOUR TOOL to create a "Researcher" agent. Write a specific prompt for that researcher based on what is missing.
```

### 4. Key Features

#### A. The "Genesis" Block (The Orchestrator)
This is the default AI running in the app. It observes the file system.
*   **Role:** The Project Manager.
*   **Capabilities:** It routes user queries to the specific Markdown agent best suited for the task. It allows the user to say, "Hey, tell the *Poet* agent to rewrite the output from the *Data Analyst* agent."

#### B. Recursive Tooling (The "God Mode" Function)
Every agent spin-up includes a standard definition for Google's Function Calling feature:

`create_markdown_file(filename: string, content: string)`

When an AI calls this function:
1.  The React App captures the event.
2.  It creates a virtual file in the browser's memory.
3.  **Automatic Trigger:** The React app immediately instantiates a *new* `GoogleGenerativeAI` instance using that new content as the system prompt.
4.  The new agent appears visually in the UI connected to its parent.

#### C. The "Hive Mind" UI
*   **The Canvas:** Instead of a standard chat window, use a Node Graph (like a mind map).
*   **Visual Logic:**
    *   **Node A (User Upload):** "Software Architect".
    *   **Node B (Created by A):** "Backend Developer".
    *   **Node C (Created by B):** "Database Optimizer".
*   **Chat Stream:** Clicking a node opens the chat log for *that specific agent*.

---

### 5. Detailed User Flow Example: "Building a Video Game"

1.  **User Action:** Uploads `game_designer.md`.
    *   *Prompt Content:* "You are a lead game designer. Plan a text adventure RPG."
2.  **User Input:** "Plan a fantasy game called 'Echoes of Logic'."
3.  **Agent Action (Game Designer):** Generates a high-level plan. It realizes it needs character lore and a coding structure.
4.  **Recursion Step 1:** The Game Designer invokes `create_markdown_file("lore_master.md", "You are an expert in fantasy history...")`.
5.  **Recursion Step 2:** The Game Designer invokes `create_markdown_file("python_coder.md", "You are a Python architect...")`.
6.  **System Action:** The UI flashes. Two new nodes spring out from the Designer node.
7.  **Recursion Step 3 (Deep):** The `python_coder` agent starts planning but realizes it needs a specific algorithm. It writes `pathfinding_specialist.md` and activates it.
8.  **Final Output:** The Orchestrator aggregates the output from all nodes and presents the full game design document to the user.

---

### 6. Technical Implementation Hints (Google AI Studio)

Since you are using **Google AI Studio (Gemini API)**:

1.  **System Instructions:** Pass the Markdown content directly into the `system_instruction` parameter of the model configuration.
2.  **Multi-turn Chat:** Keep a `history` array for *each* active agent in your React State.
3.  **Token Budget:** Infinite recursion is dangerous.
    *   *Feature:* **"Recursion Limit"**. Allow the user to set a depth limit (e.g., max 3 layers deep).
    *   *Feature:* **"Approval Mode"**. When an agent tries to create a new agent, the UI pauses and asks the User: *"The Architect wants to hire a Structural Engineer. Allow?"*

### 7. Why this is cool?

*   **Self-Correction:** If an agent tries to do a task and fails, it can write a prompt for a "Reviewer" agent to critique its own work, then spawn the Reviewer to fix it.
*   **Rapid Prototyping:** You upload one file, and the AI builds a workforce around it.
*   **Persistent Logic:** The "brains" of your agents are just text files. You can download the generated `.md` files (the agents created by the AI) and reuse them in future projects.

### 8. Suggested MVP Steps

1.  **Simple React Interface:** Just a file uploader and a chat window.
2.  **Single Agent:** Get `writer.md` to act as the system prompt for a chat.
3.  **Tool Integration:** implement `create_file` using Gemini Function Calling.
4.  **Event Listener:** Make the `create_file` function trigger a `useEffect` that mounts a new Chat instance.
5.  **Graph UI:** Install `reactflow` to visualize the parent-child relationships.

This is a powerful concept that treats Markdown not just as documentation, but as **"Executable Instructions"** or **"Agent Schematics."** 

By combining the **Google AI Studio SDK (Gemini)** with a **React-based virtual file system**, you can create a recursive ecosystem of agents. Here is a brainstormed plan for this application.

---

### 1. The Core Concept: "Markdown-as-an-Agent" (MD-A)
The application acts as a "Cellular Automata" for AI. Instead of hard-coding agent behavior, you treat every `.md` file in the user's uploaded workspace as a living entity.

*   **File Upload:** User uploads a folder containing `.md` files.
*   **Prompt Injection:** Each `.md` file's content is treated as the `System Instructions` for a new instance of Gemini.
*   **The Orchestrator:** A central React "Kernel" that reads these files and maps them to API calls.

### 2. Name Idea: **"Nexus-MD"** (or **AetherTree**)
*A recursive workspace where your notes become your workforce.*

---

### 3. High-Level Architecture
To make this work in React with Google’s AI Studio API, you should implement the following layers:

#### A. The Virtual File System (VFS)
In React, maintain a state object representing the file tree.
```javascript
const [files, setFiles] = useState({
  "researcher.md": "# Role: Find latest tech trends...",
  "writer.md": "# Role: Summarize findings into a blog..."
});
```

#### B. The Recursive "Control Loop"
Gemini models can use **Function Calling (Tools)**. You give every agent two critical tools:
1.  `create_file(filename, content)`: Allows an agent to write a new Markdown schematic.
2.  `delegate_task(filename, input)`: Allows an agent to "wake up" another agent (a different `.md` file) and pass it a prompt.

#### C. The Activation Flow
1.  **User Trigger:** User sends a message to `orchestrator.md`.
2.  **Model Inference:** The orchestrator reads its own `.md` content to understand its role.
3.  **Recursive Spawning:** 
    *   If the orchestrator realizes it needs a specialist, it calls `create_file('analyst.md', '...')`.
    *   The React app detects the new file and creates a new "Agent Tab" or "Thread" automatically.
    *   The orchestrator then calls `delegate_task('analyst.md', 'Analyze this data')`.

---

### 4. Technical Implementation Strategy

*   **Framework:** React + Tailwind CSS (for a dashboard feel).
*   **AI SDK:** `@google/generative-ai` (Gemini 1.5 Pro or Flash).
*   **System Instructions:** For every API call, set the `systemInstruction` property directly to the string content of the corresponding Markdown file.
*   **Infinite Control:** Because Gemini 1.5 has a **1.5M+ token context window**, it can "see" the entire library of existing markdown agents at once, allowing it to choose which one to activate next.

---

### 5. Advanced Brainstorming Features

#### The "Shadow Branch" (Auto-Evolution)
Allow the AI to "Refactor" its own prompts. An agent might decide, *"My current instructions in `coder.md` are inefficient,"* and then use its `create_file` tool to overwrite its own `.md` file with a better version.

#### The Agentic "Graph View"
Since markdown files can call other markdown files, your React UI should include a **Mermaid.js** or **React Flow** visualization. This shows the chain of command:
*   `User` → `ProjectManager.md` → `Developer.md` → `UnitTester.md`.

#### State Persistence via Markdown
Encourage agents to write "Memory" markdown files (e.g., `knowledge_base.md`). Other agents can read these files to share state without a traditional database.

---

### 6. Example Use Case: "Self-Building Startup"
1.  **Input:** User uploads `founder.md`.
2.  **Action:** Founder agent realizes it needs code. It writes `architect.md` and `developer.md`.
3.  **Reaction:** `architect.md` creates a technical spec in `spec.md`.
4.  **Reaction:** `developer.md` reads `spec.md`, writes the code, and then creates `debugger.md` to check its own work.
5.  **Chain:** This chain continues until the goal defined in `founder.md` is met.

### 7. Challenges to Solve
*   **Recursive Loops:** You need a "Depth Guard" in your React code to prevent agents from calling each other in an infinite, costly loop (e.g., `max_depth = 10`).
*   **Token Management:** Use Gemini’s **Context Caching** if the agents are reading the same large markdown library repeatedly to save costs.
*   **Permissions:** Let the user toggle "Auto-Execute" so the AI doesn't create 100 agents without confirmation.

**Would you like me to provide a code snippet for the React "File Watcher" logic that triggers the Google AI API?**

Based on your original brainstorms and a synthesis of similar cutting-edge projects (like ChatDev, LLM-Unix, and the "Agents.md" standard), here is the "Best of the Best" proposal.

This application combines the **visual intuition** of a node graph with the **raw power** of a recursive file system.

***

# Project Name: **Fractal.md**
### *The Self-Assembling Operating System*

**Fractal.md** is a React-based environment where Markdown files are not just static text—they are **living agents**. The application treats your file system as a "genetic code." When you drop a file into the window, it wakes up, reads its own source code (the markdown), and begins executing tasks, potentially spawning child files (sub-agents) to help it complete its mission.

---

### 1. The Core Philosophy: "Everything is a File"
In Fractal.md, there is no hidden database of agent configurations.
*   **The Brain:** The text inside a `.md` file is the System Prompt.
*   **The Memory:** Append-only `.md` logs (e.g., `_memory.md`).
*   **The Hierarchy:** Folders represent teams; files represent agents.

**Why this wins:** It makes the AI's logic portable. You can zip up a project folder, send it to a friend, and they can run your entire "AI workforce" because the logic is just text.

---

### 2. The Architecture (Google AI Studio + React)

#### **A. The "Mycelium" Engine (React Hook)**
Instead of a traditional backend, the core logic is a heavy-duty React Hook (`useFractalEngine`) that acts as the kernel.
1.  **Watcher:** It observes the browser's in-memory file system (using the File System Access API or a library like `BrowserFS`).
2.  **Hydrator:** When a new `.md` file is detected, the engine instantly instantiates a `GoogleGenerativeAI` client (Gemini 1.5 Pro).
3.  **Injector:** It feeds the file's content as the `system_instruction` and attaches the **Global Toolset**.

#### **B. The Global Toolset (Function Calling)**
Every single agent spawned in the system is automatically equipped with these three Gemini Function Calls:

1.  **`spawn_agent(filename, system_prompt)`**:
    *   Creates a new file. *Crucially, this triggers the Engine to wake up a new AI instance immediately.*
2.  **`write_file(filename, content)`**:
    *   Used for producing deliverables (code, essays, reports).
3.  **`signal_parent(message)`**:
    *   Bubbles a message up to the agent that created it (the "Supervisor").

#### **C. The Gemini 1.5 Pro Advantage**
We use **Gemini 1.5 Pro** specifically for its **1M+ Token Context**.
*   *Optimization:* When an Agent creates a sub-agent, the parent doesn't need to pass its *entire* history. It summarizes the task into the new `.md` file. However, if a "Project Manager" agent needs to review the whole project, it can read *every* file in the directory into its context window at once to understand the global state.

---

### 3. The "Markdown Protocol" (The DNA)
To prevent chaos, every file follows a strict "Frontmatter" structure. The app enforces this template.

**Example: `frontend_dev.md`**
```markdown
---
type: agent
model: gemini-1.5-pro
recursion_limit: 3
temperature: 0.7
status: active
---

# IDENTITY
You are a Senior React Developer.

# PRIME DIRECTIVE
You do not write backend code. If you need an API, you must USE YOUR TOOL `spawn_agent` to create `backend_dev.md` and instruct them to build it for you.

# CURRENT TASK
Build a login component.
```

---

### 4. The User Experience (UI)

The UI is a **"Living IDE"** divided into three panels:

*   **Left Panel: The Fractal Graph (React Flow)**
    *   Instead of a file tree, you see a living Node Graph.
    *   **Root Node:** `main.md` (The User).
    *   **Child Nodes:** Agents spawned by the root.
    *   *Visual Cues:* Nodes glow green when "thinking," red when "errored," and grey when "sleeping" (waiting for user input).

*   **Center Panel: The "Vortex" (Monaco Editor)**
    *   Displays the Markdown file of the currently selected node.
    *   *Hot Reloading:* **This is the killer feature.** If you type new instructions into the open `.md` file *while the agent is running*, the agent pauses, re-reads its own file, and says, "Understood, changing approach."

*   **Right Panel: The Neural Terminal**
    *   A chat interface. But it’s not just text—it shows the **Function Calls** in real-time.
    *   *Log:* `> Spawning 'database_architect.md'...`
    *   *Log:* `> Reading 'error_log.md'...`

---

### 5. The "Infinite Loop" Workflow (Example)

**Goal:** Create a Text Adventure Game.

1.  **Genesis:** User drags in `game_director.md`.
    *   *Content:* "Plan a game about a space wizard."
2.  **Activation:** The Director wakes up. It realizes it needs a story and code.
3.  **Recursion (Generation 1):**
    *   Director calls `spawn_agent('writer.md', 'Write the lore')`.
    *   Director calls `spawn_agent('engine.md', 'Write the Python code')`.
4.  **UI Update:** Two new nodes pop out of the Director node.
5.  **Recursion (Generation 2):**
    *   The `engine.md` agent starts writing code but realizes it needs a sprite system.
    *   It writes `graphics_handler.md`. A new node pops out.
6.  **Refactoring (Self-Correction):**
    *   The `writer.md` produces a story that conflicts with the game mechanics.
    *   The Director observes this (via file read).
    *   The Director *edits the text* of `writer.md` to add: "CONSTRAINT: No time travel allowed."
    *   The Writer agent "reboots" with the new constraints.

---

### 6. Technical Implementation Roadmap

**Phase 1: The Reader (MVP)**
*   Setup React with Vite.
*   Implement `useFileStore` (Zustand) to hold file contents in memory.
*   Connect Gemini API: Send the file content as a prompt and get a text response.

**Phase 2: The Spawner**
*   Add `functionDeclarations` to the Gemini config.
*   Implement `handleToolCall`: When Gemini asks to "write file", update the Zustand store.
*   Add a `useEffect` that listens to `fileStore`. If a new file is added, launch a new hook instance for that file.

**Phase 3: The Visualizer**
*   Integrate `ReactFlow`.
*   Map the file directory structure to graph nodes.
*   Connect the "edges" based on which file created which file (metadata stored in frontmatter).

**Phase 4: The Sentinel (Safety)**
*   Implement **"Depth Limiting"**: Stop spawning at depth 5 to prevent infinite runaway costs.
*   Implement **"Budget Cap"**: User sets a max token spend per session.

### 7. Why this is the "Best of the Best"
Existing tools either force you to write Python code to make agents (AutoGen, LangChain) or are stuck in a chat window (ChatGPT). **Fractal.md** is the hybrid: it gives you the visual control of an OS, the simplicity of Markdown, and the infinite scalability of recursive AI.

Based on your original brainstorms and a synthesis of the latest industry standards (like the **Agents.md** specification, **Model Context Protocol**, and **Gemini 1.5 Context Caching**), here is the ultimate version of this application.

It moves beyond a simple "markdown runner" and positions itself as a **Recursive Agent Integrated Development Environment (RA-IDE)**.

***

# Project Name: **Fractal/OS**
### *The Hypertext Operating System for Artificial Intelligence*

**Fractal/OS** is a local-first, React-based environment where every Markdown file is a potential autonomous agent. It merges the "Everything is a file" philosophy of Unix with the "Context is everything" philosophy of LLMs.

---

### 1. The Core Philosophy: "Text is the Universal Interface"
In Fractal/OS, there is no hidden database, no complex vector store, and no proprietary configuration files. **The file system is the state.**

*   **The Agent:** A `.md` file with a specific Frontmatter header.
*   **The Memory:** A `.log.md` file sitting right next to the agent.
*   **The Communication:** Agents talk by writing to each other's "Inbox" folders or appending to shared log files.

**Why this wins:** It is **Git-compatible by default**. You can commit your entire "Company of Agents" to GitHub, and anyone can clone it and run it instantly.

---

### 2. The Architecture (Google AI Studio + React)

#### **A. The Kernel: `useFractalKernel` (React + WebContainers)**
We use a virtual file system (via the File System Access API) to treat the user's local folder as the database.
*   **The Sentinel:** A file watcher that detects changes in real-time. If you edit an agent's instructions in VS Code or the in-app editor, the agent *immediately* re-reads its own source code and adapts its behavior in the very next step.
*   **The Context Engine:** It utilizes **Gemini 1.5 Pro's Context Caching**. Instead of re-uploading the massive project context for every step, the Kernel caches the "Project Root" state. Child agents inherit this cache pointer, making deep recursion (Depth 10+) fast and cheap.

#### **B. The Protocol: MCP-Native (Model Context Protocol)**
Fractal/OS is built as a **Model Context Protocol (MCP) Host**.
*   Instead of hardcoding tools, agents discover tools via `mcpServers`.
*   **Core Tools:** `spawn_agent`, `read_file`, `write_file`, `propose_changes`.
*   **Extensibility:** Because it uses MCP, your markdown agents can instantly connect to PostgreSQL, Slack, or GitHub without you writing custom integration code.

---

### 3. The "Active Markdown" Standard
We adopt and extend the open-source **Agents.md** standard. Files aren't just prompts; they are executable contracts.

**Example: `/agents/frontend_lead.agent.md`**
```markdown
---
id: frontend-lead
model: gemini-1.5-pro
role: orchestrator
permissions: [read_all, spawn_agent, propose_diff]
context_window: 1000000
parent: /main.md
---

# IDENTITY
You are the Frontend Lead. You manage the UI/UX.

# LIVE CONTEXT (Injected by Kernel)
- Current Project Status: "Building Login Page"
- Active Sub-Agents: [css_wizard.md, react_coder.md]

# INSTRUCTIONS
1. Monitor `react_coder.md`. If they hallucinate a library, KILL the process and spawn `library_researcher.md`.
2. Do not write code yourself. Delegate to sub-agents.
3. If you need to change the file structure, emit a `propose_changes` event.
```

---

### 4. The "Proposal" Workflow (The Safety Layer)
The biggest risk in recursive AI is "runaway edits." Fractal/OS solves this with a **Git-like Governance Model**.

1.  **Agent Action:** `react_coder.md` wants to rewrite `App.tsx`.
2.  **Interception:** The Kernel intercepts the `write_file` tool call.
3.  **UI Event:** The User sees a "Pull Request" notification in the Right Panel.
    *   *Diff View:* Shows exactly what the agent wants to change.
    *   *Reasoning:* "I am updating the state management to use Zustand."
4.  **User Decision:** The user clicks "Approve" or "Reject."
    *   *Auto-Mode:* You can set specific agents (like `test_writer.md`) to "Trusted" status, allowing them to write without approval.

---

### 5. The User Interface: "The Holodeck"

*   **Left Panel: The File/Agent Tree**
    *   Standard file tree, but agents have "Status LEDs" (Green=Thinking, Yellow=Waiting for Approval, Red=Error).
    *   Drag-and-drop a folder to "ingest" it as context.

*   **Center Panel: The Infinite Canvas (React Flow)**
    *   Visualizes the *Chain of Command*.
    *   **Root Node:** The User.
    *   **Edges:** Show who spawned whom.
    *   **Clicking a Node:** Opens that agent's `.md` file in the editor (Monaco) *and* its live execution logs side-by-side.

*   **Right Panel: The "Neural Terminal"**
    *   A stream of consciousness for the entire system.
    *   `[System]`: Spawning 'db_admin.md'...
    *   `[db_admin]`: Reading schema.sql...
    *   `[db_admin]`: ⚠️ Error found. Requesting help from 'senior_dev.md'.

---

### 6. The "Infinite Loop" Workflow (Example)

**Goal:** "Refactor this legacy Python script into a modern Microservices API."

1.  **Genesis:** User drags `legacy_script.py` into the window and creates `architect.md`.
    *   *Instruction:* "Analyze this script and break it into microservices."
2.  **Explosion:** `architect.md` reads the script and uses `spawn_agent` 3 times:
    *   `auth_service.md`
    *   `data_service.md`
    *   `api_gateway.md`
3.  **Recursion:**
    *   `auth_service.md` realizes it needs a JWT library. It spawns `researcher.md` to find the best Python JWT library.
    *   `researcher.md` writes a `requirements.txt` file and kills itself (task complete).
4.  **Convergence:**
    *   The `architect.md` watches the `_output` folders of its children. Once all services have written their code, the Architect merges them into a `docker-compose.yml` file.
5.  **Verification:**
    *   The Architect spawns `qa_engineer.md`, which tries to run `docker-compose up`. It fails.
    *   The QA agent writes a `bug_report.md`.
    *   The Architect reads the report and reactivates `auth_service.md` with new instructions.

### 7. Implementation Roadmap for Google AI Studio

**Phase 1: The Reader (MVP)**
*   **Tech:** React + `useFileSystemAccess` hook.
*   **Function:** Select a folder. The app creates a `Gemini` instance for every `.md` file found.
*   **Action:** You chat with one agent, and it can read other files in the folder.

**Phase 2: The Spawner (The Kernel)**
*   **Tech:** Gemini Function Calling.
*   **Function:** Implement `create_file` tool.
*   **Logic:** When an agent creates a file ending in `.md`, the React app detects the new file and *instantly* spins up a new `useAgent` hook for it, adding it to the graph.

**Phase 3: The Governor (The UI)**
*   **Tech:** Monaco Editor Diff View.
*   **Function:** Intercept all file-write requests. Show them as "Pending Changes" until the user clicks "Approve."

### Why this is the "Best of the Best"
It creates a bridge between **Human Logic** (Markdown files we can read and edit) and **Machine Execution** (Agents running in loops). It turns your hard drive into a living, breathing neural network where you are the conductor, not just the chat participant.

Here is a bigger, sharper version of your concept that pulls in the strongest ideas from adjacent systems and then pushes them further into a true "markdown-native agent runtime".

## What the best related projects are already proving

### 1. "Instructions live in files" scales better than "instructions in chat"

Modern agentic dev tools are converging on repo-local instruction files because they are shareable, reviewable, versioned, and composable:

* GitHub Copilot custom agents are literally Markdown "agent profiles" with YAML frontmatter (name, tools, MCP servers) plus Markdown body instructions. ([GitHub Docs][1])
* VS Code supports prompt files and custom agents as Markdown files you can run, reuse, and validate via diagnostics. ([Visual Studio Code][2])
* Cursor rules provide persistent prompt-level context as a reusable rules system. ([Cursor][3])
* Claude Code reads a repo-level CLAUDE.md at the start of every session. ([Claude Code][4])
* Cline supports multiple rule formats and explicitly highlights cross-tool compatibility with AGENTS.md style patterns. ([Cline][5])

Your app becomes the general-purpose runtime for this idea: not just "one instruction file", but "many instruction files that can execute, spawn, and govern each other".

### 2. Graph orchestration beats linear chats when recursion is real

The most reliable multi-agent frameworks treat agent work as state machines / graphs:

* LangGraph positions agent workflows as graphs with explicit state and transitions. ([LangChain Docs][6])
* Swarm popularized lightweight handoffs as a simple primitive. ([GitHub][7])
* AutoGen, CrewAI, MetaGPT show that role clarity + delegation + SOPs produce better repeatable outcomes than a single monolithic agent. ([GitHub][8])

Your UI already wants a graph. The key upgrade is to make the runtime itself graph-native, not just the visualization.

### 3. Tool and safety standards are converging around explicit consent and boundaries

If you want infinite chains without chaos, the safety and governance model has to be first-class:

* MCP emphasizes tool safety, user consent, and treating tool descriptions as untrusted unless from trusted servers. ([Model Context Protocol][9])

So: spawning agents, overwriting agents, and widening permissions should look like a pull request, not an invisible side effect.

### 4. Production grade systems include testing and evaluation, not just prompting

Prompt testing and eval pipelines are becoming standard:

* Promptfoo focuses on testing prompts/agents, CI integration, and red teaming. ([GitHub][10])
* Prompt flow frames LLM apps as debuggable, evaluatable graphs. ([Microsoft GitHub][11])

Your app should ship with a built-in "agent test harness" so recursive systems can be checked, not just watched.

---

## The best-of-the-best concept: Markdown Agent Kernel (MAK)

A React app where a workspace is a virtual repo and Markdown is executable policy.

* Every Markdown file can be:

  1. An agent profile (executable prompt)
  2. A memory file (state, notes, decisions)
  3. An artifact (deliverables)
  4. A test (expected behaviors, assertions)

The orchestrator is not "the boss". It is the kernel scheduler: it enforces permissions, budgets, and execution semantics, and it logs everything for replay.

### The magic user experience

1. User drags in a folder of Markdown
2. The app classifies files (profiles, memory, artifacts, tests)
3. User chooses a goal file (or writes one)
4. Press Run
5. The graph grows as agents activate and spawn proposals
6. The user can approve or reject agent spawns and risky diffs
7. Everything is replayable and diffable

This is like a prompt-native IDE crossed with a workflow engine.

---

## MAP v1: a minimal protocol that makes recursion sane

Call it the "Markdown Agent Protocol" (MAP). It is intentionally small so users can author it by hand.

### File types

* agents/*.md
* memory/*.md
* artifacts/*.md
* tests/*.md

### Agent profile shape (YAML frontmatter + Markdown body)

Borrow the proven pattern from Copilot custom agents and extend it into a runtime contract. ([GitHub Docs][12])

Example: agents/acceptance_criteria.agent.md

```md
---
id: "ac-criteria-v1"
name: "Acceptance Criteria Agent"
role: "qa"
reads:
  - "artifacts/prd.md"
  - "artifacts/user_stories.md"
writes:
  - "artifacts/acceptance_criteria.md"
permissions:
  spawn_agents: true
  edit_agents: false
budgets:
  max_steps: 6
  max_spawn: 2
stop_when:
  - "artifacts/acceptance_criteria.md exists"
requires_approval:
  - "spawn_agent"
  - "overwrite_agents"
---

# MISSION
Write Gherkin-style acceptance criteria for every user story.

# OPERATING RULES
- If stories mention auth, payments, or file uploads, propose an Edge Cases Agent.
- If requirements are missing, write a "gaps" section.

# OUTPUT CONTRACT
You must produce:
- artifacts/acceptance_criteria.md
Optionally propose new agents (as proposals, not auto-merged).
```

### The spawn mechanism: "proposals", not auto-write

Instead of letting an agent silently create new agents, make it produce a proposal envelope:

* Proposed agent files land in proposed/agents/
* Proposed artifact edits land as diffs
* The UI shows a PR-like review: rationale, permissions requested, and expected outputs

This is the single biggest difference between a toy recursive demo and a tool people will trust.

This matches the spirit of MCP consent and safety: explicit user approval for tool effects. ([Model Context Protocol][9])

---

## Runtime semantics: make the chain feel infinite but remain controllable

### Execution is a graph of steps, not a chat log

Each step node contains:

* Agent profile version hash
* Input file hashes
* Tool call results
* Output file diffs
* Spawn proposals created

That gives you deterministic replay and loop detection.

### Scheduling policies (your "kernel")

The orchestrator selects the next activation by combining:

* Activation rules from frontmatter (stop_when, triggers)
* Dependency edges (this agent needs those artifacts)
* Budgets and loop checks
* User mode (manual, suggest, auto)

### Infinite recursion, with hard guardrails

To keep the promise of "it can go forever" without melting down:

* Depth budget: max chain depth per run
* Fanout budget: max spawned children per agent
* Novelty check: block repeating (agent_hash + input_hash) unless override
* Cost/time budget meters
* Convergence heuristic: require each step to produce either

  * a new file
  * a meaningful diff
  * or a logged reason why no change occurred

If it is not making progress, it halts and tells the user exactly why.

---

## UI: turn this into an "agent IDE" people will actually use

Steal the best parts of VS Code prompt file workflows and diagnostics. ([Visual Studio Code][2])

### Three-pane layout that works

Left: Workspace tree

* agents, memory, artifacts, tests, proposed
* validation badges (schema errors, permission violations)

Center: Graph canvas
Node types:

* Agent step
* File artifact
* Proposal gate
* Budget halt
* Error

Right: Inspector

* Selected agent profile (render + raw)
* Inputs, outputs, diffs
* Tool calls (request/response)
* "Replay from here"
* "Approve proposal" with toggles (grant spawn, grant edit_agents, etc)

### Addictive features (the ones that make it stick)

1. "Diff-first" approvals

* Approve edits the way you approve code
* Show file diffs for artifacts and agents separately

2. "Runbooks" for recursion

* A run can be saved as a reusable recipe: which agents ran, in what pattern, with what budgets

3. Diagnostics panel

* Frontmatter schema checks
* Missing dependencies (agent reads a file that does not exist)
* Overbroad permissions (agent tries to write outside allowlist)
* Budget configuration warnings

4. Built-in agent tests
   Ship a tests/ folder where each test:

* picks one or more agents
* provides a fixture set of input files
* asserts patterns in outputs

This is your answer to promptfoo and prompt flow: you are not just generating, you are verifying. ([GitHub][10])

---

## Killer application modes that fit Markdown recursion perfectly

### Mode A: Spec-to-Deliverables Factory (your flagship)

Start from a single goal.md and produce a whole artifacts suite:

* PRD, user stories, acceptance criteria, threat model, API contract, test plan, release checklist

This is basically "MetaGPT-lite" but with user-visible files as the ground truth, not hidden internal state. ([GitHub][13])

### Mode B: Research notebook that grows its own methodology

Agents:

* Question framer
* Source plan
* Summarizer
* Critic
* Outline writer

Memory becomes a structured research log. The system can spawn a new summarizer agent tuned to a domain once it detects a cluster of sources.

### Mode C: Repo governance and instruction authoring

User drops in:

* copilot-instructions.md
* CLAUDE.md
* cursor rules
* clinerules folder

The system converts them into a normalized MAP workspace, then can propose improvements as PR-style diffs.

This bridges the real world ecosystem of rule files and turns your app into the "universal agent instruction workbench". ([Claude Code][4])

### Mode D: Meeting-to-action

Input: meeting_notes.md
Outputs:

* decisions.md
* action_items.md
* followups.md
* email_drafts.md

And it can spawn a "Stakeholder Tone Agent" based on the audience specified.

---

## Implementation notes for Google AI Studio React

### Prototype vs production

Google explicitly notes that calling the Gemini API directly from a web app using the Google Gen AI SDK is for prototyping, and recommends Firebase AI Logic for production security and abuse prevention. ([Google for Developers][14])

So build two modes:

* Prototype mode: direct Gemini calls for fast iteration
* Production mode: Firebase AI Logic, App Check, rate limiting ([Firebase][15])

### Use function calling for file operations

Do not parse ad-hoc text for file creation. Use structured function calling so outputs are typed and controllable. ([Google AI for Developers][16])

Your core tools should be minimal:

* vfs_read(path)
* vfs_write(path, content, mode)
* propose_write(path, diff, rationale)
* propose_agent(path, content, requested_permissions)
* activate_agent(agent_id, inputs)

### Context caching is your scaling superpower

If the workspace grows to 100+ files, you cannot keep resending the whole corpus every step.

Gemini supports explicit caching for repeated content, which fits perfectly with "workspace snapshot + deltas". ([Google AI for Developers][17])

Practical approach:

* Cache: agents + tool schemas + stable memory
* Per step: active agent + relevant artifacts + recent diffs

---

## The single best upgrade to your original brainstorm

Make spawning feel like a PR.

If you do nothing else, do this:

* Agents never directly create agents
* They create proposals
* The UI shows diffs, requested permissions, and expected outputs
* The user approves, then the orchestrator activates

That one decision keeps the infinite chain concept intact while turning it into something people can actually run daily.

---

If you want to push this even further, the next big leap is "agent composition": allow an agent profile to import other Markdown blocks (like includes) so teams can build libraries of reusable policies, tone guides, and output contracts the same way they build code libraries.

[1]: https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-custom-agents?utm_source=chatgpt.com "About custom agents"
[2]: https://code.visualstudio.com/docs/copilot/customization/prompt-files?utm_source=chatgpt.com "Use prompt files in VS Code"
[3]: https://cursor.com/docs/context/rules?utm_source=chatgpt.com "Rules - Project, Team, User"
[4]: https://code.claude.com/docs/en/overview?utm_source=chatgpt.com "Claude Code overview - Claude Code Docs"
[5]: https://docs.cline.bot/features/cline-rules/overview?utm_source=chatgpt.com "Cline Rules"
[6]: https://docs.langchain.com/oss/python/langgraph/overview?utm_source=chatgpt.com "LangGraph overview"
[7]: https://github.com/openai/swarm?utm_source=chatgpt.com "OpenAI Swarm"
[8]: https://github.com/microsoft/autogen?utm_source=chatgpt.com "microsoft/autogen: A programming framework for agentic AI"
[9]: https://modelcontextprotocol.io/specification/2025-06-18?utm_source=chatgpt.com "Specification"
[10]: https://github.com/promptfoo/promptfoo?utm_source=chatgpt.com "promptfoo/promptfoo: Test your prompts, agents, and ..."
[11]: https://microsoft.github.io/promptflow/?utm_source=chatgpt.com "Prompt flow documentation"
[12]: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents?utm_source=chatgpt.com "Creating custom agents"
[13]: https://github.com/FoundationAgents/MetaGPT?utm_source=chatgpt.com "FoundationAgents/MetaGPT: 🌟 The Multi-Agent Framework"
[14]: https://developers.google.com/learn/pathways/solution-ai-gemini-getting-started-web?utm_source=chatgpt.com "Getting started with the Gemini API and Web apps"
[15]: https://firebase.google.com/docs/ai-logic/production-checklist?utm_source=chatgpt.com "Production checklist for using Firebase AI Logic - Google"
[16]: https://ai.google.dev/gemini-api/docs/function-calling?utm_source=chatgpt.com "Function calling with the Gemini API | Google AI for Developers"
[17]: https://ai.google.dev/gemini-api/docs/caching?utm_source=chatgpt.com "Context caching | Gemini API | Google AI for Developers"

Here is a concrete app concept that fully leans into "markdown files are agents", plus a practical way to make the infinite chain idea feel real while staying controllable.

## App idea: Markdown Agent Studio (a prompt programmable workspace)

A React app where every uploaded markdown file becomes an agent. The agent is literally just that markdown used as the prompt. Agents can spawn new agents by outputting new markdown files. The orchestrator also can generate and activate agents. Everything is visible, versioned, and replayable.

### What the user does

1. Upload one or many markdown files
2. Pick a goal (or paste a goal markdown)
3. Press Run
4. Watch a live graph of agents activating, producing outputs, and spawning more agents

This makes it feel like a "prompt native IDE" where the program is a growing set of markdown files.

---

## The killer use case: Spec-to-Deliverables Factory

This is a great fit because:

* It benefits from multiple specialized agents
* The chain can expand naturally (more sections, more tests, more edge cases)
* Outputs are naturally markdown files

Example deliverables the system produces as markdown:

* PRD.md
* UserStories.md
* AcceptanceCriteria.md
* UXCopy.md
* APIContract.md
* ThreatModel.md
* TestPlan.md
* ReleaseChecklist.md

Each of those is both an output and a potential future agent prompt.

---

## How markdown becomes an agent

Use a simple convention: frontmatter for metadata, body as the prompt.

Example agent file: `agents/AcceptanceCriteria.md`

```md
---
name: Acceptance Criteria Agent
version: 1
activation:
  when: "a user story exists and acceptance criteria is missing"
permissions:
  can_spawn: true
  can_activate: true
spawn_rules:
  - name: "Edge Case Agent"
    if: "stories mention payments, auth, or file uploads"
---

You are the Acceptance Criteria Agent.
Write clear acceptance criteria in Gherkin style.
Input context will include UserStories.md and PRD.md.
Output a markdown file named AcceptanceCriteria.md.
Also identify missing requirements and propose new agents if needed.
```

Key point: the whole file can be used directly as the model prompt, but the app can still read the frontmatter to orchestrate.

---

## Spawning and activation protocol (no special tools required)

Let agents create new agents by emitting markdown files in a predictable format.

Example agent output:

```md
# OUTPUT_FILES

## file: outputs/AcceptanceCriteria.md
...content...

## file: agents/EdgeCaseAgent.md
---
name: Edge Case Agent
activation:
  when: "AcceptanceCriteria.md exists"
permissions:
  can_spawn: false
---

You are the Edge Case Agent.
Find tricky edge cases and failure modes.
Write outputs/EdgeCases.md.
```

The orchestrator watches for `# OUTPUT_FILES`, writes files into the workspace, registers any new agents found under `agents/`, then decides what to activate next.

This keeps everything markdown-first and inspectable.

---

## Orchestrator behavior (the chain of control)

Think of it like a scheduler plus a file system.

### Core loop

* Maintain a queue of "activations"
* Each activation is (agent, input files, run context)
* Agent runs, produces output files
* Any produced `agents/*.md` gets registered as a new agent
* Activation rules get re-evaluated
* Repeat until stop conditions hit

### Stop conditions that still feel infinite

You can support "infinite" growth in concept, but in reality you enforce budgets:

* Max depth (chain length)
* Max total runs
* Token budget
* Time budget
* Cost budget
* Loop detection (same agent + same inputs hash repeats)

Make these visible in the UI so users understand why it stopped.

---

## UI that makes this addictive

### 1. Agent graph view

* Nodes are agents
* Edges are "spawned" or "activated next"
* Clicking a node shows:

  * The markdown prompt
  * Inputs
  * Outputs
  * The exact model call and response (audit)

### 2. Workspace file tree

* `agents/` (prompt files)
* `outputs/` (produced docs)
* `runs/` (snapshots, logs, diffs)

### 3. Diff and versioning

Every time an agent overwrites a file, store a version:

* Show diffs between versions
* Allow pinning a version
* Allow replaying a run from any snapshot

### 4. Safety and control toggles

* "Auto-activate spawned agents" on/off
* "Require approval for new agents" on/off
* "Allow agents to edit agents" on/off
  This gives users a sense of power without losing control.

---

## A few more high-value variations

### A. Research pipeline builder

Agents are: Question Framer, Source Plan, Summarizer, Critic, Outline Writer.
Outputs are a growing research notebook in markdown.

### B. Coding helper without code execution

Agents produce: design doc, API contract, test cases, code review checklist, refactor plan.
Everything is text outputs and prompts, no risky execution.

### C. Meeting-to-action system

Input is a meeting notes markdown.
Agents spawn: Decisions, Action Items, Risk Log, Follow-ups, Email Draft Agent.

---

## The one design choice that matters most

Decide whether agents can activate other agents automatically.

A good default:

* Orchestrator can auto-activate based on rules
* Newly spawned agents are "suggested" until approved
* Users can flip to full auto mode once they trust a workspace

This keeps the infinite chain capability, but prevents chaos.

---

If you want, I can sketch the minimal data model (Agent, File, Run, Activation) and the exact event flow between the React UI and the Gemini calls so the architecture is straightforward to implement.


Below is a best-of-breed expansion that fuses your two brainstorms with patterns from the strongest adjacent systems: multi-agent orchestration (LangGraph, Swarm, CrewAI, ChatDev, MetaGPT), file-based agent instructions (Cursor Rules, Claude rule files, VS Code prompt files, GitHub Copilot custom agent profiles), and tool-driven workspace agents (OpenHands). ([LangChain][1])

## The upgraded concept

You are not just making "agents from markdown". You are building a small, local-first "agent kernel" where Markdown is:

1. A declarative agent profile (prompt + tools + governance)
2. A shared memory and artifact store (plans, specs, research, decisions)
3. A spawn mechanism (agents can write new profiles and activate them)

This is the same core idea that modern coding agents use (project instruction files), except you take it further by making every profile runnable and recursively generative. Cursor formalizes "Rules" as system-level instructions for its agent, and Claude supports modular rule files; you are basically turning that into a general runtime. ([Cursor][2])

## What to borrow from the best existing projects

These are the strongest reusable patterns and what you should steal:

* File-based agent definitions with YAML frontmatter
  GitHub Copilot custom agents are literally Markdown agent profiles with YAML frontmatter for name, description, prompt, tools, and MCP servers. This validates your "agent-as-markdown" direction and suggests a clean spec shape. ([GitHub Docs][3])

* Layered instruction hierarchy (global -> project -> agent)
  Cursor rules and Claude rule systems show that instruction layering is the practical way to scale behaviors across many sessions without repeating yourself. ([Cursor][2])

* Graph orchestration, not just chats
  LangGraph pushes workflows into a graph/state-machine mindset for reliability and controllable loops. Your UI already wants this (React Flow). Your runtime should also think like this. ([LangChain Docs][4])

* Explicit multi-agent roles and handoffs
  CrewAI, ChatDev 2.0, MetaGPT all emphasize role clarity, delegation, and repeatable SOPs. Your templates should start here, not from scratch. ([CrewAI Documentation][5])

* Tool-first agents that manipulate a workspace
  OpenHands focuses on agents that edit files, run commands, and iterate. Even if you sandbox heavily in-browser, the "workspace as ground truth" pattern is exactly right for your Markdown ecosystem. ([docs.openhands.dev][6])

* Lightweight, client-run multi-agent ergonomics
  Swarm is explicitly about ergonomic agent handoffs and can run almost entirely client-side. That is a good conceptual fit for your React-first prototype. ([GitHub][7])

## The Markdown Agent Protocol (MAP)

This is the biggest upgrade I would make: define a minimal protocol so agents stay composable, inspectable, and safe.

### 1) Three file types

* Profile files: define behavior (agents)
  Example: `agents/researcher.md`, `agents/planner.md`
* Memory files: shared or agent-specific state
  Example: `memory/project_brief.md`, `memory/decisions.md`
* Artifact files: outputs meant for users or other agents
  Example: `artifacts/spec.md`, `artifacts/test_plan.md`

### 2) YAML frontmatter (profile metadata)

Take cues from Copilot custom agents and prompt files: keep it small, but explicit. ([GitHub Docs][3])

Recommended keys:

* `id`: stable UUID
* `name`: human label
* `role`: short role string
* `model`: default model (optional)
* `tools_allowlist`: list of tools this agent may call
* `reads`: glob patterns it can read (ex: `memory/**`)
* `writes`: glob patterns it can write (ex: `artifacts/**`, `agents/**` gated)
* `delegation`: allowed target agent tags or globs
* `budget`: max tool calls, max recursion depth, max tokens
* `stop_conditions`: explicit halting rules
* `requires_approval`: list of actions that must be user-approved (spawn agent, overwrite profiles, export zip, etc)

### 3) Body sections (human-readable, LLM-friendly)

A consistent set of headers makes agents predictable:

* `# MISSION`
* `# CONTEXT`
* `# OPERATING RULES`
* `# WHEN TO DELEGATE`
* `# OUTPUT FORMAT`
* `# STOP CONDITIONS`

## Runtime semantics: how recursion actually works

Your current idea is: "any markdown can create markdown and activate it infinitely". Keep that spirit, but implement it as a governed graph runtime.

### Core objects in the app state

* `FileTree`: virtual file system (VFS) in memory + persistent storage
* `AgentRegistry`: index of all profile files, parsed + validated
* `AgentInstance`: a running chat state bound to a profile
* `RunGraph`: nodes (agent steps) and edges (spawn, delegate, read, write)
* `EventLog`: append-only tool calls, diffs, model responses (for replay)

### The two magic tools every agent gets (minimum)

Use Gemini function calling so agent actions are structured, not parsed from text. ([Google AI for Developers][8])

1. `create_markdown_file(path, content, kind)`
2. `activate_agent(agent_path, input, mode)`

Then add these quickly (you will want them):

* `vfs_read(path)`
* `vfs_write(path, content, mode: overwrite|patch)`
* `vfs_list(glob)`
* `delegate(agent_path, input)` (alias of activate with different bookkeeping)
* `propose_diff(path, diff)` (UI gate + review)

### Infinite recursion, but safe

Auto-looping is the fastest way to burn budget and get stuck. You want deliberate guardrails:

* Depth guard: max recursion depth per run
* Fanout guard: max children spawned per agent
* Cycle detection: block spawn/delegate edges that create a tight loop unless user approves
* Budget meter: token estimate + tool call count
* Approval mode: "agent wants to spawn X" pause and show diff + metadata before it becomes active

This is directly motivated by the real issues autonomous agent projects hit (loops, cost, reliability). ([Built In][9])

## UI: make it feel like an "agent IDE"

Your graph UI idea is correct. Here is how to make it genuinely useful (not just pretty).

### Main panes

* Left: File tree (profiles, memory, artifacts) with validation badges
* Center: Graph canvas (React Flow)

  * Node types: AgentProfile, AgentStep, MemoryFile, ArtifactFile, ApprovalGate, Error
* Right: Inspector panel

  * Selected node shows:

    * Profile markdown (editable)
    * Tool calls and results
    * Read/write list for that step
    * Diff viewer for file changes
    * "Replay from here" button

### Two interaction patterns that matter

* "Click-to-focus": clicking an agent node swaps the chat to that agent instance
* "Drag-to-wire": draw an edge to declare a dependency, which becomes structured context (ex: planner depends on researcher output)

### Diagnostics view (steal this idea)

VS Code has a diagnostics concept for loaded prompt files. Do the same:

* Frontmatter schema errors
* Tool allowlist violations
* Broken references (agent imports a file that does not exist)
* Budget policy violations
  This makes the system feel professional and debuggable. ([Visual Studio Code][10])

## Performance and cost: context caching as your superpower

Once users have 20 to 200 markdown files, resending them every turn is wasteful. Gemini provides explicit context caching for repeated corpuses. Your orchestrator should cache the "workspace snapshot" and then send only deltas plus the active agent profile each step. ([Google AI for Developers][11])

Practical caching strategy:

* Cache: all profiles + key memory files + tool schemas
* Per step: send only (a) user input (b) active agent profile (c) relevant artifacts and recent diffs

## Google AI Studio + React implementation reality

Two important build modes:

### Prototype mode (fast)

* React app calls Gemini via Google Gen AI SDK
* Great for demos and local use

But Google explicitly warns that calling Gemini directly from a web client is only for prototyping because exposing an API key is risky. ([Google for Developers][12])

### Production mode (real)

* Use Firebase AI Logic (client SDK + App Check + rate limiting) or a server-side proxy
  Firebase AI Logic is positioned for production security and abuse prevention, including App Check protection. ([Firebase][13])

Also: Google has AI Studio starter applets you can lift patterns from (UI + Gemini integration). ([GitHub][14])

## Templates: start with a strong default "crew"

Instead of letting the system spawn random roles, ship a small, proven starter library inspired by MetaGPT and ChatDev role structures. ([GitHub][15])

Recommended built-ins (as markdown profiles):

* `orchestrator.md` (routes tasks, enforces budgets, chooses agents)
* `planner.md` (breaks work into steps and artifacts)
* `researcher.md` (writes to `artifacts/research.md`)
* `implementer.md` (writes to `artifacts/output.md` or code blocks)
* `reviewer.md` (creates diffs, calls out errors)
* `librarian.md` (maintains `memory/index.md` and links)

Then give the orchestrator a strict rule:

* "Spawn new agents only if an existing template cannot satisfy the need. Prefer delegation over spawning."

## The single best upgrade: make spawning feel like a PR, not a jump scare

When an agent calls `create_markdown_file` for a new agent profile:

1. Put the new file into a "Proposed" state
2. Show a diff and a one-paragraph rationale (auto-generated)
3. Require approval if it writes into `agents/**`
4. On approval, it becomes runnable and appears on the graph
5. Orchestrator tags it (capabilities, dependencies, risk level)

This is how you keep the system powerful without turning into uncontrolled agent spam.

## MVP that still feels magical (but shippable)

Phase 1

* Upload folder of `.md`
* Parse profile frontmatter, build registry
* Single orchestrator chat that can:

  * activate an existing agent
  * create a new markdown file
* Per-agent chat history stored separately
* Graph view shows spawn and delegate edges

Phase 2

* Approval gates + diff viewer for profile writes
* Context caching for workspace snapshot ([Google AI for Developers][11])
* Diagnostics panel

Phase 3

* Export/import workspace as zip
* Template gallery
* Run replay and checkpointing (event log)

If you want a north-star tagline that matches what this really is:
"An agent runtime where markdown files are executable policies, and the UI is a living graph of who created what, why, and what changed."

If you want, I can also draft a concrete MAP v1 schema (frontmatter keys + validation rules) and a minimal set of Gemini function declarations for your tool layer. ([Google AI for Developers][8])

[1]: https://www.langchain.com/langgraph?utm_source=chatgpt.com "LangGraph: Agent Orchestration Framework for Reliable AI ..."
[2]: https://cursor.com/docs/context/rules?utm_source=chatgpt.com "Rules | Cursor Docs"
[3]: https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-custom-agents?utm_source=chatgpt.com "About custom agents"
[4]: https://docs.langchain.com/oss/python/langgraph/overview?utm_source=chatgpt.com "LangGraph overview - Docs by LangChain"
[5]: https://docs.crewai.com/en/concepts/agents?utm_source=chatgpt.com "Agents"
[6]: https://docs.openhands.dev/sdk/getting-started?utm_source=chatgpt.com "Getting Started"
[7]: https://github.com/openai/swarm?utm_source=chatgpt.com "OpenAI Swarm"
[8]: https://ai.google.dev/gemini-api/docs/function-calling?utm_source=chatgpt.com "Function calling with the Gemini API | Google AI for Developers"
[9]: https://builtin.com/artificial-intelligence/autogpt?utm_source=chatgpt.com "AutoGPT Explained: How to Build Self-Managing AI Agents"
[10]: https://code.visualstudio.com/docs/copilot/customization/prompt-files?utm_source=chatgpt.com "Use prompt files in VS Code"
[11]: https://ai.google.dev/gemini-api/docs/caching?utm_source=chatgpt.com "Context caching | Gemini API | Google AI for Developers"
[12]: https://developers.google.com/learn/pathways/solution-ai-gemini-getting-started-web?utm_source=chatgpt.com "Getting started with the Gemini API and Web apps"
[13]: https://firebase.google.com/docs/ai-logic?utm_source=chatgpt.com "Gemini API using Firebase AI Logic - Google"
[14]: https://github.com/google-gemini/starter-applets?utm_source=chatgpt.com "Google AI Studio Starter Applets"
[15]: https://github.com/FoundationAgents/MetaGPT?utm_source=chatgpt.com "FoundationAgents/MetaGPT: 🌟 The Multi-Agent Framework"


Below is a tightened, expanded "best of the best" version of your two brainstorms, with the strongest patterns pulled from real agent ecosystems (file-based instruction standards, graph runtimes, PR-style approvals, consented tool access, and replayable execution logs).

## What similar projects have already validated (and what we should steal)

1. Repo-local instruction files are winning because they are reviewable, versionable, portable

* GitHub Copilot custom agents are defined as Markdown agent profiles with YAML frontmatter plus body instructions. ([GitHub Docs][1])
* AGENTS.md is emerging as a cross-tool convention for agent guidance. ([Agents][2])
* Tools like Cline explicitly support multiple rule formats (.clinerules, .cursorrules, .windsurfrules, AGENTS.md), which proves users want interop, not lock-in. ([Cline][3])

2. Graph execution beats linear chat once delegation and recursion are real

* LangGraph frames agent workflows as explicit graphs with control flow you can reason about and debug. ([LangChain][4])
* Agent IDEs are converging on "inspectable runs" (steps, state, diffs, replay). ([LangChain Docs][5])

3. The safe way to let agents affect the world is consent + boundaries

* MCP is a standard for connecting models to tools/data with clearer separation and security boundaries (client-host-server, JSON-RPC). ([Model Context Protocol][6])

4. Minimal primitives scale further than giant frameworks

* SWE-agent and mini-swe-agent show that a small core loop plus a real environment can outperform heavyweight stacks. ([GitHub][7])

5. "OS metaphors" (processes, permissions, scheduling) are a natural fit

* LLMos/LLMunix treats agents like processes with identity, memory, permissions, and lifecycle. ([GitHub][8])
* OpenHands pushes the idea of scaling from one to many agents under a platform/SDK. ([GitHub][9])

## The upgraded concept: Fractal.md Kernel (FractalK)

Think of it as a markdown-native agent runtime where:

* Markdown files are both instructions and executable policy
* Execution is a graph of steps
* Side effects are diffs and proposals
* The "orchestrator" is a kernel scheduler, not a bossy agent

### Core promise

Drop in 1 or 100 markdown files. Each file can become an agent. Agents can propose new agent files. Those spawned agents can propose more. The chain can be unbounded in theory, but the kernel enforces budgets, permissions, and progress checks so it stays usable.

## The Markdown Agent Protocol (MAP): small, strict, portable

MAP is your on-disk contract. It should be authorable by hand, but machine-validated.

### Workspace layout (virtual repo)

* agents/
* memory/
* artifacts/
* tests/
* runs/ (append-only event log snapshots)
* proposed/ (PR queue: proposed agents and diffs)
* policies/ (global constraints, deny rules, budgets)

### Agent file = profile + contract + permissions

Borrow the proven pattern: YAML frontmatter + markdown body. ([GitHub Docs][1])

Example: agents/frontend.agent.md

```md
---
id: "frontend-v1"
name: "Frontend Engineer"
model: "gemini"
reads:
  - "artifacts/prd.md"
  - "memory/decisions.md"
writes:
  - "artifacts/ui_spec.md"
  - "artifacts/components/*"
tools:
  - "vfs_read"
  - "propose_write"
  - "propose_agent"
budgets:
  max_steps: 8
  max_proposals: 3
  max_tokens: 120000
requires_approval:
  - "apply_patch"
  - "activate_agent"
  - "permission_escalation"
stop_when:
  - "artifacts/ui_spec.md exists"
---

# IDENTITY
You are a Senior React engineer.

# RULES
- Do not write backend code.
- If you need backend changes, propose a new agent file in proposed/agents/.

# OUTPUT CONTRACT
Deliver:
- artifacts/ui_spec.md
Optionally:
- proposed/agents/backend.agent.md with clear rationale
```

### Imports: composable instruction libraries

Steal the best part of context modularization: let any agent include other markdown snippets so teams can build reusable policy packs (tone guides, security rules, formatting rules). Gemini CLI explicitly supports breaking guidance into smaller files via imports. ([Gemini CLI][10])

MAP import idea:

```md
# GLOBAL RULES
@policies/security.md
@policies/style.md
@memory/domain_glossary.md
```

## The single biggest upgrade: spawning is a PR, not an auto-write

Instead of letting an agent silently create or overwrite agent files, enforce a proposal gate.

### Proposal envelopes

* Proposed new agents land in: proposed/agents/*.md
* Proposed edits land as patch objects in: proposed/patches/*.json
* The UI shows a PR-like review:

  * what changed (diff)
  * why (rationale)
  * what permissions are requested
  * what the agent promises to produce (output contract)

This aligns with the direction of safer tool standards and boundary-first integration. ([Model Context Protocol][6])

## Runtime semantics: make recursion feel infinite, but remain controllable

### Execution is a graph of steps, not a chat transcript

Each step node records:

* agent id + version hash (frontmatter + body hash)
* input file hashes
* tool calls (requests + results)
* proposed diffs produced
* accepted diffs applied
* cost counters (tokens, time)

This gives you:

* deterministic replay (re-run from node N)
* loop detection (same agent hash + same inputs -> repeated outcome)
* debugging (which step introduced a bad constraint)

### Kernel scheduling (the orchestrator you described)

The kernel chooses what runs next using:

* dependency readiness (reads exist and are up to date)
* triggers (file changed, proposal accepted, stop_when unmet)
* budgets (steps, fanout, cost)
* progress heuristics (no meaningful diff -> halt)

### Guardrails that prevent runaway recursion

Hard limits that users can raise intentionally:

* depth limit per run (default 5)
* max active agents concurrently
* per-agent fanout limit
* novelty gate: block repeating (agent_hash + input_hash) unless user overrides
* "must make progress" rule: each step must produce a new artifact, a diff, or a logged explanation

If the system stalls, it halts with an explicit reason and suggested next actions.

## UI: "agent IDE" that makes this usable daily

### Layout that actually works

Left: Workspace tree + validation

* show agents, memory, artifacts, tests, proposed
* schema diagnostics (frontmatter errors, missing reads, writes outside allowlist)

Center: Living graph canvas

* node types:

  * Agent Step
  * Artifact File
  * Proposal Gate
  * Budget Halt
  * Error
* edges:

  * reads, writes
  * spawned-by lineage
  * proposal approved/rejected

Right: Inspector (diff-first)

* render selected agent profile
* show inputs, outputs, diffs
* show tool calls and results
* buttons:

  * Approve proposal (with toggles: grant permissions, cap budgets)
  * Replay from here
  * Fork agent (copy to new file id)

### Hot reload that is actually safe

You can edit an agent markdown while it runs, but:

* edits create a new version hash
* the kernel pauses and resumes as a new step node
* if the edit expands permissions or budgets, it triggers an approval gate

## Built-in evaluation: tests are markdown too

Add tests as first-class files:

* tests/ui_spec_quality.test.md
* tests/security_no_secrets.test.md

A test includes:

* fixture inputs (which artifacts/memory to load)
* assertions (regex, JSON schema checks, required sections)
* scoring (pass/fail, warnings)

This gives you a way to tame recursive systems with checks, not hope.

## Interop: your app becomes the universal instruction workbench

MAP should be able to ingest and emit:

* AGENTS.md guidance ([Agents][2])
* Copilot agent profiles ([GitHub Docs][1])
* Cline rule formats (.clinerules, .cursorrules, .windsurfrules) ([Cline][3])

So a repo can stay tool-agnostic and your app becomes the place where teams author, validate, and simulate these instruction systems.

## Google AI Studio React implementation that matches this design

### Prototype mode (fast iteration)

* React app with an in-memory or IndexedDB-backed virtual filesystem
* Run agents with Gemini calls directly for prototyping

### Production mode (sane security and cost control)

Google recommends production guardrails like App Check and rate limiting when using Firebase AI Logic. ([Firebase][11])
Use:

* Firebase AI Logic for gated model calls
* App Check
* per-user quotas and throttles
* audit logs tied to run steps

### Tooling layer

Model tool calls should be structured, minimal, and enforceable:

* vfs_read(path)
* vfs_list(prefix)
* propose_write(path, unified_diff, rationale)
* propose_agent(path, content, requested_permissions)
* apply_patch(patch_id) (approval-gated)
* activate_agent(agent_id, input_set) (approval-gated)
* run_tests(test_ids)

### Context scaling

Once workspaces grow, you do not want to resend everything every step. Use caching patterns (stable corpus cached, step deltas sent) and load only dependency slices per agent step.

## Killer modes (shipped as templates)

1. Spec-to-deliverables factory
   Goal: goal.md -> PRD, user stories, acceptance criteria, threat model, API contract, test plan, release checklist
   This is the fastest way to make the system feel indispensable.

2. Repo instruction governance
   Drop in existing rule files, normalize to MAP, propose improvements as diffs.

3. Research notebook that grows its own method
   Agents propose new "method agents" as they discover the domain (terminology agent, bibliography agent, skeptic agent).

4. Meeting-to-action chain
   meeting_notes.md -> decisions.md, action_items.md, followups.md, email_drafts.md
   Spawns tone agents per stakeholder.

## What to build first (MVP that proves the thesis)

Phase 1: MAP loader + validator

* parse frontmatter, validate reads/writes/tools/budgets
* show diagnostics in UI

Phase 2: Single-agent runner + diff output

* run one agent
* require outputs as diffs (no silent writes)

Phase 3: Proposal gate + activation chain

* propose_agent -> approve -> activate_agent
* visualize lineage edges

Phase 4: Scheduling + replay

* step graph, replay from node, loop detection

Phase 5: Tests

* markdown tests, run per step or per milestone

If you want, I can also draft:

* a MAP JSON schema for frontmatter validation
* the exact tool declarations for Gemini function calling
* 6 starter agents (PM, Architect, Frontend, Backend, QA, Security) plus 6 tests that keep recursion sane

[1]: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents?utm_source=chatgpt.com "Creating custom agents"
[2]: https://agents.md/?utm_source=chatgpt.com "AGENTS.md"
[3]: https://docs.cline.bot/features/cline-rules/overview?utm_source=chatgpt.com "Cline Rules"
[4]: https://www.langchain.com/langgraph?utm_source=chatgpt.com "LangGraph: Agent Orchestration Framework for Reliable AI ..."
[5]: https://docs.langchain.com/langsmith/studio?utm_source=chatgpt.com "LangSmith Studio - Docs by LangChain"
[6]: https://modelcontextprotocol.io/specification/2025-06-18?utm_source=chatgpt.com "Specification"
[7]: https://github.com/SWE-agent/SWE-agent?utm_source=chatgpt.com "SWE-agent/SWE-agent"
[8]: https://github.com/EvolvingAgentsLabs/llmunix?utm_source=chatgpt.com "EvolvingAgentsLabs/llmos: The flagship example—the OS ..."
[9]: https://github.com/OpenHands/OpenHands?utm_source=chatgpt.com "OpenHands: AI-Driven Development"
[10]: https://geminicli.com/docs/cli/gemini-md/?utm_source=chatgpt.com "Provide context with GEMINI.md files"
[11]: https://firebase.google.com/docs/ai-logic/production-checklist?utm_source=chatgpt.com "Production checklist for using Firebase AI Logic - Google"


Here is a bigger, sharper version of your concept that pulls in the strongest ideas from adjacent systems and then pushes them further into a true "markdown-native agent runtime".

## What the best related projects are already proving

### 1. "Instructions live in files" scales better than "instructions in chat"

Modern agentic dev tools are converging on repo-local instruction files because they are shareable, reviewable, versioned, and composable:

* GitHub Copilot custom agents are literally Markdown "agent profiles" with YAML frontmatter (name, tools, MCP servers) plus Markdown body instructions. ([GitHub Docs][1])
* VS Code supports prompt files and custom agents as Markdown files you can run, reuse, and validate via diagnostics. ([Visual Studio Code][2])
* Cursor rules provide persistent prompt-level context as a reusable rules system. ([Cursor][3])
* Claude Code reads a repo-level CLAUDE.md at the start of every session. ([Claude Code][4])
* Cline supports multiple rule formats and explicitly highlights cross-tool compatibility with AGENTS.md style patterns. ([Cline][5])

Your app becomes the general-purpose runtime for this idea: not just "one instruction file", but "many instruction files that can execute, spawn, and govern each other".

### 2. Graph orchestration beats linear chats when recursion is real

The most reliable multi-agent frameworks treat agent work as state machines / graphs:

* LangGraph positions agent workflows as graphs with explicit state and transitions. ([LangChain Docs][6])
* Swarm popularized lightweight handoffs as a simple primitive. ([GitHub][7])
* AutoGen, CrewAI, MetaGPT show that role clarity + delegation + SOPs produce better repeatable outcomes than a single monolithic agent. ([GitHub][8])

Your UI already wants a graph. The key upgrade is to make the runtime itself graph-native, not just the visualization.

### 3. Tool and safety standards are converging around explicit consent and boundaries

If you want infinite chains without chaos, the safety and governance model has to be first-class:

* MCP emphasizes tool safety, user consent, and treating tool descriptions as untrusted unless from trusted servers. ([Model Context Protocol][9])

So: spawning agents, overwriting agents, and widening permissions should look like a pull request, not an invisible side effect.

### 4. Production grade systems include testing and evaluation, not just prompting

Prompt testing and eval pipelines are becoming standard:

* Promptfoo focuses on testing prompts/agents, CI integration, and red teaming. ([GitHub][10])
* Prompt flow frames LLM apps as debuggable, evaluatable graphs. ([Microsoft GitHub][11])

Your app should ship with a built-in "agent test harness" so recursive systems can be checked, not just watched.

---

## The best-of-the-best concept: Markdown Agent Kernel (MAK)

A React app where a workspace is a virtual repo and Markdown is executable policy.

* Every Markdown file can be:

  1. An agent profile (executable prompt)
  2. A memory file (state, notes, decisions)
  3. An artifact (deliverables)
  4. A test (expected behaviors, assertions)

The orchestrator is not "the boss". It is the kernel scheduler: it enforces permissions, budgets, and execution semantics, and it logs everything for replay.

### The magic user experience

1. User drags in a folder of Markdown
2. The app classifies files (profiles, memory, artifacts, tests)
3. User chooses a goal file (or writes one)
4. Press Run
5. The graph grows as agents activate and spawn proposals
6. The user can approve or reject agent spawns and risky diffs
7. Everything is replayable and diffable

This is like a prompt-native IDE crossed with a workflow engine.

---

## MAP v1: a minimal protocol that makes recursion sane

Call it the "Markdown Agent Protocol" (MAP). It is intentionally small so users can author it by hand.

### File types

* agents/*.md
* memory/*.md
* artifacts/*.md
* tests/*.md

### Agent profile shape (YAML frontmatter + Markdown body)

Borrow the proven pattern from Copilot custom agents and extend it into a runtime contract. ([GitHub Docs][12])

Example: agents/acceptance_criteria.agent.md

```md
---
id: "ac-criteria-v1"
name: "Acceptance Criteria Agent"
role: "qa"
reads:
  - "artifacts/prd.md"
  - "artifacts/user_stories.md"
writes:
  - "artifacts/acceptance_criteria.md"
permissions:
  spawn_agents: true
  edit_agents: false
budgets:
  max_steps: 6
  max_spawn: 2
stop_when:
  - "artifacts/acceptance_criteria.md exists"
requires_approval:
  - "spawn_agent"
  - "overwrite_agents"
---

# MISSION
Write Gherkin-style acceptance criteria for every user story.

# OPERATING RULES
- If stories mention auth, payments, or file uploads, propose an Edge Cases Agent.
- If requirements are missing, write a "gaps" section.

# OUTPUT CONTRACT
You must produce:
- artifacts/acceptance_criteria.md
Optionally propose new agents (as proposals, not auto-merged).
```

### The spawn mechanism: "proposals", not auto-write

Instead of letting an agent silently create new agents, make it produce a proposal envelope:

* Proposed agent files land in proposed/agents/
* Proposed artifact edits land as diffs
* The UI shows a PR-like review: rationale, permissions requested, and expected outputs

This is the single biggest difference between a toy recursive demo and a tool people will trust.

This matches the spirit of MCP consent and safety: explicit user approval for tool effects. ([Model Context Protocol][9])

---

## Runtime semantics: make the chain feel infinite but remain controllable

### Execution is a graph of steps, not a chat log

Each step node contains:

* Agent profile version hash
* Input file hashes
* Tool call results
* Output file diffs
* Spawn proposals created

That gives you deterministic replay and loop detection.

### Scheduling policies (your "kernel")

The orchestrator selects the next activation by combining:

* Activation rules from frontmatter (stop_when, triggers)
* Dependency edges (this agent needs those artifacts)
* Budgets and loop checks
* User mode (manual, suggest, auto)

### Infinite recursion, with hard guardrails

To keep the promise of "it can go forever" without melting down:

* Depth budget: max chain depth per run
* Fanout budget: max spawned children per agent
* Novelty check: block repeating (agent_hash + input_hash) unless override
* Cost/time budget meters
* Convergence heuristic: require each step to produce either

  * a new file
  * a meaningful diff
  * or a logged reason why no change occurred

If it is not making progress, it halts and tells the user exactly why.

---

## UI: turn this into an "agent IDE" people will actually use

Steal the best parts of VS Code prompt file workflows and diagnostics. ([Visual Studio Code][2])

### Three-pane layout that works

Left: Workspace tree

* agents, memory, artifacts, tests, proposed
* validation badges (schema errors, permission violations)

Center: Graph canvas
Node types:

* Agent step
* File artifact
* Proposal gate
* Budget halt
* Error

Right: Inspector

* Selected agent profile (render + raw)
* Inputs, outputs, diffs
* Tool calls (request/response)
* "Replay from here"
* "Approve proposal" with toggles (grant spawn, grant edit_agents, etc)

### Addictive features (the ones that make it stick)

1. "Diff-first" approvals

* Approve edits the way you approve code
* Show file diffs for artifacts and agents separately

2. "Runbooks" for recursion

* A run can be saved as a reusable recipe: which agents ran, in what pattern, with what budgets

3. Diagnostics panel

* Frontmatter schema checks
* Missing dependencies (agent reads a file that does not exist)
* Overbroad permissions (agent tries to write outside allowlist)
* Budget configuration warnings

4. Built-in agent tests
   Ship a tests/ folder where each test:

* picks one or more agents
* provides a fixture set of input files
* asserts patterns in outputs

This is your answer to promptfoo and prompt flow: you are not just generating, you are verifying. ([GitHub][10])

---

## Killer application modes that fit Markdown recursion perfectly

### Mode A: Spec-to-Deliverables Factory (your flagship)

Start from a single goal.md and produce a whole artifacts suite:

* PRD, user stories, acceptance criteria, threat model, API contract, test plan, release checklist

This is basically "MetaGPT-lite" but with user-visible files as the ground truth, not hidden internal state. ([GitHub][13])

### Mode B: Research notebook that grows its own methodology

Agents:

* Question framer
* Source plan
* Summarizer
* Critic
* Outline writer

Memory becomes a structured research log. The system can spawn a new summarizer agent tuned to a domain once it detects a cluster of sources.

### Mode C: Repo governance and instruction authoring

User drops in:

* copilot-instructions.md
* CLAUDE.md
* cursor rules
* clinerules folder

The system converts them into a normalized MAP workspace, then can propose improvements as PR-style diffs.

This bridges the real world ecosystem of rule files and turns your app into the "universal agent instruction workbench". ([Claude Code][4])

### Mode D: Meeting-to-action

Input: meeting_notes.md
Outputs:

* decisions.md
* action_items.md
* followups.md
* email_drafts.md

And it can spawn a "Stakeholder Tone Agent" based on the audience specified.

---

## Implementation notes for Google AI Studio React

### Prototype vs production

Google explicitly notes that calling the Gemini API directly from a web app using the Google Gen AI SDK is for prototyping, and recommends Firebase AI Logic for production security and abuse prevention. ([Google for Developers][14])

So build two modes:

* Prototype mode: direct Gemini calls for fast iteration
* Production mode: Firebase AI Logic, App Check, rate limiting ([Firebase][15])

### Use function calling for file operations

Do not parse ad-hoc text for file creation. Use structured function calling so outputs are typed and controllable. ([Google AI for Developers][16])

Your core tools should be minimal:

* vfs_read(path)
* vfs_write(path, content, mode)
* propose_write(path, diff, rationale)
* propose_agent(path, content, requested_permissions)
* activate_agent(agent_id, inputs)

### Context caching is your scaling superpower

If the workspace grows to 100+ files, you cannot keep resending the whole corpus every step.

Gemini supports explicit caching for repeated content, which fits perfectly with "workspace snapshot + deltas". ([Google AI for Developers][17])

Practical approach:

* Cache: agents + tool schemas + stable memory
* Per step: active agent + relevant artifacts + recent diffs

---

## The single best upgrade to your original brainstorm

Make spawning feel like a PR.

If you do nothing else, do this:

* Agents never directly create agents
* They create proposals
* The UI shows diffs, requested permissions, and expected outputs
* The user approves, then the orchestrator activates

That one decision keeps the infinite chain concept intact while turning it into something people can actually run daily.

---

If you want to push this even further, the next big leap is "agent composition": allow an agent profile to import other Markdown blocks (like includes) so teams can build libraries of reusable policies, tone guides, and output contracts the same way they build code libraries.

[1]: https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-custom-agents?utm_source=chatgpt.com "About custom agents"
[2]: https://code.visualstudio.com/docs/copilot/customization/prompt-files?utm_source=chatgpt.com "Use prompt files in VS Code"
[3]: https://cursor.com/docs/context/rules?utm_source=chatgpt.com "Rules - Project, Team, User"
[4]: https://code.claude.com/docs/en/overview?utm_source=chatgpt.com "Claude Code overview - Claude Code Docs"
[5]: https://docs.cline.bot/features/cline-rules/overview?utm_source=chatgpt.com "Cline Rules"
[6]: https://docs.langchain.com/oss/python/langgraph/overview?utm_source=chatgpt.com "LangGraph overview"
[7]: https://github.com/openai/swarm?utm_source=chatgpt.com "OpenAI Swarm"
[8]: https://github.com/microsoft/autogen?utm_source=chatgpt.com "microsoft/autogen: A programming framework for agentic AI"
[9]: https://modelcontextprotocol.io/specification/2025-06-18?utm_source=chatgpt.com "Specification"
[10]: https://github.com/promptfoo/promptfoo?utm_source=chatgpt.com "promptfoo/promptfoo: Test your prompts, agents, and ..."
[11]: https://microsoft.github.io/promptflow/?utm_source=chatgpt.com "Prompt flow documentation"
[12]: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents?utm_source=chatgpt.com "Creating custom agents"
[13]: https://github.com/FoundationAgents/MetaGPT?utm_source=chatgpt.com "FoundationAgents/MetaGPT: 🌟 The Multi-Agent Framework"
[14]: https://developers.google.com/learn/pathways/solution-ai-gemini-getting-started-web?utm_source=chatgpt.com "Getting started with the Gemini API and Web apps"
[15]: https://firebase.google.com/docs/ai-logic/production-checklist?utm_source=chatgpt.com "Production checklist for using Firebase AI Logic - Google"
[16]: https://ai.google.dev/gemini-api/docs/function-calling?utm_source=chatgpt.com "Function calling with the Gemini API | Google AI for Developers"
[17]: https://ai.google.dev/gemini-api/docs/caching?utm_source=chatgpt.com "Context caching | Gemini API | Google AI for Developers"
