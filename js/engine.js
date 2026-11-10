/*
 * محرّك شجرة الأسئلة: التوجيه بين الفروع وحساب النتيجة.
 * لا يعتمد على الصفحة (DOM)، لذا يستخدمه التطبيق وسكربت التحقق `scripts/validate-tree.js` معًا.
 */
(function (root) {
  'use strict';

  var RESPONSE_ORDER = ['fight', 'flight', 'freeze', 'fawn'];

  function create(data) {
    var nodes = data.nodes;
    var threshold = typeof data.leanThreshold === 'number' ? data.leanThreshold : 0.2;
    var remainingMemo = {};

    function optionOf(id, answers) {
      var a = answers[id];
      return a === null || a === undefined ? null : nodes[id].options[a];
    }

    function maxAbs(node, key) {
      return node.options.reduce(function (m, o) { return Math.max(m, Math.abs(o[key] || 0)); }, 0);
    }

    /* يجمع الأوزان على طول المسار (الأسئلة المجاب عنها فقط) */
    function tally(path, answers) {
      var t = {
        x: 0, y: 0, xMax: 0, yMax: 0, rTotal: 0,
        counts: { fight: 0, flight: 0, freeze: 0, fawn: 0 },
        tags: {}, modules: []
      };
      path.forEach(function (id) {
        var node = nodes[id];
        if (t.modules.indexOf(node.module) === -1) t.modules.push(node.module);
        var o = optionOf(id, answers);
        if (!o) return;
        t.xMax += maxAbs(node, 'x');
        t.yMax += maxAbs(node, 'y');
        t.x += o.x || 0;
        t.y += o.y || 0;
        if (o.r) { t.counts[o.r] += 1; t.rTotal += 1; }
        if (o.t) Object.keys(o.t).forEach(function (k) { t.tags[k] = (t.tags[k] || 0) + o.t[k]; });
      });
      t.xNorm = t.xMax ? t.x / t.xMax : 0;
      t.yNorm = t.yMax ? t.y / t.yMax : 0;
      return t;
    }

    function topResponses(counts) {
      var top = Math.max.apply(null, RESPONSE_ORDER.map(function (k) { return counts[k]; }));
      return top > 0 ? RESPONSE_ORDER.filter(function (k) { return counts[k] === top; }) : [];
    }

    /* للتوجيه نحتاج ردًّا واحدًا: عند التعادل نأخذ أحدث رد من بين المتعادلين */
    function routingResponse(path, answers, t) {
      var tied = topResponses(t.counts);
      if (tied.length <= 1) return tied[0] || null;
      for (var i = path.length - 1; i >= 0; i--) {
        var o = optionOf(path[i], answers);
        if (o && o.r && tied.indexOf(o.r) !== -1) return o.r;
      }
      return tied[0];
    }

    function leanOf(t) {
      if (t.xNorm > threshold) return 'narcissist';
      if (t.xNorm < -threshold) return 'victim';
      return 'mixed';
    }

    /* السؤال التالي بعد أن يجيب المستخدم عن `id` بالخيار `optionIndex` (أو null للنهاية) */
    function nextNode(id, optionIndex, path, answers) {
      var node = nodes[id];
      var opt = node.options[optionIndex];
      if (opt && opt.next !== undefined) return opt.next;
      var next = node.next;
      if (next === null || next === undefined || typeof next === 'string') return next || null;

      var t = tally(path, answers);
      var key = next.by === 'response' ? routingResponse(path, answers, t)
        : next.by === 'lean' ? leanOf(t)
        : null;
      if (key && next.to[key]) return next.to[key];
      var keys = Object.keys(next.to);
      return next.to[keys[0]];
    }

    /* كل الأسئلة التي يمكن أن تلي `id` بغض النظر عن الإجابة */
    function successors(id) {
      var node = nodes[id];
      var out = [];
      var add = function (n) { if (n && out.indexOf(n) === -1) out.push(n); };
      node.options.forEach(function (o) { if (o.next !== undefined) add(o.next); });
      var hasOptionNext = node.options.some(function (o) { return o.next !== undefined; });
      var allOptionNext = node.options.every(function (o) { return o.next !== undefined; });
      if (!allOptionNext || !hasOptionNext) {
        if (typeof node.next === 'string') add(node.next);
        else if (node.next && node.next.to) Object.keys(node.next.to).forEach(function (k) { add(node.next.to[k]); });
      }
      return out;
    }

    /* أقصى عدد أسئلة متبقٍّ ابتداءً من `id` (شاملًا إياه) */
    function remaining(id) {
      if (remainingMemo[id] !== undefined) return remainingMemo[id];
      var s = successors(id);
      var r = 1 + (s.length ? Math.max.apply(null, s.map(remaining)) : 0);
      remainingMemo[id] = r;
      return r;
    }

    function pickSubtype(t) {
      var g = t.tags.grandiose || 0, v = t.tags.vulnerable || 0;
      var rec = t.tags.recognition || 0, sil = t.tags.silencing || 0;
      if (t.modules.indexOf('narcissism') !== -1) {
        if (Math.max(g, v) < 2) return 'narcissism-mild';
        return g >= v ? 'grandiose' : 'vulnerable';
      }
      if (t.modules.indexOf('victimhood') !== -1) {
        if (Math.max(rec, sil) < 2) return 'victimhood-mild';
        return rec > sil ? 'recognition' : 'silencing';
      }
      if (t.modules.indexOf('mixed') !== -1) {
        return (t.tags.triangle || 0) >= 2 ? 'triangle' : 'flexible';
      }
      return null;
    }

    function pickAwareness(t) {
      if (t.modules.indexOf('reflect') !== -1) {
        if (t.tags.rumination) return 'rumination';
        if (t.tags.insight) return 'insight';
        return 'reflective';
      }
      if (t.modules.indexOf('defend') !== -1) return t.yNorm >= 0 ? 'open' : 'defensive';
      return null;
    }

    function result(path, answers) {
      var t = tally(path, answers);
      var c = t.counts;
      var dominant = topResponses(c);

      // النمط الهجين (Walker): الرد الثاني إن وُجد رد غالب واحد
      var secondary = null;
      if (dominant.length === 1) {
        var rest = RESPONSE_ORDER.filter(function (k) { return k !== dominant[0] && c[k] > 0; });
        rest.sort(function (a, b) { return c[b] - c[a]; });
        if (rest.length && (rest.length === 1 || c[rest[0]] > c[rest[1]])) secondary = rest[0];
      }

      // التعادل على محور ضحية/نرجسي يُحسم بردود الفعل: (قتال+هروب) مقابل (تجمّد+إرضاء)
      var narcissist = t.x > 0 || (t.x === 0 && c.fight + c.flight > c.freeze + c.fawn);
      // التعادل على محور الوعي يُحسب «يدرك»
      var aware = t.y >= 0;

      return {
        x: t.x, y: t.y, xNorm: t.xNorm, yNorm: t.yNorm,
        narcissist: narcissist,
        aware: aware,
        quadrant: (narcissist ? 'narcissist' : 'victim') + '-' + (aware ? 'aware' : 'unaware'),
        counts: c,
        rTotal: t.rTotal,
        dominant: dominant,
        secondary: secondary,
        healthy: t.tags.healthy || 0,
        tags: t.tags,
        modules: t.modules,
        subtype: pickSubtype(t),
        awareness: pickAwareness(t)
      };
    }

    return {
      nodes: nodes,
      start: data.start,
      tally: tally,
      nextNode: nextNode,
      successors: successors,
      remaining: remaining,
      result: result
    };
  }

  root.QuizEngine = { create: create, RESPONSE_ORDER: RESPONSE_ORDER };
})(typeof window !== 'undefined' ? window : globalThis);
