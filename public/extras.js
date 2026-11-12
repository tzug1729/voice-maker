const $ = id => document.getElementById(id);
let words = {};
let editingUuid = null;
let songBlob = null;
let songUrl = null;
const wordTypesByContext = { 1348: 'PROPER_NOUN', 1345: 'COMMON_NOUN', 642: 'VERB', 20: 'ADJECTIVE', 1358: 'SUFFIX' };

async function api(endpoint, options) {
  const response = await fetch(endpoint, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `処理に失敗しました (${response.status})。`);
  return data;
}

function showMode(mode) {
  $('form').hidden = mode !== 'speech';
  document.querySelector('.credit-panel').hidden = mode !== 'speech';
  $('dictionaryView').hidden = mode !== 'dictionary';
  $('singingView').hidden = mode !== 'singing';
  for (const tab of document.querySelectorAll('.mode-tab')) {
    tab.classList.toggle('active', tab.dataset.mode === mode);
    if (tab.dataset.mode === mode) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  if (mode === 'dictionary') loadDictionary();
  if (mode === 'singing') loadSingers();
}

for (const tab of document.querySelectorAll('.mode-tab')) tab.addEventListener('click', () => showMode(tab.dataset.mode));

function resetWordForm() {
  editingUuid = null;
  $('dictionaryForm').reset();
  $('dictionaryFormTitle').textContent = '単語を追加';
  $('cancelWordEdit').hidden = true;
}

function renderWords() {
  const list = $('dictionaryList');
  list.replaceChildren();
  const entries = Object.entries(words).sort((a, b) => a[1].surface.localeCompare(b[1].surface, 'ja'));
  if (!entries.length) { list.textContent = '登録した単語はありません。'; return; }
  for (const [uuid, word] of entries) {
    const item = document.createElement('div');
    item.className = 'dictionary-item';
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = word.surface;
    const detail = document.createElement('p');
    detail.textContent = `${word.pronunciation} · アクセント ${word.accent_type} · 優先度 ${word.priority}`;
    info.append(title, detail);
    const actions = document.createElement('div');
    actions.className = 'dictionary-actions';
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'secondary'; edit.textContent = '編集';
    edit.addEventListener('click', () => {
      editingUuid = uuid;
      $('wordSurface').value = word.surface;
      $('wordPronunciation').value = word.pronunciation;
      $('wordAccent').value = word.accent_type;
      $('wordType').value = word.word_type || wordTypesByContext[word.context_id] || 'PROPER_NOUN';
      $('wordPriority').value = word.priority;
      $('dictionaryFormTitle').textContent = '単語を編集';
      $('cancelWordEdit').hidden = false;
      $('dictionaryForm').scrollIntoView({ behavior: 'smooth' });
    });
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'secondary'; remove.textContent = '削除';
    remove.addEventListener('click', async () => {
      if (!confirm(`「${word.surface}」を辞書から削除しますか？`)) return;
      try {
        const data = await api(`/api/dictionary/${uuid}`, { method: 'DELETE' });
        words = data.words; renderWords(); resetWordForm();
        $('dictionaryMessage').textContent = '単語を削除しました。';
      } catch (error) { $('dictionaryMessage').textContent = error.message; }
    });
    actions.append(edit, remove); item.append(info, actions); list.append(item);
  }
}

async function loadDictionary() {
  $('dictionaryMessage').textContent = '辞書を読み込み中...';
  try {
    const data = await api('/api/dictionary');
    words = data.words; renderWords();
    $('dictionaryMessage').textContent = '';
  } catch (error) { $('dictionaryMessage').textContent = error.message; }
}

$('cancelWordEdit').addEventListener('click', resetWordForm);
$('dictionaryForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = {
    surface: $('wordSurface').value.trim(), pronunciation: $('wordPronunciation').value.trim(),
    accentType: Number($('wordAccent').value), wordType: $('wordType').value,
    priority: Number($('wordPriority').value),
  };
  const button = $('dictionaryForm').querySelector('button[type="submit"]');
  button.disabled = true;
  $('dictionaryMessage').textContent = '保存中...';
  try {
    const data = await api(editingUuid ? `/api/dictionary/${editingUuid}` : '/api/dictionary', {
      method: editingUuid ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    words = data.words; renderWords(); resetWordForm();
    $('dictionaryMessage').textContent = '単語を dictionary.json に保存しました。';
  } catch (error) { $('dictionaryMessage').textContent = error.message; }
  finally { button.disabled = false; }
});

function noteRow(key = 60, seconds = 0.5, lyric = 'ラ') {
  const row = document.createElement('div');
  row.className = 'note-row';
  row.innerHTML = '<label>音高（MIDI番号）<input class="note-key" type="number" min="0" max="127" placeholder="休符"></label><label>長さ（秒）<input class="note-seconds" type="number" min="0.05" max="10" step="0.05" required></label><label>歌詞（１モーラ）<input class="note-lyric" maxlength="20" placeholder="ラ"></label><button class="secondary" type="button">削除</button>';
  row.querySelector('.note-key').value = key ?? '';
  row.querySelector('.note-seconds').value = seconds;
  row.querySelector('.note-lyric').value = lyric;
  row.querySelector('button').addEventListener('click', () => row.remove());
  return row;
}

$('noteList').append(noteRow(60, 0.5, 'ド'), noteRow(62, 0.5, 'レ'), noteRow(64, 0.5, 'ミ'));
$('addNote').addEventListener('click', () => $('noteList').append(noteRow()));

async function loadSingers() {
  $('singingMessage').textContent = '歌唱スタイルを読み込み中...';
  try {
    const data = await api('/api/singers');
    const teachers = data.styles.filter(style => ['sing', 'singing_teacher'].includes(style.type));
    const singers = data.styles.filter(style => style.type === 'frame_decode');
    $('teacherStyle').replaceChildren(...teachers.map(style => new Option(`${style.speaker}・${style.style}`, style.id)));
    $('singerStyle').replaceChildren(...singers.map(style => new Option(`${style.speaker}・${style.style}`, style.id)));
    $('generateSong').disabled = !teachers.length || !singers.length;
    $('singingMessage').textContent = teachers.length && singers.length ? '' : '歌唱に対応するスタイルがありません。VOICEVOXの歌唱対応ライブラリを確認してください。';
  } catch (error) { $('singingMessage').textContent = error.message; $('generateSong').disabled = true; }
}

$('singingForm').addEventListener('submit', async event => {
  event.preventDefault();
  const notes = [...$('noteList').children].map(row => ({
    key: row.querySelector('.note-key').value === '' ? null : Number(row.querySelector('.note-key').value),
    seconds: Number(row.querySelector('.note-seconds').value), lyric: row.querySelector('.note-lyric').value.trim(),
  }));
  $('generateSong').disabled = true;
  $('singingMessage').textContent = '歌声を生成中...';
  try {
    const response = await fetch('/api/sing', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacherStyleId: Number($('teacherStyle').value), singerStyleId: Number($('singerStyle').value),
        notes, volumeScale: Number($('singVolume').value), outputSamplingRate: Number($('singRate').value), outputStereo: $('singStereo').checked }) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `生成に失敗しました (${response.status})。`);
    }
    if (songUrl) URL.revokeObjectURL(songUrl);
    songBlob = await response.blob();
    songUrl = URL.createObjectURL(songBlob);
    $('songPlayer').src = songUrl;
    $('songResult').hidden = false;
    $('singingMessage').textContent = '歌声を生成しました。';
  } catch (error) { $('singingMessage').textContent = error.message; }
  finally { $('generateSong').disabled = false; }
});

$('saveSongWav').addEventListener('click', async () => {
  if (!songBlob) return;
  $('saveSongWav').disabled = true;
  try {
    const saved = await api('/api/wav', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: songBlob });
    $('singingMessage').textContent = `WAVを保存しました。保存先: ${saved.storagePath}`;
  } catch (error) { $('singingMessage').textContent = error.message; }
  finally { $('saveSongWav').disabled = false; }
});
