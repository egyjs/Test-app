(function () {
  'use strict';

  var DATA = window.QUIZ_DATA;
  var QUESTIONS = DATA.questions;
  var QUADRANTS = DATA.quadrants;
  var RESPONSES = DATA.responses;
  var PARTS = DATA.parts;
  var RESPONSE_ORDER = ['fight', 'flight', 'freeze', 'fawn'];
  var ADVANCE_DELAY = 260; // ms بين اختيار الإجابة والانتقال للسؤال التالي

  /* ترتيب المربعات داخل المصفوفة (يسار→يمين، أعلى→أسفل) كما في الصورة */
  var MATRIX_ORDER = [
    { key: 'victim-unaware', pos: 'top' },
    { key: 'narcissist-unaware', pos: 'top' },
    { key: 'victim-aware', pos: 'bottom' },
    { key: 'narcissist-aware', pos: 'bottom' }
  ];

  /* نقاط زخرفية بنسب مئوية من مساحة المصفوفة، منقولة تقريبًا من الصورة */
  var DECOR_DOTS = [
    [42.3, 35.9], [24.0, 40.8], [34.9, 43.4], [42.0, 43.7], [44.4, 47.0],
    [59.1, 35.9], [68.9, 39.5], [61.0, 41.8], [66.3, 44.4], [78.2, 42.9], [57.3, 47.0],
    [42.1, 57.7], [21.8, 62.3], [33.5, 59.7], [44.4, 62.3], [36.4, 64.9], [41.5, 67.9], [43.0, 80.6],
    [60.3, 59.1], [66.3, 61.3], [68.0, 66.2], [57.5, 67.4]
  ];

  var state = {
    index: 0,
    answers: QUESTIONS.map(function () { return null; }),
    locked: false,
    result: null
  };

  /* ---------------- أدوات مساعدة ---------------- */

  function $(id) { return document.getElementById(id); }

  function arNum(n) {
    try { return Number(n).toLocaleString('ar-EG'); } catch (e) { return String(n); }
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function questionCountLabel(n) {
    // ٣–١٠ تُجمع «أسئلة»، و١١ فما فوق «سؤالًا»
    return arNum(n) + (n >= 3 && n <= 10 ? ' أسئلة' : ' سؤالًا');
  }

  /* ---------------- المصفوفة ---------------- */

  function matrixHTML(opts) {
    opts = opts || {};
    var html = '<div class="matrix' + (opts.result ? ' is-result' : '') + '" dir="ltr"';
    html += opts.result ? ' role="img" aria-label="موقعك على المصفوفة: ' + escapeHTML(QUADRANTS[opts.active].title) + '"' : ' aria-hidden="true"';
    html += '><div class="matrix-grid">';

    MATRIX_ORDER.forEach(function (cell) {
      var q = QUADRANTS[cell.key];
      var cls = 'quad quad-' + cell.pos + ' q-' + cell.key + (opts.active === cell.key ? ' is-active' : '');
      html += '<div class="' + cls + '"><span dir="rtl">' + escapeHTML(q.label[0]) + '<br>' + escapeHTML(q.label[1]) + '</span></div>';
    });

    DECOR_DOTS.forEach(function (d) {
      html += '<i class="dot" style="left:' + d[0] + '%;top:' + d[1] + '%"></i>';
    });

    if (opts.result) {
      html += '<div class="you" id="you-marker"><span class="you-dot"></span><span class="you-label" dir="rtl">أنت</span></div>';
    }

    html += '</div></div>';
    return html;
  }

  /*
   * يحوّل قيمة من [-1, 1] إلى بُعد عن مركز المصفوفة (٪) داخل المربع الصحيح، فلا تقع النقطة
   * أبدًا في الفراغ بين المربعات. أفقيًا: من 8% إلى 38%. عموديًا تبقى النقطة في الشريط القريب
   * من المحور (4%–15%) — حيث النقاط في الصورة — كي لا تغطي اسم المربع.
   */
  var X_RANGE = [8, 38];
  var Y_RANGE = [4, 15];

  function axisOffset(norm, range) {
    return range[0] + Math.min(1, Math.abs(norm)) * (range[1] - range[0]);
  }

  /* ---------------- الحساب ---------------- */

  function computeResult(answers) {
    var x = 0, y = 0, xMax = 0, yMax = 0, rTotal = 0;
    var counts = { fight: 0, flight: 0, freeze: 0, fawn: 0 };

    QUESTIONS.forEach(function (q, qi) {
      var maxX = 0, maxY = 0;
      q.options.forEach(function (o) {
        maxX = Math.max(maxX, Math.abs(o.x || 0));
        maxY = Math.max(maxY, Math.abs(o.y || 0));
      });
      xMax += maxX;
      yMax += maxY;

      var a = answers[qi];
      if (a === null || a === undefined) return;
      var o = q.options[a];
      x += o.x || 0;
      y += o.y || 0;
      if (o.r) { counts[o.r] += 1; rTotal += 1; }
    });

    var top = Math.max.apply(null, RESPONSE_ORDER.map(function (k) { return counts[k]; }));
    var dominant = top > 0 ? RESPONSE_ORDER.filter(function (k) { return counts[k] === top; }) : [];

    // التعادل على محور ضحية/نرجسي يُحسم بردود الفعل: (قتال+هروب) مقابل (تجمّد+إرضاء)
    var narcissist = x > 0 || (x === 0 && counts.fight + counts.flight > counts.freeze + counts.fawn);
    // التعادل على محور الوعي يُحسب «يدرك»
    var aware = y >= 0;

    return {
      x: x, y: y,
      xNorm: xMax ? x / xMax : 0,
      yNorm: yMax ? y / yMax : 0,
      narcissist: narcissist,
      aware: aware,
      quadrant: (narcissist ? 'narcissist' : 'victim') + '-' + (aware ? 'aware' : 'unaware'),
      counts: counts,
      rTotal: rTotal,
      dominant: dominant
    };
  }

  /* ---------------- التنقل بين الشاشات ---------------- */

  function showScreen(name, focusId) {
    ['intro', 'quiz', 'result'].forEach(function (s) {
      $('screen-' + s).hidden = s !== name;
    });
    window.scrollTo(0, 0);
    if (focusId) {
      var el = $(focusId);
      if (el) el.focus({ preventScroll: true });
    }
  }

  function startQuiz() {
    state.index = 0;
    state.answers = QUESTIONS.map(function () { return null; });
    state.locked = false;
    renderQuestion();
    showScreen('quiz', 'question-text');
  }

  /* ---------------- شاشة الأسئلة ---------------- */

  function renderQuestion() {
    var q = QUESTIONS[state.index];
    var total = QUESTIONS.length;

    $('progress-text').textContent = 'سؤال ' + arNum(state.index + 1) + ' من ' + arNum(total);
    $('progress-bar').style.width = ((state.index) / total * 100) + '%';
    $('part-label').textContent = PARTS[q.part] ? PARTS[q.part].label : '';
    $('part-label').setAttribute('data-part', q.part);
    $('question-text').textContent = q.text;

    var box = $('options');
    box.innerHTML = '';
    q.options.forEach(function (o, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';
      btn.setAttribute('aria-pressed', state.answers[state.index] === i ? 'true' : 'false');
      if (state.answers[state.index] === i) btn.classList.add('is-selected');
      btn.innerHTML = '<span class="option-num" aria-hidden="true">' + arNum(i + 1) + '</span><span class="option-text"></span>';
      btn.querySelector('.option-text').textContent = o.text;
      btn.addEventListener('click', function () { selectOption(i); });
      box.appendChild(btn);
    });

    // إعادة تشغيل حركة الظهور
    box.classList.remove('is-entering');
    void box.offsetWidth;
    box.classList.add('is-entering');
  }

  function selectOption(i) {
    if (state.locked) return;
    state.locked = true;
    state.answers[state.index] = i;

    Array.prototype.forEach.call($('options').children, function (btn, bi) {
      btn.classList.toggle('is-selected', bi === i);
      btn.setAttribute('aria-pressed', bi === i ? 'true' : 'false');
    });
    $('progress-bar').style.width = ((state.index + 1) / QUESTIONS.length * 100) + '%';

    window.setTimeout(function () {
      state.locked = false;
      if (state.index < QUESTIONS.length - 1) {
        state.index += 1;
        renderQuestion();
        $('question-text').focus({ preventScroll: true });
        window.scrollTo(0, 0);
      } else {
        finish();
      }
    }, prefersReducedMotion() ? 0 : ADVANCE_DELAY);
  }

  function goBack() {
    if (state.locked) return;
    if (state.index === 0) {
      showScreen('intro', 'intro-title');
      return;
    }
    state.index -= 1;
    renderQuestion();
    $('question-text').focus({ preventScroll: true });
  }

  /* ---------------- شاشة النتيجة ---------------- */

  function finish() {
    state.result = computeResult(state.answers);
    renderResult(state.result);
    showScreen('result', 'result-title');
    placeMarker(state.result);
  }

  function responseNames(keys) {
    return keys.map(function (k) { return RESPONSES[k].emoji + ' ' + RESPONSES[k].name; });
  }

  function renderResult(res) {
    var quad = QUADRANTS[res.quadrant];

    $('result-title').textContent = quad.title;
    $('result-title').style.setProperty('--accent', quad.color);
    $('result-matrix').innerHTML = matrixHTML({ result: true, active: res.quadrant });

    var card = $('quadrant-card');
    card.style.setProperty('--accent', quad.color);
    $('quadrant-desc').textContent = quad.description;
    $('quadrant-next').textContent = quad.next;
    var signs = $('quadrant-signs');
    signs.innerHTML = '';
    quad.signs.forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s;
      signs.appendChild(li);
    });

    // ردّة الفعل الغالبة
    var dom = res.dominant;
    var title = dom.length > 1 ? 'مزيج من ' + responseNames(dom).join(' و') : responseNames(dom).join('');
    $('response-title').textContent = title;
    var desc = $('response-desc');
    desc.innerHTML = '';
    dom.forEach(function (k) {
      var p = document.createElement('p');
      p.className = 'card-text';
      p.textContent = (dom.length > 1 ? RESPONSES[k].emoji + ' ' + RESPONSES[k].name + ': ' : '') + RESPONSES[k].description;
      desc.appendChild(p);
    });

    var bars = $('response-bars');
    bars.innerHTML = '';
    RESPONSE_ORDER.forEach(function (k) {
      var pct = res.rTotal ? Math.round(res.counts[k] / res.rTotal * 100) : 0;
      var row = document.createElement('div');
      row.className = 'bar-row' + (dom.indexOf(k) !== -1 ? ' is-dominant' : '');
      row.innerHTML =
        '<span class="bar-name"><span aria-hidden="true">' + RESPONSES[k].emoji + '</span> ' + escapeHTML(RESPONSES[k].name) + '</span>' +
        '<span class="bar" role="img" aria-label="' + escapeHTML(RESPONSES[k].name) + ' ' + arNum(pct) + '٪"><i style="width:' + pct + '%"></i></span>' +
        '<span class="bar-pct">' + arNum(pct) + '٪</span>';
      bars.appendChild(row);
    });
  }

  function placeMarker(res) {
    var marker = $('you-marker');
    if (!marker) return;
    var dx = axisOffset(res.xNorm, X_RANGE);
    var dy = axisOffset(res.yNorm, Y_RANGE);
    var left = res.narcissist ? 50 + dx : 50 - dx; // «نرجسي» يمينًا
    var top = res.aware ? 50 + dy : 50 - dy; // «يدرك» في الأسفل

    // ضع كلمة «أنت» نحو الحافة الخارجية، أو نحو المحور إن كانت النقطة قريبة من الحافة
    var outer = res.narcissist ? 'right' : 'left';
    var inner = res.narcissist ? 'left' : 'right';
    marker.classList.add('label-' + (dx > 25 ? inner : outer));

    var apply = function () {
      marker.style.left = left + '%';
      marker.style.top = top + '%';
    };
    if (prefersReducedMotion()) { apply(); return; }
    // ابدأ من المنتصف ثم تحرّك إلى الموقع
    requestAnimationFrame(function () { requestAnimationFrame(apply); });
  }

  /* ---------------- المشاركة ---------------- */

  function showToast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function share() {
    var res = state.result;
    if (!res) return;
    var quad = QUADRANTS[res.quadrant];
    var text = 'نتيجتي في اختبار «ضحية أم نرجسي؟»: ' + quad.title +
      '. ردّة فعلي تحت الضغط: ' + responseNames(res.dominant).join(' و') + '. وأنت، أيّهم أنت؟';
    var url = /^https?:/.test(location.protocol) ? location.href.split('#')[0] : '';

    if (navigator.share) {
      navigator.share({ title: 'ضحية أم نرجسي؟', text: text, url: url || undefined }).catch(function () {});
      return;
    }
    var full = url ? text + '\n' + url : text;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(full).then(
        function () { showToast('تم نسخ النتيجة، الصقها حيث تريد'); },
        function () { showToast(full); }
      );
    } else {
      showToast(full);
    }
  }

  /* ---------------- التهيئة ---------------- */

  function init() {
    $('intro-matrix').innerHTML = matrixHTML();
    $('intro-meta').textContent = questionCountLabel(QUESTIONS.length) + ' · ٣ دقائق تقريبًا';

    $('start-btn').addEventListener('click', startQuiz);
    $('back-btn').addEventListener('click', goBack);
    $('restart-btn').addEventListener('click', startQuiz);
    $('share-btn').addEventListener('click', share);

    document.addEventListener('keydown', function (e) {
      if ($('screen-quiz').hidden || e.altKey || e.ctrlKey || e.metaKey) return;
      var map = { '1': 0, '2': 1, '3': 2, '4': 3, '١': 0, '٢': 1, '٣': 2, '٤': 3 };
      if (Object.prototype.hasOwnProperty.call(map, e.key) && map[e.key] < QUESTIONS[state.index].options.length) {
        e.preventDefault();
        selectOption(map[e.key]);
      }
    });
  }

  // متاح للاختبارات الآلية
  window.QuizApp = { computeResult: computeResult, questions: QUESTIONS };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
