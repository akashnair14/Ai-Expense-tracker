# PulseAI (Kinetiq Money) Architecture Documentation

> **Status:** Current Production Architecture  
> **Framework:** NestJS 11 (TypeScript)  
> **Database:** PostgreSQL (Prisma ORM 5.22)  
> **Bot Platform:** Telegram (grammY 1.45)  
> **Web Client:** Single-Page Application (Vanilla JS / Tailwind CSS / Chart.js)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Component Architecture Diagram](#2-component-architecture-diagram)
3. [Request Flow](#3-request-flow)
4. [Telegram Message Flow](#4-telegram-message-flow)
5. [Web API Flow](#5-web-api-flow)
6. [Authentication Flow](#6-authentication-flow)
7. [Transaction Creation Flow](#7-transaction-creation-flow)
8. [AI / NLU Flow](#8-ai--nlu-flow)
9. [Budget Flow & Pacing Engine](#9-budget-flow--pacing-engine)
10. [Recurring Transaction Flow](#10-recurring-transaction-flow)
11. [Database Architecture](#11-database-architecture)
12. [Scheduler Architecture](#12-scheduler-architecture)
13. [Dashboard Architecture](#13-dashboard-architecture)

---

## 1. System Overview

PulseAI is a personal financial intelligence platform operating on a **modular monolith** pattern. It provides automated income and expense tracking, conversational querying, receipt scanning, voice expense capture, deterministic budget pace tracking, and scheduled cash flow automation.

### Key Tenet
> **AI decides what the user means; deterministic backend code decides what actually happens.**

The system is split into two interaction tiers connecting to a shared domain layer:
* **Telegram Interface**: Handles text messages, voice notes, bill photos, inline interactive callbacks, and persistent menu keyboards via `grammy`.
* **Web Dashboard & REST API**: Handles web sessions, onboarding, visual interactive analytics, manual entries, budget configuration, and CSV exports.
* **Internal Event Bus**: Uses `@nestjs/event-emitter` for asynchronous domain notifications (`budget.alert`, `recurring.auto_posted`, `weekly.digest.ready`).

---

## 2. Component Architecture Diagram

```mermaid
graph TB
    subgraph Clients["Client Tier"]
        TG["Telegram App<br/>(Text / Voice / Photos / Callbacks)"]
        WEB["Web Browser SPA / MiniApp<br/>(Dashboard / Onboarding / Chat)"]
    end

    subgraph Ingress["Ingress & Transport Layer"]
        H_CORS["Helmet + CORS + Static Assets Middleware"]
        THROT["ThrottlerGuard (60 req/min)"]
        TG_HOOK["TelegramController (/telegram/webhook)"]
        TG_POLL["grammY Long-Polling Worker"]
    end

    subgraph AuthLayer["Security & Authentication"]
        JWT_G["JwtAuthGuard<br/>(HttpOnly Cookie / Bearer)"]
        TG_GUARD["TelegramWebAppAuthGuard / Verifier<br/>(HMAC-SHA256)"]
        AUTH_S["AuthService<br/>(Bcrypt, QR Sessions, JWT)"]
    end

    subgraph CoreEngine["NLU & AI Subsystem"]
        NLU_S["NluService (Coordinator)"]
        REG_P["RegexParser (Single & Batch & Bank SMS)"]
        CAT_M["CategoryDictionaryMapper"]
        LLM_A["LlmIntentAdapter (Groq / Gemini / OpenAI)"]
        CTX_S["ConversationContextService (15-min TTL)"]
        TOOL_D["ToolDispatcherService"]
        VOICE_S["AudioTranscriptionService (Whisper / Gemini)"]
        VISION_S["ReceiptVisionService (Gemini 1.5 Flash Vision)"]
    end

    subgraph DomainServices["Deterministic Financial Core"]
        TX_S["TransactionService<br/>(Ledger, Seeding, Undo/Redo)"]
        AN_S["AnalyticsService<br/>(Pulse Score, Daily Limit, Reports)"]
        REC_S["RecurringService<br/>(Idempotent Cron Processor)"]
        WD_S["WeeklyDigestService<br/>(Broadcast Builder)"]
    end

    subgraph Storage["Data Persistence Layer"]
        PRISMA["PrismaService (PrismaClient)"]
        DB[("PostgreSQL Database")]
    end

    TG -->|Webhook / Polling| TG_HOOK
    TG -->|Long Polling| TG_POLL
    WEB -->|HTTP Requests| H_CORS --> THROT
    
    TG_HOOK --> TG_GUARD
    THROT --> JWT_G
    JWT_G --> AUTH_S

    TG_POLL --> NLU_S
    TG_HOOK --> NLU_S
    THROT -->|/api/chat| NLU_S

    NLU_S --> REG_P
    NLU_S --> CAT_M
    NLU_S --> LLM_A
    NLU_S --> CTX_S
    NLU_S --> TOOL_D
    TG_POLL --> VOICE_S
    TG_POLL --> VISION_S

    TOOL_D --> AN_S
    TOOL_D --> TX_S
    NLU_S --> TX_S

    TX_S --> PRISMA
    AN_S --> PRISMA
    REC_S --> PRISMA
    AUTH_S --> PRISMA
    PRISMA --> DB
```

---

## 3. Request Flow

### Standard Ingress Pipeline
1. **HTTP Requests** arrive at `main.ts` / Express:
   - Security headers enforced via `helmet({ contentSecurityPolicy: false })`.
   - CORS validation applied via `CORS_ORIGIN`.
   - Static files served from `/public`.
2. **Rate Limiting**: `ThrottlerGuard` enforces a global limit of 60 requests/minute per IP address.
3. **Authentication**:
   - Protected routes pass through `JwtAuthGuard` (extracting `pulse_session` HttpOnly cookie or `Authorization` Bearer token).
   - Semi-protected endpoints (e.g. `/api/chat`) pass through `OptionalJwtAuthGuard`.
   - Telegram webhooks pass through `TelegramWebhookGuard` verifying `x-telegram-bot-api-secret-token`.
4. **Controller Handling**: Controllers invoke domain services with authenticated `user.id`.
5. **Database Transaction / Query**: `PrismaService` executes SQL queries against PostgreSQL.

---

## 4. Telegram Message Flow

The Telegram interface (`TelegramBotService`) processes inputs based on update types:

```mermaid
sequenceDiagram
    autonumber
    actor User as Telegram User
    participant Bot as grammY Bot (TelegramBotService)
    participant NLU as NluService
    participant Parser as RegexParser / LLM
    participant TxService as TransactionService
    participant DB as PostgreSQL (Prisma)

    User->>Bot: Sends Text / Voice / Receipt Photo
    alt Voice Note
        Bot->>Bot: Download OGG Buffer
        Bot->>Parser: AudioTranscriptionService (Groq Whisper / Gemini)
        Parser-->>Bot: Transcribed Text
    else Photo
        Bot->>Bot: Download image
        Bot->>Parser: ReceiptVisionService (Gemini 1.5 Flash Vision)
        Parser-->>Bot: Scanned Receipt Details
    end

    Bot->>NLU: processUserInput(userId, text)
    NLU->>Parser: Level 1 Regex / Bank SMS / Multipliers
    alt Regex Matched
        Parser-->>NLU: Parsed Transaction(s)
    else Regex Unmatched
        NLU->>Parser: Level 2 LLM Intent Classification (with History)
        Parser-->>NLU: Structured JSON Intent & Parameters
    end

    alt Intent: CREATE_TRANSACTION
        NLU-->>Bot: Return ParsedTransaction[]
        Bot->>TxService: recordParsedTransaction(telegramId, parsed)
        TxService->>DB: INSERT INTO Transaction (Decimal amount)
        TxService->>TxService: checkBudgetAlert(userId, categoryId, amount)
        TxService-->>Bot: Transaction + BudgetAlert
        Bot-->>User: Markdown Confirmation + Category Change Inline Keyboard
    else Intent: Query / Tool Call
        NLU->>TxService: Execute Tool via ToolDispatcherService
        TxService-->>NLU: Calculation Result
        NLU-->>Bot: Formatted Tool Result
        Bot-->>User: Markdown Summary + Action Buttons
    end
```

---

## 5. Web API Flow

The web application communicates with the backend via REST endpoints located under `/api/*` and `/analytics/*`:

| Endpoint | Method | Guard | Description |
| :--- | :--- | :--- | :--- |
| `/api/auth/register` | `POST` | Public | Register with email + password (hashed with bcrypt). |
| `/api/auth/login` | `POST` | Public | Authenticate with email + password, issues `pulse_session` cookie. |
| `/api/auth/telegram` | `POST` | Public | Authenticate via Telegram Login Widget HMAC signature. |
| `/api/auth/qr/generate` | `GET` | Public | Generates a 5-minute QR login session with Telegram deep link. |
| `/api/auth/qr/status` | `GET` | Public | Polls QR session approval status and sets cookie when approved. |
| `/api/auth/logout` | `POST` | Public | Clears `pulse_session` cookie. |
| `/api/me` | `GET` | `JwtAuthGuard` | Returns authenticated user profile and settings. |
| `/api/user/onboarding` | `POST` | `JwtAuthGuard` | Saves onboarding income, currency, savings target, and initial budgets. |
| `/api/chat` | `POST` | `OptionalJwtAuthGuard` | Natural language chat input for web dashboard users. |
| `/api/transactions` | `GET` | `JwtAuthGuard` | Returns dashboard aggregates, period summaries, and recent transactions. |
| `/api/transactions` | `POST` | `JwtAuthGuard` | Manual transaction creation. |
| `/api/transactions/:id` | `DELETE` | `JwtAuthGuard` | Soft-deletes a transaction owned by the user. |
| `/api/budgets` | `GET` | `JwtAuthGuard` | Retrieves monthly category budget limits. |
| `/api/budgets` | `POST` | `JwtAuthGuard` | Upserts a monthly category budget limit. |
| `/api/recurring` | `GET` | `JwtAuthGuard` | Retrieves active recurring rules. |
| `/api/recurring` | `POST` | `JwtAuthGuard` | Creates a new recurring scheduled payment rule. |
| `/api/export/csv` | `GET` | `JwtAuthGuard` | Exports user transactions as a sanitized CSV file. |
| `/health` | `GET` | Public | Health check reporting DB status, uptime, and memory usage. |

---

## 6. Authentication Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Browser
    participant AuthC as AuthController
    participant AuthS as AuthService
    participant Bot as Telegram Bot
    participant DB as PostgreSQL (Prisma)

    alt Scenario A: Email & Password
        User->>AuthC: POST /api/auth/login { email, password }
        AuthC->>AuthS: loginWithEmail(email, pass)
        AuthS->>DB: findUnique(user)
        AuthS->>AuthS: bcrypt.compare(password, hash)
        AuthS-->>AuthC: JWT Token + User Profile
        AuthC-->>User: Set-Cookie: pulse_session=<token>; HttpOnly
    else Scenario B: Telegram Widget
        User->>AuthC: POST /api/auth/telegram { id, hash, auth_date, ... }
        AuthC->>AuthS: validateAndLoginTelegramUser(data)
        AuthS->>AuthS: HMAC-SHA256(botToken, dataCheckString) == hash
        AuthS->>DB: Upsert User by telegramId
        AuthS-->>AuthC: JWT Token + User Profile
        AuthC-->>User: Set-Cookie: pulse_session=<token>; HttpOnly
    else Scenario C: Desktop QR Code Login
        User->>AuthC: GET /api/auth/qr/generate
        AuthC->>AuthS: createQrSession()
        AuthS-->>User: { sessionId, deepLink: "https://t.me/bot?start=qr_xxx" }
        User->>Bot: Opens deep link on phone & sends /start qr_xxx
        Bot->>AuthS: approveQrSession(sessionId, telegramId)
        AuthS->>AuthS: Update session status to 'APPROVED' & attach token
        User->>AuthC: GET /api/auth/qr/status?sessionId=xxx (Polling)
        AuthC-->>User: Set-Cookie: pulse_session=<token> & Authenticated!
    end
```

---

## 7. Transaction Creation Flow

```mermaid
flowchart TD
    Start(["Input: Text, Audio Transcript, or Manual API"]) --> NLU["NluService.processUserInput()"]
    
    NLU --> CheckBatch{"Contains Multi-Item<br/>Comma/Newline Delimiters?"}
    CheckBatch -- Yes --> ParseBatch["RegexParser.parseBatch()"]
    CheckBatch -- No --> CheckRegex{"Matches Regex /<br/>Bank SMS / Multipliers?"}
    
    CheckRegex -- Yes --> ParseSingle["RegexParser.parseSingle()"]
    ParseSingle --> DictMap["CategoryDictionaryMapper.categorize()"]
    
    CheckRegex -- No --> LLM["LlmIntentAdapter.classifyAndDispatch()"]
    LLM --> ZodCheck{"Valid Schema &<br/>Transactions Present?"}
    ZodCheck -- No --> ToolOrChat["Dispatch Tool Query or Chat Reply"]
    ZodCheck -- Yes --> ExtractTx["Extract Transaction Items"]

    ParseBatch --> BatchLoop["Iterate Transaction List"]
    DictMap --> RecordTx["TransactionService.recordParsedTransaction()"]
    ExtractTx --> RecordTx
    BatchLoop --> RecordTx

    RecordTx --> ResolveUser["Get / Create User"]
    ResolveUser --> ResolveCat["Get / Create Category under User Scope"]
    ResolveCat --> DecimalConvert["Convert Amount to Prisma.Decimal"]
    DecimalConvert --> InsertDB[("Insert into Transaction Table")]
    InsertDB --> DupCheck["AnalyticsService.detectDuplicate()"]
    InsertDB --> BudgetCheck["TransactionService.checkBudgetAlert()"]
    
    BudgetCheck --> OverPaced{"Over 80% or Exceeded<br/>or Burn Pace Warning?"}
    OverPaced -- Yes --> EmitAlert["EventEmitter: emit('budget.alert')"]
    OverPaced -- No --> ReturnResult["Return Transaction & Summary to Client"]
    EmitAlert --> ReturnResult
```

---

## 8. AI / NLU Flow

The NLU subsystem is structured in multi-tier cascading stages to minimize LLM latency and cost while maintaining high parsing precision:

```mermaid
graph TD
    RawInput["User Input String"] --> Level1A["Level 1A: Regex Batch Parser<br/>(e.g., 'Lunch 200, tea 40, cab 180')"]
    
    Level1A -- "Matched >= 2 items" --> SuccessBatch["Return Multiple Parsed Transactions<br/>(Confidence: 0.90, parsedBy: REGEX)"]
    Level1A -- "No Match" --> Level1B["Level 1B: Regex Single Parser & Bank SMS<br/>- Bank debit/credit pattern detection<br/>- Multipliers (k, lakh, cr)<br/>- Split bills ('split with 4')<br/>- Preposition merchant extraction"]
    
    Level1B -- "Amount > 0" --> Dict["CategoryDictionaryMapper<br/>(Keyword Matching on 19 standard categories)"]
    Dict --> SuccessSingle["Return Single Parsed Transaction<br/>(Confidence: 0.90-0.95, parsedBy: REGEX)"]
    
    Level1B -- "Amount <= 0 / Unmatched" --> Context["ConversationContextService<br/>(Inject last 6 messages within 15-min TTL)"]
    Context --> Level2["Level 2: LLM Intent Classifier & Router<br/>(Groq LLaMA 3.3 70B / Gemini 1.5 Flash / OpenAI)"]
    
    Level2 --> ZodValidate["Zod Validation<br/>(NLUIntentResponseSchema)"]
    ZodValidate --> RouteIntent{"Classified Intent"}
    
    RouteIntent -->|CREATE_TRANSACTION| LLMTx["Extracted Transactions (parsedBy: LLM)"]
    RouteIntent -->|QUERY_* / BUDGET_*| ToolCall["ToolDispatcherService Execution"]
    RouteIntent -->|CONVERSATIONAL_CORRECTION| Correction["Apply Field Correction"]
    RouteIntent -->|GENERAL_QUESTION / ADVICE| ChatReply["Return Direct Assistant Reply"]
```

---

## 9. Budget Flow & Pacing Engine

Budget management operates entirely with deterministic domain rules in `TransactionService` and `AnalyticsService`:

1. **Budget Definition**:
   - Monthly limit configured per category per month/year via `prisma.budget.upsert()`.
2. **Current Spend Aggregation**:
   - Sums all active (`isDeleted: false`), expense transactions within UTC month bounds.
3. **Pace & Run-Rate Formula**:
   $$\text{usedPercentage} = \frac{\text{currentSpent}}{\text{monthlyLimit}} \times 100$$
   $$\text{expectedPacePercentage} = \left(\frac{\text{currentDay}}{\text{totalDaysInMonth}}\right) \times 100$$
   - **Pace Warning Condition**: Triggers if $\text{usedPercentage} > (\text{expectedPacePercentage} + 20\%)$ before the limit is reached.
   - **Month-End Projection**:
     $$\text{projectedMonthEndSpend} = \left(\frac{\text{currentSpent}}{\text{currentDay}}\right) \times \text{totalDaysInMonth}$$
     $$\text{projectedOverage} = \text{projectedMonthEndSpend} - \text{monthlyLimit}$$
4. **Proactive Event Trigger**:
   - Emits `budget.alert` event when spend $\ge 80\%$ or when the pace formula projects an overage.

---

## 10. Recurring Transaction Flow

Recurring transactions (e.g. SIPs, subscriptions, salaries, rent) run through an **idempotent transactional scheduler**:

```mermaid
sequenceDiagram
    autonumber
    participant Cron as NestJS Scheduler (@Cron midnight)
    participant RecS as RecurringService
    participant DB as PostgreSQL (Prisma $transaction)
    participant Events as EventEmitter2 ('recurring.auto_posted')
    participant Bot as Telegram Bot Service

    Cron->>RecS: handleRecurringCron()
    RecS->>DB: findMany(isActive=true, nextRun <= now)
    
    loop For each due recurring transaction
        RecS->>DB: BEGIN $transaction
        RecS->>DB: findUnique(RecurringExecution for scheduledDate)
        alt Already Executed
            RecS->>DB: ROLLBACK (Skip duplicate)
        else Not Executed
            RecS->>DB: INSERT INTO Transaction (type, amount, merchant, parsedBy='ML')
            RecS->>DB: UPDATE RecurringTransaction (nextRun = addMonths(nextRun, 1))
            RecS->>DB: INSERT INTO RecurringExecution (scheduledDate, status='SUCCESS')
            RecS->>DB: COMMIT $transaction
            RecS->>Events: emit('recurring.auto_posted', payload)
            Events->>Bot: @OnEvent('recurring.auto_posted')
            Bot-->>Bot: Send Telegram alert message to user
        end
    end
```

---

## 11. Database Architecture

### Entity Relationship Diagram

```mermaid
erDiagram
    User ||--o{ Category : "owns"
    User ||--o{ Transaction : "records"
    User ||--o{ Budget : "sets"
    User ||--o{ RecurringTransaction : "schedules"
    User ||--o{ AuditLog : "generates"
    Category ||--o{ Transaction : "categorizes"
    Category ||--o{ Budget : "limits"
    Category ||--o{ RecurringTransaction : "categorizes"
    RecurringTransaction ||--o{ RecurringExecution : "executes"

    User {
        String id PK
        String email UK
        String passwordHash
        String telegramId UK
        String username
        String firstName
        String lastName
        String profilePhotoUrl
        String currency
        Boolean isOnboarded
        Decimal monthlyIncome
        Int targetSavingsRate
        DateTime createdAt
        DateTime updatedAt
        DateTime lastLoginAt
        Boolean isActive
    }

    Category {
        String id PK
        String userId FK
        String name
        TransactionType type
        String icon
        Boolean isSystem
        DateTime createdAt
        DateTime updatedAt
    }

    Transaction {
        String id PK
        String userId FK
        String categoryId FK
        TransactionType type
        Decimal amount
        Decimal originalAmount
        String currency
        String merchant
        String description
        DateTime transactionDate
        Int splitCount
        String rawText
        ParsedBy parsedBy
        Boolean isDeleted
        DateTime createdAt
        DateTime updatedAt
    }

    Budget {
        String id PK
        String userId FK
        String categoryId FK
        Decimal monthlyLimit
        Int month
        Int year
        DateTime createdAt
        DateTime updatedAt
    }

    RecurringTransaction {
        String id PK
        String userId FK
        String categoryId FK
        TransactionType type
        Decimal amount
        String description
        String cronExpression
        DateTime nextRun
        Boolean isActive
        DateTime createdAt
        DateTime updatedAt
    }

    RecurringExecution {
        String id PK
        String recurringTransactionId FK
        DateTime scheduledDate
        DateTime executedAt
        Decimal amount
        String status
    }

    AuditLog {
        String id PK
        String userId FK
        String action
        Json details
        DateTime createdAt
    }

    AIPrediction {
        String id PK
        String rawPrompt
        String provider
        Json responseMetadata
        Int tokensUsed
        Int latencyMs
        DateTime createdAt
    }
```

---

## 12. Scheduler Architecture

The application uses `@nestjs/schedule` for background cron routines:

| Cron Job | Schedule | Service | Responsibility |
| :--- | :--- | :--- | :--- |
| **Recurring Outlay Processor** | `0 0 * * *`<br/>(Daily at Midnight) | [`RecurringService`](file:///d:/Akash%20Saas%20Projects/Ai%20Expense%20Tracker/src/analytics/recurring.service.ts) | Queries due recurring records, creates ledger transactions atomically, increments `nextRun` by 1 month, logs execution records, and emits notification events. |
| **Weekly Money Digest** | `0 20 * * 0`<br/>(Every Sunday at 8:00 PM) | [`WeeklyDigestService`](file:///d:/Akash%20Saas%20Projects/Ai%20Expense%20Tracker/src/analytics/weekly-digest.service.ts) | Computes 7-day totals, net savings, Pulse Score, and top 3 expense categories for all active Telegram users, emitting `weekly.digest.ready` events. |

---

## 13. Dashboard Architecture

The Web Dashboard is implemented as a client-side single page application inside [`public/index.html`](file:///d:/Akash%20Saas%20Projects/Ai%20Expense%20Tracker/public/index.html) integrating with backend REST endpoints:

### Frontend Subsystems
1. **State & Session Store**:
   - Manages active user profiles, authenticated sessions, theme preferences (`dark`/`light`), and live dashboard caches.
2. **Interactive Charting (Chart.js)**:
   - Renders weekly spend vs. income trend bars, category allocation donuts, and monthly burn progression.
3. **Financial Intelligence Widgets**:
   - **Pulse Health Score Gauge (0–100)**: Evaluates retention rate and budget discipline into a graded indicator (`Excellent`, `Good`, `Fair`, `At Risk`).
   - **Safe Daily Spend Card**: Real-time formula dividing remaining discretionary budget by remaining days in month.
4. **Interactive AI Assistant Panel**:
   - Inline conversation interface communicating with `POST /api/chat`, supporting natural language queries and instant transaction logging.
5. **Interactive Controls**:
   - Category budget limit editor, recurring payment creation modal, transaction soft-deletion, and one-click CSV export download.
