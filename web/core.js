/* Daybreak – shared logic (used by index.html and sw.js) */
(function (root) {
  'use strict';
  var DAY = 864e5, HOUR = 36e5, MIN = 6e4;
  var MILESTONES = [1, 3, 7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365, 545, 730, 1095, 1460, 1825];
  var ANALYSIS_MIN = 5;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function sched(d, time) {
    var p = String(time || '08:00').split(':');
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), +p[0] || 0, +p[1] || 0, 0, 0).getTime();
  }

  /* ---------- perioder og rekord ---------- */
  function curPeriod(a) {
    for (var i = a.periods.length - 1; i >= 0; i--) if (a.periods[i].end == null) return a.periods[i];
    return null;
  }
  function sorted(a) { return a.periods.slice().sort(function (x, y) { return x.start - y.start; }); }
  function plen(p, now) { return Math.max(0, (p.end == null ? now : p.end) - p.start); }
  function nextMilestone(len) {
    var d = len / DAY;
    for (var i = 0; i < MILESTONES.length; i++) if (MILESTONES[i] > d) return MILESTONES[i] * DAY;
    return (Math.floor(d / 365) + 1) * 365 * DAY;
  }
  function stats(a, now) {
    var ps = sorted(a), cur = curPeriod(a), curLen = cur ? plen(cur, now) : 0, bestPrior = 0;
    ps.forEach(function (p) { if (p !== cur) { var l = plen(p, now); if (l > bestPrior) bestPrior = l; } });
    var isRecord = bestPrior > 0 && curLen > bestPrior;
    var target, kind;
    if (bestPrior > 0 && curLen <= bestPrior) { target = bestPrior; kind = 'toRecord'; }
    else { target = nextMilestone(curLen); kind = isRecord ? 'record' : 'first'; }
    return {
      cur: cur, curLen: curLen, bestPrior: bestPrior, best: Math.max(bestPrior, curLen),
      isRecord: isRecord, recordSetAt: isRecord ? cur.start + bestPrior : null,
      target: target, kind: kind, remaining: Math.max(0, target - curLen),
      progress: target > 0 ? Math.min(1, curLen / target) : 0, count: ps.length
    };
  }
  function recordHistory(a, now) {
    var running = 0, out = [];
    sorted(a).forEach(function (p) {
      var l = plen(p, now);
      if (l > running) {
        out.push({ period: p, length: l, setAt: running > 0 ? p.start + running : null, ongoing: p.end == null });
        running = l;
      }
    });
    return out;
  }
  function parts(ms) {
    ms = Math.max(0, Math.floor(ms / 1000));
    return { d: Math.floor(ms / 86400), h: Math.floor(ms % 86400 / 3600), m: Math.floor(ms % 3600 / 60), s: ms % 60 };
  }
  function fmt(ms) {
    var p = parts(ms);
    if (p.d > 0) return p.d + ' d' + (p.h ? ' ' + p.h + ' h' : '');
    if (p.h > 0) return p.h + ' h' + (p.m ? ' ' + p.m + ' m' : '');
    if (p.m > 0) return p.m + ' m';
    return p.s + ' s';
  }

  /* ---------- morning notification (one for all) ---------- */
  function morningText(data, now) {
    var items = (data.items || []).filter(function (a) { return curPeriod(a); });
    if (!items.length) return null;
    var lines = items.map(function (a) {
      var st = stats(a, now);
      if (st.kind === 'toRecord') return a.name + ': ' + fmt(st.remaining) + ' to a new record';
      if (st.kind === 'record') return '🏆 ' + a.name + ': new record – ' + fmt(st.curLen);
      return a.name + ': ' + fmt(st.curLen) + ' – next goal ' + Math.round(st.target / DAY) + ' d';
    });
    return { title: 'Good morning ☀️', body: lines.join('\n') };
  }

  /* ---------- text analysis ---------- */
  var THEMES = [
    { k: 'sug', kind: 'neg', label: 'cravings and temptation', w: ['craving', 'crave', 'urge', 'tempt', 'longing', 'desire', 'miss it', 'want it'] },
    { k: 'uro', kind: 'neg', label: 'anxiety and tension', w: ['anxi', 'nervous', 'stress', 'tense', 'restless', 'panic', 'on edge', 'uneasy', 'worr'] },
    { k: 'nede', kind: 'neg', label: 'low and heavy feelings', w: ['sad', 'depress', 'down!', 'low!', 'empty', 'lonely', 'hopeless', 'discourag', 'miserable'] },
    { k: 'skam', kind: 'neg', label: 'shame and guilt', w: ['shame', 'guilt', 'embarrass', 'regret', 'failed', 'failure', 'disappointed in myself', 'let myself down'] },
    { k: 'sinne', kind: 'neg', label: 'irritation and frustration', w: ['irritab', 'irritat', 'angry', 'anger', 'frustrat', 'snappy', 'grumpy', 'furious'] },
    { k: 'sliten', kind: 'neg', label: 'tiredness', w: ['tired', 'exhaust', 'fatigue', 'drained', 'sluggish', 'no energy'] },
    { k: 'sovnd', kind: 'neg', label: 'poor sleep', w: ['sleep badly', 'slept badly', 'sleepless', 'insomnia', 'poor sleep', 'bad sleep', 'barely slept', 'can.t sleep'] },
    { k: 'kropp', kind: 'neg', label: 'physical symptoms', w: ['headache', 'nausea', 'nauseous', 'shak', 'sweat', 'withdrawal', 'dizzy', 'aching'] },
    { k: 'energi', kind: 'pos', label: 'more energy', w: ['more energy', 'energetic', 'energized', 'energised', 'lots of energy', 'refreshed', 'rested'] },
    { k: 'stolt', kind: 'pos', label: 'pride and achievement', w: ['proud', 'in control', 'victory', 'managed', 'succeed', 'strong', 'accomplish', 'achiev'] },
    { k: 'ro', kind: 'pos', label: 'calm and clarity', w: ['calm', 'clear head', 'clear-headed', 'clarity', 'focus', 'concentrat', 'sharp', 'peace'] },
    { k: 'glede', kind: 'pos', label: 'joy and relief', w: ['happy', 'happier', 'joy', 'glad', 'relie', 'motivat', 'hope!', 'hopeful', 'optimis', 'feel good', 'feeling good', 'great!', 'wonderful', 'content!'] },
    { k: 'sovnb', kind: 'pos', label: 'better sleep', w: ['sleep better', 'sleeping better', 'sleep well', 'slept well', 'slept great', 'good sleep', 'sleeping well'] },
    { k: 'okon', kind: 'pos', label: 'better finances', w: ['saved', 'saving', 'savings', 'money', 'afford'] },
    { k: 'frihet', kind: 'pos', label: 'a sense of freedom', w: ['free!', 'freedom', 'lighter', 'liberat'] }
  ];
  var TRIGS = [
    { k: 'kjed', label: 'boredom', w: ['bored'] },
    { k: 'stress', label: 'stress and pressure', w: ['stress', 'pressure', 'overwhelm'] },
    { k: 'ensom', label: 'loneliness', w: ['lonely', 'alone!'] },
    { k: 'kveld', label: 'evenings and nights', w: ['evening', 'night!', 'late!'] },
    { k: 'helg', label: 'weekends and parties', w: ['weekend', 'friday', 'saturday', 'party', 'parties'] },
    { k: 'sosial', label: 'social situations', w: ['friends', 'social', 'company', 'around people', 'pub!', 'bar!'] },
    { k: 'jobb', label: 'work', w: ['work!', 'job!', 'boss', 'colleague', 'office'] },
    { k: 'krangel', label: 'conflicts', w: ['argument', 'argued', 'fight', 'conflict', 'row!'] },
    { k: 'belonn', label: 'a need for reward', w: ['reward', 'deserve', 'celebrat', 'treat'] },
    { k: 'vane', label: 'habits and routines', w: ['habit', 'routine', 'automatic', 'after dinner', 'after meal', 'coffee'] },
    { k: 'tung', label: 'low feelings', w: ['sad', 'down!', 'depress', 'upset'] }
  ];
  function compile(list) {
    list.forEach(function (t) {
      t.re = new RegExp('(?:^|[^a-z])(?:' + t.w.map(function (w) {
        return w.slice(-1) === '!' ? w.slice(0, -1) + '(?![a-z])' : w;
      }).join('|') + ')', 'i');
    });
  }
  compile(THEMES); compile(TRIGS);
  var THEME_BY = {}; THEMES.forEach(function (t) { THEME_BY[t.k] = t; });
  var TRIG_BY = {}; TRIGS.forEach(function (t) { TRIG_BY[t.k] = t; });
  var DISTRESS = /can.t go on|give up|no way out|no point|don.t want to live|end my life|kill myself|not worth living/i;

  function hitsOf(text, list) {
    var s = (text || '').toLowerCase(), out = [];
    list.forEach(function (t) { if (t.re.test(s)) out.push(t.k); });
    return out;
  }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function list(arr) {
    if (arr.length <= 1) return arr.join('');
    if (arr.length === 2) return arr[0] + ' and ' + arr[1];
    return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1];
  }
  function avg(arr) { return arr.length ? arr.reduce(function (s, x) { return s + x; }, 0) / arr.length : null; }
  function top(infos, kind, n) {
    var cnt = {};
    infos.forEach(function (i) { i.h.forEach(function (k) { if (THEME_BY[k].kind === kind) cnt[k] = (cnt[k] || 0) + 1; }); });
    return Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, n).map(function (k) { return THEME_BY[k].label; });
  }

  function analyze(a, now) {
    var cs = a.comments.slice().sort(function (x, y) { return x.ts - y.ts; });
    if (cs.length < ANALYSIS_MIN) return null;
    var byId = {}; a.periods.forEach(function (p) { byId[p.id] = p; });
    var info = cs.map(function (c) {
      var h = hitsOf(c.text, THEMES), pos = 0, neg = 0;
      h.forEach(function (k) { if (THEME_BY[k].kind === 'pos') pos++; else neg++; });
      var p = byId[c.periodId], day = null;
      if (p) day = c.type === 'relapse' ? plen(p, now) / DAY : (c.type === 'start' ? 0 : (c.ts - p.start) / DAY);
      return { c: c, h: h, day: day, score: c.mood ? c.mood - 3 : clamp(pos - neg, -2, 2) };
    });
    var name = a.name, st = stats(a, now), secs = [];
    var clean = info.filter(function (i) { return i.c.type !== 'relapse'; });
    var rel = info.filter(function (i) { return i.c.type === 'relapse'; });
    var moods = cs.filter(function (c) { return c.mood; }).map(function (c) { return c.mood; });

    /* 1 – the big picture */
    var days = Math.max(1, Math.round((cs[cs.length - 1].ts - cs[0].ts) / DAY));
    var t1 = 'You have written ' + cs.length + ' comments about ' + name + ' over ' + days + (days === 1 ? ' day. ' : ' days. ');
    if (moods.length) t1 += 'Your average mood is ' + avg(moods).toFixed(1) + ' out of 5. ';
    t1 += 'You have had ' + st.count + (st.count === 1 ? ' period' : ' periods') + ', and your longest is ' + fmt(st.best) + '.';
    secs.push({ title: 'The big picture', body: t1 });

    /* 2 – while without */
    if (clean.length) {
      var pos = top(clean, 'pos', 3), neg = top(clean, 'neg', 3), t2 = [];
      if (pos.length) t2.push('When you stay away from ' + name + ', you write most often about ' + list(pos) + '.');
      if (neg.length) t2.push((pos.length ? 'At the same time,' : 'When you stay away from ' + name + ',') + ' ' + list(neg) + ' also show up.');
      var early = clean.filter(function (i) { return i.day != null && i.day < 7; }).map(function (i) { return i.score; });
      var later = clean.filter(function (i) { return i.day != null && i.day >= 7; }).map(function (i) { return i.score; });
      if (early.length && later.length) {
        var diff = avg(later) - avg(early);
        if (diff >= 0.4) t2.push('It seems to get easier over time: your mood is clearly better after the first week than during it.');
        else if (diff <= -0.4) t2.push('Your mood is lower later in the periods than at the start. It may be worth noting what happens when the early motivation fades.');
        else t2.push('Your mood stays steady throughout the periods.');
      }
      if (!t2.length) t2.push('Your comments from the periods without ' + name + ' say little about how it feels. Try describing your body and mind a bit more concretely.');
      secs.push({ title: 'While you are without ' + name, body: t2.join(' ') });
    }

    /* 3 – relapse */
    if (rel.length) {
      var rn = top(rel, 'neg', 3), rp = top(rel, 'pos', 2), t3 = [];
      if (rn.length) t3.push('After you do it again, you write most often about ' + list(rn) + '.');
      if (rp.length) t3.push('You also mention ' + list(rp) + ', so it is not only heavy.');
      var ra = avg(rel.map(function (i) { return i.score; })), ca = clean.length ? avg(clean.map(function (i) { return i.score; })) : null;
      if (ca != null && ca - ra >= 0.5) t3.push('Your mood is clearly lower after a relapse than otherwise.');
      else if (ca != null && ra - ca >= 0.5) t3.push('Your mood is actually higher right after you do it. That is a typical sign of short-term relief, but check whether it lasts.');
      if (!t3.length) t3.push('Your comments after a relapse are short. Try writing more about what happened just before, and how it felt afterwards.');
      secs.push({ title: 'When you do it again', body: t3.join(' ') });
    } else {
      secs.push({ title: 'When you do it again', body: 'You have not written a comment after a relapse yet. Those comments often give the most insight, because they show what happens right before and right after.' });
    }

    /* 4 – triggers */
    var tcnt = {};
    info.forEach(function (i) {
      if (i.c.type === 'relapse' || i.h.indexOf('sug') >= 0) hitsOf(i.c.text, TRIGS).forEach(function (k) { tcnt[k] = (tcnt[k] || 0) + 1; });
    });
    var tk = Object.keys(tcnt).sort(function (x, y) { return tcnt[y] - tcnt[x]; }).slice(0, 3).map(function (k) { return TRIG_BY[k].label; });
    if (tk.length) secs.push({ title: 'What triggers you', body: 'Around cravings and relapses you most often mention ' + list(tk) + '. A concrete plan for exactly those situations can make the biggest difference.' });

    /* 5 – progress */
    if (info.length >= 6) {
      var half = Math.floor(info.length / 2);
      var d = avg(info.slice(half).map(function (i) { return i.score; })) - avg(info.slice(0, half).map(function (i) { return i.score; }));
      var t5 = d >= 0.4 ? 'It is going in the right direction: your latest comments are clearly more positive than your first ones.'
        : d <= -0.4 ? 'Your latest comments are lower in mood than your first ones. Heavier stretches are common, and it can help to talk to someone you trust.'
        : 'Your mood is stable over time.';
      secs.push({ title: 'Progress', body: t5 });
    }

    /* 6 – what it does to you */
    var gains = top(clean, 'pos', 3), costUse = top(rel, 'neg', 3), costQuit = top(clean.filter(function (i) { return i.day != null && i.day < 7; }), 'neg', 2), t6 = [];
    if (costUse.length) t6.push('Based on what you have written, ' + name + ' goes together with ' + list(costUse) + ', especially in the time after you give in.');
    if (gains.length) t6.push('Without ' + name + ', you describe ' + list(gains) + '.');
    if (costQuit.length) t6.push('The first days are mostly marked by ' + list(costQuit) + '.');
    if (!t6.length) t6.push('There is not enough text to say anything for sure yet. Try writing in more detail about how your body and mind feel.');
    secs.push({ title: 'What ' + name + ' does to you', body: t6.join(' '), highlight: true });

    /* 7 – note */
    var note = 'This is an automatic analysis of your own words, not a diagnosis.';
    if (cs.some(function (c) { return DISTRESS.test(c.text || ''); })) note += ' Some of what you have written sounds heavy. Talk to someone you trust, or call a helpline. In Norway, Mental Helse is on 116 123, open 24/7.';
    secs.push({ title: 'Note', body: note, note: true });

    return { at: now, n: cs.length, sections: secs };
  }

  /* ---------- IndexedDB (delt med service worker) ---------- */
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('daybreak', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet(k) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { rej(q.error); };
      });
    });
  }
  function idbSet(k, v) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }

  root.Core = {
    DAY: DAY, HOUR: HOUR, MIN: MIN, ANALYSIS_MIN: ANALYSIS_MIN,
    curPeriod: curPeriod, sorted: sorted, plen: plen, stats: stats, recordHistory: recordHistory,
    parts: parts, fmt: fmt, morningText: morningText, analyze: analyze,
    dayKey: dayKey, sched: sched, idbGet: idbGet, idbSet: idbSet
  };
  if (typeof module !== 'undefined') module.exports = root.Core;
})(typeof self !== 'undefined' ? self : this);
