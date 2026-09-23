const state = {
  modules: [],
  wrongBook: [],
  wrongBookFilter: "全部",
  selectedModule: null,
  practice: {
    mode: "questions",
    index: 0,
    answers: {},
    submitted: {},
    correction: null,
    knowledgeQueue: [],
    knowledgeRemembered: {},
    wrongBookQueue: [],
    wrongBookRemembered: {},
    timer: {
      key: null,
      startedAt: 0,
      elapsed: 0,
      running: false,
      finished: false,
      intervalId: null,
      elapsedByKey: {},
    },
  },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function questionImagesMarkup(question, className = "question-images") {
  const images = Array.isArray(question?.images) ? question.images : [];
  return images.map((src, index) => {
    const imageUrl = String(src || "");
    if (!imageUrl.startsWith("/media/")) return "";
    return `
      <figure class="${className}">
        <img src="${escapeHtml(imageUrl)}" alt="题目配图 ${index + 1}" loading="lazy" />
      </figure>
    `;
  }).join("");
}

function questionContentMarkup(question, className = "practice-question-text") {
  return `<span class="${className}">${escapeHtml(question?.text || "")}</span>${questionImagesMarkup(question)}`;
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : ""}`;
  toast.textContent = message;
  $("#toast-region").appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

function setView(view) {
  if (view !== "practice") stopQuestionTimer(false);
  $("#overview-view").hidden = view !== "overview";
  $("#module-view").hidden = view !== "module";
  $("#practice-view").hidden = view !== "practice";
  $("#wrong-book-view").hidden = view !== "wrong-book";
  $$(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.view === view));
  const labels = { overview: "总览", module: "模块详情", practice: "练习", "wrong-book": "错题本" };
  $("#breadcrumb-current").textContent = labels[view];
  $("#page-title").textContent = view === "overview"
    ? "把文件变成可以练习的题目"
    : view === "module"
      ? (state.selectedModule?.name || "模块详情")
      : view === "wrong-book"
        ? "分类整理并手动复习错题"
        : "专注完成这一组内容";
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

async function loadModules() {
  const [payload, wrongBookPayload] = await Promise.all([
    getJson("/api/modules"),
    getJson("/api/wrong-book"),
  ]);
  state.modules = payload.modules;
  state.wrongBook = wrongBookPayload.entries;
  renderModuleList();
  renderMetrics();
  renderModuleGrid();
  renderWrongBook();
}

function wrongBookKey(entry) {
  return `${entry.moduleId}::${entry.question.id}`;
}

function wrongBookCategories() {
  const categories = [...new Set(state.wrongBook.map((entry) => entry.category || "未分类"))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  return categories.length ? categories : ["未分类"];
}

function filteredWrongBook() {
  if (state.wrongBookFilter === "全部") return state.wrongBook;
  return state.wrongBook.filter((entry) => (entry.category || "未分类") === state.wrongBookFilter);
}

function isInWrongBook(moduleId, questionId) {
  return state.wrongBook.some((entry) => entry.moduleId === moduleId && entry.question.id === questionId);
}

function renderModuleList() {
  $("#module-count").textContent = state.modules.length;
  $("#module-list").innerHTML = state.modules.length
    ? state.modules.map((module) => `
      <button data-module-id="${module.id}" class="${state.selectedModule?.id === module.id ? "is-active" : ""}">
        <strong>${escapeHtml(module.name)}</strong><span>${module.contentCount || module.questionCount}</span>
      </button>
    `).join("")
    : `<div class="empty-state">还没有题库</div>`;
  $$("#module-list button").forEach((button) => {
    button.addEventListener("click", () => openModule(button.dataset.moduleId));
  });
}

function renderMetrics() {
  const contentCount = state.modules.reduce((sum, module) => sum + (module.contentCount || module.questionCount), 0);
  const pendingCount = state.modules.reduce((sum, module) => sum + module.pendingCount, 0);
  const latest = state.modules[0]?.lastSource || "—";
  $("#metric-modules").textContent = state.modules.length;
  $("#metric-questions").textContent = contentCount;
  $("#metric-pending").textContent = pendingCount;
  $("#metric-latest").textContent = latest.replace(/\.[^.]+$/, "") || "—";
}

function renderModuleGrid() {
  if (!state.modules.length) {
    $("#module-grid").innerHTML = `<div class="empty-state">点击上方“导入文件”，让第一个题库模块在这里出现。</div>`;
    return;
  }
  $("#module-grid").innerHTML = state.modules.map((module) => {
    const typeLabels = [
      ...Object.entries(module.types || {}).map(([type, count]) => `${type} ${count}`),
      module.knowledgeCount ? `知识点 ${module.knowledgeCount}` : "",
    ].filter(Boolean).join(" · ");
    return `
      <article class="module-card">
        <div class="module-card-top">
          <h3 title="${escapeHtml(module.name)}">${escapeHtml(module.name)}</h3>
          <span class="module-count">${module.contentCount || module.questionCount} ${module.knowledgeCount && !module.questionCount ? "知识点" : "项"}</span>
        </div>
        <p>${escapeHtml(typeLabels || "等待解析")}<br />${module.pendingCount ? `${module.pendingCount} 题需要校正` : "内容已整理"}</p>
        <div class="module-card-footer">
          <span>${module.lastSource ? `来自 ${escapeHtml(module.lastSource)}` : "本地题库"}</span>
          <button class="text-button" data-module-id="${module.id}">查看 →</button>
        </div>
      </article>
    `;
  }).join("");
  $$("#module-grid .text-button").forEach((button) => {
    button.addEventListener("click", () => openModule(button.dataset.moduleId));
  });
}

async function openModule(moduleId, alertText = "") {
  const payload = await getJson(`/api/modules/${moduleId}`);
  state.selectedModule = payload.module;
  renderModuleList();
  renderModuleDetail(alertText);
  setView("module");
}

function renderModuleDetail(alertText = "") {
  const module = state.selectedModule;
  const questions = module.questions || [];
  const knowledgePoints = module.knowledgePoints || [];
  const counts = questions.reduce((acc, question) => {
    acc[question.type] = (acc[question.type] || 0) + 1;
    return acc;
  }, {});
  $("#module-title").textContent = module.name;
  $("#module-subtitle").textContent = `${module.imports || 1} 个文件来源 · 最近更新 ${new Date(module.updatedAt).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}`;
  $("#detail-question-count").textContent = questions.length;
  $("#detail-single-count").textContent = counts["单选题"] || 0;
  $("#detail-multiple-count").textContent = counts["多选题"] || 0;
  $("#detail-judge-count").textContent = counts["判断题"] || 0;
  $("#detail-knowledge-count").textContent = knowledgePoints.length;
  $("#detail-pending-count").textContent = questions.filter((question) => question.needsReview).length;
  $("#start-practice").hidden = !questions.length;
  $("#start-knowledge").hidden = !knowledgePoints.length;
  $("#module-source").textContent = module.lastSource ? `最近导入：${module.lastSource}` : "";
  const alert = $("#module-alert");
  alert.hidden = !alertText;
  alert.className = `import-alert ${alertText.includes("待校正") ? "warning" : ""}`;
  alert.innerHTML = alertText;

  const questionMarkup = questions.map((question, index) => `
    <article class="question-preview">
      <div class="question-preview-number">Q${String(index + 1).padStart(2, "0")}</div>
      <div>
        <h3>${escapeHtml(question.text)}</h3>
        ${questionImagesMarkup(question, "preview-question-image")}
        ${question.options?.length ? `<div class="preview-options">${question.options.map((option) => `<span><b>${escapeHtml(option.key)}</b>${escapeHtml(option.text)}</span>`).join("")}</div>` : ""}
        <p>${question.options?.length ? `${question.options.length} 个选项 · ` : ""}${question.answer?.length ? `答案 ${escapeHtml(question.answer.join("、"))} · ` : "无标准答案 · "}${escapeHtml(question.explanation || "暂无解析")}</p>
      </div>
      <div class="question-preview-meta">
        ${question.needsReview
          ? `<span class="review-tag">待标记</span>`
          : question.answerSource === "manual"
            ? `<span class="review-tag corrected-tag">已勘误</span>`
            : escapeHtml(question.type)}
        <button class="text-button danger-text delete-question" data-question-id="${question.id}">删除 ×</button>
      </div>
    </article>
  `).join("");
  const knowledgeMarkup = knowledgePoints.map((point, index) => `
    <article class="question-preview knowledge-preview">
      <div class="question-preview-number">K${String(index + 1).padStart(2, "0")}</div>
      <div>
        <h3>${escapeHtml(point.text)}</h3>
        <p>背题模式 · 忘记后会延后再次出现</p>
      </div>
      <div class="question-preview-meta">知识点</div>
    </article>
  `).join("");
  $("#question-preview-list").innerHTML = questionMarkup + knowledgeMarkup
    || `<div class="empty-state">这个模块暂时没有识别出题目或知识点。</div>`;
  bindQuestionDeleteButtons();
}

function bindQuestionDeleteButtons() {
  $$(".delete-question").forEach((button) => {
    button.addEventListener("click", () => deleteQuestion(button.dataset.questionId));
  });
}

async function deleteQuestion(questionId) {
  const question = (state.selectedModule?.questions || []).find((item) => item.id === questionId);
  if (!question || !state.selectedModule) return;
  if (!window.confirm(`确定删除这道题吗？\n\n${question.text.slice(0, 100)}`)) return;
  try {
    await getJson(`/api/modules/${encodeURIComponent(state.selectedModule.id)}/questions/${encodeURIComponent(questionId)}`, {
      method: "DELETE",
    });
    const moduleId = state.selectedModule.id;
    state.wrongBook = (await getJson("/api/wrong-book")).entries;
    await loadModules();
    await openModule(moduleId, "题目已删除；如果它在错题本中，也已同步移除。");
    showToast("题目已删除");
  } catch (error) {
    showToast(error.message === "接口不存在"
      ? "当前后端还是旧版本，请先关闭旧服务，再重新运行 start.py 或 start.command"
      : error.message, "error");
  }
}

async function deleteModule() {
  const module = state.selectedModule;
  if (!module) return;
  const contentCount = (module.questions || []).length + (module.knowledgePoints || []).length;
  if (!window.confirm(`确定删除题库模块“${module.name}”吗？\n\n将删除其中 ${contentCount} 项内容及其错题本记录。此操作不可恢复。`)) return;
  try {
    await getJson(`/api/modules/${encodeURIComponent(module.id)}`, { method: "DELETE" });
    state.selectedModule = null;
    await loadModules();
    setView("overview");
    showToast(`题库模块「${module.name}」已删除`);
  } catch (error) {
    showToast(error.message === "接口不存在"
      ? "当前后端还是旧版本，请先关闭旧服务，再重新运行 start.py 或 start.command"
      : error.message, "error");
  }
}

function resetPractice(mode) {
  stopQuestionTimer(false);
  state.practice = {
    mode,
    index: 0,
    answers: {},
    submitted: {},
    correction: null,
    knowledgeQueue: [],
    knowledgeRemembered: {},
    wrongBookQueue: [],
    wrongBookRemembered: {},
    timer: {
      key: null,
      startedAt: 0,
      elapsed: 0,
      running: false,
      finished: false,
      intervalId: null,
      elapsedByKey: {},
    },
  };
}

function formatElapsed(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function currentTimerSeconds() {
  const timer = state.practice.timer;
  if (!timer) return 0;
  if (!timer.running) return timer.elapsed;
  return timer.elapsed + Math.floor((Date.now() - timer.startedAt) / 1000);
}

function renderQuestionTimer() {
  const timerElement = $("#practice-timer");
  if (!timerElement) return;
  timerElement.textContent = formatElapsed(currentTimerSeconds());
  timerElement.classList.toggle("is-running", Boolean(state.practice.timer?.running));
}

function stopQuestionTimer(finished = false) {
  const timer = state.practice.timer;
  if (!timer) return;
  if (timer.running) timer.elapsed = currentTimerSeconds();
  if (timer.key) timer.elapsedByKey[timer.key] = timer.elapsed;
  timer.running = false;
  timer.finished = finished;
  if (timer.intervalId) window.clearInterval(timer.intervalId);
  timer.intervalId = null;
  renderQuestionTimer();
}

function startQuestionTimer(key) {
  const timer = state.practice.timer;
  if (timer.key === key && (timer.running || timer.finished)) {
    renderQuestionTimer();
    return;
  }
  stopQuestionTimer(false);
  timer.key = key;
  timer.elapsed = timer.elapsedByKey[key] || 0;
  timer.startedAt = Date.now();
  timer.running = true;
  timer.finished = false;
  timer.intervalId = window.setInterval(renderQuestionTimer, 1000);
  renderQuestionTimer();
}

function showStoppedQuestionTimer(key) {
  const timer = state.practice.timer;
  if (timer.key !== key) stopQuestionTimer(false);
  timer.key = key;
  timer.elapsed = timer.elapsedByKey[key] || timer.elapsed || 0;
  timer.running = false;
  timer.finished = true;
  if (timer.intervalId) window.clearInterval(timer.intervalId);
  timer.intervalId = null;
  renderQuestionTimer();
}

function finishQuestionTimer() {
  stopQuestionTimer(true);
}

function beginPractice(mode = "questions") {
  const questions = state.selectedModule?.questions || [];
  const knowledgePoints = state.selectedModule?.knowledgePoints || [];
  if (mode === "questions" && !questions.length) {
    showToast("这个模块还没有可练习的题目，请进入背知识点模式", "error");
    return;
  }
  if (mode === "knowledge" && !knowledgePoints.length) {
    showToast("这个模块还没有可背诵的知识点", "error");
    return;
  }
  resetPractice(mode);
  state.practice.knowledgeQueue = mode === "knowledge" ? knowledgePoints.map((point) => point.id) : [];
  $("#practice-module-name").textContent = state.selectedModule.name;
  $("#practice-index-label").textContent = mode === "knowledge" ? "KNOWLEDGE INDEX" : "QUESTION INDEX";
  $("#question-practice-content").hidden = mode === "knowledge";
  $("#knowledge-practice-content").hidden = mode !== "knowledge";
  renderPracticeIndex();
  if (mode === "knowledge") renderKnowledgePractice();
  else renderPracticeQuestion();
  setView("practice");
}

function beginWrongBookPractice() {
  const entries = filteredWrongBook();
  if (!entries.length) {
    showToast("当前分类没有可练习的错题", "error");
    return;
  }
  resetPractice("wrong-book");
  state.practice.wrongBookQueue = entries.map(wrongBookKey);
  $("#practice-module-name").textContent = state.wrongBookFilter === "全部" ? "错题本 · 全部" : `错题本 · ${state.wrongBookFilter}`;
  $("#practice-index-label").textContent = "WRONG BOOK";
  $("#question-practice-content").hidden = false;
  $("#knowledge-practice-content").hidden = true;
  renderPracticeIndex();
  renderWrongBookPracticeQuestion();
  setView("practice");
}

function currentQuestion() {
  return state.selectedModule.questions[state.practice.index];
}

function currentKnowledgePoint() {
  const pointId = state.practice.knowledgeQueue[0];
  return (state.selectedModule.knowledgePoints || []).find((point) => point.id === pointId);
}

function currentWrongBookEntry() {
  const key = state.practice.wrongBookQueue[0];
  return state.wrongBook.find((entry) => wrongBookKey(entry) === key);
}

function answerKey(question) {
  return (state.practice.answers[question.id] || []).slice().sort().join("|");
}

function categoryOptions(selected = "未分类") {
  const categories = wrongBookCategories();
  if (selected && !categories.includes(selected)) categories.push(selected);
  return categories.map((category) => (
    `<option value="${escapeHtml(category)}" ${category === selected ? "selected" : ""}>${escapeHtml(category)}</option>`
  )).join("");
}

function categoryEditor(prefix, selected = "未分类") {
  return `
    <div class="manual-mark-fields">
      <select id="${prefix}-category" class="compact-select">
        ${categoryOptions(selected)}
        <option value="__new__">新分类...</option>
      </select>
      <input id="${prefix}-new-category" class="compact-input" type="text" placeholder="输入新分类" />
    </div>
  `;
}

function readCategory(prefix) {
  const selected = $(`#${prefix}-category`)?.value || "未分类";
  const custom = $(`#${prefix}-new-category`)?.value.trim();
  return selected === "__new__" ? (custom || "未分类") : selected;
}

function renderPracticeIndex() {
  if (state.practice.mode === "knowledge") {
    const points = state.selectedModule.knowledgePoints || [];
    $("#practice-index").innerHTML = points.map((point, index) => {
      const remembered = state.practice.knowledgeRemembered[point.id];
      const current = state.practice.knowledgeQueue[0] === point.id;
      const status = remembered ? "is-correct" : current ? "is-current" : "";
      return `<span class="knowledge-index-item ${status}" title="${escapeHtml(point.text)}">${String(index + 1).padStart(2, "0")}</span>`;
    }).join("");
    return;
  }
  if (state.practice.mode === "wrong-book") {
    const entries = filteredWrongBook();
    $("#practice-index").innerHTML = entries.map((entry, index) => {
      const key = wrongBookKey(entry);
      const remembered = state.practice.wrongBookRemembered[key];
      const current = state.practice.wrongBookQueue[0] === key;
      const status = remembered ? "is-correct" : current ? "is-current" : "";
      return `<span class="knowledge-index-item ${status}" title="${escapeHtml(entry.question.text)}">${String(index + 1).padStart(2, "0")}</span>`;
    }).join("");
    return;
  }
  const questions = state.selectedModule.questions;
  $("#practice-index").innerHTML = questions.map((question, index) => {
    const submitted = state.practice.submitted[question.id];
    const status = submitted === true ? "is-correct" : submitted === false ? "is-wrong" : "";
    return `<button class="${index === state.practice.index ? "is-current " : ""}${status}" data-practice-index="${index}">${String(index + 1).padStart(2, "0")}</button>`;
  }).join("");
  $$("#practice-index button").forEach((button) => {
    button.addEventListener("click", () => {
      state.practice.index = Number(button.dataset.practiceIndex);
      renderPracticeQuestion();
      renderPracticeIndex();
    });
  });
}

function renderOptions(question, submitted = false) {
  const selected = state.practice.answers[question.id] || [];
  if (!question.options?.length) {
    return `<div class="empty-state">这道题没有识别出选项，可直接手动加入错题本。</div>`;
  }
  return question.options.map((option) => {
    const isSelected = selected.includes(option.key);
    const isCorrect = submitted && question.answer?.includes(option.key);
    const isWrong = submitted && isSelected && !question.answer?.includes(option.key);
    return `<button class="option-button ${isSelected ? "is-selected " : ""}${isCorrect ? "is-correct " : ""}${isWrong ? "is-wrong" : ""}" data-option-key="${escapeHtml(option.key)}">
      <span class="option-key">${escapeHtml(option.key)}</span><span>${escapeHtml(option.text)}</span>
    </button>`;
  }).join("");
}

function isMultipleChoice(question) {
  return question.type === "多选题"
    || (question.answer?.length || 0) > 1
    || /多选/.test(question.text || "");
}

function renderMultipleChoiceSubmit(question, submitted = false) {
  const selectedCount = (state.practice.answers[question.id] || []).length;
  const button = $("#practice-submit");
  button.hidden = submitted || !isMultipleChoice(question);
  button.disabled = selectedCount === 0;
  button.innerHTML = selectedCount
    ? `确认选择（${selectedCount} 项） <span>↗</span>`
    : "请选择答案后确认 <span>↗</span>";
}

function answerCorrectionMarkup(question) {
  const correction = state.practice.correction;
  if (!correction?.open || correction.questionId !== question.id) return "";
  const options = question.options || [];
  const selected = correction.selected || [];
  const optionMarkup = options.length
    ? `<div id="answer-correction-options" class="answer-correction-options">
        ${options.map((option) => `
          <button type="button" class="correction-option ${selected.includes(option.key) ? "is-selected" : ""}" data-correction-key="${escapeHtml(option.key)}">
            <span class="option-key">${escapeHtml(option.key)}</span><span>${escapeHtml(option.text)}</span>
          </button>
        `).join("")}
      </div>`
    : `<input id="answer-correction-input" class="compact-input answer-correction-input" type="text" value="${escapeHtml(correction.raw || "")}" placeholder="填写正确答案" />`;
  return `
    <div class="answer-correction">
      <strong>勘误本题正确答案</strong>
      <span>请选择一个或多个正确选项，保存后会写入本地题库。</span>
      ${optionMarkup}
      <div class="feedback-actions">
        <button id="cancel-answer-correction" class="button button-quiet" type="button">取消</button>
        <button id="save-answer-correction" class="button button-primary" type="button">保存勘误 <span>✓</span></button>
      </div>
    </div>
  `;
}

function renderAnswerCorrection(question) {
  state.practice.correction = {
    questionId: question.id,
    open: true,
    selected: [...(question.answer || [])],
    raw: question.options?.length ? "" : (question.answer?.[0] || ""),
  };
  if (state.practice.mode === "wrong-book") renderWrongBookPracticeQuestion();
  else renderPracticeQuestion();
}

function closeAnswerCorrection() {
  state.practice.correction = null;
  if (state.practice.mode === "wrong-book") renderWrongBookPracticeQuestion();
  else renderPracticeQuestion();
}

function toggleAnswerCorrectionOption(key) {
  const correction = state.practice.correction;
  if (!correction) return;
  correction.selected = correction.selected.includes(key)
    ? correction.selected.filter((item) => item !== key)
    : [...correction.selected, key];
  if (state.practice.mode === "wrong-book") renderWrongBookPracticeQuestion();
  else renderPracticeQuestion();
}

function bindAnswerCorrection(question) {
  $("#answer-correction-button")?.addEventListener("click", () => renderAnswerCorrection(question));
  $$("#answer-correction-options .correction-option").forEach((button) => {
    button.addEventListener("click", () => toggleAnswerCorrectionOption(button.dataset.correctionKey));
  });
  $("#answer-correction-input")?.addEventListener("input", (event) => {
    if (state.practice.correction) state.practice.correction.raw = event.target.value;
  });
  $("#cancel-answer-correction")?.addEventListener("click", closeAnswerCorrection);
  $("#save-answer-correction")?.addEventListener("click", () => saveAnswerCorrection(question));
}

async function saveAnswerCorrection(question) {
  const correction = state.practice.correction;
  if (!correction?.open || correction.questionId !== question.id) return;
  const answer = question.options?.length
    ? [...correction.selected]
    : [($("#answer-correction-input")?.value || correction.raw || "").trim()];
  if (!answer.filter(Boolean).length) {
    showToast("至少选择或填写一个正确答案", "error");
    return;
  }
  const entry = state.practice.mode === "wrong-book" ? currentWrongBookEntry() : null;
  const moduleId = entry?.moduleId || state.selectedModule?.id;
  if (!moduleId) return;
  const selectedAnswer = [...(state.practice.answers[question.id] || [])];
  finishQuestionTimer();
  try {
    const payload = await getJson(
      `/api/modules/${encodeURIComponent(moduleId)}/questions/${encodeURIComponent(question.id)}`,
      {
        method: "PUT",
        body: JSON.stringify({ answer }),
        headers: { "Content-Type": "application/json" },
      },
    );
    const updatedQuestion = payload.question;
    if (state.selectedModule?.id === moduleId) {
      const localQuestion = state.selectedModule.questions.find((item) => item.id === question.id);
      if (localQuestion) Object.assign(localQuestion, updatedQuestion);
    }
    state.wrongBook = state.wrongBook.map((wrongEntry) => (
      wrongEntry.moduleId === moduleId && wrongEntry.question.id === question.id
        ? { ...wrongEntry, question: updatedQuestion }
        : wrongEntry
    ));
    state.practice.correction = null;
    if (state.practice.mode === "questions") {
      if (selectedAnswer.length) {
        state.practice.submitted[question.id] = selectedAnswer.slice().sort().join("|")
          === updatedQuestion.answer.slice().sort().join("|");
      } else {
        delete state.practice.submitted[question.id];
      }
    }
    await loadModules();
    if (state.practice.mode === "wrong-book") renderWrongBookPracticeQuestion();
    else {
      renderPracticeQuestion();
      renderPracticeIndex();
    }
    showToast(`答案已勘误为 ${updatedQuestion.answer.join("、")}，并已保存到题库`);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderPracticeQuestion() {
  if (state.practice.mode === "knowledge") {
    renderKnowledgePractice();
    return;
  }
  if (state.practice.mode === "wrong-book") {
    renderWrongBookPracticeQuestion();
    return;
  }
  const question = currentQuestion();
  const submitted = Object.prototype.hasOwnProperty.call(state.practice.submitted, question.id);
  const hasAnswer = Boolean(question.answer?.length);
  if (submitted) showStoppedQuestionTimer(question.id);
  else startQuestionTimer(question.id);
  $("#question-practice-content").hidden = false;
  $("#knowledge-practice-content").hidden = true;
  $("#practice-progress-label").textContent = `${state.practice.index + 1} / ${state.selectedModule.questions.length}`;
  $("#practice-progress-bar").style.width = `${((state.practice.index + 1) / state.selectedModule.questions.length) * 100}%`;
  $("#practice-score").textContent = `${Object.keys(state.practice.submitted).length} 已判题`;
  $("#practice-type").textContent = hasAnswer
    ? (isMultipleChoice(question) ? "多选题" : question.type)
    : "人工标记";
  $("#practice-number").textContent = `Q${String(state.practice.index + 1).padStart(2, "0")}`;
  $("#practice-question").innerHTML = questionContentMarkup(question);
  $("#practice-options").innerHTML = renderOptions(question, submitted && hasAnswer);
  $$("#practice-options .option-button").forEach((button) => {
    button.addEventListener("click", () => toggleOption(button.dataset.optionKey));
  });

  const feedback = $("#practice-feedback");
  if (!hasAnswer) {
    feedback.hidden = false;
    feedback.className = "practice-feedback manual";
    feedback.innerHTML = `
      <strong>这道题没有标准答案</strong>
      <div>你可以先选择自己认为正确的选项，再把它按分类存入错题本，之后进入错题本做手动练习。</div>
      ${categoryEditor("manual-mark", "待人工标记")}
      <div class="feedback-actions">
        <button id="answer-correction-button" class="button button-quiet" type="button">勘误答案 <span>✎</span></button>
        <button id="manual-save-wrong" class="button button-dark">标记并加入错题本 <span>＋</span></button>
      </div>
      ${answerCorrectionMarkup(question)}
    `;
    bindAnswerCorrection(question);
    $("#manual-save-wrong").addEventListener("click", () => saveWrongBookEntry(question, {
      category: readCategory("manual-mark"),
      manualAnswer: state.practice.answers[question.id] || [],
      note: "人工标记题",
    }));
    $("#practice-submit").hidden = true;
    $("#practice-submit").disabled = false;
    $("#practice-next").hidden = false;
    $("#practice-next").textContent = state.practice.index === state.selectedModule.questions.length - 1 ? "回到模块  →" : "下一题  →";
    return;
  }

  feedback.hidden = !submitted;
  if (submitted) {
    const correct = state.practice.submitted[question.id];
    feedback.className = `practice-feedback ${correct ? "" : "wrong"}`;
    feedback.innerHTML = `
      <strong>${correct ? "回答正确" : "回答不正确"} · 正确答案：${escapeHtml(question.answer.join("、"))}</strong>
      <div>${escapeHtml(question.explanation || "暂无解析")}</div>
      ${correct ? "" : categoryEditor("wrong-mark", "自动错题")}
      <div class="feedback-actions">
        <button id="answer-correction-button" class="button button-quiet" type="button">勘误答案 <span>✎</span></button>
        ${correct ? "" : `<button id="wrong-book-button" class="button button-quiet">${isInWrongBook(state.selectedModule.id, question.id) ? "更新错题本" : "加入错题本"} <span>＋</span></button>`}
      </div>
      ${answerCorrectionMarkup(question)}
    `;
    bindAnswerCorrection(question);
    $("#wrong-book-button")?.addEventListener("click", () => saveWrongBookEntry(question, {
      category: readCategory("wrong-mark"),
      manualAnswer: state.practice.answers[question.id] || [],
      note: "答题错误",
    }));
  }
  renderMultipleChoiceSubmit(question, submitted);
  $("#practice-next").hidden = !submitted;
  $("#practice-next").textContent = state.practice.index === state.selectedModule.questions.length - 1 ? "回到模块  →" : "下一题  →";
}

function renderKnowledgePractice() {
  stopQuestionTimer(false);
  $("#practice-timer").textContent = "--:--";
  $("#practice-timer").classList.remove("is-running");
  const points = state.selectedModule.knowledgePoints || [];
  const point = currentKnowledgePoint();
  const rememberedCount = Object.keys(state.practice.knowledgeRemembered).length;
  $("#question-practice-content").hidden = true;
  $("#knowledge-practice-content").hidden = false;
  $("#practice-index-label").textContent = "KNOWLEDGE INDEX";
  $("#practice-progress-label").textContent = `${rememberedCount} / ${points.length} 已记得`;
  $("#practice-progress-bar").style.width = `${points.length ? (rememberedCount / points.length) * 100 : 100}%`;
  $("#practice-score").textContent = `${state.practice.knowledgeQueue.length} 次待复习`;
  $("#practice-feedback").hidden = true;
  $("#practice-submit").hidden = true;
  $("#practice-next").hidden = true;
  $("#knowledge-complete").hidden = Boolean(point);
  $("#knowledge-forgot").hidden = !point;
  $("#knowledge-remember").hidden = !point;
  if (!point) {
    $("#knowledge-point-text").textContent = "这一组知识点已经复习完成";
    $("#knowledge-number").textContent = "DONE";
    renderPracticeIndex();
    return;
  }
  const pointIndex = points.findIndex((item) => item.id === point.id);
  $("#knowledge-number").textContent = `K${String(pointIndex + 1).padStart(2, "0")}`;
  $("#knowledge-point-text").textContent = point.text;
  renderPracticeIndex();
}

function renderWrongBookPracticeQuestion() {
  const entries = filteredWrongBook();
  const entry = currentWrongBookEntry();
  const rememberedCount = Object.keys(state.practice.wrongBookRemembered).length;
  $("#question-practice-content").hidden = false;
  $("#knowledge-practice-content").hidden = true;
  $("#practice-index-label").textContent = "WRONG BOOK";
  $("#practice-progress-label").textContent = `${rememberedCount} / ${entries.length} 本轮已掌握`;
  $("#practice-progress-bar").style.width = `${entries.length ? (rememberedCount / entries.length) * 100 : 100}%`;
  $("#practice-score").textContent = `${state.practice.wrongBookQueue.length} 次待复习`;
  $("#practice-submit").hidden = true;
  $("#practice-submit").disabled = false;
  $("#practice-next").hidden = true;
  if (!entry) {
    stopQuestionTimer(true);
    $("#practice-timer").textContent = "--:--";
    $("#practice-timer").classList.remove("is-running");
    $("#practice-type").textContent = "错题本";
    $("#practice-number").textContent = "DONE";
    $("#practice-question").textContent = "本轮错题练习完成";
    $("#practice-options").innerHTML = `<div class="empty-state">错题仍会保留在错题本中，只有手动删除才会移除。</div>`;
    $("#practice-feedback").hidden = true;
    renderPracticeIndex();
    return;
  }
  const question = entry.question;
  startQuestionTimer(wrongBookKey(entry));
  $("#practice-type").textContent = entry.category || "未分类";
  $("#practice-number").textContent = `错${String(entries.findIndex((item) => wrongBookKey(item) === wrongBookKey(entry)) + 1).padStart(2, "0")}`;
  $("#practice-question").innerHTML = questionContentMarkup(question);
  $("#practice-options").innerHTML = renderOptions(question, false);
  $$("#practice-options .option-button").forEach((button) => {
    button.addEventListener("click", () => toggleOption(button.dataset.optionKey));
  });
  const answerText = question.answer?.length
    ? `标准答案：${escapeHtml(question.answer.join("、"))}`
    : entry.manualAnswer?.length
      ? `人工标记：${escapeHtml(entry.manualAnswer.join("、"))}`
      : "暂无标准答案";
  $("#practice-feedback").hidden = false;
  $("#practice-feedback").className = "practice-feedback manual";
  $("#practice-feedback").innerHTML = `
    <strong>${answerText}</strong>
    <div>${escapeHtml(question.explanation || entry.note || "这道题需要人工复盘。")}</div>
    <div class="feedback-actions">
      <button id="answer-correction-button" class="button button-quiet" type="button">勘误答案 <span>✎</span></button>
      <button id="wrong-book-forgot" class="button button-quiet">还不会，后面再来 <span>↻</span></button>
      <button id="wrong-book-remember" class="button button-primary">记住了，本轮跳过 <span>→</span></button>
    </div>
    ${answerCorrectionMarkup(question)}
  `;
  bindAnswerCorrection(question);
  $("#wrong-book-forgot").addEventListener("click", forgetWrongBookQuestion);
  $("#wrong-book-remember").addEventListener("click", rememberWrongBookQuestion);
  renderPracticeIndex();
}

function toggleOption(key) {
  const question = state.practice.mode === "wrong-book" ? currentWrongBookEntry()?.question : currentQuestion();
  if (!question || Object.prototype.hasOwnProperty.call(state.practice.submitted, question.id)) return;
  const existing = state.practice.answers[question.id] || [];
  if (isMultipleChoice(question) || !question.answer?.length || state.practice.mode === "wrong-book") {
    state.practice.answers[question.id] = existing.includes(key)
      ? existing.filter((item) => item !== key)
      : [...existing, key];
    renderPracticeQuestion();
    return;
  }
  state.practice.answers[question.id] = [key];
  submitAnswer();
}

function submitAnswer() {
  if (state.practice.mode !== "questions") return;
  const question = currentQuestion();
  const selected = state.practice.answers[question.id] || [];
  if (!selected.length) {
    showToast("请先选择一个答案", "error");
    return;
  }
  if (!question.answer?.length) {
    renderPracticeQuestion();
    return;
  }
  state.practice.submitted[question.id] = answerKey(question) === [...question.answer].sort().join("|");
  finishQuestionTimer();
  renderPracticeQuestion();
  renderPracticeIndex();
}

function rememberKnowledge() {
  const point = currentKnowledgePoint();
  if (!point) return;
  state.practice.knowledgeRemembered[point.id] = true;
  state.practice.knowledgeQueue = state.practice.knowledgeQueue.filter((id) => id !== point.id);
  renderKnowledgePractice();
}

function forgetKnowledge() {
  const point = currentKnowledgePoint();
  if (!point) return;
  state.practice.knowledgeQueue.shift();
  state.practice.knowledgeQueue.push(point.id, point.id);
  renderKnowledgePractice();
}

function rememberWrongBookQuestion() {
  const entry = currentWrongBookEntry();
  if (!entry) return;
  const key = wrongBookKey(entry);
  finishQuestionTimer();
  state.practice.wrongBookRemembered[key] = true;
  state.practice.wrongBookQueue = state.practice.wrongBookQueue.filter((item) => item !== key);
  renderWrongBookPracticeQuestion();
}

function forgetWrongBookQuestion() {
  const entry = currentWrongBookEntry();
  if (!entry) return;
  const key = wrongBookKey(entry);
  state.practice.wrongBookQueue.shift();
  state.practice.wrongBookQueue.push(key);
  renderWrongBookPracticeQuestion();
}

async function saveWrongBookEntry(question, { category = "未分类", manualAnswer = [], note = "" } = {}) {
  const moduleId = state.selectedModule?.id;
  if (!moduleId || !question?.id) return;
  finishQuestionTimer();
  try {
    await getJson("/api/wrong-book", {
      method: "POST",
      body: JSON.stringify({ moduleId, questionId: question.id, category, manualAnswer, note }),
      headers: { "Content-Type": "application/json" },
    });
    state.wrongBook = (await getJson("/api/wrong-book")).entries;
    renderWrongBook();
    renderPracticeQuestion();
    showToast(`已保存到「${category}」`);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderWrongBook() {
  const categories = wrongBookCategories();
  if (state.wrongBookFilter !== "全部" && !categories.includes(state.wrongBookFilter)) {
    state.wrongBookFilter = "全部";
  }
  const entries = filteredWrongBook();
  $("#wrong-book-count").textContent = state.wrongBook.length;
  $("#wrong-book-subtitle").textContent = `${entries.length} 道题 · 当前分类：${state.wrongBookFilter}。错题会一直保存，除非手动删除。`;
  $("#wrong-book-filter").innerHTML = `
    <option value="全部" ${state.wrongBookFilter === "全部" ? "selected" : ""}>全部</option>
    ${categories.map((category) => `<option value="${escapeHtml(category)}" ${state.wrongBookFilter === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
  `;
  $("#start-wrong-book-practice").disabled = !entries.length;
  $("#wrong-book-list").innerHTML = entries.length
    ? entries.map((entry, index) => {
      const answer = entry.question.answer?.length
        ? `标准答案 ${entry.question.answer.join("、")}`
        : entry.manualAnswer?.length
          ? `人工标记 ${entry.manualAnswer.join("、")}`
          : "暂无答案";
      return `
        <article class="question-preview wrong-book-item">
          <div class="question-preview-number">错${String(index + 1).padStart(2, "0")}</div>
          <div>
            <h3>${escapeHtml(entry.question.text)}</h3>
            <p>${escapeHtml(entry.moduleName)} · ${escapeHtml(answer)} · ${escapeHtml(entry.question.explanation || entry.note || "人工复盘")}</p>
            <div class="wrong-book-controls">
              <select class="compact-select wrong-book-category" data-module-id="${entry.moduleId}" data-question-id="${entry.question.id}">
                ${categoryOptions(entry.category || "未分类")}
                <option value="__new__">新分类...</option>
              </select>
              <input class="compact-input wrong-book-new-category" data-module-id="${entry.moduleId}" data-question-id="${entry.question.id}" type="text" placeholder="输入新分类后回车" />
            </div>
          </div>
          <div class="question-preview-meta">
            <span class="review-tag">${escapeHtml(entry.category || "未分类")}</span>
            <button class="text-button remove-wrong-book" data-module-id="${entry.moduleId}" data-question-id="${entry.question.id}">删除 ×</button>
          </div>
        </article>
      `;
    }).join("")
    : `<div class="empty-state">当前分类没有错题。没有标准答案的题，可以在刷题时用“标记并加入错题本”保存。</div>`;
  bindWrongBookControls();
}

function bindWrongBookControls() {
  $$(".remove-wrong-book").forEach((button) => {
    button.addEventListener("click", async () => {
      const payload = { moduleId: button.dataset.moduleId, questionId: button.dataset.questionId };
      try {
        await getJson("/api/wrong-book", { method: "DELETE", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } });
        state.wrongBook = (await getJson("/api/wrong-book")).entries;
        renderWrongBook();
        showToast("已从错题本删除");
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });
  $$(".wrong-book-category").forEach((select) => {
    select.addEventListener("change", async () => {
      if (select.value === "__new__") return;
      await updateWrongBookCategory(select.dataset.moduleId, select.dataset.questionId, select.value);
    });
  });
  $$(".wrong-book-new-category").forEach((input) => {
    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter" || !input.value.trim()) return;
      await updateWrongBookCategory(input.dataset.moduleId, input.dataset.questionId, input.value.trim());
    });
  });
}

async function updateWrongBookCategory(moduleId, questionId, category) {
  try {
    await getJson("/api/wrong-book", {
      method: "PUT",
      body: JSON.stringify({ moduleId, questionId, category }),
      headers: { "Content-Type": "application/json" },
    });
    state.wrongBook = (await getJson("/api/wrong-book")).entries;
    state.wrongBookFilter = category;
    renderWrongBook();
    showToast(`已归入「${category}」`);
  } catch (error) {
    showToast(error.message, "error");
  }
}

const uploadSelection = {
  questionFile: null,
  answerFile: null,
};

function updateUploadSelection() {
  $("#question-file-name").textContent = uploadSelection.questionFile?.name || "尚未选择";
  $("#answer-file-name").textContent = uploadSelection.answerFile?.name || "尚未选择";
  $("#submit-upload").disabled = !uploadSelection.questionFile;
}

function clearUploadSelection() {
  uploadSelection.questionFile = null;
  uploadSelection.answerFile = null;
  $("#question-file-input").value = "";
  $("#answer-file-input").value = "";
  updateUploadSelection();
}

async function uploadFile(questionFile, answerFile = null) {
  if (!questionFile) {
    showToast("请先选择题目文件", "error");
    return;
  }
  const formData = new FormData();
  formData.append("question_file", questionFile);
  if (answerFile) formData.append("answer_file", answerFile);
  $("#upload-progress").hidden = false;
  $("#submit-upload").disabled = true;
  $("#upload-progress-text").textContent = `正在解析 ${questionFile.name}${answerFile ? ` 和 ${answerFile.name}` : ""}…`;
  let uploaded = false;
  try {
    const payload = await getJson("/api/upload", { method: "POST", body: formData });
    const action = payload.mode === "merged" ? "已合并到已有题库模块" : "已创建新的题库模块";
    const imageText = payload.parse.imageCount ? `，提取 ${payload.parse.imageCount} 张题目配图` : "";
    const warningText = payload.parse.warnings?.length
      ? `，有 ${payload.parse.warnings.length} 处需要校正`
      : payload.parse.contentType === "knowledge"
        ? "，已整理为知识点"
        : "，题目结构完整";
    showToast(`${action}「${payload.module.name}」${warningText}${imageText}`);
    await loadModules();
    const contentMessage = payload.parse.contentType === "knowledge"
      ? `已整理 ${payload.parse.recognizedKnowledgePoints || payload.parse.recognized} 个知识点。`
      : `已处理 ${payload.parse.recognizedQuestions || payload.parse.recognized} 道题${payload.parse.paired ? `，并匹配 ${payload.parse.answerCount} 个答案` : ""}${imageText}。`;
    await openModule(payload.module.id, `<strong>${action}</strong>「${escapeHtml(payload.module.name)}」${contentMessage}${payload.parse.warnings?.length ? `其中 ${payload.parse.warnings.length} 处未完整识别。` : ""}`);
    uploaded = true;
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    $("#upload-progress").hidden = true;
    if (uploaded) clearUploadSelection();
    else updateUploadSelection();
  }
}

function setupUpload() {
  const questionInput = $("#question-file-input");
  const answerInput = $("#answer-file-input");
  $("#select-question-file").addEventListener("click", () => questionInput.click());
  $("#select-answer-file").addEventListener("click", () => answerInput.click());
  $("#header-upload").addEventListener("click", () => questionInput.click());
  questionInput.addEventListener("change", () => {
    uploadSelection.questionFile = questionInput.files[0] || null;
    updateUploadSelection();
  });
  answerInput.addEventListener("change", () => {
    uploadSelection.answerFile = answerInput.files[0] || null;
    updateUploadSelection();
  });
  $("#submit-upload").addEventListener("click", () => uploadFile(
    uploadSelection.questionFile,
    uploadSelection.answerFile,
  ));
  $("#clear-upload").addEventListener("click", clearUploadSelection);
  updateUploadSelection();
}

function setupEvents() {
  $$(".nav-item").forEach((item) => item.addEventListener("click", () => {
    if (item.dataset.view === "practice") {
      if (state.selectedModule) beginPractice(state.selectedModule.questions?.length ? "questions" : "knowledge");
      else showToast("请先选择一个题库模块", "error");
    } else if (item.dataset.view === "wrong-book") {
      renderWrongBook();
      setView("wrong-book");
    } else {
      setView("overview");
    }
  }));
  $("#refresh-modules").addEventListener("click", () => loadModules().then(() => showToast("题库列表已刷新")));
  $("#back-overview").addEventListener("click", () => setView("overview"));
  $("#back-module").addEventListener("click", () => {
    if (state.practice.mode === "wrong-book") {
      renderWrongBook();
      setView("wrong-book");
    } else {
      renderModuleDetail();
      setView("module");
    }
  });
  $("#start-practice").addEventListener("click", () => beginPractice("questions"));
  $("#start-knowledge").addEventListener("click", () => beginPractice("knowledge"));
  $("#delete-module").addEventListener("click", deleteModule);
  $("#start-wrong-book-practice").addEventListener("click", beginWrongBookPractice);
  $("#wrong-book-filter").addEventListener("change", (event) => {
    state.wrongBookFilter = event.target.value;
    renderWrongBook();
  });
  $("#practice-submit").addEventListener("click", submitAnswer);
  $("#knowledge-forgot").addEventListener("click", forgetKnowledge);
  $("#knowledge-remember").addEventListener("click", rememberKnowledge);
  $("#practice-next").addEventListener("click", () => {
    if (state.practice.mode !== "questions") return;
    if (state.practice.index === state.selectedModule.questions.length - 1) {
      renderModuleDetail();
      setView("module");
    } else {
      state.practice.index += 1;
      renderPracticeQuestion();
      renderPracticeIndex();
    }
  });
  setupUpload();
}

loadModules().catch((error) => showToast(error.message, "error"));
setupEvents();
