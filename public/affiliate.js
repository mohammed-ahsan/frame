'use strict';

const state = {
  sourceFileId: null,
  generation: null,
  availablePaisa: 0,
  editingSubmissionId: null,
  affiliateData: null,
  isAndroidApp: Boolean(window.FrameflowAndroid?.isAffiliateApp?.()),
};
const $ = (selector) => document.querySelector(selector);

async function api(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) { location.assign('/login'); throw new Error('Sign in required'); }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || 'Something went wrong.');
    error.code = body.code;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function updateGenerate() {
  $('#generate-affiliate').disabled = !(state.sourceFileId && $('#style-name').value.trim().length >= 2 && $('#style-prompt').value.trim().length >= 20);
}

function clearGeneratedResult(message = '') {
  state.generation = null;
  $('#generated-preview').removeAttribute('src');
  $('#generated-result').hidden = true;
  $('#submission-status').textContent = message;
}

function renderSubmissions(submissions) {
  const container = $('#affiliate-submissions');
  if (!submissions.length) {
    const empty = document.createElement('p'); empty.className = 'empty-gallery'; empty.textContent = 'Your submissions will appear here.';
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(...submissions.map((submission) => {
    const card = document.createElement('article'); card.className = 'affiliate-submission';
    const image = document.createElement('img'); image.src = submission.imageUrl; image.alt = `Submitted ${submission.styleName} style`;
    const content = document.createElement('div');
    const heading = document.createElement('div'); heading.className = 'affiliate-submission-heading';
    const title = document.createElement('h3'); title.textContent = submission.styleName;
    const badge = document.createElement('span'); badge.className = `task-status task-status-${submission.status}`; badge.textContent = submission.status === 'feedback' ? 'Feedback requested' : submission.status === 'rejected' ? 'Not approved' : submission.status === 'approved' ? 'Approved · ৳50' : 'Under review';
    heading.append(title, badge);
    const prompt = document.createElement('p'); prompt.className = 'submission-prompt'; prompt.textContent = submission.prompt;
    const submitted = document.createElement('small'); submitted.textContent = submission.status === 'pending'
      ? `Submitted ${new Date(submission.createdAt).toLocaleString()} · feedback expected within about 2 hours`
      : `Submitted ${new Date(submission.createdAt).toLocaleString()}`;
    const progress = document.createElement('ol');
    progress.className = `submission-progress submission-progress-${submission.status}`;
    progress.setAttribute('aria-label', `Submission progress: generated, submitted, ${submission.status === 'feedback' ? 'feedback requested' : submission.status === 'approved' ? 'approved' : submission.status === 'rejected' ? 'not approved' : 'under review'}`);
    const reviewLabel = submission.status === 'feedback' ? 'Feedback requested'
      : submission.status === 'approved' ? 'Approved'
        : submission.status === 'rejected' ? 'Not approved'
          : 'Under review';
    const progressLabels = ['Generated', 'Submitted', reviewLabel];
    progressLabels.forEach((label, index) => {
      const step = document.createElement('li');
      step.className = index < 2 ? 'complete' : submission.status === 'pending' || submission.status === 'feedback' ? 'current' : 'complete';
      const marker = document.createElement('span'); marker.className = 'submission-progress-marker';
      marker.setAttribute('aria-hidden', 'true');
      marker.textContent = step.classList.contains('complete') ? '✓' : String(index + 1);
      const text = document.createElement('span'); text.className = 'submission-progress-label'; text.textContent = label;
      step.append(marker, text);
      progress.append(step);
    });
    content.append(heading, progress, prompt, submitted);
    if (submission.feedback) {
      const feedback = document.createElement('p'); feedback.className = 'submission-feedback'; feedback.textContent = `Dashboard feedback: ${submission.feedback}`;
      content.append(feedback);
    }
    if (submission.status === 'feedback') {
      const revise = document.createElement('button'); revise.type = 'button'; revise.className = 'button button-primary'; revise.textContent = 'Edit and resubmit';
      revise.addEventListener('click', () => {
        state.editingSubmissionId = submission.id;
        state.sourceFileId = submission.sourceFileId;
        state.generation = null;
        $('#style-name').value = submission.styleName;
        $('#style-prompt').value = submission.prompt;
        $('#source-preview').src = submission.sourceImageUrl;
        $('#source-preview').hidden = false;
        $('#dropzone').classList.add('has-image');
        $('#generation-status').textContent = 'Revise the prompt based on dashboard feedback, then generate a fresh image.';
        $('#generate-affiliate').textContent = 'Generate revised image';
        $('#submit-affiliate').textContent = 'Resubmit revised work · ৳50';
        $('#cancel-revision').hidden = false;
        clearGeneratedResult();
        updateGenerate();
        document.querySelector('.affiliate-creator').scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('#style-name').focus({ preventScroll: true });
      });
      content.append(revise);
    }
    card.append(image, content);
    return card;
  }));
}

function renderAffiliate(data) {
  state.affiliateData = data;
  $('#affiliate-username').textContent = data.username;
  $('#web-generation-count').textContent = `Web ${data.webGenerationsUsed} / ${data.webGenerationLimit}`;
  $('#app-generation-count').textContent = `Android app ${data.appGenerationsUsed} / ${data.appGenerationLimit} · separate daily allowance`;
  $('#android-app-offer').hidden = state.isAndroidApp || data.webGenerationsUsed < data.webGenerationLimit;
  $('#earning-balance').textContent = `৳${(data.balancePaisa / 100).toLocaleString('en-BD')}`;
  $('#header-approved-balance').textContent = `৳${(data.balancePaisa / 100).toLocaleString('en-BD')}`;
  $('#available-balance').textContent = `৳${(data.availablePaisa / 100).toLocaleString('en-BD')} available`;
  state.availablePaisa = data.availablePaisa;
  updatePayoutForm();
  $('#payout-history').replaceChildren(...data.withdrawals.map((item) => {
    const row = document.createElement('p');
    row.textContent = `৳${(item.amountPaisa / 100).toLocaleString('en-BD')} · ${item.status} · ${new Date(item.createdAt).toLocaleDateString()}`;
    return row;
  }));
  renderSubmissions(data.submissions);
}

function updatePayoutForm() {
  const data = state.affiliateData;
  const numberInput = $('#bkash-number');
  const payoutButton = $('#request-payout');
  const hasActiveWithdrawal = Boolean(data.activeWithdrawal);
  const invalidNumber = !numberInput.checkValidity();
  payoutButton.disabled = hasActiveWithdrawal || invalidNumber;
  const activeStatus = $('#payout-status');
  activeStatus.hidden = !hasActiveWithdrawal;
  activeStatus.textContent = hasActiveWithdrawal
    ? 'A withdrawal is already requested. It will be disbursed within 2 hours; wait until it is completed before requesting another.'
    : '';
  const canWithdraw = data.availablePaisa >= data.minimumPayoutPaisa && !hasActiveWithdrawal;
  $('#confirm-payout').hidden = !canWithdraw;
  $('#withdrawal-guide-status').textContent = canWithdraw
    ? 'Your balance is eligible. Confirm below to submit the request.'
    : hasActiveWithdrawal
      ? 'Your current request is being processed; no further action is needed.'
      : 'Keep submitting styles for approval. You can confirm a withdrawal request once your available earnings reach ৳1,500.';
}

async function refresh() {
  renderAffiliate(await api('/api/affiliate'));
}

async function uploadFile(file) {
  if (!file) return;
  $('#generation-status').textContent = 'Preparing your photo…';
  clearGeneratedResult('Choose a new photo, then generate again.');
  const form = new FormData(); form.append('image', file);
  try {
    const { media } = await api('/api/media', { method: 'POST', body: form });
    state.sourceFileId = media.id;
    $('#source-preview').src = media.contentUrl;
    $('#source-preview').hidden = false;
    $('#dropzone').classList.add('has-image');
    $('#generation-status').textContent = state.editingSubmissionId
      ? 'New source photo ready. Generate a replacement image for this revision.'
      : 'Photo ready. Describe your style.';
    $('#generate-affiliate').textContent = state.editingSubmissionId ? 'Generate revised image' : 'Generate image';
    $('#submit-affiliate').textContent = state.editingSubmissionId ? 'Resubmit revised work · ৳50' : 'Submit for review · ৳50';
    updateGenerate();
  } catch (error) { $('#generation-status').textContent = error.message; }
}

for (const eventName of ['dragenter', 'dragover']) $('#dropzone').addEventListener(eventName, (event) => {
  event.preventDefault(); $('#dropzone').classList.add('dragging');
});
for (const eventName of ['dragleave', 'drop']) $('#dropzone').addEventListener(eventName, (event) => {
  event.preventDefault(); $('#dropzone').classList.remove('dragging');
});
$('#dropzone').addEventListener('drop', (event) => uploadFile(event.dataTransfer.files[0]));
$('#file-input').addEventListener('change', (event) => uploadFile(event.target.files[0]));

for (const input of [$('#style-name'), $('#style-prompt')]) input.addEventListener('input', () => {
  if (state.generation) {
    clearGeneratedResult('Your prompt changed. Generate a fresh image before submitting.');
    $('#generation-status').textContent = 'Prompt updated. The previous image was cleared; generate a new match.';
  }
  updateGenerate();
});

$('#generate-affiliate').addEventListener('click', async () => {
  const button = $('#generate-affiliate'); button.disabled = true;
  $('#generation-status').textContent = 'Generating your style…';
  clearGeneratedResult();
  try {
    const result = await api('/api/affiliate/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(state.isAndroidApp ? { 'X-Frameflow-Client': 'android-affiliates' } : {}),
      },
      body: JSON.stringify({ sourceFileId: state.sourceFileId, styleName: $('#style-name').value.trim(), prompt: $('#style-prompt').value.trim() }),
    });
    state.generation = result.generation;
    if (result.channel === 'android') {
      $('#app-generation-count').textContent = `Android app ${result.generationsUsed} / ${result.generationLimit} · separate daily allowance`;
    } else {
      $('#web-generation-count').textContent = `Web ${result.generationsUsed} / ${result.generationLimit}`;
      $('#android-app-offer').hidden = state.isAndroidApp || result.generationsUsed < result.generationLimit;
    }
    $('#generated-preview').src = result.generation.image.contentUrl;
    $('#generated-result').hidden = false;
    $('#generation-status').textContent = `${result.generationLimit - result.generationsUsed} generations left today.`;
    $('#generated-result').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    $('#generation-status').textContent = error.message;
    if (error.code === 'AFFILIATE_DAILY_LIMIT_REACHED' && state.affiliateData?.appBonusEnabled) {
      $('#android-app-offer').hidden = false;
      $('#android-app-offer').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    try { await refresh(); }
    catch (refreshError) { $('#generation-status').textContent = `${error.message} ${refreshError.message}`; }
  } finally { updateGenerate(); }
});

$('#submit-affiliate').addEventListener('click', async () => {
  if (!state.generation) return;
  const confirmed = window.confirm('Submit this image and its matching style name and prompt for review? This image will be locked to the prompt you generated with.');
  if (!confirmed) return;
  const button = $('#submit-affiliate'); button.disabled = true;
  $('#submission-status').textContent = 'Submitting for review…';
  try {
    const editing = Boolean(state.editingSubmissionId);
    await api(editing ? `/api/affiliate/submissions/${state.editingSubmissionId}` : '/api/affiliate/submissions', {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generationId: state.generation.id }),
    });
    state.editingSubmissionId = null;
    $('#submit-affiliate').textContent = 'Submit for review · ৳50';
    $('#generate-affiliate').textContent = 'Generate image';
    $('#cancel-revision').hidden = true;
    clearGeneratedResult('Submitted. Feedback is expected within about 2 hours.');
    $('#generation-status').textContent = 'Submission sent for review.';
    await refresh();
  } catch (error) {
    $('#submission-status').textContent = error.message;
  } finally { button.disabled = false; }
});

$('#cancel-revision').addEventListener('click', () => {
  state.editingSubmissionId = null;
  state.sourceFileId = null;
  $('#style-name').value = '';
  $('#style-prompt').value = '';
  $('#file-input').value = '';
  $('#source-preview').removeAttribute('src');
  $('#source-preview').hidden = true;
  $('#dropzone').classList.remove('has-image');
  $('#generate-affiliate').textContent = 'Generate image';
  $('#submit-affiliate').textContent = 'Submit for review · ৳50';
  $('#cancel-revision').hidden = true;
  $('#generation-status').textContent = 'Revision cancelled. Your original submission and feedback are unchanged.';
  clearGeneratedResult();
  updateGenerate();
});

$('#payout-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if ($('#request-payout').disabled || !state.affiliateData) return;
  $('#withdrawal-guide').hidden = false;
  $('#withdrawal-guide').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

$('#close-withdrawal-guide').addEventListener('click', () => {
  $('#withdrawal-guide').hidden = true;
});

$('#confirm-payout').addEventListener('click', async () => {
  const button = $('#confirm-payout');
  button.disabled = true;
  $('#withdrawal-guide-status').textContent = 'Submitting your withdrawal request…';
  try {
    await api('/api/payout-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bkashNumber: $('#bkash-number').value }),
    });
    $('#withdrawal-guide-status').textContent = 'Withdrawal requested. It will be disbursed within 2 hours.';
    await refresh();
  } catch (error) {
    try { await refresh(); } catch (refreshError) {
      $('#withdrawal-guide-status').textContent = `${error.message} Could not refresh withdrawal status: ${refreshError.message}`;
      return;
    }
    $('#withdrawal-guide-status').textContent = error.message;
    button.disabled = false;
  }
});

$('#bkash-number').addEventListener('input', () => {
  if (state.affiliateData) updatePayoutForm();
});

$('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.assign('/'); });
$('#footer-year').textContent = new Date().getFullYear();

refresh().catch((error) => {
  if (error.message.includes('Affiliate access is not enabled')) {
    document.querySelector('.affiliate-page').innerHTML = '<section class="studio-intro"><span class="kicker">Access required</span><h1>Affiliate access<br><em>not enabled.</em></h1><p>Ask the Frameflow team to add your username, then come back to this page.</p><a class="button button-dark" href="/app">Back to studio</a></section>';
    return;
  }
  $('#generation-status').textContent = error.message;
});
