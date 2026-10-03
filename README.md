# Greenhouse, Lever, Ashby & Workday Jobs Feed

Get one clean job feed from public Greenhouse, Lever, Ashby, and Workday career pages. Paste a career-site URL or a board name. The actor detects the ATS, calls that vendor's public job-board endpoint (no login), and returns deduplicated jobs with the title, department, locations, remote or hybrid status, salary when the board publishes it, dates, apply link, and the description as both text and HTML.

Use it to watch a list of companies, pull openings for a job board, or schedule a daily run that returns only roles you have not seen before.

## What a run returns

Each dataset item is one job. Newest posted dates come first. Duplicate postings in the same run are removed. You are charged only for rows that are returned. Jobs filtered out, and boards that fail, are not charged.

```json
{
  "source": "lever",
  "boardId": "spotify",
  "company": "Spotify",
  "jobId": "e04833c0-9cff-4b5e-b217-91a3bcb57051",
  "title": "Senior Software Engineer",
  "department": "Engineering / Platform",
  "locations": ["Toronto"],
  "workplaceType": "remote",
  "isRemote": true,
  "employmentType": "Permanent",
  "salary": null,
  "postedAt": "2026-10-02T13:54:24.827Z",
  "updatedAt": null,
  "applyUrl": "https://jobs.lever.co/spotify/e04833c0-9cff-4b5e-b217-91a3bcb57051/apply",
  "descriptionText": "The Platform team creates the technology that enables Spotify to learn quickly...",
  "descriptionHtml": "<div><p>The Platform team creates the technology that enables Spotify to learn quickly...</p></div>"
}
```

Salary is included when the board publishes it. This Ashby posting is a real example:

```json
"salary": {
  "min": 211400,
  "max": 290600,
  "currency": "USD",
  "interval": "year",
  "text": "$211.4K - $290.6K"
}
```

`workplaceType` is `remote`, `hybrid`, `onsite`, or `unknown`. `isRemote` is true for a fully remote job. Hybrid stays hybrid, so a remote-only filter does not include it.

A run summary is saved as the `OUTPUT` record in the key-value store: how many boards succeeded, how many jobs matched, and whether the spending limit stopped the run.

## Input

| Field | Default | What it does |
| --- | --- | --- |
| Career pages or board identifiers | Discord Greenhouse, Spotify Lever, Linear Ashby | URLs or slugs. Mixed ATS values are fine. |
| Keyword | empty | Case-insensitive phrase in the title, department, company, location, or description. |
| Location | empty | Case-insensitive phrase matched against locations. |
| Remote only | false | Keeps jobs the source marks remote. Hybrid is excluded. |
| Department | empty | Case-insensitive phrase matched against department. |
| Posted within days | empty | Drops jobs older than N days, and jobs with no date. |
| Only jobs not seen before | false | Returns jobs this state key has not already returned. |
| State key | `default` | Separate histories for separate watch lists. Kept 90 days. |
| Reset seen-jobs state | false | Forgets that history before the run. |
| Maximum results | 15 | Cap on rows returned and charged. |
| Max concurrency | 4 | Boards fetched at once. Also limits Workday detail calls. |
| Include descriptions | true | Workday loads one detail page per returned job. Turn off to skip that. |
| Workday list limit | 100 | Caps how many Workday list rows are read per board. |

Accepted inputs:

- `https://boards.greenhouse.io/discord` or `https://job-boards.greenhouse.io/discord`
- `https://boards.greenhouse.io/embed/job_board?for=discord`
- `https://jobs.lever.co/spotify` and `https://jobs.eu.lever.co/spotify`
- `https://jobs.ashbyhq.com/linear`
- `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite`
- `https://pwc.wd3.myworkdaysite.com/recruiting/pwc/Global_Experienced_Careers`
- `greenhouse:discord`, `lever:spotify`, `ashby:linear`, `workday:` plus a career URL
- A bare slug such as `discord`, probed on Greenhouse, then Lever, then Ashby

The same board pasted twice is fetched once. EU Greenhouse and EU Lever hosts are detected from the URL.

Start with the default input. It calls three small public boards and returns at most 15 jobs, which keeps a scheduled check fast.

## Only new jobs

Turn on **Only jobs not seen before**. The actor stores returned job ids in a named key-value store called `ats-jobs-feed`, under your state key. The next run with the same key skips those ids.

The first run has an empty history, so it returns jobs and records the ones it actually output. Set **Maximum results** high enough to cover the boards on that first run if you want the whole current list marked as seen. Jobs past the cap stay unseen and can show up next time. Seen ids that are still on the board are refreshed. Ids that disappear are forgotten after 90 days.

Filtered-out jobs are not marked seen. You only pay for rows in the dataset.

## Pricing

You pay per job returned (the `job-result` event), plus a tiny run-start fee. The intended price is **$1.20 per 1,000 jobs** on the free plan, with lower prices on higher Apify plans. See the Pricing tab for the live rate. A default run of 15 jobs is about two cents before any plan discount.

## How the data is collected

Greenhouse, Lever, and Ashby each expose one public JSON endpoint that their own career pages use. No password is required. Descriptions are in that same response. Greenhouse HTML is entity-decoded before it is stored.

Workday career sites are different. The actor reads the public CXS jobs endpoint with no login, pages through the list, and loads a detail page only for jobs that will be returned. Workday is isolated: a timeout, a block, or a bad URL is logged and skipped. It does not fail the rest of the run. If every Greenhouse, Lever, and Ashby board fails too, the run fails so you can see that the input needs attention.

Requests are retried with exponential backoff on network errors and HTTP 408, 429, and 5xx. Other boards keep going when one board is bad.

## Limitations

- These are the public career-page feeds. A company that has left an ATS, or a board that requires a login, will not return jobs.
- Greenhouse often has no structured salary or employment type. Those fields are null unless the board puts them in job metadata.
- Lever's public feed has no updated date. Ashby and Lever company names are taken from the board slug when the feed does not send a display name (`spotify` becomes Spotify).
- Workday does not publish a department on the list feed. Posted dates on the list are phrases like "Posted yesterday" until the detail page supplies a date. Multi-location rows say "5 Locations" until that detail page is loaded. Very large tenants are capped by **Workday list limit** (default 100, hard cap 2,000, and some tenants cap their own total). Keyword search on Workday uses the title, location, and Workday's own search box, not the full description of every listing.
- A job URL still resolves to the company board, not a single posting.
- The actor does not submit applications and does not log in.

## Local run

```bash
npm install
npm test
npm start
```

`npm test` runs unit tests and live calls against Discord Greenhouse, Spotify Lever, Linear Ashby, and an NVIDIA Workday board. With no input file, `npm start` uses the same three default boards and returns at most 15 jobs. To pass input, write `storage/key_value_stores/default/INPUT.json` before `npm start`.
