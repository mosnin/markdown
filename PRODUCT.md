# Poggle — Product Vision & Architecture

## What Poggle Is

Poggle is the **context operating system for AI agents.**

Not a note-taking app. Not a knowledge base for humans to read.

Poggle is the persistent, structured, relational context layer that AI agents read from and write back to — with human oversight at every write. Teams use it to give their AI agents a reliable foundation of domain knowledge instead of starting every task from zero.

---

## The Problem We Solve

An AI agent without organized context is a goldfish. It forgets. It hallucinates. It has no understanding of your domain, your decisions, or your team's accumulated knowledge.

Current "solutions" fail:
- **Vector DBs** — flat embedding search, no relationships, no curation, no agent write-back
- **LangChain/LlamaIndex memory** — ephemeral session state, not persistent workspace context
- **Notion AI** — designed for humans, not agent-optimized, no write-gate, no versioning
- **RAG pipelines** — expensive to build, brittle in production, no approval workflow

Poggle solves all of this in one system.

---

## The Two Users

### 1. The AI Engineer / Developer
Sets up the context layer. Connects agents via MCP or API. Defines Boxes (context domains), configures agent permissions, manages workflows. Comfortable with technical concepts. Wants a reliable, auditable context backend for the agents they deploy.

### 2. The Context Curator / Approver
Non-technical (or less technical). Responsible for the quality of the context layer. Reviews what agents propose to write. Curates notes, organizes Boxes, approves or rejects agent-generated changes. The human-in-the-loop.

Both are first-class users. The UI must serve both without forcing either to compromise.

---

## Core Concepts

### Boxes — Context Domains
A Box is a bounded, structured knowledge container — not a folder. Each Box represents a domain of context: a product area, a project, a team, a topic. Agents are granted access to Boxes, not to individual notes. Boxes have:
- A guide note (what this domain is and how an agent should use it)
- Agent instructions (system-level context for connected agents)
- Linked objects (skills, agents, files)
- Access controls per agent

### Notes — Context Nodes
Notes are not documents for humans to read. They are **context nodes** that agents traverse. Each note has:
- Rich metadata: summary, tags, typed relationships to other notes, retrieval priority, read hints
- Typed links to other notes (`depends_on`, `parent_of`, `derived_from`, `extends`, `related`, etc.)
- Version history with full audit trail
- Agent read/write telemetry

The relationships between notes form a knowledge graph that agents traverse — not just keyword-match.

### Context Bundles
The crown jewel. When an agent requests context, Poggle assembles a **deterministic, bounded context bundle**: the target note + its typed relationships + ancestor summaries + guide note, deduplicated and capped at hard token limits. This is reliable, auditable retrieval — not a probabilistic RAG guess.

### Atlas AI — The Workspace Operator
The first-party AI agent that ships with Poggle. Operates against the context layer with three tools: `hybrid_search` (vector + graph traversal), `draft_note` (write to context), `analysis` (reasoning over retrieved context). Flow: plan → human approval → execute. Every action is auditable.

### Skills — Reusable Context Instructions
Structured capability definitions (YAML, Markdown, Python, JSON) that agents pull from during execution. Think of them as the "prompt library" or "playbook" for your agents.

### Agents — Reusable Orchestration Logic
Persistent agent definitions with model preferences, system prompts, and source content. Can be attached to Boxes, triggered by events, or run as workflow nodes.

### Workflows — Agentic Pipelines
DAG-based automation: chain sub-agents, searches, transforms, and conditions. Runs durably via Inngest. The automation layer on top of the context layer.

### Branches — Safe Context Experimentation
Agents can draft changes to the context layer in an isolated branch. Humans review. Promote to main when approved. No agent can corrupt the canonical context — only propose changes to it.

### Proposals — The Write Gate
The trust mechanism. External agents (via MCP or API) cannot directly modify context. They submit proposals with suggested content and rationale. Humans approve or reject. Approved proposals create a new version in the immutable version chain.

---

## The Context OS Stack

```
┌─────────────────────────────────────────────────────┐
│                  HUMAN INTERFACE                     │
│     Context curation · Approvals · Monitoring        │
├─────────────────────────────────────────────────────┤
│                   ATLAS AI                           │
│     First-party agent · Plan/Approve/Execute         │
├─────────────────────────────────────────────────────┤
│              CONTEXT LAYER (Boxes + Notes)           │
│   Structured · Relational · Versioned · Branched     │
├─────────────────────────────────────────────────────┤
│              RETRIEVAL ENGINE                        │
│   Context bundles · Hybrid search · Graph traversal  │
├─────────────────────────────────────────────────────┤
│            EXTERNAL AGENT INTERFACE                  │
│         MCP endpoints · API · Proposals              │
└─────────────────────────────────────────────────────┘
```

---

## What Poggle Is NOT

- Not a note-taking app for humans
- Not a general knowledge base (Notion, Confluence)
- Not a session-level agent memory (Letta, MemGPT)
- Not a raw vector database (Pinecone, Weaviate)
- Not an AI assistant that happens to have memory

Poggle is **infrastructure** — the context backend that makes AI agents reliable, auditable, and domain-aware.

---

## Design Principles for All UI/Code Work

1. **Agents are the primary consumers.** Every UI decision should serve the human who is curating context FOR agents, not a human writing for other humans.

2. **The control plane comes first.** What agents are doing, what they've read, what they've proposed — this should be visible at a glance.

3. **Boxes are context domains, not folders.** Language and UI treatment should reinforce this. A Box has agents attached to it. A Box has an access model. A Box is infrastructure.

4. **Proposals are the trust layer.** Every agent write goes through a proposal. This is not a bug or a limitation — it is the core trust architecture. The UI should make approvals feel powerful, not tedious.

5. **Context bundles are the product.** The retrieval engine is the crown jewel. Make it visible: show what was retrieved, why, how much context space was used.

6. **Dual audience, one product.** The developer configures; the curator approves. Neither should have to navigate the other's primary surface to do their job.

7. **Infrastructure aesthetics.** The UI should feel like Vercel, Linear, or Railway — confident, precise, information-dense. Not like a consumer note app.
