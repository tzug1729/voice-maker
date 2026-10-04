const $ = id => document.getElementById(id);
const numeric = ['speedScale', 'pitchScale', 'intonationScale', 'volumeScale', 'prePhonemeLength', 'postPhonemeLength'];
let presets = [];
let styles = [];
let currentId = 'hina';
let creating = false;

function status(message) { $('status').textContent = message; }
function setForm(preset) {
  creating = false;
  currentId = preset.id;
  $('name').value = preset.id === 'hina' ? 'ヒナ' : preset.name;
  $('name').disabled = preset.id === 'hina';
  $('style').value = preset.styleId == null ? '' : String(preset.styleId);
  for (const key of numeric) $(key).value = preset[key] ?? '';
  $('creditInput').value = preset.credit || '';
  $('termsUrl').value = preset.termsUrl || '';
  $('enabled').checked = !!preset.enabled;
  $('deletePreset').hidden = preset.id === 'hina';
  $('settings').hidden = false;
}

function resetForm() {
  creating = true;
  currentId = `custom-${crypto.randomUUID()}`;
  $('name').disabled = false;
  $('name').value = '';
  $('style').value = '';
  for (const key of numeric) $(key).value = key === 'pitchScale' ? '0' : key === 'prePhonemeLength' || key === 'postPhonemeLength' ? '0.1' : '1';
  $('creditInput').value = '';
  $('termsUrl').value = '';
  $('enabled').checked = true;
  $('deletePreset').hidden = true;
  $('settings').hidden = false;
}

function renderPresets(selected = 'hina') {
  $('presetSelect').replaceChildren();
  for (const preset of presets) $('presetSelect').add(new Option(preset.name, preset.id));
  $('presetSelect').value = selected;
  const preset = presets.find(item => item.id === selected);
  if (preset) setForm(preset);
  else resetForm();
}

async function api(endpoint, method, body) {
  const response = await fetch(endpoint, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `通信に失敗しました (${response.status})。`);
  return data;
}

$('connect').addEventListener('click', async () => {
  status('VOICEVOXから話者一覧を読み込んでいます...');
  try {
    const [settings, voiceList] = await Promise.all([
      api('/api/admin/presets', 'GET'),
      api('/api/admin/speakers', 'GET'),
    ]);
    presets = settings.presets;
    styles = voiceList.speakers;
    $('style').replaceChildren(new Option('話者・スタイルを選択', ''));
    for (const voice of styles) $('style').add(new Option(`${voice.speaker} / ${voice.style}`, String(voice.id)));
    $('editor').hidden = false;
    renderPresets(presets.some(preset => preset.id === 'hina') ? 'hina' : presets[0]?.id);
    status('話者一覧を読み込みました。設定を入力して保存してください。');
  } catch (err) {
    $('editor').hidden = true;
    status(`${err.message} VOICEVOXデスクトップアプリを起動し、起動完了後に再度読み込んでください。`);
  }
});

$('presetSelect').addEventListener('change', () => {
  const preset = presets.find(item => item.id === $('presetSelect').value);
  if (preset) setForm(preset);
});
$('newPreset').addEventListener('click', resetForm);
$('exportDefaults').addEventListener('click', () => {
  const hina = presets.find(preset => preset.id === 'hina');
  if (!hina?.enabled || !Number.isInteger(hina.styleId)) {
    status('先にヒナの話者・設定値を保存し、「読み上げ画面の選択肢に表示する」を有効にしてください。');
    return;
  }
  const blob = new Blob([`${JSON.stringify(presets, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'presets.default.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('配布用プリセットを書き出しました。READMEの「配布用プリセットを更新する」手順に進んでください。');
});
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  status('保存中...');
  const body = {
    name: $('name').value.trim(),
    styleId: Number($('style').value),
    credit: $('creditInput').value.trim(),
    termsUrl: $('termsUrl').value.trim(),
    enabled: $('enabled').checked,
  };
  for (const key of numeric) body[key] = Number($(key).value);
  try {
    const endpoint = creating ? '/api/admin/presets' : `/api/admin/presets/${currentId}`;
    await api(endpoint, creating ? 'POST' : 'PUT', { ...body, id: currentId });
    const saved = { ...body, id: currentId };
    const index = presets.findIndex(preset => preset.id === currentId);
    if (index < 0) presets.push(saved); else presets[index] = saved;
    renderPresets(currentId);
    status('保存しました。読み上げ画面に反映されました。');
  } catch (err) { status(err.message); }
});
$('deletePreset').addEventListener('click', async () => {
  try {
    await api(`/api/admin/presets/${currentId}`, 'DELETE');
    presets = presets.filter(preset => preset.id !== currentId);
    renderPresets(presets.some(preset => preset.id === 'hina') ? 'hina' : presets[0]?.id);
    status('プリセットを削除しました。');
  } catch (err) { status(err.message); }
});
