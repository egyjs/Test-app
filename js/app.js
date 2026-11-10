(function () {
  'use strict';

  var DATA = window.QUIZ_DATA;
  var engine = window.QuizEngine.create(DATA);
  var NODES = DATA.nodes;
  var QUADRANTS = DATA.quadrants;
  var RESPONSES = DATA.responses;
  var RESPONSE_ORDER = window.QuizEngine.RESPONSE_ORDER;
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

  /*
   * يحوّل قيمة من [-1, 1] إلى بُعد عن مركز المصفوفة (٪) داخل المربع الصحيح، فلا تقع النقطة
   * أبدًا في الفراغ بين المربعات. أفقيًا: من 8% إلى 38%. عموديًا تبقى النقطة في الشريط القريب
   * من المحور (4%–15%) — حيث النقاط في الصورة — كي لا تغطي اسم المربع.
   */
  var X_RANGE = [8, 38];
  var Y_RANGE = [4, 15];

  var state = {
    path: [DATA.start], // الأسئلة التي مرّ بها المستخدم بالترتيب؛ آخرها هو السؤال الحالي
    answers: {}, // معرّف السؤال ← رقم الخيار
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

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function questionCountLabel(n) {
    // ٣–١٠ تُجمع «أسئلة»، و١١ فما فوق «سؤالًا»
    return arNum(n) + (n >= 3 && n <= 10 ? ' أسئلة' : ' سؤالًا');
  }

  function stageOf(module) {
    for (var i = 0; i < DATA.stages.length; i++) {
      if (DATA.stages[i].modules.indexOf(module) !== -1) return DATA.stages[i];
    }
    return null;
  }

  function currentId() { return state.path[state.path.length - 1]; }

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

  function axisOffset(norm, range) {
    return range[0] + Math.min(1, Math.abs(norm)) * (range[1] - range[0]);
  }

  /* ---------------- التنقل بين الشاشات ---------------- */

  function showScreen(name, focusId) {
    ['intro', 'quiz', 'result'].forEach(function (s) {
      $('screen-' + s).hidden = s !== name;
    });
    window.scrollTo(0, 0);
    if (focusId) {
      var target = $(focusId);
      if (target) target.focus({ preventScroll: true });
    }
  }

  function startQuiz() {
    state.path = [DATA.start];
    state.answers = {};
    state.locked = false;
    state.result = null;
    $('share-fallback').hidden = true;
    renderQuestion();
    showScreen('quiz', 'question-text');
  }

  /* ---------------- شاشة الأسئلة ---------------- */

  function totalQuestions() {
    // المسارات كلها بطول واحد، لكن نحسب الطول المتبقي من الشجرة كي يبقى العدد صحيحًا إن تغيّرت
    return state.path.length - 1 + engine.remaining(currentId());
  }

  function renderQuestion() {
    var id = currentId();
    var node = NODES[id];
    var total = totalQuestions();
    var stage = stageOf(node.module);

    $('progress-text').textContent = 'سؤال ' + arNum(state.path.length) + ' من ' + arNum(total);
    $('progress-bar').style.width = ((state.path.length - 1) / total * 100) + '%';
    $('part-label').textContent = stage
      ? 'المرحلة ' + arNum(stage.n) + ' من ' + arNum(DATA.stages.length) + ': ' + stage.label
      : '';
    $('part-label').setAttribute('data-stage', stage ? stage.n : '');
    $('question-text').textContent = node.text;

    var box = $('options');
    box.innerHTML = '';
    node.options.forEach(function (o, i) {
      var btn = el('button', 'option');
      btn.type = 'button';
      var selected = state.answers[id] === i;
      btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
      if (selected) btn.classList.add('is-selected');
      btn.appendChild(el('span', 'option-num', arNum(i + 1))).setAttribute('aria-hidden', 'true');
      btn.appendChild(el('span', 'option-text', o.text));
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
    var id = currentId();
    state.answers[id] = i;

    Array.prototype.forEach.call($('options').children, function (btn, bi) {
      btn.classList.toggle('is-selected', bi === i);
      btn.setAttribute('aria-pressed', bi === i ? 'true' : 'false');
    });
    $('progress-bar').style.width = (state.path.length / totalQuestions() * 100) + '%';

    window.setTimeout(function () {
      state.locked = false;
      var next = engine.nextNode(id, i, state.path, state.answers);
      if (next) {
        state.path.push(next);
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
    if (state.path.length === 1) {
      showScreen('intro', 'intro-title');
      return;
    }
    // نعود خطوة في المسار؛ إن تغيّرت الإجابة فسيُعاد حساب الفرع التالي
    state.path.pop();
    renderQuestion();
    $('question-text').focus({ preventScroll: true });
  }

  /* ---------------- شاشة النتيجة ---------------- */

  function finish() {
    state.result = engine.result(state.path, state.answers);
    renderResult(state.result);
    showScreen('result', 'result-title');
    placeMarker(state.result);
  }

  function responseName(k) { return RESPONSES[k].emoji + ' ' + RESPONSES[k].name; }

  function renderResult(res) {
    var quad = QUADRANTS[res.quadrant];

    $('result-title').textContent = quad.title;
    $('result-title').style.setProperty('--accent', quad.color);
    $('result-matrix').innerHTML = matrixHTML({ result: true, active: res.quadrant });

    $('quadrant-card').style.setProperty('--accent', quad.color);
    $('quadrant-desc').textContent = quad.description;
    $('quadrant-next').textContent = quad.next;
    var signs = $('quadrant-signs');
    signs.innerHTML = '';
    quad.signs.forEach(function (s) { signs.appendChild(el('li', '', s)); });

    renderResponse(res);
    renderDeeper(res);
    renderTree(res);
  }

  function renderResponse(res) {
    var dom = res.dominant;
    $('response-title').textContent = dom.length > 1
      ? 'مزيج من ' + dom.map(responseName).join(' و')
      : dom.map(responseName).join('');

    var desc = $('response-desc');
    desc.innerHTML = '';
    dom.forEach(function (k) {
      var r = RESPONSES[k];
      desc.appendChild(el('p', 'card-text', (dom.length > 1 ? r.emoji + ' ' + r.name + ': ' : '') + r.description));
    });

    if (res.secondary) {
      var hybrid = el('p', 'card-text');
      hybrid.appendChild(el('strong', '', 'نمطك الهجين: ' + RESPONSES[dom[0]].name + '–' + RESPONSES[res.secondary].name + '. '));
      hybrid.appendChild(document.createTextNode(
        'تبدأ غالبًا بـ«' + RESPONSES[dom[0]].name + '»، وحين لا ينجح تنتقل إلى «' + RESPONSES[res.secondary].name + '».'
      ));
      desc.appendChild(hybrid);
    }

    dom.forEach(function (k) {
      var healthy = el('p', 'card-text healthy');
      healthy.appendChild(el('strong', '', 'النسخة الصحية' + (dom.length > 1 ? ' من «' + RESPONSES[k].name + '»' : '') + ': '));
      healthy.appendChild(document.createTextNode(RESPONSES[k].healthy));
      desc.appendChild(healthy);
    });

    var bars = $('response-bars');
    bars.innerHTML = '';
    RESPONSE_ORDER.forEach(function (k) {
      var pct = res.rTotal ? Math.round(res.counts[k] / res.rTotal * 100) : 0;
      var row = el('div', 'bar-row' + (dom.indexOf(k) !== -1 ? ' is-dominant' : ''));
      row.innerHTML =
        '<span class="bar-name"><span aria-hidden="true">' + RESPONSES[k].emoji + '</span> ' + escapeHTML(RESPONSES[k].name) + '</span>' +
        '<span class="bar" role="img" aria-label="' + escapeHTML(RESPONSES[k].name) + ' ' + arNum(pct) + '٪"><i style="width:' + pct + '%"></i></span>' +
        '<span class="bar-pct">' + arNum(pct) + '٪</span>';
      bars.appendChild(row);
    });
  }

  function insightBlock(item) {
    var wrap = el('div', 'insight');
    wrap.appendChild(el('h4', 'insight-title', item.title));
    wrap.appendChild(el('p', 'card-text', item.text));
    wrap.appendChild(el('p', 'ref', item.refs)).setAttribute('dir', 'ltr');
    return wrap;
  }

  function renderDeeper(res) {
    var box = $('deeper-body');
    box.innerHTML = '';
    if (res.subtype && DATA.subtypes[res.subtype]) box.appendChild(insightBlock(DATA.subtypes[res.subtype]));
    if (res.awareness && DATA.awarenessStyles[res.awareness]) box.appendChild(insightBlock(DATA.awarenessStyles[res.awareness]));
    $('deeper-card').hidden = !box.children.length;
  }

  function renderTree(res) {
    var list = $('tree-path');
    list.innerHTML = '';
    DATA.treeLevels.forEach(function (level, li) {
      var stage = DATA.stages[li];
      var item = el('li', 'tree-level');
      item.appendChild(el('span', 'tree-stage', 'المرحلة ' + arNum(li + 1) + (stage ? ': ' + stage.label : '')));
      var branches = el('div', 'tree-branches');
      level.forEach(function (m) {
        var taken = res.modules.indexOf(m) !== -1;
        var chip = el('span', 'branch' + (taken ? ' is-taken' : ''), DATA.modules[m]);
        if (taken) chip.setAttribute('aria-current', 'step');
        branches.appendChild(chip);
      });
      item.appendChild(branches);
      list.appendChild(item);
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

  function renderReferences() {
    var list = $('references-list');
    DATA.references.forEach(function (r) {
      var li = el('li');
      li.appendChild(el('span', 'ref-about', r.about));
      li.appendChild(el('span', 'ref', r.cite)).setAttribute('dir', 'ltr');
      list.appendChild(li);
    });
  }

  /* ---------------- المشاركة ---------------- */

  function showToast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* داخل إطار مضمَّن (iframe) لا تعمل قائمة المشاركة، ورابط الصفحة ليس رابطها الحقيقي */
  function isFramed() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }

  /* إن تعذّر النسخ تلقائيًا نعرض النص محدَّدًا ليُنسخ يدويًا */
  function showShareText(text) {
    var box = $('share-text');
    box.value = text;
    $('share-fallback').hidden = false;
    box.focus();
    box.select();
  }

  function share() {
    var res = state.result;
    if (!res) return;
    var quad = QUADRANTS[res.quadrant];
    var text = 'نتيجتي في اختبار «ضحية أم نرجسي؟»: ' + quad.title +
      '. ردّة فعلي تحت الضغط: ' + res.dominant.map(responseName).join(' و') + '. وأنت، أيّهم أنت؟';
    var framed = isFramed();
    var url = !framed && /^https?:/.test(location.protocol) ? location.href.split('#')[0] : '';
    var full = url ? text + '\n' + url : text;

    if (navigator.share && !framed) {
      navigator.share({ title: 'ضحية أم نرجسي؟', text: text, url: url || undefined }).catch(function (err) {
        if (!err || err.name !== 'AbortError') showShareText(full);
      });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(full).then(
        function () { showToast('تم نسخ النتيجة، الصقها حيث تريد'); },
        function () { showShareText(full); }
      );
    } else {
      showShareText(full);
    }
  }

  /* ---------------- التهيئة ---------------- */

  function init() {
    $('intro-matrix').innerHTML = matrixHTML();
    $('intro-meta').textContent = questionCountLabel(engine.remaining(DATA.start)) + ' · تتفرّع الأسئلة حسب إجاباتك';
    renderReferences();

    $('start-btn').addEventListener('click', startQuiz);
    $('back-btn').addEventListener('click', goBack);
    $('restart-btn').addEventListener('click', startQuiz);
    $('share-btn').addEventListener('click', share);

    document.addEventListener('keydown', function (e) {
      if ($('screen-quiz').hidden || e.altKey || e.ctrlKey || e.metaKey) return;
      var map = { '1': 0, '2': 1, '3': 2, '4': 3, '١': 0, '٢': 1, '٣': 2, '٤': 3 };
      if (Object.prototype.hasOwnProperty.call(map, e.key) && map[e.key] < NODES[currentId()].options.length) {
        e.preventDefault();
        selectOption(map[e.key]);
      }
    });
  }

  // متاح للاختبارات الآلية
  window.QuizApp = { engine: engine, state: state };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
