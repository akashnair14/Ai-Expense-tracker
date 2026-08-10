# Production-Ready AI-Powered Telegram Expense Tracker

An enterprise-grade, scalable, and modular Telegram-based expense tracker built with **NestJS**, **Prisma ORM**, **PostgreSQL**, **Redis**, and a **Hybrid NLU Engine (Regex -> Dictionary -> LLM Fallback)**.

---

## 🚀 Quick Start Guide

### 1. Prerequisites
Make sure you have installed on your machine:
* **Node.js**: v18+ (tested on v24.15.0)
* **PostgreSQL Database** (local instance or cloud database such as Supabase / Neon / Render)
* **Telegram Bot Token** (obtain from [@BotFather](https://t.me/BotFather))

---

### 2. Environment Setup

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Database Connection (PostgreSQL)
DATABASE_URL="postgresql://postgres:password@localhost:5432/expense_tracker?schema=public"

# Telegram Bot Credentials
TELEGRAM_BOT_TOKEN="your_telegram_bot_token_here"

# LLM Fallback Configuration (Optional, used for complex/unstructured natural language queries)
LLM_PROVIDER="groq" # Options: groq | openai | gemini | openrouter
LLM_API_KEY="your_llm_api_key_here"
```

---

### 3. Database Migration & Prisma Client

Run the following commands to generate the Prisma client and push the schema to your PostgreSQL database:

```bash
# Generate Prisma Client
npx prisma generate

# Apply Database Schema / Migrations
npx prisma db push
```

---

### 4. Running the NLU Test Harness (Offline / CLI Verification)

You can verify the natural language understanding (NLU) parsing engine locally without launching the bot:

```bash
npx ts-node test/nlu-test.ts
```

---

### 5. Running the Application

#### Development Mode (with Hot Reloading)
```bash
npm run start:dev
```

#### Production Build & Execution
```bash
# Build TypeScript binaries
npm run build

# Start Production Server
npm run start:prod
```

---

## 📱 Telegram Bot Setup

1. Open Telegram and search for [@BotFather](https://t.me/BotFather).
2. Create a new bot using `/newbot` and copy your HTTP API Token.
3. Paste the token into `.env` under `TELEGRAM_BOT_TOKEN`.
4. Run `npm run start:dev`.
5. Open your bot in Telegram and send `/start`.

---

## 💡 Example Natural Language Inputs

Send any of the following to your Telegram bot:

* `Paid ₹250 for lunch`
* `Lunch 250`
* `Uber ₹420`
* `Groceries 1850`
* `Salary +50000`
* `Received freelance payment 25000`
* `Electricity bill 1800`
* `Zomato 800 split with 4`
* `Movie yesterday 400`
* `Coffee 180`

---

## 🛠️ Bot Commands

* `/start` - Start bot & onboarding guide
* `/help` - View usage guide & natural language examples
* `/undo` - Soft-delete the last transaction
* `/redo` - Restore the last soft-deleted transaction
* `/today` - View today's summary
* `/month` - View current month's breakdown
