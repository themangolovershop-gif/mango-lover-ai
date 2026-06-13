# Technical Requirements Document (TRD): TMLS Verified Mango Network

## 💻 1. Tech Stack
* **Frontend**: Next.js 15 (App Router, Tailwind CSS, Lucide Icons, Framer Motion)
* **Backend**: Node.js API Routes (Next.js serverless handlers) + Express.js backend modules
* **Database & Storage**: Supabase (PostgreSQL, Realtime, Supabase Storage for daily orchard media)
* **ORM**: Prisma Client
* **AI Model**: Claude 3.5 Sonnet / GPT-4o via OpenRouter/OpenAI API
* **WhatsApp Integration**: Meta Business Cloud API (Webhook endpoint handled in Next.js)
* **Campaigns**: AiSensy API
* **Logistics**: Shiprocket API
* **Deployment**: Vercel (Production) & Local Windows Dev Environment

---

## 🏗️ 2. System Architecture

The platform follows a serverless architecture where Next.js hosts both the React UI dashboard and API endpoints. The WhatsApp Webhook receives inbound messages, parses user intent using the AI service, reads/updates database records via Prisma, and responds via the Meta Cloud API.

```
                  ┌──────────────────────┐
                  │   WhatsApp Client    │
                  └──────────┬───────────┘
                             │
                      Inbound│Outbound
                      Webhook│API Call
                             ▼
┌────────────────────────────────────────────────────────┐
│                      Next.js App                       │
│                                                        │
│ ┌──────────────────┐  ┌──────────────────┐  ┌────────┐ │
│ │  API Route /wh   ├─►│    AI Service    ├─►│ OpenAI │ │
│ └──────────────────┘  │ (Prompt Builder) │  └────────┘ │
│                       └────────┬─────────┘             │
│ ┌──────────────────┐           │                       │
│ │ Dashboard UI     ├─►┌────────▼────────┐              │
│ └──────────────────┘  │  Prisma Client  │              │
└───────────────────────┼────────┬────────┼──────────────┘
                        │        │        │
                 Direct │        │        │ Pooled
             Connection │        │        │ Connection
                        ▼        ▼        ▼
                ┌──────────────────────────────────┐
                │             Supabase             │
                │ ┌──────────────────────────────┐ │
                │ │     PostgreSQL Database      │ │
                │ └──────────────────────────────┘ │
                │ ┌──────────────────────────────┐ │
                │ │        Media Storage         │ │
                │ └──────────────────────────────┘ │
                └──────────────────────────────────┘
```

---

## 🗄️ 3. Backend Schema (Key Tables)

The primary tables involved in Phase 1 (Sourcing & Pricing) are `Product`, `Order`, `OrderItem`, and `WebhookLog`.

### Product Model
Stores product sizes, retail prices, corporate prices, and rules.
```prisma
model Product {
  id                String      @id @default(uuid())
  name              String
  slug              String      @unique
  size              ProductSize // enum: MEDIUM, LARGE, JUMBO
  price             Decimal     @db.Decimal(10, 2) // Retail Price
  corporatePrice    Decimal     @db.Decimal(10, 2) @default(0.00) // Corporate Price
  active            Boolean     @default(true)
  cityRulesJson     Json?
  deliveryRulesJson Json?
  orderItems        OrderItem[]
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt

  @@index([active])
  @@index([size])
}
```

### WebhookLog Model
Stores logs of WhatsApp webhook requests for monitoring and debugging.
```prisma
model WebhookLog {
  id            String   @id @default(uuid())
  whatsappMsgId String?  @map("whatsapp_msg_id")
  phone         String?
  status        String
  payload       Json?
  error         String?
  durationMs    Int?     @map("duration_ms")
  createdAt     DateTime @default(now()) @map("created_at")

  @@index([whatsappMsgId])
  @@index([phone])
  @@index([status])
  @@index([createdAt])
}
```

---

## 🔌 4. API Endpoints (Pricing Module)

### `GET /api/pricing`
* **Description**: Fetches all active products with their retail and corporate pricing. Auto-seeds default pricing if the database is empty.
* **Response**:
  ```json
  [
    {
      "id": "prod-uuid-1",
      "name": "Medium",
      "slug": "medium",
      "size": "MEDIUM",
      "price": 1499.00,
      "corporatePrice": 2999.00
    }
  ]
  ```

### `POST /api/pricing`
* **Description**: Updates pricing for multiple product sizes in the database.
* **Payload**:
  ```json
  {
    "prices": {
      "MEDIUM": { "retail": 1499, "corporate": 2999 },
      "LARGE": { "retail": 1999, "corporate": 3499 },
      "JUMBO": { "retail": 2499, "corporate": 3999 }
    }
  }
  ```
* **Response**:
  ```json
  {
    "success": true,
    "updated": [...]
  }
  ```

---

## 🔒 5. Security & Performance
* **Authentication**: Dashboard access is guarded by an `ADMIN_PASSWORD` checked server-side via `/api/login` and stored in a secure cookie session.
* **Caching**: Live business facts (system prompt injector) caches database calls for **5 minutes** (`FACTS_CACHE_TTL_MS`) to prevent excessive read requests to Supabase during high-traffic WhatsApp chats.
* **Database Pooler**: Prisma uses connection pooling (`DATABASE_URL` via Supabase pooler port `6543`) to avoid exhausting database connections during concurrent webhook execution.
