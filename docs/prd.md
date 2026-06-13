# Product Requirements Document (PRD): TMLS Verified Mango Network

## 🥭 1. Executive Summary
**The Mango Lover Shop (TMLS)** is transitioning from a traditional e-commerce storefront into **India’s Verified Mango Network**. The platform connects retail and corporate buyers directly with premium, verified Alphonso mango farmers in Devgad and Ratnagiri, using AI to automate sales, pricing updates, visual trust (photos/videos), payment tracking, and order fulfillment.

---

## 👥 2. User Personas & Problems

### A. The Consumer (Retail Buyer)
* **Profile**: Premium fruit connoisseurs, families, health-conscious buyers.
* **Pain Points**: Fake Alphonso claims (fake Devgad/Ratnagiri), chemical ripening (carbide), high retail markups, lack of trust in online sellers.
* **Needs**: Source-verified, naturally ripened, GI-tagged Alphonso mangoes delivered fresh.

### B. The Corporate Buyer
* **Profile**: HR managers, company executives, procurement heads.
* **Pain Points**: Difficulty arranging bulk premium gifting, lack of custom packaging/branding options, slow GST invoicing.
* **Needs**: Reliable bulk delivery, customizable branding/cards, automated invoicing, bulk price quoting.

### C. The Verified Farmer (Grower)
* **Profile**: Traditional orchard owners in Devgad & Ratnagiri.
* **Pain Points**: Exploited by mandi middle-men, volatile pricing, no direct relationship with buyers, lack of tech skills.
* **Needs**: Fair direct-to-consumer prices, control over daily rates, simple UI to share their harvest journey.

### D. The Operator/Admin (Vinod & Team)
* **Profile**: Operations coordinator, sales lead.
* **Pain Points**: Overflow of 100+ manual WhatsApp chats per day, verifying payments manually, copy-pasting tracking details.
* **Needs**: Central console to monitor AI chats, override AI replies, track orders, update prices, and view logistics health.

---

## 🛠️ 3. Core Features & Functional Requirements

### Phase 1: Live Sourcing & Pricing Sync (Sourcing Core)
* **Farmer Pricing Admin Panel**: Inside the dashboard, the operator or farmer can set live pricing for Medium, Large, and Jumbo boxes for both retail and corporate customers.
* **AI Prompt Synchronization**: OpenAI prompt builder fetches database rates in real-time, preventing the AI from quoting outdated pricing.

### Phase 2: Visual Trust & Farmer Daily Updates
* **Farmer Mobile Media Portal**: Simplified mobile web interface where farmers upload daily orchard, harvesting, and grading photos.
* **AI Media Injector**: During sales conversations, the AI agent dynamically sends these fresh, time-stamped farm photos to handle buyer objections.

### Phase 3: Transaction Automation & Payments
* **UPI Screenshot OCR**: Customers upload payment screenshots on WhatsApp; AI scans the image to extract the UTR (Transaction ID) and amount.
* **Payment Auto-Verification**: Matches the parsed transaction ID with database orders to mark them as "Paid".
* **Automated GST Invoicing**: Auto-generates GST tax invoices for corporate clients.

### Phase 4: Order Routing & Logistics
* **Geographic Order Routing**: Auto-allocates orders to the nearest verified farmer who has active inventory.
* **Shiprocket Dispatch Integration**: Generates shipping labels inside the farmer dashboard and sends automated tracking links to the customer on WhatsApp.

### Phase 5: Corporate Portal & Export Panel
* **Corporate Gifting Panel**: Self-serve portal for bulk corporate buyers to upload employee address lists and customize corporate gifting cards.

---

## 📈 4. Success Metrics (KPIs)
* **Conversion Rate**: Increase WhatsApp lead-to-paid order conversion by 20% through instant responses.
* **Revenue Target**: Achieve ₹10 Crore seasonal revenue.
* **Operational Efficiency**: Reduce manual operator chat time by 80% through AI automation.
* **Trust Factor**: 100% of mango boxes shipped must be linked to a verified orchard.
