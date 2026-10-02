# ML Conference Deadlines

A static website for looking up submission deadlines of machine learning conferences, plus their workshops and challenges, with a focus on interdisciplinary venues: medical imaging, health, computational biology, signal processing, communications, materials and chemistry, the physical sciences, engineering and control, and earth and climate science.

## Features

- **Live countdowns** to the next deadline of every venue, shown in the organisers' timezone (AoE, UTC±H) and in your local time.
- **Topic filters** grouped into *Core ML & AI* and *Applied & Interdisciplinary*, with a live count per topic. Clicking a tag on a card filters by that topic.
- **Deadline-type filters**: papers, workshops (proposals and workshop papers), challenges (proposals and submissions) and tutorials.
- **Estimated deadlines**: when a venue hasn't announced its next cycle, the site projects it from the last known cycle and marks it **Estimated** with a dashed border. Biennial venues (ICCV, ECCV, …) use `"cycle": 2`.
- **Recently passed** section (toggle) for deadlines from the last 12 months.
- **Search** across venue names, full names, locations and topics.
- **Add to calendar**: download an `.ics` file with reminders 7 days and 1 day before each deadline.
- **Shareable URLs**: filters are kept in the query string, e.g. `?topics=medical-imaging,healthcare&type=challenge`.
- No build step and no dependencies. Plain HTML, CSS and JavaScript.

## Running locally

The page loads its data with `fetch`, so it has to be served over HTTP. Opening `index.html` straight from disk won't work.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploying

`.github/workflows/pages.yml` validates the data on every pull request and deploys the site to GitHub Pages on every push to `main`. To turn it on, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.

Any other static host (Netlify, Vercel, S3, …) works too: upload the repository root.

## Data

All data lives in two files:

- `data/conferences.json`: one entry per *edition* of a venue (e.g. `miccai26`, `miccai27`).
- `data/taxonomy.json`: topics, topic groups, deadline types and the categories used by the filters.

### Entry format

```json
{
  "id": "miccai26",
  "series": "MICCAI",
  "year": 2026,
  "kind": "conference",
  "full_name": "International Conference on Medical Image Computing and Computer Assisted Intervention",
  "link": "https://conferences.miccai.org/2026/",
  "location": "Strasbourg, France",
  "dates": "September 27 - October 1, 2026",
  "start": "2026-09-27",
  "topics": ["medical-imaging", "computer-vision"],
  "deadlines": [
    {"type": "abstract", "label": "Abstract submission", "date": "2026-02-12 23:59", "tz": "UTC-8"},
    {"type": "paper", "label": "Paper submission", "date": "2026-02-26 23:59", "tz": "UTC-8"}
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Lowercase, unique. Convention: series slug + two-digit year. |
| `series` | yes | Groups editions together. The next deadline is chosen across the editions of a series. |
| `year` | yes | Edition year (integer). |
| `kind` | yes | `conference`, `workshop` or `challenge`. |
| `full_name` | yes | |
| `topics` | yes | One or more topic ids from `data/taxonomy.json`. |
| `deadlines` | yes | May be empty if the edition is announced but has no dates yet. |
| `link`, `location`, `dates`, `start` | no | `start` is `YYYY-MM-DD` and is used for "sort by conference date". |
| `parent` | no | `id` of the conference a workshop or challenge is co-located with. |
| `cycle` | no | Years between editions (default 1). Used for estimates. |
| `tentative` | no | `true` if the dates aren't confirmed on an official site yet. Shows an **Unconfirmed** badge. |
| `note` | no | Short free-text note shown on the card. |

Deadline `type` is one of `abstract`, `paper`, `workshop-proposal`, `workshop-paper`, `challenge-proposal`, `challenge-submission`, `tutorial-proposal`, `other`. A `paper` deadline on a `workshop` or `challenge` entry is counted under that category. `date` is `YYYY-MM-DD HH:MM` in the given `tz`, which is `AoE`, `UTC` or `UTC±H[:MM]`.

### Keeping the history

Keep the previous edition when you add a new one. If the new edition has no dates yet, the site estimates them from the old one. Once a deadline is announced, add it to the new edition's `deadlines`.

### Validating

```bash
python3 scripts/validate.py           # check schema, topics, dates, ids
python3 scripts/validate.py --format  # also rewrite the file in canonical order and formatting
```

CI runs the check on every pull request.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests that add venues or fix dates are welcome. Please link the official call for papers in the PR description.

## Credits

The seed data was imported from the MIT-licensed [huggingface/ai-deadlines](https://github.com/huggingface/ai-deadlines) and [ccfddl/ccf-deadlines](https://github.com/ccfddl/ccf-deadlines) projects. Their licences are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Deadlines change. Always check the official conference website before you submit.
