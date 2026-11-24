# Owner manual — AIEC Lift Marketplace

Written for the business owner. No technical knowledge is needed.

## What changed
Customers can now **shop for a lift**: they enter building details, choose Basic, Standard,
Premium or Luxury, pick approved upgrades, see a live estimated price and request a quotation.
Everything else (leads, surveys, partners, projects, collections, commission) works as before.

## Your daily routine (10 minutes)
1. Open **Lift marketplace** in the admin menu.
2. Work through the **Exception queue** from top to bottom. Red items block sales; amber items need a decision.
3. Ignore everything that is not in the queue. Routine steps are automatic and recorded.

## One-time setup before going live
| Step | Where | Who |
| --- | --- | --- |
| 1. Approve suppliers after checking their KYC and GST | Lift marketplace → Suppliers and products | You or Operations |
| 2. Approve each product and each price | Same page | You or Operations |
| 3. Create the pricing rules (installation, transport, overhead, margin, maximum discount, GST, payment milestones) and **activate** them | Lift marketplace → Pricing and engineering rules | You (only the owner can activate) |
| 4. Ask your authorised lift engineer to review and **activate** the engineering rules | Same page | Engineer |
| 5. Build each package: add components, choose the standard option and any upgrades, then **Publish** | Lift marketplace → Packages | Operations |
| 6. Give your engineer the role **Authorised lift engineer** | Users and roles | You |

Until steps 3 and 4 are done, customers see **"price on request"** and nothing can be quoted. This
is on purpose: the system never shows invented prices.

## How a quotation moves
1. **Estimate**: the customer requested it using their own measurements. Schedule the site survey from the lead.
2. After the survey is reviewed, open the quotation and press **Create version**. The price is now **final**, based on the survey.
3. **Engineering review**: your engineer approves or rejects, and must tick every yellow item.
4. **Awaiting AIEC approval**: only if a discount is above your limit or the margin is below your minimum. You decide.
5. **Issued**: the customer accepts and chooses **AIEC Contract** or **Marketplace Partner**.

Prices in a quotation **never change** once generated, even if a supplier changes its price. To
re-price, create a new version; old versions stay on record.

## What the colours mean
- **Green**: compatible under the active engineering rules.
- **Yellow**: an engineer must decide (for example a shallow pit or unknown power supply).
- **Red**: cannot be sold. The customer must change the selection.

## If something looks wrong
- A supplier made a pricing mistake: reject the price with a note. Price changes over 25% are flagged automatically.
- A supplier misbehaves: set it to **Suspended** with a reason. Its products disappear from carts at once, and open quotations containing them cannot be accepted until you issue a new version.
