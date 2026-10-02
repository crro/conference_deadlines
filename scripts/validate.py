#!/usr/bin/env python3
"""Validate data/conferences.json against data/taxonomy.json.

Usage:
    python3 scripts/validate.py           # check only
    python3 scripts/validate.py --format  # check, then rewrite the file in canonical form

Only the Python standard library is required.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "conferences.json"
TAXONOMY = ROOT / "data" / "taxonomy.json"

KINDS = {"conference", "workshop", "challenge"}
FIELD_ORDER = [
    "id", "series", "year", "kind", "full_name", "link", "location", "dates", "start",
    "topics", "parent", "cycle", "tentative", "note", "deadlines",
]
REQUIRED = ["id", "series", "year", "kind", "full_name", "topics", "deadlines"]
DEADLINE_ORDER = ["type", "label", "date", "tz"]
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$")
TZ_RE = re.compile(r"^(AoE|UTC|UTC[+-]\d{1,2}(:\d{2})?)$")
ISO_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate(entries, taxonomy):
    topics = {t["id"] for g in taxonomy["topic_groups"] for t in g["topics"]}
    types = set(taxonomy["deadline_types"])
    errors = []
    ids = set()

    for i, e in enumerate(entries):
        where = f"entry #{i} ({e.get('id', '?')})"
        for f in REQUIRED:
            if f not in e:
                errors.append(f"{where}: missing '{f}'")
        unknown = set(e) - set(FIELD_ORDER)
        if unknown:
            errors.append(f"{where}: unknown field(s) {sorted(unknown)}")
        if e.get("id") in ids:
            errors.append(f"{where}: duplicate id")
        ids.add(e.get("id"))
        if not re.fullmatch(r"[a-z0-9-]+", str(e.get("id", ""))):
            errors.append(f"{where}: id must be lowercase letters, digits and dashes")
        if not isinstance(e.get("year"), int):
            errors.append(f"{where}: year must be an integer")
        if e.get("kind") not in KINDS:
            errors.append(f"{where}: kind must be one of {sorted(KINDS)}")
        if not e.get("topics"):
            errors.append(f"{where}: needs at least one topic")
        for t in e.get("topics", []):
            if t not in topics:
                errors.append(f"{where}: unknown topic '{t}' (see data/taxonomy.json)")
        if "start" in e and not ISO_DAY_RE.match(str(e["start"])):
            errors.append(f"{where}: start must be YYYY-MM-DD")
        if "cycle" in e and e["cycle"] not in (1, 2, 3, 4):
            errors.append(f"{where}: cycle must be 1-4 (years between editions)")
        if "link" in e and e["link"] and not str(e["link"]).startswith(("http://", "https://")):
            errors.append(f"{where}: link must be an http(s) URL")
        for j, d in enumerate(e.get("deadlines", [])):
            dw = f"{where} deadline #{j}"
            if d.get("type") not in types:
                errors.append(f"{dw}: unknown type '{d.get('type')}'")
            if not DATE_RE.match(str(d.get("date", ""))):
                errors.append(f"{dw}: date must be 'YYYY-MM-DD HH:MM'")
            if not TZ_RE.match(str(d.get("tz", ""))):
                errors.append(f"{dw}: tz must be AoE, UTC or UTC±H[:MM]")
            if not d.get("label"):
                errors.append(f"{dw}: missing label")

    for e in entries:
        if e.get("parent") and e["parent"] not in ids:
            errors.append(f"{e.get('id')}: parent '{e['parent']}' does not exist")
    return errors


def canonical(entries):
    """Stable ordering and one deadline per line keeps diffs readable."""
    def order(obj, keys):
        return {k: obj[k] for k in keys if k in obj} | {k: v for k, v in obj.items() if k not in keys}

    entries = sorted(entries, key=lambda e: (e["kind"] != "conference", e["series"].lower(), e["year"], e["id"]))
    chunks = []
    for e in entries:
        e = order(e, FIELD_ORDER)
        deadlines = sorted(e.pop("deadlines", []), key=lambda d: d["date"])
        body = json.dumps(e, ensure_ascii=False, indent=2)[:-2]  # drop closing "\n}"
        body = re.sub(r'"topics": \[\s*([^\]]*?)\s*\]', lambda m: '"topics": [' + re.sub(r",\s+", ", ", m.group(1)) + "]", body)
        lines = [body + ","]
        if deadlines:
            lines.append('  "deadlines": [')
            lines.append(",\n".join("    " + json.dumps(order(d, DEADLINE_ORDER), ensure_ascii=False) for d in deadlines))
            lines.append("  ]")
        else:
            lines.append('  "deadlines": []')
        lines.append("}")
        chunks.append("\n".join(lines))
    return "[\n" + ",\n".join(chunks) + "\n]\n"


def main():
    entries = json.loads(DATA.read_text(encoding="utf-8"))
    taxonomy = json.loads(TAXONOMY.read_text(encoding="utf-8"))
    errors = validate(entries, taxonomy)
    if errors:
        print("\n".join(errors))
        print(f"\n{len(errors)} problem(s) found.", file=sys.stderr)
        return 1
    if "--format" in sys.argv:
        DATA.write_text(canonical(entries), encoding="utf-8")
        print("Rewrote data/conferences.json in canonical form.")
    elif DATA.read_text(encoding="utf-8") != canonical(entries):
        print("data/conferences.json is valid but not canonically formatted; run with --format.", file=sys.stderr)
        return 1
    print(f"OK: {len(entries)} entries.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
