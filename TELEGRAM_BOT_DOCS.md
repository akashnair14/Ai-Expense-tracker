# Kinetiq Money Telegram Expense Tracker Bot — Complete System & Feature Documentation

> **Overview**: Kinetiq Money is an AI-powered financial intelligence assistant integrated with Telegram and a companion Web Dashboard. It allows users to log expenses/income using natural language text, manage category budgets interactively via buttons, automate recurring schedules (SIP, rent, salaries), and log into their desktop web dashboard via QR code scanning.

---

## 1. Core Architecture & Tech Stack

- **Backend Framework**: NestJS 11 (TypeScript, Modular Architecture)
- **Telegram Bot Framework**: `grammY` (Long-polling in local dev / Webhook ready for serverless)
- **Database & ORM**: PostgreSQL (Neon Serverless) + Prisma ORM
- **NLU / AI Engine**: Hybrid Natural Language Processing:
  - Regex / Heuristic Tokenizer for ultra-fast zero-latency offline parsing.
  - Gemini LLM fallback for complex, colloquial, backdated, or multi-split expense queries.
- **Companion Frontend**: Vanilla HTML5 + CSS (True Black `#09090b` / Zinc `#121215` Pro UI) + Chart.js.

---

## 2. Natural Language Processing (NLU) Features

Users don't need to fill forms. They simply type natural colloquial sentences to the bot:

### A. Expense Tracking
- `Paid 350 for lunch` -> Amount: `₹350`, Category: `Food & Dining`, Type: `EXPENSE`
- `Uber 420` -> Amount: `₹420`, Category: `Travel & Fuel`, Merchant: `Uber`
- `Bought Nike shoes 4500` -> Amount: `₹4500`, Category: `Shopping`, Merchant: `Nike`

### B. Income Tracking
- `Received salary 65000` -> Amount: `₹65000`, Category: `Salary`, Type: `INCOME`
- `Freelance payout +12000` -> Amount: `₹12000`, Category: `Freelance`, Type: `INCOME`

### C. Bill Splitting
- `Dinner with friends 1800 split by 3` -> Records user's individual share of `₹600` while logging original amount `₹1800` and split count `3`.

### D. Backdated Date Parsing
- `Movie yesterday 450` -> Automatically sets transaction date to yesterday's timestamp.
- `Flight ticket 5400 on 12th Aug` -> Backdates to specified date.

---

## 3. Interactive Telegram UI & UX (Zero Typing)

### A. In-Chat Interactive Budget Control Center (`/budget`)
- **ASCII Progress Bars**: Visual capacity meter `[■■■■■■□□□□] 60%` rendered inline.
- **Dynamic Status Flags**: Categorized into `✅ Good`, `⚠️ Warning` (above 80%), or `🚨 Over` (100%+).
- **1-Tap Category Picker**: Grid of category buttons (`Food & Dining`, `Groceries`, `Shopping`, `Travel & Fuel`, `Bills & Utilities`, `Entertainment`).
- **Preset Quick-Set Buttons**: Instant 1-tap limit buttons (`₹2,000`, `₹5,000`, `₹10,000`, `₹15,000`, `₹20,000`, `₹30,000`).
- **Stepper Adjusters**: `[ ➖ ₹1,000 ]` and `[ ➕ ₹1,000 ]` buttons for live incremental budget tuning without re-typing.
- **Budget Deletion**: `[ 🗑️ Remove Limit ]` to remove category caps in 1 click.

### B. Transaction Confirmation Card Actions
Every logged transaction immediately replies with an actionable inline card:
- **`[ 🏷️ Change Category ]`**: Opens a grid of alternative categories to reclassify miscategorized entries in 1 tap without editing text.
- **`[ ❌ Delete ]`**: 1-tap deletion to remove duplicate or erroneous entries.

### C. Native Telegram Command Menu (`setMyCommands`)
Auto-populated into Telegram's native `/` menu bar:
- `/today` — Today's financial summary (Expenses, Income, Net Savings).
- `/month` — Month-to-date breakdown & top spend categories.
- `/budget` — Interactive Budget Control Center with visual progress bars.
- `/recurring` — Scheduled SIPs, bills, rents, and salary management.
- `/dashboard` — 1-tap login link / instructions to open desktop dashboard.
- `/undo` — Delete the most recent transaction recorded.
- `/help` — Quick syntax guide and examples.

---

## 4. Recurring Schedule Engine (`/recurring`)

Automates regular recurring commitments (SIPs, Rent, EMIs, Salaries):
- **Command Syntax**: `/recurring <Description> <Amount> [income/expense] on <Day>th`
- **Examples**:
  - `/recurring Rent 15000 on 1st`
  - `/recurring Zerodha SIP 5000 on 5th`
  - `/recurring Company Salary 75000 income on 30th`
- **Cron Worker**: Runs daily cron checks in NestJS and automatically writes transactions when due and notifies the user via Telegram alert.

---

## 5. Cross-Device QR Code Authentication

Allows seamless laptop/desktop dashboard login without remembering passwords:
1. User opens the Web Dashboard on their laptop browser.
2. A temporary cryptographic QR code session (`/api/auth/qr/generate`) is rendered with a 2-minute expiration countdown.
3. User scans the QR code with phone camera -> opens deep link `https://t.me/YourBot?start=qr_<sessionId>`.
4. Telegram Bot verifies `ctx.from.id` and approves the session.
5. The desktop browser automatically polls `/api/auth/qr/status`, receives the JWT authentication token, and logs the user straight into the Executive Dashboard.
6. The user's Telegram First Name, Last Name, and `@username` are automatically synced.

---

## 6. Proactive Event Alerts & Notifications

1. **Budget Threshold Warnings**: Automatically triggers when an expense pushes category spending past 80% (`⚠️ NEAR BUDGET LIMIT`) or 100% (`🚨 BUDGET EXCEEDED`).
2. **Recurring Payment Executions**: Instant Telegram ping whenever a scheduled payment or salary is auto-posted.

---

## 7. Web Companion Features Synced with Bot

- **Live Overview**: Real-time KPI blocks for expenses, income, net savings, and budget consumption.
- **AI Financial Insights**: Pattern recognition and automated recommendations.
- **Cash Flow Analytics**: Chart.js income vs. expense trend lines and category donut breakdown.
- **Data Export**: 1-click export to CSV spreadsheet and printable PDF financial statements.
- **Modern Minimal Theme**: True Midnight Black (`#09090b`) with neutral zinc aesthetics.
