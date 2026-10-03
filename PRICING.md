# Pricing recommendation

Checked against live Apify Store listings on 3 October 2026. "From" prices are the cheapest Store discount tier the listing advertises. The price a free-plan user pays is that number or higher.

| Actor | Advertised price | What they sell |
| --- | --- | --- |
| [fantastic-jobs/greenhouse-jobs-api](https://apify.com/fantastic-jobs/greenhouse-jobs-api) | from $1.20 / 1,000 jobs | Greenhouse only, their own job database |
| [fantastic-jobs/ashby-jobs-api](https://apify.com/fantastic-jobs/ashby-jobs-api) | from $1.20 / 1,000 jobs | Ashby only, their own job database |
| [fantastic-jobs/workday-jobs-api](https://apify.com/fantastic-jobs/workday-jobs-api) | from $1.20 / 1,000 jobs | Workday only, their own job database |
| [fantastic-jobs/jobs-scraper](https://apify.com/fantastic-jobs/jobs-scraper) | from $1.00 / 1,000 jobs | Live scrape of 12 ATS career pages |
| [bovi/greenhouse-lever-ashby-job-scraper](https://apify.com/bovi/greenhouse-lever-ashby-job-scraper) | from $1.45 / 1,000 results (listing also says $1.50) | Greenhouse, Lever, Ashby, plus three more. Has a "new since last run" mode. No Workday. |
| [webdata_labs/greenhouse-lever-ashby-jobs-scraper](https://apify.com/webdata_labs/greenhouse-lever-ashby-jobs-scraper) | from $0.60 / 1,000 (page also says $1.00) | Seven ATS, including Workday, with a new-jobs mode |
| [memo23/career-site-ats-jobs-api](https://apify.com/memo23/career-site-ats-jobs-api) | from $2.50 / 1,000 jobs | Very wide ATS coverage, email enrichment, a start fee |

## Recommended price

Charge two events. Turn on Apify Store discounts.

1. **`job-result`** — one normalized job written to the dataset. This is the event the code charges with `Actor.pushData(item, 'job-result')`.
2. **`apify-actor-start`** — the automatic start event. Leave the price at Apify's default, **$0.00005**. Do not charge it in code. Apify covers the compute for the first 5 seconds when this event is enabled.

Set **`apify-default-dataset-item` to $0, or delete it.** The code already charges `job-result` for each dataset row. If the dataset-item event also has a price, every job is billed twice.

| Tier | Price per job | Per 1,000 jobs |
| --- | --- | --- |
| Free | $0.0012 | $1.20 |
| Bronze | $0.0011 | $1.10 |
| Silver | $0.0010 | $1.00 |
| Gold | $0.0009 | $0.90 |
| Platinum | $0.0008 | $0.80 |
| Diamond | $0.0008 | $0.80 |

The Store card will show **from $0.80 / 1,000 jobs**. That sits on the same anchor as the Fantastic.jobs single-ATS actors ($1.20), under Bovi ($1.50) and memo23 ($2.50), and above the $0.60 floor. $0.60 does not leave enough after Apify's cut to be worth the support.

Do not add a large start fee. A daily "only new jobs" run that finds nothing should cost the fraction of a cent start event, or people will turn the schedule off.

## What $60 a month takes

Apify pays you **80% of fees from paying users, minus the platform cost of those runs**. Free-plan usage pays you nothing, and Apify covers that compute. Source: [Actor pricing and costs](https://docs.apify.com/actors/publishing/monetize/pricing-and-costs).

At $1.20 / 1,000 jobs:

- 70,000 charged jobs from paying users = $84 of fees
- Your 80% = $67.20
- These runs are JSON requests at 512 MB, usually a few seconds. A rough cost for that volume is a few dollars (compute at $0.20 per compute unit on the free/bronze rate, plus dataset writes at $0.005 per 1,000). Net is about **$60**.

That is about 70 default-sized runs a day if every run returned 15 jobs, or a handful of users pulling a few thousand jobs a week. Users who schedule "only new jobs" after a baseline run pay for the delta, which is the right shape for a monitor and a smaller bill.

If you would rather reach $60 on fewer jobs, use **$0.0015 ($1.50 / 1,000)** on the free tier and discount down to $0.0010. About 52,000 paying jobs then covers the 80% share before the small compute cost. That matches Bovi's price and this actor also covers Workday. I would start at $1.20 so the listing is not more expensive than the Fantastic.jobs actors buyers already compare against.

## What not to charge for

- Jobs removed by keyword, location, remote, department, or date filters
- Boards that 404 or time out
- The Workday list rows that are read and then dropped
- A second copy of a job in the same run

The code stops pushing rows when the user's max charge for the run is reached, and it exits cleanly. Set the actor's default memory to **512 MB** so a short run stays cheap. The minimum in `actor.json` is already 512 MB.
