# Publishing this actor

This is the click-by-click path for a first Apify account. Nothing here has been published. This project has no Apify token, and it should stay that way. Do not paste a token into the repo, into `.env`, or into a commit.

The actor id in `.actor/actor.json` is `ats-jobs-feed`. The Store title is "Greenhouse, Lever, Ashby & Workday Jobs Feed".

## 1. Create the account

1. Open [https://console.apify.com/sign-up](https://console.apify.com/sign-up) and create an account.
2. Confirm the email address. You can stay on the free plan while you test. Free-plan runs of your own actor do not create payout income.

## 2. Install the CLI and log in

On your computer, in a terminal:

```bash
npm install -g apify-cli
apify login
```

The browser login stores the token on your machine, outside this repo. `apify login` is the only place the token should go.

## 3. Push the code

From the project folder (the one that contains `package.json` and the `.actor` directory):

```bash
npm install
npm test
apify push
```

`npm test` must pass before you push. It calls the real Discord, Spotify, Linear, and NVIDIA boards.

`apify push` creates the actor on your account from `.actor/actor.json` and builds the Docker image. The first build takes a few minutes. If the name `ats-jobs-feed` is already used on your account, change the `name` field in `.actor/actor.json` and push again. The Store title can stay the same.

## 4. Set the run size

In Apify Console, open the actor, then **Settings**.

- Set the default memory to **512 MB**. The code refuses less than 512 MB and more than 2048 MB.
- Leave the timeout at a few minutes. A default run finishes in well under a minute.

## 5. Run it once on Apify before you publish

Open the **Input** tab. The form should already show:

- `https://boards.greenhouse.io/discord`
- `https://jobs.lever.co/spotify`
- `https://jobs.ashbyhq.com/linear`
- Maximum results: **15**

Leave keyword, location, and remote-only empty. Click **Start** (or Save and Start).

When it finishes, the run must be green (succeeded), not failed. Open the dataset. You should see up to 15 jobs with `source`, `company`, `title`, and `applyUrl`. Open **Storage → Key-value stores → default → OUTPUT** and confirm `boardsSucceeded` is 3.

If this run fails, do not publish. Fix the input or the code and run it again. Apify's Store checker uses this saved default input every day.

## 6. Turn on pay-per-event pricing

Open the actor → **Publication** → **Monetization**. Choose **Pay per event** (not rental, and not pay per result). Enable **Apify Store discounts**.

Create or edit these events. Prices are USD per single event.

**Actor start** (the built-in event, name exactly `apify-actor-start`)

- Title: `Actor start`
- Description: `Charged once when the run starts.`
- Price on every tier: `0.00005`
- Do not add a line of code that charges this. Apify charges it automatically. Charging it yourself will fail the run.

**Job result** (name exactly `job-result`)

- Title: `Job result`
- Description: `One normalized job listing added to the dataset.`
- Free: `0.0012`
- Bronze: `0.0011`
- Silver: `0.0010`
- Gold: `0.0009`
- Platinum: `0.0008`
- Diamond: `0.0008`

**Dataset item** (the built-in event `apify-default-dataset-item`)

- Set the price to `0` on every tier, or remove the event if the form lets you.
- The code charges `job-result` for each row. A second price on the dataset item bills the user twice.

Save the monetization form. Apify may ask you to wait before the price is public. That wait is normal.

Why these numbers, and what it takes to clear $60 a month, is in [PRICING.md](PRICING.md).

## 7. Fill in the Store listing

Still under **Publication**:

1. The description on the Store page is `README.md`. Read it in the preview and fix anything that sounds wrong. The short card text comes from `description` in `.actor/actor.json`.
2. Category: **Jobs**.
3. Add a picture if you have one. The listing can go live without one.
4. Leave the default input as the three boards above and max results 15. Do not replace it with a large Workday board. Workday is slower and more likely to fail, and a failed daily check puts the actor under maintenance after 3 bad days and up for removal after 28 more.

Click **Publish**, then make the actor public when the button is available.

## 8. Get paid

1. Open **Settings → Payouts** (or Billing) on your account.
2. Add your legal billing details and verify your identity.
3. Choose **PayPal** or **Wise**. The payout minimum is $20 for those. Other methods need $100, and bank wires often take a fee.
4. Apify creates the invoice on the **11th** of each month for the previous month. Only users who have actually paid are included. Your share is 80% of those fees, minus the platform cost of the runs. If a month is under $20, it rolls over.

## 9. Keep the daily check green

Apify runs the actor every day with the saved default input. The run fails only when every Greenhouse, Lever, and Ashby board fails. One bad URL does not fail the run if another board still returns data. A Workday failure never fails the run by itself.

If Discord, Spotify, or Linear leaves that ATS, the default run can start returning an empty or failed board. When that happens:

1. Pick another public board that returns JSON today.
2. Change the default and the prefill in `.actor/input_schema.json`.
3. `apify push` again.
4. In Console, open Input, confirm the new URLs, and **Save** so the daily checker uses them.

Do not point the default input at a board you have not just opened in a browser.

## Local check, without publishing

```bash
npm install
npm test
npm start
```

`npm start` reads `storage/key_value_stores/default/INPUT.json` if that file exists. If it does not, the actor uses the three default boards and returns at most 15 jobs. Results land in `storage/datasets/default/`. That folder is gitignored.
