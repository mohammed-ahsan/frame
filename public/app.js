'use strict';

const state = { me: null, sourceFileId: null, presetId: null, presentation: 'female', referralUrl: '' };
const $ = (selector) => document.querySelector(selector);

async function api(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) { location.assign('/login'); throw new Error('Sign in required'); }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Something went wrong.');
  }
  return response.status === 204 ? null : response.json();
}

function setStatus(message, tone = '') {
  $('#status').textContent = message;
  $('#status').dataset.tone = tone;
  $('#scroll-recent').hidden = true;
}

function updateGenerate() {
  $('#generate').disabled = !(state.sourceFileId && state.presetId);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderMe(me) {
  state.me = me; state.referralUrl = me.referralUrl;
  $('#remaining').textContent = me.quota.remaining;
  $('#affiliate-link').hidden = !me.isAffiliate;
  $('#usage-detail').textContent = `${me.quota.used} / ${me.quota.hourlyLimit}`;
  $('#file-detail').textContent = `${me.files.used} / ${me.files.limit}`;
  $('#storage-detail').textContent = `${formatBytes(me.storage.usedBytes)} / ${formatBytes(me.storage.limitBytes)}`;
}

function renderPresets(presets) {
  const grid = $('#preset-grid');
  grid.replaceChildren(...presets.map((preset, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'preset'; button.dataset.id = preset.id;
    button.style.setProperty('--preview-x', `${(index % 5) * 25}%`);
    button.style.setProperty('--preview-y', `${Math.floor(index / 5) * (100 / 3)}%`);
    button.innerHTML = `<i></i><span>${String(preset.order).padStart(2, '0')}</span><strong>${preset.name}</strong>`;
    button.addEventListener('click', () => {
      grid.querySelectorAll('.preset').forEach((item) => item.classList.toggle('selected', item === button));
      state.presetId = preset.id; updateGenerate(); setStatus(`${preset.name} selected. Ready when you are.`);
    });
    return button;
  }));
}

async function uploadFile(file) {
  if (!file) return;
  setStatus('Preparing your photo…');
  const form = new FormData(); form.append('image', file);
  try {
    const { media } = await api('/api/media', { method: 'POST', body: form });
    state.sourceFileId = media.id;
    $('#source-preview').src = media.contentUrl; $('#source-preview').hidden = false;
    $('#dropzone').classList.add('has-image');
    setStatus('Photo ready. Now choose a look.', 'success'); updateGenerate(); await refresh();
  } catch (error) { setStatus(error.message, 'error'); }
}

function renderGallery(files) {
  const gallery = $('#gallery');
  if (!files.length) { gallery.innerHTML = '<div class="empty-gallery">Your creations will land here.</div>'; return; }
  gallery.replaceChildren(...files.map((file) => {
    const item = document.createElement('article'); item.className = 'gallery-item';
    item.innerHTML = `<button class="share-instagram" type="button" aria-label="Share image to Instagram" title="Share to Instagram"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.25"/><circle class="instagram-dot" cx="17.4" cy="6.7" r="1"/></svg></button><button class="download-image" type="button" aria-label="Download image" title="Download image"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14"/></svg></button><img src="${file.contentUrl}" alt="Your ${file.source === 'generation' ? 'generated' : 'uploaded'} image"><div><span>${file.source === 'generation' ? 'Created' : 'Upload'}</span><button class="delete-image" type="button" aria-label="Delete image">Delete</button></div>`;
    item.querySelector('.share-instagram').addEventListener('click', (event) => shareImage(file, event.currentTarget));
    item.querySelector('.download-image').addEventListener('click', (event) => downloadImage(file, event.currentTarget));
    item.querySelector('.delete-image').addEventListener('click', async () => { await api(`/api/media/${file.id}`, { method: 'DELETE' }); await refresh(); });
    return item;
  }));
}

async function downloadImage(file, button) {
  button.disabled = true;
  try {
    const response = await fetch(file.contentUrl);
    if (response.status === 401) { location.assign('/login'); return; }
    if (!response.ok) throw new Error('Could not download this image.');
    const blob = await response.blob();
    const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'webp';
    saveBlob(blob, `frameflow-${file.source === 'generation' ? 'frame' : 'upload'}-${file.id.slice(-8)}.${extension}`);
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function shareImage(file, button) {
  button.disabled = true;
  try {
    const response = await fetch(`/api/media/${file.id}/share`);
    if (response.status === 401) { location.assign('/login'); return; }
    if (!response.ok) throw new Error('Could not prepare this image for sharing.');
    const blob = await response.blob();
    const filename = `frameflow-${file.source === 'generation' ? 'frame' : 'upload'}-${file.id.slice(-8)}.jpg`;
    const sharedFile = new File([blob], filename, { type: 'image/jpeg' });
    if (navigator.share && navigator.canShare?.({ files: [sharedFile] })) {
      await navigator.share({ files: [sharedFile], title: 'Frameflow image', text: 'Made with Frameflow' });
      setStatus('Image opened in your phone’s share sheet.', 'success');
    } else {
      saveBlob(blob, filename);
      setStatus('Sharing is not supported here. The image was downloaded—open Instagram to post it.', 'success');
    }
  } catch (error) {
    if (error.name !== 'AbortError') setStatus(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function saveBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function refresh() {
  const [me, media] = await Promise.all([api('/api/me'), api('/api/media')]);
  renderMe(me); renderGallery(media.files);
}

$('#file-input').addEventListener('change', (event) => uploadFile(event.target.files[0]));
for (const eventName of ['dragenter', 'dragover']) $('#dropzone').addEventListener(eventName, (event) => { event.preventDefault(); $('#dropzone').classList.add('dragging'); });
for (const eventName of ['dragleave', 'drop']) $('#dropzone').addEventListener(eventName, (event) => { event.preventDefault(); $('#dropzone').classList.remove('dragging'); });
$('#dropzone').addEventListener('drop', (event) => uploadFile(event.dataTransfer.files[0]));
document.querySelectorAll('.style-toggle button').forEach((button) => button.addEventListener('click', () => {
  state.presentation = button.dataset.presentation;
  document.querySelectorAll('.style-toggle button').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  $('#preset-grid').dataset.presentation = state.presentation;
  setStatus(`${state.presentation === 'male' ? 'Male' : 'Female'} style previews selected.`);
}));
$('#generate').addEventListener('click', async () => {
  const button = $('#generate'); button.disabled = true; setStatus('Creating your look… this can take a moment.');
  try {
    await api('/api/generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceFileId: state.sourceFileId, presetId: state.presetId, presentation: state.presentation }) });
    setStatus('Your new frame is ready.', 'success'); await refresh();
    $('#scroll-recent').hidden = false;
  } catch (error) { setStatus(error.message, 'error'); }
  finally { updateGenerate(); }
});
$('#copy-referral').addEventListener('click', async () => { await navigator.clipboard.writeText(state.referralUrl); $('#copy-referral').textContent = 'Copied!'; setTimeout(() => { $('#copy-referral').textContent = 'Copy invite link'; }, 1400); });
$('#scroll-recent').addEventListener('click', () => $('#recent-frames').scrollIntoView({ behavior: 'smooth', block: 'start' }));
$('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.assign('/'); });

$('#footer-year').textContent = new Date().getFullYear();

api('/api/presets')
  .then((data) => renderPresets(data.presets))
  .catch((error) => setStatus(`Could not load styles: ${error.message}`, 'error'));

refresh().catch((error) => setStatus(error.message, 'error'));
