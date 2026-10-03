# Cinekive Pro on Lemon Squeezy

Paid Pro is a license key, not a Cinekive account. The desktop app sends the key to the local API. The API calls Lemon Squeezy `activate` or `validate`. Media never goes to the store.

## What is on sale

| Plan | Price | Checkout |
|------|-------|----------|
| Lifetime | $99 once | [Buy Lifetime](https://cinekive.lemonsqueezy.com/checkout/buy/938df13e-96e3-406f-a56f-2a245b790ada) |
| Annual | $19/year | Not on sale. The dashboard variant is still pending and is not a $19 subscription. Do not send buyers there until it is published as a yearly subscription. |

Store: `cinekive.lemonsqueezy.com`. Product id `1346696` (override with `LEMONSQUEEZY_PRODUCT_ID`).

The product was still in Lemon test mode when this was written. Live keys and test keys are not interchangeable. Switch the store to live before taking real money.

## Activate

1. Buyer pays. Lemon emails a license key.
2. In the app: **Settings → Cinekive Pro** → paste the key.
3. The API calls `POST https://api.lemonsqueezy.com/v1/licenses/activate` with an instance name (the machine id).
4. The response's `instance.id` is stored in `license.json`. Later checks call `validate` with that instance and do not consume another seat.
5. **Deactivate** calls Lemon `deactivate` so the seat is freed, then deletes the local file.

What leaves the machine: license key and instance id. Not frames.

Device limit comes from the license's `activation_limit` (dashboard). Offline grace and re-verify default to 14 days (`CINEKIVE_LICENSE_GRACE_SEC`, `CINEKIVE_LICENSE_REVERIFY_SEC`).

## Trials

`CK-TRIAL-` keys are unchanged. They are no-card, maintainer-signed, and expire on an absolute timestamp. They are not a Lemon subscription trial.

## Env

| Variable | Purpose |
|----------|---------|
| `CINEKIVE_LEMONSQUEEZY` | `off` disables the license API (forks) |
| `LEMONSQUEEZY_PRODUCT_ID` | Allowlist. Default `1346696` |
| `LEMONSQUEEZY_STORE_SLUG` | Default `cinekive` |
| `LEMONSQUEEZY_VARIANT_LIFETIME` | Checkout slug. Default is the published Lifetime variant |
| `LEMONSQUEEZY_VARIANT_ANNUAL` | Set only after the $19/year variant is published |
| `CINEKIVE_PRO_URL` | Overrides the upgrade link |
| `LEMONSQUEEZY_API_KEY` | Store API only (dashboard scripts). Not required to activate a buyer's key |

## Legacy Gumroad

If Lemon rejects a key and Gumroad product env vars are set, the API still tries Gumroad. New sales should not create Gumroad keys.
