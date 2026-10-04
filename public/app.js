const $ = id => document.getElementById(id);
const parameterNames = ['speedScale', 'pitchScale', 'intonationScale', 'volumeScale', 'prePhonemeLength', 'postPhonemeLength'];
let presets = [];
let audioUrl;

function selectedPreset() { return presets.find(preset => preset.id === $('preset').value); }
function showMessage(message) { $('message').textContent = message; }

function setParameters(preset) {
  $('parameterPanel').hidden = !preset;
  $('saveAsPreset').hidden = !preset;
  if (!preset) return;
  for (const name of parameterNames) {
    $(name).value = preset[name];
    $(`${name}Value`).textContent = Number(preset[name]).toFixed(2);
  }
}

function refreshPresetView() {
  const preset = selectedPreset();
  $('credit').textContent = preset?.credit || 'クレジット表記は設定されていません。';
  $('terms').href = preset?.termsUrl || 'https://voicevox.hiroshiba.jp/term/';
  setParameters(preset);
}

function renderPresets(selectedId = '') {
  $('preset').replaceChildren(new Option('プリセットを選択', ''));
  for (const preset of presets) $('preset').add(new Option(preset.name, preset.id));
  $('preset').value = selectedId;
  refreshPresetView();
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `通信に失敗しました (${response.status})。`);
  return data;
}

async function init() {
  try {
    const [presetData, health] = await Promise.all([
      api('/api/presets'),
      api('/api/health').catch(error => ({ ready: false, error: error.message })),
    ]);
    presets = presetData.presets;
    renderPresets();
    if (!presets.length) {
      $('preset').replaceChildren(new Option('利用できるプリセットがありません', ''));
      $('generate').disabled = true;
      showMessage('「プリセット設定」から利用するプリセットを設定してください。');
    } else if (!health.ready) {
      showMessage(health.error);
    }
  } catch (error) {
    $('preset').replaceChildren(new Option('読み込みに失敗しました', ''));
    $('generate').disabled = true;
    showMessage(error.message);
  }
}

$('preset').addEventListener('change', () => {
  refreshPresetView();
  showMessage('');
});

for (const name of parameterNames) {
  $(name).addEventListener('input', () => { $(`${name}Value`).textContent = Number($(name).value).toFixed(2); });
}

$('resetParameters').addEventListener('click', () => setParameters(selectedPreset()));
$('text').addEventListener('input', () => { $('count').textContent = `${[...$('text').value].length} / 500`; });

$('form').addEventListener('submit', async event => {
  event.preventDefault();
  showMessage('');
  const text = $('text').value.trim();
  if (!text || [...text].length > 500) { showMessage('文章は1〜500文字で入力してください。'); return; }
  const preset = selectedPreset();
  if (!preset) { showMessage('プリセットを選択してください。'); return; }

  $('generate').disabled = true;
  $('generate').textContent = '生成中...';
  try {
    const parameters = Object.fromEntries(parameterNames.map(name => [name, Number($(name).value)]));
    const response = await fetch('/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, presetId: preset.id, parameters }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `音声を生成できませんでした (${response.status})。`);
    }
    const blob = await response.blob();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(blob);
    $('player').src = audioUrl;
    $('download').href = audioUrl;
    $('download').download = `voice-${Date.now()}.wav`;
    $('result').hidden = false;
    showMessage('音声を生成しました。再生またはWAV保存ができます。');
  } catch (error) { showMessage(error.message || '音声を生成できませんでした。'); }
  finally {
    $('generate').disabled = false;
    $('generate').textContent = '音声を生成';
  }
});

$('saveAsPreset').addEventListener('click', () => {
  $('savePresetMessage').textContent = '';
  $('newPresetName').value = '';
  $('saveDialog').showModal();
  $('newPresetName').focus();
});

$('cancelSave').addEventListener('click', () => $('saveDialog').close());
$('savePresetForm').addEventListener('submit', async event => {
  event.preventDefault();
  const source = selectedPreset();
  if (!source) return;
  const preset = {
    id: `local-${crypto.randomUUID().replaceAll('-', '')}`,
    name: $('newPresetName').value.trim(),
    enabled: true,
    styleId: source.styleId,
    credit: source.credit,
    termsUrl: source.termsUrl,
  };
  for (const name of parameterNames) preset[name] = Number($(name).value);
  const save = $('savePresetForm').querySelector('button[type="submit"]');
  save.disabled = true;
  $('savePresetMessage').textContent = '保存中...';
  try {
    await api('/api/admin/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preset),
    });
    presets.push(preset);
    renderPresets(preset.id);
    $('saveDialog').close();
    showMessage(`「${preset.name}」をこのPCのプリセットに保存しました。`);
  } catch (error) { $('savePresetMessage').textContent = error.message; }
  finally { save.disabled = false; }
});

init();
