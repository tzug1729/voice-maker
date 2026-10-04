const $ = id => document.getElementById(id);
let presets = [];
let audioUrl;
const parameterNames = ['speedScale', 'pitchScale', 'intonationScale', 'volumeScale', 'prePhonemeLength', 'postPhonemeLength'];

function showError(message) { $('message').textContent = message; }
function setParameters(preset) {
  $('parameterPanel').hidden = !preset;
  if (!preset) return;
  for (const name of parameterNames) {
    $(name).value = preset[name];
    $(`${name}Value`).textContent = Number(preset[name]).toFixed(2);
  }
}
function refreshCredit() {
  const preset = presets.find(item => item.id === $('preset').value);
  $('credit').textContent = preset?.credit || '声を選ぶと、必要なクレジットが表示されます。';
  $('terms').href = preset?.termsUrl || 'https://voicevox.hiroshiba.jp/term/';
  setParameters(preset);
}

async function init() {
  try {
    const [presetResponse, healthResponse] = await Promise.all([fetch('/api/presets'), fetch('/api/health')]);
    const data = await presetResponse.json();
    if (!presetResponse.ok) throw new Error(data.error || 'プリセットを読み込めませんでした。');
    presets = data.presets;
    $('preset').replaceChildren(new Option('声を選んでください', ''));
    for (const preset of presets) $('preset').add(new Option(preset.name, preset.id));
    if (!presets.length) {
      $('preset').add(new Option('利用できるプリセットがありません', ''));
      $('generate').disabled = true;
      showError('「プリセット設定」からVOICEVOXの話者と設定値を保存してください。');
    } else {
      $('generate').disabled = false;
      const health = await healthResponse.json();
      if (!health.ready) showError(health.error);
    }
    refreshCredit();
  } catch (err) {
    $('preset').replaceChildren(new Option('読み込みに失敗しました', ''));
    showError(err.message);
  }
}

$('preset').addEventListener('change', refreshCredit);
for (const name of parameterNames) {
  $(name).addEventListener('input', () => { $(`${name}Value`).textContent = Number($(name).value).toFixed(2); });
}
$('resetParameters').addEventListener('click', () => {
  setParameters(presets.find(item => item.id === $('preset').value));
});
$('text').addEventListener('input', () => { $('count').textContent = `${[...$('text').value].length} / 500`; });
$('form').addEventListener('submit', async event => {
  event.preventDefault();
  showError('');
  const text = $('text').value.trim();
  if (!text || [...text].length > 500) { showError('文章は1〜500文字で入力してください。'); return; }
  if (!$('preset').value) { showError('プリセットを選んでください。'); return; }
  $('generate').disabled = true;
  $('generate').textContent = '音声を生成中...';
  try {
    const response = await fetch('/api/synthesize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        presetId: $('preset').value,
        parameters: Object.fromEntries(parameterNames.map(name => [name, Number($(name).value)])),
      }),
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
    showError('音声ができました。再生または保存できます。');
  } catch (err) { showError(err.message || '音声を生成できませんでした。'); }
  finally {
    $('generate').disabled = false;
    $('generate').innerHTML = '音声をつくる <span aria-hidden="true">↗</span>';
  }
});

init();
