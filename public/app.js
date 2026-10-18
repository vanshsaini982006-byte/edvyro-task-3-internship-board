'use strict';

// Front end for the Internship Board. It only talks to the REST API (/api/...)
// and builds all page content with textContent, so API data can never inject HTML.

(function () {
  var PAGE_SIZE = 6;
  var COVER_LETTER_MAX = 2000;
  // config.js (served by the backend) sets the API address. Empty means "this same server".
  var API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) || '';

  function byId(id) { return document.getElementById(id); }

  var els = {
    form: byId('filter-form'),
    search: byId('search'),
    domain: byId('domain'),
    mode: byId('mode'),
    clear: byId('clear-filters'),
    results: byId('results'),
    summary: byId('result-summary'),
    loading: byId('state-loading'),
    error: byId('state-error'),
    errorText: byId('state-error-text'),
    retry: byId('retry-list'),
    empty: byId('state-empty'),
    emptyClear: byId('empty-clear'),
    list: byId('card-list'),
    pagination: byId('pagination'),
    prev: byId('page-prev'),
    next: byId('page-next'),
    pageStatus: byId('page-status'),

    dialog: byId('details-dialog'),
    dialogTitle: byId('dialog-title'),
    dialogClose: byId('dialog-close'),
    dialogLoading: byId('dialog-loading'),
    dialogError: byId('dialog-error'),
    dialogErrorText: byId('dialog-error-text'),
    dialogRetry: byId('dialog-retry'),
    dialogContent: byId('dialog-content'),
    detailDomain: byId('detail-domain'),
    detailMode: byId('detail-mode'),
    detailLocation: byId('detail-location'),
    detailOpenings: byId('detail-openings'),
    detailSkills: byId('detail-skills'),
    noOpenings: byId('no-openings'),

    applyForm: byId('apply-form'),
    applyTarget: byId('apply-target'),
    nameInput: byId('applicant-name'),
    emailInput: byId('applicant-email'),
    resumeInput: byId('resume-url'),
    letterInput: byId('cover-letter'),
    letterCount: byId('cover-letter-count'),
    nameError: byId('applicant-name-error'),
    emailError: byId('applicant-email-error'),
    resumeError: byId('resume-url-error'),
    letterError: byId('cover-letter-error'),
    applyProgress: byId('apply-progress'),
    applyError: byId('apply-error'),
    applySuccess: byId('apply-success'),
    applySubmit: byId('apply-submit')
  };

  var state = { page: 1, search: '', domain: '', mode: '' };
  var latestListRequest = 0;
  var lastTrigger = null;
  var currentInternshipId = null;
  var totalPages = 1;

  // ---------- API helper ----------

  function ApiRequestError(message, details) {
    this.message = message;
    this.code = details.code;
    this.fields = details.fields;
    this.httpStatus = details.httpStatus;
  }

  function apiRequest(path, options) {
    return fetch(API_BASE + '/api' + path, options).then(
      function (response) {
        return response.json().then(
          function (payload) { return { response: response, payload: payload }; },
          function () { return { response: response, payload: null }; }
        );
      },
      function () {
        throw new ApiRequestError('Could not reach the server. Check that it is running, then try again.', { code: 'NETWORK_ERROR' });
      }
    ).then(function (result) {
      var payload = result.payload;
      if (!result.response.ok || !payload || payload.status !== 'success') {
        var error = payload && payload.error ? payload.error : {};
        throw new ApiRequestError(error.message || 'Something went wrong. Please try again.', {
          code: error.code,
          fields: error.fields,
          httpStatus: result.response.status
        });
      }
      return payload;
    });
  }

  // ---------- Small DOM helper ----------

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function openingsText(count) {
    if (count === 0) return 'No openings';
    return count + (count === 1 ? ' opening' : ' openings');
  }

  // ---------- Internship list ----------

  function showView(view) {
    els.loading.hidden = view !== 'loading';
    els.error.hidden = view !== 'error';
    els.empty.hidden = view !== 'empty';
    els.list.hidden = view !== 'results';
    if (view !== 'results') els.pagination.hidden = true;
  }

  function renderCards(items) {
    els.list.textContent = '';
    items.forEach(function (item) {
      var card = make('li', 'card');
      card.appendChild(make('h3', 'card-title', item.title));
      card.appendChild(make('p', 'card-domain', item.domain));

      var facts = make('ul', 'card-facts');
      facts.appendChild(make('li', '', item.mode));
      facts.appendChild(make('li', '', item.location));
      facts.appendChild(make('li', '', openingsText(item.openings)));
      card.appendChild(facts);

      var skills = make('ul', 'chips');
      skills.setAttribute('aria-label', 'Skills');
      item.skills.forEach(function (skill) { skills.appendChild(make('li', '', skill)); });
      card.appendChild(skills);

      var button = make('button', 'btn', 'View details');
      button.type = 'button';
      button.setAttribute('aria-label', 'View details for ' + item.title);
      button.addEventListener('click', function () { openDetails(item.id, button); });
      card.appendChild(button);

      els.list.appendChild(card);
    });
  }

  function renderPagination(pagination) {
    totalPages = pagination.totalPages;
    els.pagination.hidden = pagination.totalPages <= 1;
    els.pageStatus.textContent = 'Page ' + pagination.page + ' of ' + pagination.totalPages;
    // aria-disabled (not disabled) keeps keyboard focus on the button after it is pressed.
    els.prev.setAttribute('aria-disabled', String(pagination.page <= 1));
    els.next.setAttribute('aria-disabled', String(pagination.page >= pagination.totalPages));
  }

  function loadInternships() {
    var requestId = ++latestListRequest;
    showView('loading');
    els.summary.textContent = 'Loading internships…';

    var params = new URLSearchParams({ page: String(state.page), limit: String(PAGE_SIZE) });
    if (state.search) params.set('search', state.search);
    if (state.domain) params.set('domain', state.domain);
    if (state.mode) params.set('mode', state.mode);

    return apiRequest('/internships?' + params.toString()).then(
      function (payload) {
        if (requestId !== latestListRequest) return; // a newer request replaced this one
        var items = payload.data;
        var pagination = payload.pagination;

        if (items.length === 0 && pagination.total > 0 && state.page > 1) {
          state.page = pagination.totalPages; // page no longer exists (data changed): go to the last one
          return loadInternships();
        }
        if (items.length === 0) {
          showView('empty');
          els.summary.textContent = 'No internships found.';
          return;
        }

        renderCards(items);
        renderPagination(pagination);
        showView('results');
        els.pagination.hidden = pagination.totalPages <= 1;
        var first = (pagination.page - 1) * pagination.limit + 1;
        var last = first + items.length - 1;
        els.summary.textContent = 'Showing ' + first + '–' + last + ' of ' + pagination.total +
          (pagination.total === 1 ? ' internship' : ' internships');
      },
      function (error) {
        if (requestId !== latestListRequest) return;
        els.errorText.textContent = error.message;
        showView('error');
        els.summary.textContent = '';
      }
    );
  }

  function loadDomainOptions() {
    return apiRequest('/internships?limit=100').then(function (payload) {
      var seen = {};
      payload.data.forEach(function (item) { seen[item.domain] = true; });
      Object.keys(seen).sort(function (a, b) { return a.localeCompare(b); }).forEach(function (name) {
        var option = make('option', '', name);
        option.value = name;
        els.domain.appendChild(option);
      });
    }).catch(function () {
      // The list request reports connection problems, so nothing to do here.
    });
  }

  function applyFilters() {
    state.search = els.search.value.trim();
    state.domain = els.domain.value;
    state.mode = els.mode.value;
    state.page = 1;
    loadInternships();
  }

  function clearFilters() {
    els.search.value = '';
    els.domain.value = '';
    els.mode.value = '';
    applyFilters();
    els.search.focus();
  }

  function changePage(delta, button) {
    if (button.getAttribute('aria-disabled') === 'true') return;
    var target = state.page + delta;
    if (target < 1 || target > totalPages) return;
    state.page = target;
    loadInternships();
  }

  // ---------- Details dialog ----------

  function showDialogView(view) {
    els.dialogLoading.hidden = view !== 'loading';
    els.dialogError.hidden = view !== 'error';
    els.dialogContent.hidden = view !== 'content';
  }

  // Each form field with its error element and the key the API uses for it.
  function formFields() {
    return [
      { key: 'applicant_name', input: els.nameInput, error: els.nameError },
      { key: 'applicant_email', input: els.emailInput, error: els.emailError },
      { key: 'resume_url', input: els.resumeInput, error: els.resumeError },
      { key: 'cover_letter', input: els.letterInput, error: els.letterError }
    ];
  }

  function clearApplyMessages() {
    formFields().forEach(function (field) {
      field.error.textContent = '';
      field.input.removeAttribute('aria-invalid');
    });
    els.applyProgress.textContent = '';
    els.applyError.textContent = '';
    els.applySuccess.textContent = '';
  }

  function updateLetterCount() {
    els.letterCount.textContent = String(els.letterInput.value.length);
  }

  function fillDetails(item) {
    els.dialogTitle.textContent = item.title;
    els.detailDomain.textContent = item.domain;
    els.detailMode.textContent = item.mode;
    els.detailLocation.textContent = item.location;
    els.detailOpenings.textContent = openingsText(item.openings);
    els.detailSkills.textContent = '';
    item.skills.forEach(function (skill) { els.detailSkills.appendChild(make('li', '', skill)); });

    els.applyTarget.textContent = 'Applying for: ' + item.title + ' (' + item.id + ')';
    var open = item.openings > 0;
    els.noOpenings.hidden = open;
    els.applyForm.hidden = !open;
  }

  function loadDetails() {
    var id = currentInternshipId;
    showDialogView('loading');
    apiRequest('/internships/' + encodeURIComponent(id)).then(
      function (payload) {
        if (id !== currentInternshipId) return;
        fillDetails(payload.data);
        showDialogView('content');
      },
      function (error) {
        if (id !== currentInternshipId) return;
        els.dialogErrorText.textContent = error.message;
        showDialogView('error');
      }
    );
  }

  function openDetails(id, trigger) {
    lastTrigger = trigger;
    currentInternshipId = id;
    els.dialogTitle.textContent = 'Internship details';
    els.applyForm.reset();
    updateLetterCount();
    clearApplyMessages();
    if (!els.dialog.open) els.dialog.showModal(); // modal <dialog>: traps focus, Esc closes it
    loadDetails();
  }

  function closeDialog() {
    if (els.dialog.open) els.dialog.close();
  }

  // ---------- Application form ----------

  // Shows field-specific messages next to the fields and moves focus to the first problem.
  // Returns true when at least one message was shown.
  function showFieldErrors(problems) {
    var firstInvalid = null;
    formFields().forEach(function (field) {
      if (problems[field.key]) {
        field.error.textContent = problems[field.key];
        field.input.setAttribute('aria-invalid', 'true');
        firstInvalid = firstInvalid || field.input;
      }
    });
    if (firstInvalid) firstInvalid.focus();
    return Boolean(firstInvalid);
  }

  // Quick checks for the user's benefit. The server repeats every check and is the real gatekeeper.
  function checkApplication(values) {
    var problems = {};
    if (!values.name) problems.applicant_name = 'Enter your full name.';
    else if (values.name.length < 2) problems.applicant_name = 'Your name must be at least 2 characters.';

    if (!values.email) problems.applicant_email = 'Enter your email address.';
    else if (!/^\S+@\S+\.\S+$/.test(values.email)) problems.applicant_email = 'Enter a valid email address, like name@example.com.';

    if (!values.resume) {
      problems.resume_url = 'Enter a link to your resume.';
    } else {
      var url = null;
      try { url = new URL(values.resume); } catch (e) { url = null; }
      if (!url) problems.resume_url = 'Enter a full link, like https://example.com/resume.pdf.';
      else if (url.protocol !== 'http:' && url.protocol !== 'https:') problems.resume_url = 'The link must start with http:// or https://.';
    }

    if (values.letter.length > COVER_LETTER_MAX) problems.cover_letter = 'The cover letter must be at most ' + COVER_LETTER_MAX + ' characters.';
    return problems;
  }

  // Turns an API failure into one clear message for the person using the form.
  function messageForFailure(error) {
    if (error.httpStatus === 409) return 'You have already applied for this internship with this email address.';
    if (error.httpStatus === 429) return 'Too many applications were sent from your connection. Please wait a few minutes and try again.';
    if (error.httpStatus === 404) return 'This internship is no longer available. Close this window and refresh the list.';
    if (error.code === 'NETWORK_ERROR') return error.message;
    if (error.httpStatus >= 500) return 'The server had a problem and your application was not saved. Please try again in a moment.';
    return error.message;
  }

  var submitting = false;

  function submitApplication(event) {
    event.preventDefault();
    if (submitting) return; // a request is already on its way
    clearApplyMessages();

    var values = {
      name: els.nameInput.value.trim(),
      email: els.emailInput.value.trim(),
      resume: els.resumeInput.value.trim(),
      letter: els.letterInput.value.trim()
    };
    var problems = checkApplication(values);
    if (Object.keys(problems).length > 0) {
      showFieldErrors(problems);
      els.applyError.textContent = 'Please correct the highlighted fields.';
      return;
    }

    submitting = true;
    els.applySubmit.disabled = true;
    els.applyForm.setAttribute('aria-busy', 'true');
    els.applyProgress.textContent = 'Submitting your application…';

    apiRequest('/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        internship_id: currentInternshipId,
        applicant_name: values.name,
        applicant_email: values.email,
        resume_url: values.resume,
        cover_letter: values.letter
      })
    }).then(
      function () {
        els.applyProgress.textContent = '';
        els.applyForm.reset();
        updateLetterCount();
        els.applySuccess.textContent = 'Application submitted. Thank you for applying.';
        els.applySuccess.focus();
      },
      function (error) {
        els.applyProgress.textContent = '';
        // Entered values are kept so the person can fix the problem and send again.
        if (error.httpStatus === 400 && showFieldErrors(error.fields || {})) {
          els.applyError.textContent = 'Please correct the highlighted fields.';
        } else {
          els.applyError.textContent = messageForFailure(error);
        }
      }
    ).then(function () {
      submitting = false;
      els.applySubmit.disabled = false;
      els.applyForm.removeAttribute('aria-busy');
    });
  }

  // ---------- Wire up events ----------

  els.form.addEventListener('submit', function (event) { event.preventDefault(); applyFilters(); });
  els.domain.addEventListener('change', applyFilters);
  els.mode.addEventListener('change', applyFilters);
  els.clear.addEventListener('click', clearFilters);
  els.emptyClear.addEventListener('click', clearFilters);
  els.retry.addEventListener('click', loadInternships);
  els.prev.addEventListener('click', function () { changePage(-1, els.prev); });
  els.next.addEventListener('click', function () { changePage(1, els.next); });

  els.dialogClose.addEventListener('click', closeDialog);
  els.dialogRetry.addEventListener('click', loadDetails);
  els.applyForm.addEventListener('submit', submitApplication);
  els.letterInput.addEventListener('input', updateLetterCount);
  // Clicking the dark area outside the dialog box closes it.
  els.dialog.addEventListener('click', function (event) { if (event.target === els.dialog) closeDialog(); });
  // Return keyboard focus to the "View details" button that opened the dialog.
  els.dialog.addEventListener('close', function () {
    currentInternshipId = null;
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
  });

  loadDomainOptions();
  loadInternships();
})();
