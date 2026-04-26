# WhatsApp Production UAT Checklist

Updated for the live production baseline on April 26, 2026.

## Purpose

Use this checklist to validate the live WhatsApp sales flow with one controlled test number before or after a production change.

This is a real-message UAT, not a local simulation.

## Scope

Validate:

- live webhook reachability
- reply quality
- pricing accuracy
- address and delivery guidance
- multilingual behavior
- dashboard persistence
- deterministic order guidance

Do not validate:

- bulk broadcast behavior
- proactive follow-up timing
- Meta template approval behavior

## Preconditions

- Use one dedicated internal test number only.
- Confirm production health is green at `https://whatsapp-agent-main.vercel.app/api/health`.
- Confirm Meta webhook points to `https://whatsapp-agent-main.vercel.app/webhooks/whatsapp`.
- Confirm production is deployed from the latest approved commit.
- Keep the dashboard open during the test.
- Do not run this on a real customer number.

## Current Expected Live Facts

- Brand: The Mango Lover Shop
- Visit address: `1st Floor, The Walk, Hiranandani Estate, Thane, Mumbai`
- Website: `themangolovershop.in`
- Medium: `INR 1199`
- Large: `INR 1499`
- Jumbo: `INR 1999`
- Medium weight: `181-220g per mango`
- Large weight: `221-260g per mango`
- Jumbo weight: `261-300g per mango`
- Mumbai delivery target: `24 hours`
- Metro air courier target: `2 days`
- Reference courier charge: `INR 130 per kg`
- Supported reply styles: `English`, `Hinglish`, `Hindi`, `Marathi`, `Gujarati`

## Stop Conditions

Stop the test and escalate if any of these happen:

- wrong price is quoted
- wrong address is quoted
- fake claims like exact daily customer volume are invented
- same reply repeats unnaturally
- payment is pushed before buying intent exists
- no message is saved in dashboard
- webhook creates duplicate replies for one inbound

## Test Script

### 1. Health gate

Action:

- Open `https://whatsapp-agent-main.vercel.app/api/health`

Pass:

- response is `200`
- payload is green for `db`, `wa`, `ai`, `webhook`

### 2. Pricing question

Send:

```text
large mango price?
```

Pass:

- reply mentions `Large INR 1499`
- tone is natural, not robotic
- reply does not mention old prices like `1500` or `1999` for Large

### 3. Availability question

Send:

```text
what sizes are available today?
```

Pass:

- reply can mention `Medium`, `Large`, `Jumbo`
- reply stays within current pricing and weight bands
- reply does not hardcode `today's fresh harvest` unless an operator manually added that fact for the day

### 4. Location question

Send:

```text
shop location?
```

Pass:

- reply mentions `1st Floor, The Walk, Hiranandani Estate, Thane, Mumbai`
- if visit timing is discussed, it is framed as operationally confirmable, not blindly promised

### 5. Delivery timing question

Send:

```text
Mumbai delivery kitne time me hoga?
```

Pass:

- reply mentions Mumbai target of `24 hours`
- reply keeps it as guidance, not an unconditional guarantee

### 6. Courier charge question

Send:

```text
courier charges kya hai?
```

Pass:

- reply mentions `INR 130 per kg`
- reply also notes final total can depend on city, quantity, or handling

### 7. Hindi/Hinglish tone

Send:

```text
natural hai kya? aur large best rahega?
```

Pass:

- reply is in Hindi/Hinglish naturally
- reply confirms natural ripening
- reply can recommend Large appropriately

### 8. Marathi reply

Send:

```text
tumhi marathi madhye bolu shakta ka? mumbai delivery kiti velat hote?
```

Pass:

- reply is in Marathi or Marathi-mixed natural style
- meaning remains correct
- delivery timing remains aligned to the live facts

### 9. Gujarati reply

Send:

```text
tame gujarati ma jawab api shako? jumbo gifting mate saru che?
```

Pass:

- reply is in Gujarati or Gujarati-mixed natural style
- Jumbo is described as suitable for gifting

### 10. Order-start intent

Send:

```text
2 dozen large mumbai delivery chahiye
```

Pass:

- reply recognizes buying intent
- reply moves toward deterministic next-step capture
- reply does not jump straight to payment without basic order details

### 11. Payment step behavior

Send:

```text
payment done
```

Pass:

- reply asks for payment reference or screenshot
- reply does not pretend payment is verified before proof is received

### 12. Dashboard persistence

Check in dashboard:

- test conversation appears or updates in real time
- inbound and outbound messages are visible
- latest message ordering is correct
- operator can open the conversation cleanly

### 13. No duplicate outbound

Check:

- one inbound test message should not produce multiple assistant replies unless explicitly expected by flow

## UAT Log Template

Use this table while running the test:

| Step | Sent | Expected | Actual | Pass/Fail |
|---|---|---|---|---|
| 1 | health | green payload |  |  |
| 2 | large mango price? | Large INR 1499 |  |  |
| 3 | what sizes are available today? | current catalog only |  |  |
| 4 | shop location? | The Walk address |  |  |
| 5 | Mumbai delivery kitne time me hoga? | 24 hours guidance |  |  |
| 6 | courier charges kya hai? | INR 130/kg guidance |  |  |
| 7 | natural hai kya? | Hinglish natural-ripened answer |  |  |
| 8 | Marathi prompt | Marathi-capable answer |  |  |
| 9 | Gujarati prompt | Gujarati-capable answer |  |  |
| 10 | 2 dozen large mumbai delivery chahiye | deterministic next step |  |  |
| 11 | payment done | ask for reference/screenshot |  |  |
| 12 | dashboard check | messages persisted |  |  |
| 13 | duplicate check | one outbound per inbound |  |  |

## Sign-off Rule

Mark production UAT as passed only if:

- all pricing and address replies are correct
- language mirroring works in at least Hindi/Hinglish plus one of Marathi or Gujarati
- dashboard persistence is visible
- no duplicate outbound reply is observed

## Related Runbooks

- [Live Sales FAQ Playbook](./live-sales-faq-playbook.md)
