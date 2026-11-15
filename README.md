# AH PF2E Auras

A Foundry VTT v14 module for Pathfinder 2e that speeds up auras. It never changes a character sheet. It only posts prompts in chat, in the same style as PF2e's own spell cards.

1. **It tells you privately.** When a creature moves into an enemy's aura, or starts its turn in one, you get a GM-only card in chat. The card says who, which aura, and the save it suggests.
2. **You decide.** Click **Post save request** to put a save request in chat for everyone (or only that player). If it isn't needed, click **Not needed**. To stop hearing about an aura, click **Never**.
3. **The save request works like a PF2e spell card:**
   - a save button with the DC, which the player clicks to roll
   - each result written out: **Critical Success**, **Success**, **Failure**, **Critical Failure**
   - damage links you click to roll. On the damage card, use PF2e's usual buttons (full, half, double) on the selected token.
   - condition links (e.g. *Frightened 2*) and effect links you can drag onto a token
4. **Immunity.** If an aura gives immunity (e.g. Frightful Presence), the request has a GM-only button that stops the module asking about that aura for that creature for the set time. It changes nothing on the sheet.

## Setting up an aura
The first time an aura you haven't set up comes up, the card has a **Set up this aura** button. You can also go to **Module Settings → AH PF2E Auras → Set up auras**. For each aura you choose:
- when it matters (moving into it, starting a turn in it, or both)
- the save (Fortitude, Reflex or Will) and the DC (the owner's class or spell DC, the standard DC for their level, or a fixed number)
- damage dice and type, with a **Use basic save damage** button
- for each result: damage, conditions, effects (drag them in from a compendium), an immunity reminder, and a short note

The bottom of the window reads your choices back as plain sentences.

## Settings
- Watch auras on or off
- Player characters only, or every creature (choose "every creature" if your PCs have auras that affect monsters)
- Enemies' auras only, or every aura
- Tell me about auras that aren't set up, or ignore them
- Who sees the save request
- Show the DC to players
- Show players what each result does

## Good to know
- Auras are checked on the scene **the GM is viewing**, because PF2e can only measure auras for tokens drawn on the canvas.
- Hidden tokens don't count, whether they're giving off the aura or standing in it.
- You won't get the same card twice in one turn for the same creature and aura. Outside combat, you won't get it twice within 15 seconds.
- Immunity times use the world clock. In combat, each round moves it on 6 seconds. Outside combat it only moves when you advance time.
- A keybinding, **Check selected tokens for auras**, posts cards for every aura the selected tokens are in. Bind it under Configure Controls.
- Macro API: `game.modules.get("ah-pf2e-auras").api` has `checkTokens()`, `openAuraList()`, `openAuraEditor(slug)`, `scan()` and `auraPairs()`.
