# PermaTrax AI Chatbot (local / free)

Floating **P** button (bottom-right) on authenticated dashboard pages.

## Stack (no paid APIs)

| Piece | Tech |
|-------|------|
| LLM (optional) | [Ollama](https://ollama.com) local — default model `llama3.2` |
| RAG | Keyword retrieval over seeded PermaTrax knowledge |
| Live data | NestJS tools → Prisma (clusters, cash op, PR, stock, FTTT) |
| Actions | Propose UI deep-links only (no silent writes) |
| Storage | Postgres tables `AiKnowledge*`, `AiConversation`, `AiMessage`, `AiFeedback`, `AiPromptLog` |

Without Ollama the bot still answers from knowledge + live tools (extractive mode).

## Setup

```bash
# DB tables
pnpm db:generate
pnpm db:push

# Optional generative answers
ollama pull llama3.2
# OLLAMA_URL=http://127.0.0.1:11434
# OLLAMA_MODEL=llama3.2
```

## API

- `GET /api/ai/health`
- `POST /api/ai/chat` `{ message, conversationId? }`
- `POST /api/ai/feedback` `{ messageId, rating, comment? }`
