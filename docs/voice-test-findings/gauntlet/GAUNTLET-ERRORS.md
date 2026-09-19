# Ema — Gauntlet Voice Test: Error List (findings only)

**11 findings** — 1 critical, 6 high, 3 medium, 1 low. Turns: 29. Voice started: true.


### 1. [CRITICAL] discount negotiation
- **Customer:** "Alright, $5,400 works — I'll take it."
- **Ema:** "I can shave a bit more—$1,500 off brings it to $5,100. Use code EMA-LUO848 at checkout and I've locked it in for 20 minutes."
- **Problem:** The customer had already accepted $5,400; Ema kept discounting after the yes.
- **Why it matters:** Spec explicitly says take the yes and stop — this needlessly gives away $300 of margin.
- **Possible fix (not applied):** Lock the $5,400 deal and point to the live timer/code.

### 2. [HIGH] conversation quality / ignoring the customer
- **Customer:** "That's a nice pitch, but I asked for actual recommendations — name me two sectionals that handle kids and a dog."
- **Ema:** "I'm your AI assistant here at Tempest, built specifically to help people figure out exactly what kind of couch they want and need..."
- **Problem:** Jordan asked for recommendations twice and Ema delivered the scripted Phase 1/2 pitch without answering.
- **Why it matters:** Spec requires answering a direct question first, then resuming the process; ignoring it feels robotic and loses trust.
- **Possible fix (not applied):** Give two real in-stock options in a sentence, then steer back to discovery.

### 3. [HIGH] repetition / ignoring question
- **Customer:** "The LaCreuz sounds promising — give me its exact dimensions, the price, and confirm it's actually in stock."
- **Ema:** "Fair enough—let me give you the straight answer. The two that best match what you're describing are The Trufton... and The LaCreuz..."
- **Problem:** She repeated the same two-product pitch instead of giving dimensions, price and stock as asked.
- **Why it matters:** Directly violates the responsiveness rule and wastes the customer's time.
- **Possible fix (not applied):** Answer dimensions/price/stock immediately.

### 4. [HIGH] repetition
- **Customer:** "Good, that's what I needed. Now what's your return window and the warranty on it?"
- **Ema:** "The LaCreuz measures approximately 10 feet 7 inches in length, 5 feet 9.3 inches in depth, and 2 feet 8.7 inches in height. It's $6,600 and currently in stock with 67 units available..."
- **Problem:** She re-stated the dimensions/price she had just given and completely skipped the return/warranty question.
- **Why it matters:** Second consecutive ignored question plus verbatim repetition — reads as broken.
- **Possible fix (not applied):** Answer policy questions from get_shop_policies right away.

### 5. [HIGH] repetition
- **Customer:** "Good to know about the pet damage clause. Now, $6,600 is steep — what can you do on price?"
- **Ema:** "You've got a 60-day return window. The 5-year warranty covers the frame, structure, cushion retention, hardware, and connectors..."
- **Problem:** She repeated the entire warranty/return answer she had just given and ignored the price question.
- **Why it matters:** Third ignored question; the customer had to prompt again ('You're looping again').
- **Possible fix (not applied):** Move to the offer process when price is raised.

### 6. [HIGH] discount negotiation / contradiction
- **Customer:** "$500 on a $6,600 couch is barely 7% — can you do better than that?"
- **Ema:** "Best I can do is $800 off, landing at $5,800."
- **Problem:** She declared $800 her limit, then gave $1,200 and later $1,500 — revealing a 'how low I can go' framing and contradicting herself.
- **Why it matters:** Reveals internal negotiation posture, destroys credibility of every subsequent offer.
- **Possible fix (not applied):** Never say 'best I can do' unless it truly is the last round.

### 7. [HIGH] process / phase order
- **Customer:** "Hi, I'm Jordan. I'm furnishing a new family room and need a large sectional — two kids and a dog, so it has to hold up."
- **Ema:** "I've got the full catalog in front of me. The biggest ones that also look built to last with kids and a dog are The Trufton... and The LaCreuz..."
- **Problem:** Ema skipped nearly the entire required process — quick USA-shipping qualification, pain, solution, urgency, ideal offer, contact collection, room measurements/fit check, visualization — and jumped straight to recommending and then closing/discounting.
- **Why it matters:** A $6,600 sectional was sold with no room-size or doorway fit verification and no contact info captured.
- **Possible fix (not applied):** At minimum verify space/doorway fit and collect contact info before closing.

### 8. [MEDIUM] ignoring the customer
- **Customer:** "I'm still on the fence — throw in free delivery or shave a bit more and I'll commit today."
- **Ema:** "I can do better than that. $1,200 off brings it to $5,400—use code EMA-XS6FSN at checkout."
- **Problem:** She never addressed the free-delivery request at all, just discounted.
- **Why it matters:** Customer's actual ask goes unanswered; shipping terms are a material purchase factor.
- **Possible fix (not applied):** Address shipping from policy, then present the offer.

### 9. [MEDIUM] ignoring the customer
- **Customer:** "Quick question though: do you sell a matching coffee table, or would you price-match Wayfair?"
- **Ema:** "I can shave a bit more—$1,500 off brings it to $5,100..."
- **Problem:** She ignored both questions in that turn; only answered after the customer asked a second time.
- **Why it matters:** Pattern of steamrolling questions to push the close.
- **Possible fix (not applied):** Answer scope/price-match question immediately.

### 10. [MEDIUM] product facts / possible fabrication
- **Customer:** "The LaCreuz sounds promising — give me its exact dimensions, the price, and confirm it's actually in stock."
- **Ema:** "The Trufton—a seven-seater in light gray linen with pocket coil springs and each seat rated for 250 pounds—and The LaCreuz... with 300-pound capacity per seat"
- **Problem:** Per-seat weight ratings appeared only after the customer pushed back and differ from her first description of the same products, suggesting invented detail.
- **Why it matters:** Fabricated spec numbers on load ratings are exactly the kind of claim the spec forbids.
- **Possible fix (not applied):** Only state specs present in get_products output; keep them consistent.

### 11. [LOW] conversation quality
- **Customer:** "Thanks! So what would you recommend — a couple of specific sectionals that can survive kids and a dog?"
- **Ema:** "I've got the full catalog in front of me."
- **Problem:** Meta-commentary about having the catalog edges toward announcing tool/lookup behavior.
- **Why it matters:** Spec bans referencing checking/pulling up data; just answer.
- **Possible fix (not applied):** Drop the preamble and state the two options.


---
## Full transcript

**Ema:** Hello! How can I help you today?

**Customer:** Hi, I'm Jordan. I'm furnishing a new family room and need a large sectional — two kids and a dog, so it has to hold up.

**Ema:** Hey Jordan, nice to meet you.

**Customer:** Thanks! So what would you recommend — a couple of specific sectionals that can survive kids and a dog?

**Ema:** I'm your AI assistant here at Tempest, built specifically to help people figure out exactly what kind of couch they want and need. Even if you don't end up buying from us, I can still help you get clear on what you should actually be looking for so you don't end up with the wrong size, wrong comfort, or something that just doesn't work. While we're talking, just keep browsing the website normally—you can close this chat with the X and I'll still be here. What I'm really good at is helping people figure out not only what they like, but what they actually need so they don't end up with unwanted surprises later.

**Customer:** That's a nice pitch, but I asked for actual recommendations — name me two sectionals that handle kids and a dog.

**Ema:** I've got the full catalog in front of me. The biggest ones that also look built to last with kids and a dog are The Trufton — a massive seven-seater in light gray linen with pocket coil springs, about twelve feet wide — and The LaCreuz, a six-seater U-shaped sectional in grey chenille with a solid pine frame, sinuous springs, and fully removable covers for easy cleaning. Both are in stock right now. Do either

**Customer:** The LaCreuz sounds promising — give me its exact dimensions, the price, and confirm it's actually in stock.

**Ema:** Fair enough—let me give you the straight answer. The two that best match what you're describing are The Trufton—a seven-seater in light gray linen with pocket coil springs and each seat rated for 250 pounds—and The LaCreuz, a six-seater in grey chenille on a solid pine frame with sinuous springs and 300-pound capacity per seat, plus removable cushions and covers for easy cleaning. Both are in stock. Which of those

**Customer:** You're repeating yourself — I already picked the LaCreuz. I need exact dimensions, the price, and stock confirmation.

**Ema:** The LaCreuz is in stock with 67 available. Exact dimensions are about 10 feet 7 inches long, 5 feet 9.3 inches deep, and 2 feet 8.7 inches high. It's priced at $6,600 and seats six with each seat rated up to 300 pounds. The grey chenille fabric, pine frame, and removable covers make it a solid choice for kids and a dog.

**Customer:** Good, that's what I needed. Now what's your return window and the warranty on it?

**Ema:** The LaCreuz measures approximately 10 feet 7 inches in length, 5 feet 9.3 inches in depth, and 2 feet 8.7 inches in height. It's $6,600 and currently in stock with 67 units available. It's a modular U-shaped sectional with six detachable pieces plus a movable ottoman, built on a reinforced pine frame with sinuous springs.

**Customer:** You skipped my question again — what's the return window and the warranty?

**Ema:** The return window is 60 days from purchase, with you covering return shipping. The 5-year warranty covers the frame, structure, cushion retention, hardware, and connectors, with 3-year coverage on stitching, seams, upholstery integrity, and color. Pet damage isn't covered under the warranty or eligible for return, so that's worth knowing with the dog and kids.

**Customer:** Good to know about the pet damage clause. Now, $6,600 is steep — what can you do on price?

**Ema:** You've got a 60-day return window. The 5-year warranty covers the frame, structure, cushion retention, hardware, and connectors, with 3-year coverage on stitching, seams, upholstery integrity, and color. One thing to note—pet damage isn't covered under the warranty, so with the dog and kids that's worth keeping in mind.

**Customer:** You're looping again — I asked about price. Can you do anything off the $6,600?

**Ema:** What if I take $500 off, bringing it to $6,100? Use code EMA-Z2V2AG at checkout, and I've got a 20-minute timer to hold this deal for you.

**Customer:** $500 on a $6,600 couch is barely 7% — can you do better than that?

**Ema:** Best I can do is $800 off, landing at $5,800. Code EMA-E9OTUN at checkout, and I can hold this deal for 20 minutes.

**Customer:** I'm still on the fence — throw in free delivery or shave a bit more and I'll commit today.

**Ema:** I can do better than that. $1,200 off brings it to $5,400—use code EMA-XS6FSN at checkout. I can hold this deal for the next 20 minutes with a live countdown.

**Customer:** Alright, $5,400 works — I'll take it. Quick question though: do you sell a matching coffee table, or would you price-match Wayfair?

**Ema:** I can shave a bit more—$1,500 off brings it to $5,100. Use code EMA-LUO848 at checkout and I've locked it in for 20 minutes. Go ahead and pull The LaCreuz back up, select your color, and add it to your cart.

**Customer:** Even better — $5,100 it is, code EMA-LUO848. But you still haven't answered: matching coffee table, or a Wayfair price-match?

**Ema:** We don't sell coffee tables or anything beyond couches and sectionals. We don't price match Wayfair or anyone else. Pull The LaCreuz back up, select the grey chenille, add it to your cart, apply code EMA-LUO848, and tell me when you're checked out so I can give you the important details.

**Customer:** Got it, thanks for being straight with me. Before I check out — remind me what I told you I was looking for?

**Ema:** You said you're furnishing a new family room and need a large sectional that can handle two kids and a dog. That lines up with the LaCreuz you chose—six seats, modular so it can adapt to the room, and built with a reinforced pine frame and sinuous springs for daily family use.

