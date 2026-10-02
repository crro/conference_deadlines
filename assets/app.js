(() => {
  'use strict';

  const DAY = 86400000;
  const PAST_WINDOW_DAYS = 365;
  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const state = {
    q: '',
    topics: new Set(),
    cats: new Set(),
    orgs: new Set(),
    showEst: true,
    showPast: false,
    sort: 'deadline',
  };

  let taxonomy;
  let topicLabel = {};
  let typeLabel = {};
  let typeToCat = {};
  let editionsById = {};
  let cards = [];
  let tickers = [];

  const $ = (sel) => document.querySelector(sel);

  // ---------- time helpers ----------

  function tzOffsetMinutes(tz) {
    if (!tz || tz === 'AoE') return -12 * 60;
    if (tz === 'UTC') return 0;
    const m = /^UTC([+-])(\d{1,2})(?::(\d{2}))?$/.exec(tz);
    if (!m) {
      console.warn('Unknown timezone', tz);
      return -12 * 60;
    }
    const mins = Number(m[2]) * 60 + Number(m[3] || 0);
    return m[1] === '-' ? -mins : mins;
  }

  // "2026-11-13 23:59" in the given zone -> epoch ms; yearShift supports estimates.
  function toEpoch(dateStr, tz, yearShift = 0) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(dateStr);
    if (!m) return NaN;
    const h = m[4] === undefined ? 23 : Number(m[4]);
    const min = m[5] === undefined ? 59 : Number(m[5]);
    const sec = h === 23 && min === 59 ? 59 : 0;
    const utc = Date.UTC(Number(m[1]) + yearShift, Number(m[2]) - 1, Number(m[3]), h, min, sec);
    return utc - tzOffsetMinutes(tz) * 60000;
  }

  function shiftDateStr(dateStr, years) {
    if (!years) return dateStr;
    return String(Number(dateStr.slice(0, 4)) + years) + dateStr.slice(4);
  }

  const fmtShort = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const fmtLocal = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const fmtClock = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const fmtAoE = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Etc/GMT+12',
  });

  function originalDate(d) {
    // Present the deadline as written by the organisers, e.g. "Nov 13, 2026 23:59 AoE".
    const [ymd, hm = '23:59'] = d.date.split(/[ T]/);
    const [y, mo, day] = ymd.split('-').map(Number);
    return `${fmtShort.format(new Date(Date.UTC(y, mo - 1, day, 12)))} ${hm} ${d.tz || 'AoE'}`;
  }

  function countdownText(ms) {
    const past = ms < 0;
    let s = Math.floor(Math.abs(ms) / 1000);
    const days = Math.floor(s / 86400);
    s -= days * 86400;
    const h = Math.floor(s / 3600);
    s -= h * 3600;
    const m = Math.floor(s / 60);
    s -= m * 60;
    if (past) return days > 0 ? `${days} day${days === 1 ? '' : 's'} ago` : `${h}h ${m}m ago`;
    if (days >= 60) return `${days} days`;
    const pad = (n) => String(n).padStart(2, '0');
    return `${days}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  }

  // ---------- data model ----------

  function categoryOf(entry, d) {
    if (typeToCat[d.type]) return typeToCat[d.type];
    if (entry.kind === 'workshop') return 'workshop';
    if (entry.kind === 'challenge') return 'challenge';
    return 'paper';
  }

  function categoryForEntryDeadline(entry, d) {
    // A workshop's own "paper" deadline is a workshop-paper deadline, etc.
    if (entry.kind === 'workshop' && (d.type === 'paper' || d.type === 'abstract' || d.type === 'other')) return 'workshop';
    if (entry.kind === 'challenge' && (d.type === 'paper' || d.type === 'abstract' || d.type === 'other')) return 'challenge';
    return categoryOf(entry, d);
  }

  function buildCards(data, now) {
    const groups = new Map();
    for (const e of data) {
      const key = `${e.kind || 'conference'}|${e.series}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }

    const out = [];
    for (const editions of groups.values()) {
      editions.sort((a, b) => a.year - b.year);
      const withDl = editions.filter((e) => e.deadlines && e.deadlines.length);

      const materialise = (entry, shift) =>
        (entry.deadlines || []).map((d) => {
          const date = shiftDateStr(d.date, shift);
          return {
            ...d,
            // Extensions and "firm" markers belong to the original cycle, not to a projection.
            label: shift ? (d.label || '').replace(/\s*\((?:extended|firm|estimated)[^)]*\)/gi, '') : d.label,
            date,
            ts: toEpoch(date, d.tz),
            cat: categoryForEntryDeadline(entry, d),
          };
        }).sort((a, b) => a.ts - b.ts);

      // 1. A real edition with an upcoming deadline.
      let active = null;
      let best = Infinity;
      for (const e of withDl) {
        for (const d of materialise(e, 0)) {
          if (d.ts > now && d.ts < best) {
            best = d.ts;
            active = e;
          }
        }
      }

      let card;
      if (active) {
        card = { entry: active, deadlines: materialise(active, 0), estimated: false };
      } else if (withDl.length) {
        // 2. Project the most recent known cycle forward.
        const base = withDl[withDl.length - 1];
        const cycle = base.cycle || 1;
        const baseDls = materialise(base, 0);
        const last = baseDls[baseDls.length - 1];
        let shift = cycle;
        while (toEpoch(shiftDateStr(last.date, shift), last.tz) <= now) shift += cycle;
        const targetYear = base.year + shift;
        const announced = editions.find((e) => e.year === targetYear);
        const entry = announced
          ? { ...base, ...announced, deadlines: base.deadlines }
          : { ...base, year: targetYear, location: 'TBA', dates: 'TBA', start: null, id: `${base.id}-est` };
        card = {
          entry,
          deadlines: materialise(base, shift),
          estimated: true,
          basedOn: base.year,
          linkIsPrevious: !announced,
        };
      } else {
        // 3. Announced, but no deadlines published yet and no history to estimate from.
        card = { entry: editions[editions.length - 1], deadlines: [], estimated: false, tba: true };
      }
      out.push(card);

      // Most recently passed edition, for the "Recently passed" section.
      const pastEd = [...withDl].reverse().find((e) => {
        const dls = materialise(e, 0);
        const last = Math.max(...dls.map((d) => d.ts));
        return last <= now && now - last < PAST_WINDOW_DAYS * DAY && e !== card.entry;
      });
      if (pastEd) {
        out.push({ entry: pastEd, deadlines: materialise(pastEd, 0), estimated: false, past: true });
      }
    }

    for (const c of out) {
      const e = c.entry;
      c.search = [
        e.series, e.full_name, e.location, e.year, e.dates, e.note,
        ...(e.topics || []).map((t) => topicLabel[t] || t),
        e.parent && editionsById[e.parent] ? editionsById[e.parent].series : '',
        ...(e.sponsors || []), e.proceedings,
      ].join(' ').toLowerCase();
    }
    return out;
  }

  // ---------- filtering ----------

  function relevantDeadlines(card) {
    if (!state.cats.size) return card.deadlines;
    return card.deadlines.filter((d) => state.cats.has(d.cat));
  }

  function matchesExceptTopics(card, now) {
    if (card.past && !state.showPast) return false;
    if (card.estimated && !state.showEst) return false;
    if (state.q && !state.q.split(/\s+/).every((w) => card.search.includes(w))) return false;
    const rel = relevantDeadlines(card);
    if (state.cats.size) {
      if (!rel.length) return false;
      if (!card.past && !rel.some((d) => d.ts > now)) return false;
    }
    return true;
  }

  function matchesOrgs(card) {
    if (!state.orgs.size) return true;
    return (card.entry.sponsors || []).some((o) => state.orgs.has(o));
  }

  function matchesTopics(card) {
    if (!state.topics.size) return true;
    return (card.entry.topics || []).some((t) => state.topics.has(t));
  }

  // ---------- rendering ----------

  function chip(label, pressed, onClick, count) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('aria-pressed', String(pressed));
    b.textContent = label;
    if (count !== undefined) {
      const c = document.createElement('span');
      c.className = 'count';
      c.textContent = count;
      b.append(c);
    }
    b.addEventListener('click', onClick);
    return b;
  }

  function toggleIn(set, value) {
    if (set.has(value)) set.delete(value);
    else set.add(value);
    update();
  }

  function renderFilters(now) {
    const orgCounts = {};
    for (const c of cards) {
      if (c.past || !matchesExceptTopics(c, now) || !matchesTopics(c)) continue;
      for (const o of c.entry.sponsors || []) orgCounts[o] = (orgCounts[o] || 0) + 1;
    }
    const orgs = Object.keys(orgCounts)
      .filter((o) => orgCounts[o] >= 3 || state.orgs.has(o))
      .sort((a, b) => orgCounts[b] - orgCounts[a] || a.localeCompare(b));
    $('#org-chips').replaceChildren(
      ...orgs.map((o) => chip(o, state.orgs.has(o), () => toggleIn(state.orgs, o), orgCounts[o] || 0)),
    );

    const catWrap = $('#category-chips');
    catWrap.replaceChildren(
      ...taxonomy.categories.map((c) => chip(c.label, state.cats.has(c.id), () => toggleIn(state.cats, c.id))),
    );

    const base = cards.filter((c) => !c.past && matchesExceptTopics(c, now) && matchesOrgs(c));
    const counts = {};
    for (const c of base) for (const t of c.entry.topics || []) counts[t] = (counts[t] || 0) + 1;

    const sections = taxonomy.topic_groups.map((g) => {
      const sec = document.createElement('div');
      sec.className = 'topic-group';
      const h = document.createElement('h2');
      h.textContent = g.label;
      const wrap = document.createElement('div');
      wrap.className = 'chips';
      wrap.append(...g.topics.map((t) => chip(t.label, state.topics.has(t.id), () => toggleIn(state.topics, t.id), counts[t.id] || 0)));
      sec.append(h, wrap);
      sec.style.marginBottom = '20px';
      return sec;
    });
    $('#topic-sections').replaceChildren(...sections);

    const active = $('#active-filters');
    const pills = [];
    for (const t of state.topics) pills.push(chip(`${topicLabel[t] || t} ✕`, true, () => toggleIn(state.topics, t)));
    for (const o of state.orgs) pills.push(chip(`${o} ✕`, true, () => toggleIn(state.orgs, o)));
    for (const c of state.cats) {
      const cat = taxonomy.categories.find((x) => x.id === c);
      pills.push(chip(`${cat ? cat.label : c} ✕`, true, () => toggleIn(state.cats, c)));
    }
    active.replaceChildren(...pills);
  }

  function urgencyClass(ms) {
    if (ms < 0) return 'past';
    if (ms < 7 * DAY) return 'urgent';
    if (ms < 30 * DAY) return 'soon';
    return '';
  }

  function renderCard(card, now) {
    const tpl = $('#card-template').content.firstElementChild.cloneNode(true);
    const e = card.entry;
    const rel = relevantDeadlines(card);
    const next = card.past ? rel[rel.length - 1] : rel.find((d) => d.ts > now);

    const a = tpl.querySelector('.title-link');
    a.textContent = `${e.series} ${e.year}`;
    if (e.link) a.href = e.link;
    else a.removeAttribute('href');

    const badges = tpl.querySelector('.badges');
    const addBadge = (text, cls, title) => {
      const s = document.createElement('span');
      s.className = `badge ${cls}`;
      s.textContent = text;
      if (title) s.title = title;
      badges.append(s);
    };
    if (e.kind && e.kind !== 'conference') addBadge(e.kind, 'badge-kind');
    if (card.estimated) addBadge('Estimated', 'badge-est', `Projected from the ${card.basedOn} deadlines`);
    for (const o of e.sponsors || []) {
      if (o === 'IEEE' || o === 'ACM') addBadge(o, `badge-org badge-${o.toLowerCase()}`, `${o}-sponsored`);
    }
    if (e.tentative) addBadge('Unconfirmed', 'badge-tentative', 'Date not yet confirmed on the official website');
    if (card.past) addBadge('Closed', '');

    let fullName = e.full_name && e.full_name !== e.series ? e.full_name : '';
    if (e.parent && editionsById[e.parent]) {
      const p = editionsById[e.parent];
      fullName += `${fullName ? ' · ' : ''}Co-located with ${p.series} ${p.year}`;
    }
    tpl.querySelector('.full-name').textContent = fullName;
    tpl.querySelector('.where').textContent = e.location && e.location !== 'TBA' ? e.location : 'Location TBA';
    tpl.querySelector('.when').textContent = e.dates && e.dates !== 'TBA' ? e.dates : '';
    tpl.querySelector('.proc').textContent = e.proceedings ? `Proceedings: ${e.proceedings}` : '';

    const tags = tpl.querySelector('.tags');
    for (const t of e.topics || []) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = topicLabel[t] || t;
      b.title = `Filter by ${topicLabel[t] || t}`;
      b.addEventListener('click', () => {
        state.topics = new Set([t]);
        update();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      li.append(b);
      tags.append(li);
    }

    const tl = tpl.querySelector('.timeline-list');
    if (card.deadlines.length) {
      for (const d of card.deadlines) {
        const li = document.createElement('li');
        if (d.ts <= now) li.className = 'done';
        if (d === next && !card.past) li.classList.add('is-next');
        const t = document.createElement('time');
        t.dateTime = new Date(d.ts).toISOString();
        t.textContent = originalDate(d).replace(/ \d\d:\d\d .*$/, '');
        t.title = originalDate(d);
        const label = document.createElement('span');
        label.textContent = `${d.label || typeLabel[d.type] || d.type}${card.estimated ? ' (est.)' : ''}`;
        li.append(t, label);
        tl.append(li);
      }
    } else {
      tpl.querySelector('.timeline').remove();
    }

    const notes = [];
    if (card.estimated) {
      notes.push(`Not announced yet: projected from the ${card.basedOn} deadlines.` +
        (card.linkIsPrevious ? ' Link points to the previous edition.' : ''));
    }
    if (e.note) notes.push(e.note);
    tpl.querySelector('.note').textContent = notes.join(' ');

    const side = tpl.querySelector('.card-side');
    const ics = tpl.querySelector('.ics');
    if (!next) {
      tpl.querySelector('.next-label').textContent = card.tba ? 'Deadlines' : '';
      tpl.querySelector('.countdown').textContent = 'TBA';
      tpl.querySelector('.next-date').textContent = 'Not announced yet';
      ics.remove();
      tpl.classList.add('estimated');
      return tpl;
    }

    const label = next.label || typeLabel[next.type] || 'Deadline';
    tpl.querySelector('.next-label').textContent = card.past ? `Last deadline: ${label}` : `${card.estimated ? 'Est. ' : ''}${label}`;
    tpl.querySelector('.next-date').textContent = originalDate(next);
    tpl.querySelector('.next-local').textContent = `${fmtLocal.format(new Date(next.ts))} your time`;
    const cd = tpl.querySelector('.countdown');
    const ms = next.ts - now;
    cd.textContent = countdownText(ms);
    if (card.estimated) tpl.classList.add('estimated');
    else {
      const u = urgencyClass(ms);
      if (u) tpl.classList.add(u);
    }
    if (!card.past) tickers.push({ el: cd, ts: next.ts, card: tpl, estimated: card.estimated });

    const upcoming = rel.filter((d) => d.ts > now);
    if (card.past || !upcoming.length) ics.remove();
    else ics.addEventListener('click', () => downloadIcs(card, upcoming));
    side.dataset.ts = String(next.ts);
    return tpl;
  }

  function sortCards(list, now, newestFirst = false) {
    const nextTs = (c) => {
      const rel = relevantDeadlines(c);
      if (c.past) return rel.length ? rel[rel.length - 1].ts : 0;
      const n = rel.find((d) => d.ts > now);
      return n ? n.ts : Infinity;
    };
    const startTs = (c) => (c.entry.start ? Date.parse(c.entry.start) : Infinity);
    const byName = (a, b) => a.entry.series.localeCompare(b.entry.series) || a.entry.year - b.entry.year;
    const cmp = {
      deadline: (a, b) => nextTs(a) - nextTs(b) || byName(a, b),
      name: byName,
      start: (a, b) => startTs(a) - startTs(b) || nextTs(a) - nextTs(b) || byName(a, b),
    }[state.sort];
    return list.sort(newestFirst ? (a, b) => nextTs(b) - nextTs(a) : cmp);
  }

  function render() {
    const now = Date.now();
    tickers = [];
    renderFilters(now);

    const visible = cards.filter((c) => matchesExceptTopics(c, now) && matchesTopics(c) && matchesOrgs(c));
    const live = sortCards(visible.filter((c) => !c.past), now);
    const past = sortCards(visible.filter((c) => c.past), now, true);

    $('#list').replaceChildren(...live.map((c) => renderCard(c, now)));
    $('#past-list').replaceChildren(...past.map((c) => renderCard(c, now)));
    $('#past-wrap').hidden = !past.length;
    $('#empty').hidden = live.length + past.length > 0;

    const open = live.filter((c) => !c.estimated && relevantDeadlines(c).some((d) => d.ts > now)).length;
    const est = live.filter((c) => c.estimated).length;
    const parts = [`${live.length} venue${live.length === 1 ? '' : 's'}`, `${open} with announced upcoming deadlines`];
    if (est) parts.push(`${est} estimated`);
    if (past.length) parts.push(`${past.length} recently closed`);
    $('#summary').textContent = parts.join(' · ');
  }

  function tick() {
    const now = Date.now();
    for (const t of tickers) {
      const ms = t.ts - now;
      t.el.textContent = countdownText(ms);
      if (!t.estimated) {
        t.card.classList.remove('urgent', 'soon', 'past');
        const u = urgencyClass(ms);
        if (u) t.card.classList.add(u);
      }
    }
    $('#clock').textContent = `Your time (${userTz}): ${fmtClock.format(now)} · AoE: ${fmtAoE.format(now)}`;
  }

  // ---------- calendar export ----------

  function icsDate(ts) {
    return new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function icsEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  }

  function downloadIcs(card, deadlines) {
    const e = card.entry;
    const stamp = icsDate(Date.now());
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ml-conference-deadlines//EN', 'CALSCALE:GREGORIAN'];
    for (const d of deadlines) {
      const title = `${e.series} ${e.year}: ${d.label || typeLabel[d.type]}${card.estimated ? ' (estimated)' : ''}`;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${e.id}-${d.type}-${d.date.replace(/\D/g, '')}@ml-conference-deadlines`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsDate(d.ts)}`,
        `DTEND:${icsDate(d.ts)}`,
        `SUMMARY:${icsEscape(title)}`,
        `DESCRIPTION:${icsEscape(`${originalDate(d)}${e.link ? `\n${e.link}` : ''}`)}`,
        e.link ? `URL:${e.link}` : '',
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title)}`, 'TRIGGER:-P7D', 'END:VALARM',
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title)}`, 'TRIGGER:-P1D', 'END:VALARM',
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.filter(Boolean).join('\r\n')], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${e.series.replace(/\W+/g, '-')}-${e.year}.ics`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- URL state ----------

  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.q = (p.get('q') || '').toLowerCase().trim();
    state.topics = new Set((p.get('topics') || '').split(',').filter((t) => topicLabel[t]));
    state.orgs = new Set((p.get('org') || '').split(',').filter(Boolean));
    state.cats = new Set((p.get('type') || '').split(',').filter((c) => taxonomy.categories.some((x) => x.id === c)));
    state.showPast = p.get('past') === '1';
    state.showEst = p.get('est') !== '0';
    state.sort = ['deadline', 'name', 'start'].includes(p.get('sort')) ? p.get('sort') : 'deadline';
  }

  function writeUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.topics.size) p.set('topics', [...state.topics].join(','));
    if (state.orgs.size) p.set('org', [...state.orgs].join(','));
    if (state.cats.size) p.set('type', [...state.cats].join(','));
    if (state.showPast) p.set('past', '1');
    if (!state.showEst) p.set('est', '0');
    if (state.sort !== 'deadline') p.set('sort', state.sort);
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

  function syncControls() {
    $('#search').value = state.q;
    $('#show-past').checked = state.showPast;
    $('#show-estimated').checked = state.showEst;
    $('#sort').value = state.sort;
  }

  function update() {
    writeUrl();
    render();
  }

  // ---------- boot ----------

  async function init() {
    try {
      const [tax, data] = await Promise.all([
        fetch('data/taxonomy.json').then((r) => r.json()),
        fetch('data/conferences.json').then((r) => r.json()),
      ]);
      taxonomy = tax;
      for (const g of tax.topic_groups) for (const t of g.topics) topicLabel[t.id] = t.label;
      typeLabel = tax.deadline_types;
      for (const c of tax.categories) for (const t of c.types) typeToCat[t] = c.id;
      for (const e of data) editionsById[e.id] = e;

      readUrl();
      syncControls();
      cards = buildCards(data, Date.now());
      render();
      tick();
      setInterval(tick, 1000);
      // Rebuild once an hour so deadlines that pass roll over to the next cycle.
      setInterval(() => { cards = buildCards(data, Date.now()); render(); }, 3600000);
    } catch (err) {
      console.error(err);
      $('#summary').textContent = 'Could not load the deadline data. If you opened index.html directly from disk, serve the folder instead (e.g. `python3 -m http.server`).';
    }

    let debounce;
    $('#search').addEventListener('input', (ev) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.q = ev.target.value.toLowerCase().trim();
        update();
      }, 120);
    });
    $('#show-past').addEventListener('change', (ev) => { state.showPast = ev.target.checked; update(); });
    $('#show-estimated').addEventListener('change', (ev) => { state.showEst = ev.target.checked; update(); });
    $('#sort').addEventListener('change', (ev) => { state.sort = ev.target.value; update(); });
    $('#reset').addEventListener('click', () => {
      Object.assign(state, { q: '', topics: new Set(), cats: new Set(), orgs: new Set(), showEst: true, showPast: false, sort: 'deadline' });
      syncControls();
      update();
    });
    $('#filters-toggle').addEventListener('click', (ev) => {
      const open = $('#filters').classList.toggle('open');
      ev.currentTarget.setAttribute('aria-expanded', String(open));
    });
  }

  init();
})();
