const $ = id => document.getElementById(id);
const parameterNames = ['speedScale', 'pitchScale', 'intonationScale', 'volumeScale', 'prePhonemeLength', 'postPhonemeLength', 'pauseLengthScale'];
let presets = [];
let speakers = [];
let audioUrl;
let audioBlob;
let accentPhrases;
let analyzedText = '';
let analyzedStyleId;
let analysisVersion = 0;

function selectedPreset() { return presets.find(preset => preset.id === $('preset').value); }
function showMessage(message) { $('message').textContent = message; }
function clearAccentAnalysis() {
  analysisVersion++;
  accentPhrases = undefined;
  analyzedText = '';
  analyzedStyleId = undefined;
  $('accentPhrases').replaceChildren();
  $('accentMessage').textContent = '';
}
function setPresetText(preset) {
  $('text').value = preset?.defaultText ?? '';
  $('readingText').value = '';
  $('count').textContent = `${[...$('text').value].length} / 500`;
}

function setParameters(preset) {
  $('parameterPanel').hidden = !preset;
  $('accentPanel').hidden = !preset;
  $('saveAsPreset').hidden = !preset;
  $('saveAsPreset').disabled = !preset || !speakers.length;
  if (!preset) return;
  $('style').value = speakers.some(style => style.id === preset.styleId) ? String(preset.styleId) : '';
  for (const name of parameterNames) {
    $(name).value = preset[name] ?? (name === 'pauseLengthScale' ? 1 : 0);
    $(`${name}Value`).textContent = Number($(name).value).toFixed(2);
  }
  $('outputSamplingRate').value = String(preset.outputSamplingRate ?? 24000);
  $('pauseLength').value = preset.pauseLength ?? '';
  $('outputStereo').checked = preset.outputStereo ?? false;
  $('enableInterrogativeUpspeak').checked = preset.enableInterrogativeUpspeak ?? true;
}

function refreshCredit() {
  const preset = selectedPreset();
  const voice = speakers.find(style => String(style.id) === $('style').value);
  const changedVoice = voice && voice.id !== preset?.styleId;
  $('credit').textContent = changedVoice ? `VOICEVOX:${voice.speaker}`
    : preset?.credit || (voice ? `VOICEVOX:${voice.speaker}` : 'クレジット表記は設定されていません。');
  $('terms').href = !changedVoice && preset?.termsUrl ? preset.termsUrl : 'https://voicevox.hiroshiba.jp/term/';
}

function refreshPresetView() {
  const preset = selectedPreset();
  setParameters(preset);
  refreshCredit();
}

function renderSpeakers() {
  $('style').replaceChildren(new Option(speakers.length ? '話者・スタイルを選択' : 'VOICEVOXの話者を取得できません', ''));
  for (const voice of speakers) $('style').add(new Option(`${voice.speaker} / ${voice.style}`, String(voice.id)));
  $('style').disabled = !speakers.length;
}

function renderPresets(selectedId = '', updateText = true) {
  $('preset').replaceChildren(new Option('プリセットを選択', ''));
  for (const preset of presets) $('preset').add(new Option(preset.name, preset.id));
  $('preset').value = selectedId;
  refreshPresetView();
  if (updateText) setPresetText(selectedPreset());
}

function numberField(caption, value, update) {
  const label = document.createElement('label');
  label.textContent = caption;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = '10';
  input.step = 'any';
  input.value = String(value);
  input.addEventListener('change', () => {
    const next = Number(input.value);
    if (input.value && Number.isFinite(next) && next >= 0 && next <= 10) { update(next); value = next; }
    else input.value = String(value);
  });
  label.append(input);
  return label;
}

async function recalculatePhrase(phrase) {
  const data = await api('/api/mora-data', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presetId: selectedPreset().id, styleId: Number($('style').value), accentPhrase: phrase }) });
  return data.accentPhrase;
}

function renderAccentPhrases(openIndex = 0) {
  const container = $('accentPhrases');
  container.replaceChildren();
  for (const [phraseIndex, phrase] of accentPhrases.entries()) {
    const details = document.createElement('details');
    details.className = 'phrase';
    details.open = phraseIndex === openIndex;
    const summary = document.createElement('summary');
    summary.textContent = `${phraseIndex + 1}. ${phrase.moras.map(mora => mora.text).join('')}`;
    const content = document.createElement('div');
    content.className = 'phrase-content';
    const controls = document.createElement('div');
    controls.className = 'phrase-controls';
    const accentLabel = document.createElement('label');
    accentLabel.textContent = 'アクセント位置';
    const accentSelect = document.createElement('select');
    phrase.moras.forEach((mora, index) => accentSelect.add(new Option(`${index + 1}音目（${mora.text}）`, String(index + 1))));
    accentSelect.value = String(phrase.accent);
    accentSelect.addEventListener('change', async () => {
      const version = analysisVersion;
      const previous = structuredClone(phrase);
      phrase.accent = Number(accentSelect.value);
      accentSelect.disabled = true;
      $('accentMessage').textContent = 'アクセントに合わせて音の高さと長さを再計算中...';
      try {
        const data = await api('/api/mora-data', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ presetId: selectedPreset().id, styleId: Number($('style').value), accentPhrase: phrase }),
        });
        if (version !== analysisVersion) return;
        accentPhrases[phraseIndex] = data.accentPhrase;
        $('accentMessage').textContent = 'この句の音高と長さを再計算しました。';
      } catch (error) {
        if (version !== analysisVersion) return;
        accentPhrases[phraseIndex] = previous;
        $('accentMessage').textContent = error.message;
      }
      renderAccentPhrases(phraseIndex);
    });
    accentLabel.append(accentSelect);
    controls.append(accentLabel);
    if (phraseIndex > 0) {
      const merge = document.createElement('button');
      merge.type = 'button'; merge.className = 'secondary'; merge.textContent = '前の句と結合';
      merge.addEventListener('click', async () => {
        const version = analysisVersion;
        merge.disabled = true;
        $('accentMessage').textContent = 'アクセント句を結合中...';
        try {
          const previous = accentPhrases[phraseIndex - 1];
          const combined = { ...previous, moras: [...previous.moras, ...phrase.moras],
            pause_mora: phrase.pause_mora, is_interrogative: phrase.is_interrogative };
          const recalculated = await recalculatePhrase(combined);
          if (version !== analysisVersion) return;
          accentPhrases.splice(phraseIndex - 1, 2, recalculated);
          renderAccentPhrases(phraseIndex - 1);
          $('accentMessage').textContent = '句を結合しました。';
        } catch (error) { if (version === analysisVersion) $('accentMessage').textContent = error.message; }
        finally { merge.disabled = false; }
      });
      controls.append(merge);
    }
    if (phrase.moras.length > 1) {
      const splitLabel = document.createElement('label');
      splitLabel.textContent = '句を分ける位置';
      const splitSelect = document.createElement('select');
      phrase.moras.slice(0, -1).forEach((mora, index) => splitSelect.add(new Option(`${mora.text} の後`, String(index + 1))));
      const split = document.createElement('button');
      split.type = 'button'; split.className = 'secondary'; split.textContent = 'ここで分割';
      split.addEventListener('click', async () => {
        const version = analysisVersion;
        split.disabled = true;
        $('accentMessage').textContent = 'アクセント句を分割中...';
        try {
          const position = Number(splitSelect.value);
          const first = { ...phrase, moras: phrase.moras.slice(0, position), accent: Math.min(phrase.accent, position),
            pause_mora: null, is_interrogative: false };
          const second = { ...phrase, moras: phrase.moras.slice(position), accent: Math.max(1, phrase.accent - position) };
          const recalculated = await Promise.all([recalculatePhrase(first), recalculatePhrase(second)]);
          if (version !== analysisVersion) return;
          accentPhrases.splice(phraseIndex, 1, ...recalculated);
          renderAccentPhrases(phraseIndex);
          $('accentMessage').textContent = '句を分割しました。';
        } catch (error) { if (version === analysisVersion) $('accentMessage').textContent = error.message; }
        finally { split.disabled = false; }
      });
      splitLabel.append(splitSelect);
      controls.append(splitLabel, split);
    }
    if (phrase.pause_mora) {
      controls.append(numberField('句の後の間（秒）', phrase.pause_mora.vowel_length,
        value => { phrase.pause_mora.vowel_length = value; }));
    }
    const questionLabel = document.createElement('label');
    questionLabel.className = 'check-control';
    const question = document.createElement('input');
    question.type = 'checkbox';
    question.checked = !!phrase.is_interrogative;
    question.addEventListener('change', () => { phrase.is_interrogative = question.checked; });
    questionLabel.append(question, document.createTextNode(' 疑問文'));
    controls.append(questionLabel);
    const moras = document.createElement('div');
    moras.className = 'mora-grid';
    phrase.moras.forEach((mora, index) => {
      const card = document.createElement('div');
      card.className = 'mora-card';
      const name = document.createElement('strong');
      name.textContent = `${index + 1}. ${mora.text}`;
      const pitchLabel = document.createElement('label');
      pitchLabel.textContent = '音高';
      const pitchValue = document.createElement('output');
      pitchValue.textContent = Number(mora.pitch).toFixed(2);
      const pitch = document.createElement('input');
      pitch.type = 'range';
      pitch.min = '0';
      pitch.max = String(Math.max(12, Math.ceil(mora.pitch)));
      pitch.step = '0.01';
      pitch.value = String(mora.pitch);
      pitch.addEventListener('input', () => {
        mora.pitch = Number(pitch.value);
        pitchValue.textContent = mora.pitch.toFixed(2);
      });
      pitchLabel.append(pitchValue, pitch);
      card.append(name, pitchLabel, numberField('母音の長さ（秒）', mora.vowel_length,
        value => { mora.vowel_length = value; }));
      if (mora.consonant_length != null) {
        card.append(numberField('子音の長さ（秒）', mora.consonant_length,
          value => { mora.consonant_length = value; }));
      }
      if (/^[iIuU]$/.test(mora.vowel)) {
        const devoicedLabel = document.createElement('label');
        devoicedLabel.className = 'check-control';
        const devoiced = document.createElement('input');
        devoiced.type = 'checkbox'; devoiced.checked = mora.vowel === mora.vowel.toUpperCase();
        devoiced.addEventListener('change', () => {
          mora.vowel = devoiced.checked ? mora.vowel.toUpperCase() : mora.vowel.toLowerCase();
          mora.pitch = devoiced.checked ? 0 : 5;
          pitch.value = String(mora.pitch);
          pitchValue.textContent = mora.pitch.toFixed(2);
        });
        devoicedLabel.append(devoiced, document.createTextNode(' 無声化'));
        card.append(devoicedLabel);
      }
      moras.append(card);
    });
    content.append(controls, moras);
    details.append(summary, content);
    container.append(details);
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `通信に失敗しました (${response.status})。`);
  return data;
}

async function init() {
  try {
    const [presetData, speakerData, health] = await Promise.all([
      api('/api/presets'),
      api('/api/speakers').catch(error => ({ speakers: [], error: error.message })),
      api('/api/health').catch(error => ({ ready: false, error: error.message })),
    ]);
    presets = presetData.presets;
    speakers = speakerData.speakers;
    renderSpeakers();
    renderPresets();
    if (!presets.length) {
      $('preset').replaceChildren(new Option('利用できるプリセットがありません', ''));
      $('generate').disabled = true;
      showMessage('有効なプリセットがありません。プリセットJSONを確認してください。');
    } else if (speakerData.error) {
      showMessage(`${speakerData.error} 話者一覧を読み込むにはページを再読み込みしてください。`);
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
  clearAccentAnalysis();
  refreshPresetView();
  setPresetText(selectedPreset());
  showMessage('');
});
$('style').addEventListener('change', () => { clearAccentAnalysis(); refreshCredit(); });

for (const name of parameterNames) {
  $(name).addEventListener('input', () => { $(`${name}Value`).textContent = Number($(name).value).toFixed(2); });
}

$('resetParameters').addEventListener('click', refreshPresetView);
$('text').addEventListener('input', () => {
  $('count').textContent = `${[...$('text').value].length} / 500`;
  const spoken = $('readingText').value.trim() || $('text').value.trim();
  if ((accentPhrases && spoken !== analyzedText) || $('analyze').disabled) clearAccentAnalysis();
});
$('readingText').addEventListener('input', () => {
  const spoken = $('readingText').value.trim() || $('text').value.trim();
  if ((accentPhrases && spoken !== analyzedText) || $('analyze').disabled) clearAccentAnalysis();
});

$('analyze').addEventListener('click', async () => {
  const preset = selectedPreset();
  const text = $('text').value.trim();
  const readingText = $('readingText').value.trim();
  const spoken = readingText || text;
  const styleId = Number($('style').value);
  if (!preset || !$('style').value || !text || [...text].length > 500) {
    $('accentMessage').textContent = 'プリセット、話者、1〜500文字の文章を指定してください。'; return;
  }
  clearAccentAnalysis();
  const version = analysisVersion;
  $('analyze').disabled = true;
  $('accentMessage').textContent = '文章を解析中...';
  try {
    const data = await api('/api/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presetId: preset.id, styleId, text, readingText }),
    });
    if (version !== analysisVersion) return;
    accentPhrases = data.accentPhrases;
    analyzedText = spoken;
    analyzedStyleId = styleId;
    renderAccentPhrases();
    $('accentMessage').textContent = 'アクセント位置や各音を変更できます。';
  } catch (error) {
    if (version === analysisVersion) $('accentMessage').textContent = error.message;
  } finally { $('analyze').disabled = false; }
});

$('form').addEventListener('submit', async event => {
  event.preventDefault();
  showMessage('');
  const text = $('text').value.trim();
  const readingText = $('readingText').value.trim();
  if (!text || [...text].length > 500) { showMessage('文章は1〜500文字で入力してください。'); return; }
  const preset = selectedPreset();
  if (!preset) { showMessage('プリセットを選択してください。'); return; }
  const styleId = Number($('style').value);
  if (!$('style').value) { showMessage('話者・スタイルを選択してください。'); return; }

  $('generate').disabled = true;
  $('generate').textContent = '生成中...';
  try {
    const parameters = Object.fromEntries(parameterNames.map(name => [name, Number($(name).value)]));
    const options = {
      outputSamplingRate: Number($('outputSamplingRate').value),
      pauseLength: $('pauseLength').value ? Number($('pauseLength').value) : null,
      outputStereo: $('outputStereo').checked,
      enableInterrogativeUpspeak: $('enableInterrogativeUpspeak').checked,
    };
    const editedPhrases = accentPhrases && analyzedText === (readingText || text) && analyzedStyleId === styleId ? accentPhrases : undefined;
    const response = await fetch('/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, readingText, presetId: preset.id, styleId, parameters, options, accentPhrases: editedPhrases }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `音声を生成できませんでした (${response.status})。`);
    }
    const blob = await response.blob();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioBlob = blob;
    audioUrl = URL.createObjectURL(blob);
    $('player').src = audioUrl;
    $('result').hidden = false;
    showMessage('音声を生成しました。再生、またはWAVを保存できます。');
  } catch (error) { showMessage(error.message || '音声を生成できませんでした。'); }
  finally {
    $('generate').disabled = false;
    $('generate').textContent = '音声を生成';
  }
});

$('saveWav').addEventListener('click', async () => {
  if (!audioBlob) return;
  $('saveWav').disabled = true;
  showMessage('WAVを保存中...');
  try {
    const saved = await api('/api/wav', {
      method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audioBlob,
    });
    showMessage(`WAVを保存しました。保存先: ${saved.storagePath}`);
  } catch (error) { showMessage(error.message); }
  finally { $('saveWav').disabled = false; }
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
  const voice = speakers.find(style => String(style.id) === $('style').value);
  if (!voice) { $('savePresetMessage').textContent = '話者・スタイルを選択してください。'; return; }
  const preset = {
    id: `local-${crypto.randomUUID().replaceAll('-', '')}`,
    name: $('newPresetName').value.trim(),
    enabled: true,
    styleId: voice.id,
    sourcePresetId: source.sourcePresetId || source.id,
    defaultText: null,
    credit: voice.id === source.styleId ? source.credit : `VOICEVOX:${voice.speaker}`,
    termsUrl: voice.id === source.styleId ? source.termsUrl : '',
    outputSamplingRate: Number($('outputSamplingRate').value),
    pauseLength: $('pauseLength').value ? Number($('pauseLength').value) : null,
    outputStereo: $('outputStereo').checked,
    enableInterrogativeUpspeak: $('enableInterrogativeUpspeak').checked,
  };
  for (const name of parameterNames) preset[name] = Number($(name).value);
  const save = $('savePresetForm').querySelector('button[type="submit"]');
  save.disabled = true;
  $('savePresetMessage').textContent = '保存中...';
  try {
    const saved = await api('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preset),
    });
    presets.push(preset);
    renderPresets(preset.id, false);
    $('saveDialog').close();
    showMessage(`「${preset.name}」を保存しました。保存先: ${saved.storagePath}`);
  } catch (error) { $('savePresetMessage').textContent = error.message; }
  finally { save.disabled = false; }
});

init();
