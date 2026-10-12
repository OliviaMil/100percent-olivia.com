/*
 * Invisible-ink reveal: words marked .ink start invisible and develop under a
 * hair dryer, like heat-activated ink (pale -> lemon -> amber -> final colour).
 * - Drag the parked dryer (.dryer-park) over the words (mouse or finger).
 * - Phones: swiping a finger sideways over the words also works as the dryer.
 * - Mouse/pen: hovering a word also turns the cursor into the dryer.
 * - Tap a word, or press Enter on the parked dryer, and it sweeps by itself.
 * - Nobody tries it within a few seconds: the dryer sweeps once on its own.
 * - The dryer stays on its stand: pick it up again and the ink cools and fades,
 *   ready to be developed once more.
 * - Words marked data-ink-auto are not for dragging: the dryer passes over them
 *   by itself shortly after they scroll into view, then on a loop (develop,
 *   hold, cool away, develop again) for as long as they stay on screen.
 * Without JS, or with reduced motion, the words are simply shown.
 */
(function () {
  var inks = Array.prototype.slice.call(document.querySelectorAll('.ink'));
  if (!inks.length) return;
  var parks = Array.prototype.slice.call(document.querySelectorAll('.dryer-park'));
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    parks.forEach(function (p) { p.hidden = true; });
    return;
  }

  // Ink colour as it heats, for light and dark backgrounds
  var PALETTES = {
    light: [
      [0.00, [127, 29, 29, 0.07]],
      [0.25, [234, 179, 8, 0.35]],
      [0.50, [217, 119, 6, 0.75]],
      [0.75, [146, 64, 14, 0.95]],
      [1.00, [159, 18, 57, 1]]
    ],
    dark: [
      [0.00, [255, 255, 255, 0.07]],
      [0.30, [250, 204, 21, 0.45]],
      [0.60, [251, 146, 60, 0.9]],
      [0.85, [253, 186, 116, 1]],
      [1.00, [248, 250, 252, 1]]
    ]
  };
  function inkColor(stops, h) {
    for (var i = 1; i < stops.length; i++) {
      if (h <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], t = (h - a[0]) / (b[0] - a[0]), c = [];
        for (var k = 0; k < 4; k++) c[k] = a[1][k] + (b[1][k] - a[1][k]) * t;
        return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + c[3].toFixed(3) + ')';
      }
    }
    var e = stops[stops.length - 1][1];
    return 'rgba(' + e.join(',') + ')';
  }

  var DRYER_SVG =
    '<svg viewBox="0 0 84 64" width="84" height="64" aria-hidden="true" focusable="false">' +
      '<g class="dryer-air" fill="none" stroke="#F59E0B" stroke-width="2.2" stroke-linecap="round">' +
        '<path d="M62 12 q4 -3 8 0 t8 0"/><path d="M62 19 q4 -3 8 0 t8 0"/><path d="M62 26 q4 -3 8 0 t8 0"/>' +
      '</g>' +
      '<path d="M20 27 L13 55 a4 4 0 0 0 4 5 h7 a4 4 0 0 0 4 -4 L33 29 Z" fill="#7C3AED"/>' +
      '<rect x="3" y="7" width="47" height="25" rx="12.5" fill="#A78BFA"/>' +
      '<path d="M48 11 L60 13 L60 26 L48 28 Z" fill="#7C3AED"/>' +
      '<circle cx="16" cy="19.5" r="6.5" fill="#EDE9FE"/>' +
      '<circle cx="16" cy="19.5" r="2.5" fill="#C4B5FD"/>' +
    '</svg>';
  var NOZZLE_X = 80, NOZZLE_Y = 19; // where the warm air lands, in SVG pixels

  var dryer = document.createElement('div');
  dryer.className = 'ink-dryer';
  dryer.innerHTML = DRYER_SVG;
  var glow = document.createElement('div');
  glow.className = 'ink-glow';
  document.body.appendChild(glow);
  document.body.appendChild(dryer);
  parks.forEach(function (p) {
    p.insertAdjacentHTML('beforeend', DRYER_SVG);
  });

  var items = inks.map(function (el) {
    var stops = el.closest('[data-ink="dark"]') ? PALETTES.dark : PALETTES.light;
    var text = el.textContent;
    el.textContent = '';
    var sr = document.createElement('span');
    sr.className = 'ink-sr';
    sr.textContent = text;
    var vis = document.createElement('span');
    vis.className = 'ink-vis';
    vis.setAttribute('aria-hidden', 'true');
    var chars = [];
    text.split(/(\s+)/).forEach(function (part) {
      if (!part) return;
      if (/^\s+$/.test(part)) { vis.appendChild(document.createTextNode(part)); return; }
      var word = document.createElement('span');
      word.className = 'ink-word';
      for (var i = 0; i < part.length; i++) {
        var c = document.createElement('span');
        c.className = 'ink-ch';
        c.textContent = part[i];
        c.style.color = inkColor(stops, 0);
        word.appendChild(c);
        chars.push({ el: c, h: 0, shown: 0, cool: false });
      }
      vis.appendChild(word);
    });
    el.appendChild(sr);
    el.appendChild(vis);
    el.classList.add('ink-ready');
    var auto = el.hasAttribute('data-ink-auto');
    if (auto) el.classList.add('ink-auto');
    return { el: el, stops: stops, chars: chars, done: false, cooling: false, auto: auto, visible: true, waiting: false, group: el.closest('.ink-group') };
  });
  // The words a person develops with the dryer (hover, drag, Enter)
  var manual = items.filter(function (it) { return !it.auto; });

  var hot = null;          // where the warm air lands, while a person holds the dryer
  var mode = null;         // 'hover' (cursor is the dryer) or 'drag' (dryer picked up from its stand)
  var grab = { x: 0, y: 0 };
  var dragPark = null;
  var queue = [];          // items waiting for the automatic sweep
  var sweep = null;        // the automatic sweep in progress
  var last = performance.now();
  var running = false;
  var finishTimer;

  function near(item, x, y, pad) {
    var rects = item.el.getClientRects();
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return true;
    }
    return false;
  }

  function heat(item, x, y, dt, rate) {
    var R = parseFloat(getComputedStyle(item.el).fontSize) * 1.4;
    var all = true;
    item.chars.forEach(function (c) {
      if (c.h < 1) {
        var r = c.el.getBoundingClientRect();
        var d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
        var warm = Math.max(0, 1 - d / R);
        if (warm > 0) c.cool = false;
        c.h = Math.min(1, c.h + warm * dt * rate);
      }
      if (c.h < 1) all = false;
    });
    return all;
  }

  function paint(item) {
    item.chars.forEach(function (c) {
      if (Math.abs(c.h - c.shown) > 0.01 || (c.h === 1 && c.shown !== 1)) {
        c.el.style.color = inkColor(item.stops, c.h);
        c.shown = c.h;
      }
    });
  }

  function finish(item) {
    item.done = true;
    item.el.classList.add('ink-done');
    if (item.group && items.every(function (it) { return it.group !== item.group || it.done; })) {
      item.group.classList.add('is-revealed');
      var bubble = item.group.querySelector('.dryer-bubble');
      if (bubble) bubble.textContent = 'Drag me again';
    }
    if (item.auto) setTimeout(function () { again(item); }, HOLD);
  }

  // Looping words: hold the developed ink a moment, let it cool away, then dry it again
  var HOLD = 2600, COOL = 1100;
  function again(item) {
    if (!item.done) return;
    if (!item.visible) { item.waiting = true; return; }
    item.waiting = false;
    coolItems([item]);
    setTimeout(function () { enqueue([item]); }, COOL);
  }

  // Pick the dryer up after the reveal: the ink cools and fades, ready for another go
  function cool(group) {
    var any = coolItems(items.filter(function (item) { return item.group === group; }));
    if (any) group.classList.remove('is-revealed');
    return any;
  }
  function coolItems(list) {
    var any = false;
    list.forEach(function (item) {
      if (!item.done) return;
      item.done = false;
      item.cooling = true;
      item.chars.forEach(function (c) { c.cool = true; });
      item.el.classList.remove('ink-done');
      any = true;
    });
    if (any) kick();
    return any;
  }

  function showDryer(x, y) {
    dryer.style.transform = 'translate(' + (x - NOZZLE_X) + 'px,' + (y - NOZZLE_Y) + 'px)';
    glow.style.transform = 'translate(' + (x - 45) + 'px,' + (y - 45) + 'px)';
    dryer.classList.add('on');
    glow.classList.add('on');
  }
  function hideDryer() {
    dryer.classList.remove('on');
    glow.classList.remove('on');
  }

  // The automatic sweep runs through the character centres, in reading order
  function sweepPoint(item, t, from) {
    var pts = item.chars.slice(from).map(function (c) {
      var r = c.el.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    });
    if (pts.length < 2) return pts[0];
    var f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), u = f - i;
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u];
  }

  function enqueue(list) {
    list.forEach(function (item) {
      if (!item.done && queue.indexOf(item) < 0 && (!sweep || sweep.item !== item)) queue.push(item);
    });
    kick();
  }

  function beginSweep(item, now) {
    var from = 0;
    while (from < item.chars.length - 1 && item.chars[from].h >= 1) from++;
    var n = item.chars.length - from;
    sweep = { item: item, from: from, t0: now, dur: Math.min(3000, Math.max(450, n * 65)) };
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    var busy = false, show = null;

    items.forEach(function (item) {
      if (!item.cooling) return;
      // Letters under the dryer stop cooling; the rest fade back to invisible
      var cold = true;
      item.chars.forEach(function (c) {
        if (!c.cool) return;
        c.h = Math.max(0, c.h - dt * 1.4);
        if (c.h > 0) cold = false; else c.cool = false;
      });
      paint(item);
      if (cold) item.cooling = false; else busy = true;
    });

    if (mode && hot) {
      manual.forEach(function (item) {
        if (item.done || !near(item, hot.x, hot.y, 40)) return;
        if (heat(item, hot.x, hot.y, dt, 9)) finish(item);
        paint(item);
      });
      show = hot;
      busy = true;
    }

    while (!sweep && queue.length) {
      var next = queue.shift();
      if (!next.done) {
        next.cooling = false;
        next.chars.forEach(function (c) { c.cool = false; });
        beginSweep(next, now);
      }
    }
    if (sweep) {
      var item = sweep.item, p = (now - sweep.t0) / sweep.dur;
      if (p >= 1) {
        // Let the last letters finish developing, then move on
        item.chars.forEach(function (c) { c.h = Math.min(1, c.h + dt * 3); });
        paint(item);
        if (item.chars.every(function (c) { return c.h >= 1; })) { finish(item); sweep = null; }
        busy = true;
      } else {
        var pt = sweepPoint(item, p, sweep.from);
        heat(item, pt[0], pt[1], dt, 4.5);
        // Letters the dryer has passed keep developing, whatever the frame rate
        var head = sweep.from + p * (item.chars.length - 1 - sweep.from);
        item.chars.forEach(function (c, i) { c.h = Math.max(c.h, Math.min(1, (head - i + 1) / 5)); });
        paint(item);
        if (!show) show = { x: pt[0], y: pt[1] };
        busy = true;
      }
    }
    if (queue.length) busy = true;
    // While the dryer sweeps by itself, its stand is empty
    var sweeping = sweep || queue.length;
    parks.forEach(function (p) { p.classList.toggle('is-away', !!sweeping); });

    if (show) showDryer(show.x, show.y); else hideDryer();
    if (busy) requestAnimationFrame(frame); else running = false;
  }

  function kick() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  // A few seconds after someone stops, the dryer finishes what is left
  function finishLater(ms) {
    clearTimeout(finishTimer);
    finishTimer = setTimeout(function () {
      if (mode) finishLater(1500);
      else enqueue(manual);
    }, ms);
  }

  // Hover: the cursor itself becomes the dryer over a hidden word
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch' || mode === 'drag') return;
    var over = manual.some(function (it) { return !it.done && near(it, e.clientX, e.clientY, 14); });
    if (over) {
      mode = 'hover';
      hot = { x: e.clientX, y: e.clientY };
      document.documentElement.classList.add('ink-drying');
      clearTimeout(finishTimer);
      kick();
    } else if (mode === 'hover') {
      mode = null;
      hot = null;
      document.documentElement.classList.remove('ink-drying');
      finishLater(4000);
    }
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', function () {
    if (mode !== 'hover') return;
    mode = null;
    hot = null;
    document.documentElement.classList.remove('ink-drying');
    finishLater(4000);
  });

  // Drag: pick the dryer up from its stand (works with a finger too)
  parks.forEach(function (park) {
    park.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      e.preventDefault();
      var r = park.querySelector('svg').getBoundingClientRect();
      grab = { x: e.clientX - r.left, y: e.clientY - r.top };
      hot = { x: e.clientX - grab.x + NOZZLE_X, y: e.clientY - grab.y + NOZZLE_Y };
      mode = 'drag';
      dragPark = park;
      cool(park.closest('.ink-group'));
      park.classList.add('is-dragging');
      document.documentElement.classList.add('ink-dragging');
      try { park.setPointerCapture(e.pointerId); } catch (err) {}
      clearTimeout(finishTimer);
      kick();
    });
    park.addEventListener('pointermove', function (e) {
      if (mode !== 'drag' || dragPark !== park) return;
      hot = { x: e.clientX - grab.x + NOZZLE_X, y: e.clientY - grab.y + NOZZLE_Y };
    });
    function drop() {
      if (dragPark !== park) return;
      mode = null;
      hot = null;
      dragPark = null;
      park.classList.remove('is-dragging');
      document.documentElement.classList.remove('ink-dragging');
      finishLater(4000);
    }
    // iPhone Safari: stop the page from scrolling under the held dryer, or it cancels the drag
    park.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
    park.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    park.addEventListener('pointerup', drop);
    park.addEventListener('pointercancel', drop);
    park.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (cool(park.closest('.ink-group'))) setTimeout(function () { enqueue(manual); }, 900);
      else enqueue(manual);
    });
  });

  // Phones: a finger swiped sideways across the words dries them, the dryer under the fingertip
  var finger = null;
  manual.forEach(function (item) {
    item.el.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch' || mode) return;
      finger = e.pointerId;
      mode = 'finger';
      hot = { x: e.clientX, y: e.clientY };
      clearTimeout(finishTimer);
      kick();
    });
  });
  document.addEventListener('pointermove', function (e) {
    if (mode === 'finger' && e.pointerId === finger) hot = { x: e.clientX, y: e.clientY };
  }, { passive: true });
  function lift(e) {
    if (mode !== 'finger' || e.pointerId !== finger) return;
    mode = null;
    hot = null;
    finger = null;
    finishLater(4000);
  }
  document.addEventListener('pointerup', lift);
  document.addEventListener('pointercancel', lift);

  // Tap or click a hidden word: the dryer does that word
  items.forEach(function (item) {
    item.el.addEventListener('click', function () { enqueue([item]); });
  });

  // Nobody tried it: once the words have been on screen a while, the dryer sweeps by itself
  var WAIT = 7000;
  var watched = [];
  items.forEach(function (it) {
    var target = it.group || it.el;
    if (watched.indexOf(target) < 0) watched.push(target);
  });
  if ('IntersectionObserver' in window) {
    var timers = new Map();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        clearTimeout(timers.get(e.target));
        var mine = items.filter(function (it) { return (it.group || it.el) === e.target; });
        var auto = e.target.hasAttribute('data-ink-auto');
        if (auto) mine.forEach(function (it) { it.visible = e.isIntersecting; });
        if (!e.isIntersecting) return;
        timers.set(e.target, setTimeout(function () {
          if (mode && !auto) return;
          // A looping word that paused off screen picks its loop back up
          var paused = mine.filter(function (it) { return it.waiting; });
          if (paused.length) paused.forEach(again);
          else enqueue(mine);
        }, auto ? 700 : WAIT));
      });
    }, { threshold: 0.6 });
    watched.forEach(function (t) { io.observe(t); });
  } else {
    enqueue(items);
  }
})();
