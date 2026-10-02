# Contributing

Thanks for helping keep the deadlines accurate.

## Add or update a venue

1. Edit `data/conferences.json`. Add a new object for each new edition rather than overwriting the previous year, because the previous year is used to estimate dates that haven't been announced.
2. Use topic ids from `data/taxonomy.json`. For an interdisciplinary venue, tag both the application area (e.g. `medical-imaging`) and the ML area (e.g. `computer-vision`).
3. Copy times and timezones exactly as the official call for papers gives them. "Anywhere on Earth" is `AoE`; Pacific time is `UTC-8` in winter and `UTC-7` in summer.
4. For workshops and challenges, use `"kind": "workshop"` or `"kind": "challenge"` and set `parent` to the host conference's `id` if it's in the file.
5. Run `python3 scripts/validate.py --format` and commit the result.
6. In the pull request, link the page you took the dates from.

## Add a topic

Add it to the right group in `data/taxonomy.json`. Topic ids are lowercase with dashes. The site picks up new topics automatically.

## Code

The site is plain HTML, CSS and JavaScript (`index.html`, `assets/`). There's no build step. Serve the folder with `python3 -m http.server` and reload.
