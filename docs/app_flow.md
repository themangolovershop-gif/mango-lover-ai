# App Flow & UI/UX Brief: TMLS Verified Mango Network

This document details the navigation flows, user interface (UI) layouts, and user experience (UX) standards for the platform.

---

## 🎨 1. Design Tokens & Brand System
To reflect a premium agricultural brand, we use a sleek, obsidian dark mode with glowing gold/amber accents, mimicking the rich color of premium Alphonso mangoes.

* **Background (Dark)**: `#070d1b` (Deep Obsidian Blue)
* **Card Background**: `rgba(255, 255, 255, 0.02)` / `rgba(255, 255, 255, 0.05)`
* **Primary Accent (Mango Gold)**: `#F59E0B` (Amber 500)
* **Secondary Accent**: `#D4860A` (Gold)
* **Status Colors**:
  * **Success/Active**: `#10B981` (Emerald 500)
  * **Warning/Pending**: `#F59E0B` (Amber 500)
  * **Danger/Error**: `#F43F5E` (Rose 500)
* **Typography**:
  * **Headers**: `Outfit` or `Inter`, Bold, Tracking Tight
  * **Body**: `Inter`, Medium weight, clean readability on mobile screens

---

## 🗺️ 2. User Flows (App Flow)

### A. Sourcing & Pricing Setup Flow
```
[Farmer / Admin Log In] ──► [Dashboard Header] ──► [Click 'Pricing'] 
                                                         │
                                                         ▼
[View Current Retail & Corporate Prices] ◄───────────────┘
  │
  ├─► [Edit Inputs: Medium, Large, Jumbo]
  │
  └─► [Click 'Save & Sync'] ──► [Save to Supabase / Refresh AI Prompt Cache]
```

### B. Buyer WhatsApp Flow
```
[Customer texts: "What are the prices?"] ──► [Meta Cloud API Webhook]
                                                        │
                                                        ▼
[AI reads Dynamic Business Facts from DB] ◄─────────────┘
  │
  ├─► [AI generates response: Retail + Corporate Rates]
  │
  └─► [WhatsApp Message Sent to Customer] ──► [Customer Uploads Screenshot]
                                                        │
                                                        ▼
[AI OCR extracts transaction code] ◄────────────────────┘
  │
  └─► [Matches against DB Order] ──► [Auto-marks as PAID] ──► [Notify Operator]
```

---

## ✏️ 3. UI/UX Dashboard Wireframe Brief

The operator console layout consists of a fixed header, a left-hand navigation list (for inbox items or pricing cards), and a primary workspace panel.

### Wireframe Mockup: Sourcing & Pricing Panel
```
+-------------------------------------------------------------------------------+
| 🥭 CONSOLE  [ INBOX ]  [ PRICING ]  [ LOGS ]         [WA: ●] [DB: ●] [AI: ●] [ ]  |
+-------------------------------------------------------------------------------+
|                                                                               |
|  Verified Farmer Pricing Admin                                                |
|  Manage retail and corporate pricing for Devgad Alphonso boxes.               |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  |  BOX SIZE      |  RETAIL PRICE (DOZEN)     |  CORPORATE PRICE (10+ BOXES)  |  |
|  +----------------+---------------------------+-------------------------------+  |
|  |  MEDIUM        |  [ ₹ 1,499           ]    |  [ ₹ 2,999                  ] |  |
|  |  181-220g      |                           |                               |  |
|  +----------------+---------------------------+-------------------------------+  |
|  |  LARGE         |  [ ₹ 1,999           ]    |  [ ₹ 3,499                  ] |  |
|  |  221-260g      |                           |                               |  |
|  +----------------+---------------------------+-------------------------------+  |
|  |  JUMBO         |  [ ₹ 2,499           ]    |  [ ₹ 3,999                  ] |  |
|  |  261-300g      |                           |                               |  |
|  +-------------------------------------------------------------------------+  |
|                                                                               |
|                                                       [ Save & Sync Rates ]   |
|                                                                               |
+-------------------------------------------------------------------------------+
```

### UX Design Rules:
1. **Interactive Hover Effects**: Buttons must highlight using smooth transitions (duration-300) with a subtle amber glow.
2. **Alerts & Toasts**: Saving changes triggers a micro-animation toast: *"Success: Live Prompt Synchronized with Supabase Database!"*
3. **Data Protection**: Invalid numerical entries (e.g. text inputs in price boxes) must block submission and display error tooltips.
