import { memoryDraft, matchingCandidates, personError, textLength, errorMessage } from './core.mjs';

export function composeMemory({ document, window, main, el, button, entries, candidates, now, urls, resize, submitMemory, navigate, announce }) {
  let draft = entries.draft(), active = true, selecting = false, submitting = false;
  const photos = [];
  main.append(button('‹ 一覧へ戻る', () => navigate('list'), 'back'), el('h1', '新しい思い出'));
  const form = el('form', '', 'memory-form'); form.noValidate = true;
  const feedback = el('p', '', 'form-message'); feedback.setAttribute('role', 'status');
  const controls = {};
  function field(key, label, type = 'text', parent = form) {
    const caption = el('label', label); caption.htmlFor = `memory-${key}`;
    const input = el(type === 'textarea' ? 'textarea' : 'input');
    input.id = caption.htmlFor; if (type !== 'textarea') input.type = type;
    input.value = draft[key]; controls[key] = input;
    input.addEventListener('input', () => { draft[key] = input.value; persist(); });
    if (type === 'text') input.addEventListener('paste', event => {
      if (/[\r\n\u2028\u2029]/.test(event.clipboardData?.getData('text') || '')) {
        event.preventDefault(); feedback.textContent = `${label}に改行は入れられません。`;
      }
    });
    parent.append(caption, input); return input;
  }
  function persist() {
    if (submitting) return;
    if (!entries.saveDraft(draft)) feedback.textContent = '下書きを端末に保存できませんでした。画面を閉じずに、空き容量やブラウザの設定を確認してください。';
  }
  field('title', '題（必須・40 字まで）');
  const kindLabel = el('label', '日付の選び方'); kindLabel.htmlFor = 'memory-dateKind';
  const kind = el('select'); kind.id = kindLabel.htmlFor;
  for (const [value, label] of [['day', '1 日'], ['month', '月だけ（日は覚えていない）'], ['range', '期間']]) {
    const option = el('option', label); option.value = value; kind.append(option);
  }
  kind.value = draft.dateKind; controls.dateKind = kind; form.append(kindLabel, kind);
  const dayFields = el('div'), monthFields = el('div'), endFields = el('div');
  field('date', '日付・期間の始まり（必須）', 'date', dayFields);
  field('month', '月（必須）', 'month', monthFields);
  field('end', '期間の終わり（必須）', 'date', endFields);
  form.append(dayFields, monthFields, endFields);
  function dateFields() { dayFields.hidden = draft.dateKind === 'month'; monthFields.hidden = draft.dateKind !== 'month'; endFields.hidden = draft.dateKind !== 'range'; }
  kind.addEventListener('change', () => { draft.dateKind = kind.value; dateFields(); persist(); }); dateFields();
  const place = field('place', '場所（60 字まで）');
  function suggestions(input, values, choose, label) {
    const list = el('div', '', 'suggestions'); list.setAttribute('aria-label', label); form.append(list);
    function update() {
      list.replaceChildren();
      for (const value of matchingCandidates(values, input.value)) list.append(button(value, () => { choose(value); list.replaceChildren(); }, 'suggestion'));
    }
    input.addEventListener('input', update);
    input.addEventListener('focus', update);
    return list;
  }
  const places = suggestions(place, candidates.places, value => { draft.place = place.value = value; persist(); }, '場所の候補');
  const person = field('person', '一緒にいた人（1 人 20 字まで）');
  const peopleSuggestions = suggestions(person, candidates.people, value => { person.value = draft.person = value; addPerson(); }, '人の候補');
  const chips = el('div', '', 'people-chips');
  function showPeople() {
    chips.replaceChildren();
    draft.people.forEach((name, index) => {
      const chip = el('span', '', 'person-chip'), remove = button('×', () => { draft.people.splice(index, 1); persist(); showPeople(); });
      remove.setAttribute('aria-label', `${name} を外す`); chip.append(el('span', name), remove); chips.append(chip);
    });
  }
  function addPerson() {
    const error = personError(person.value);
    if (error) { feedback.textContent = error; return; }
    const name = person.value.trim();
    if (!draft.people.includes(name)) draft.people.push(name);
    draft.person = person.value = ''; peopleSuggestions.replaceChildren(); feedback.textContent = ''; persist(); showPeople();
  }
  person.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); addPerson(); } });
  const add = button('人を足す', addPerson); form.append(add, chips); showPeople();
  const body = field('body', '本文（10000 字まで）', 'textarea'); body.rows = 8;
  const length = el('p', '', 'muted');
  const count = () => { length.textContent = `${textLength(body.value)} / 10000 字`; };
  body.addEventListener('input', count); count(); form.append(length);
  const photoLabel = el('label', '写真を選ぶ', 'file-button'); photoLabel.htmlFor = 'memory-photos';
  const file = el('input'); file.id = photoLabel.htmlFor; file.type = 'file'; file.accept = 'image/*'; file.multiple = true;
  const previews = el('div', '', 'memory-photos'), progress = el('p', '', 'muted'); progress.setAttribute('role', 'status');
  form.append(photoLabel, file, el('p', '写真は下書きに残りません。この画面を出ると外れます。', 'muted'), previews, progress);
  function showPhotos() {
    previews.replaceChildren();
    photos.forEach((photo, index) => {
      const figure = el('figure', '', 'preview'), image = el('img'); image.src = photo.url; image.alt = `選んだ写真 ${index + 1}`;
      const remove = button('×', () => { urls.revokeObjectURL(photo.url); photos.splice(index, 1); showPhotos(); });
      remove.disabled = submitting; remove.setAttribute('aria-label', `写真 ${index + 1} を外す`); figure.append(image, remove); previews.append(figure);
    });
  }
  function clearPhotos() { for (const photo of photos) urls.revokeObjectURL(photo.url); photos.length = 0; previews.replaceChildren(); }
  const submit = el('button', '作る', 'primary'); submit.type = 'submit';
  function lock() {
    for (const control of Object.values(controls)) control.disabled = submitting;
    file.disabled = selecting || submitting; submit.disabled = selecting || submitting; add.disabled = submitting; discard.disabled = selecting || submitting;
    for (const control of chips.querySelectorAll('button')) control.disabled = submitting;
    for (const control of form.querySelectorAll('.suggestion')) control.disabled = submitting;
    showPhotos();
  }
  file.addEventListener('change', async () => {
    if (selecting || submitting) return;
    selecting = true; lock(); feedback.textContent = '';
    const files = Array.from(file.files || []);
    try {
      for (let i = 0; i < files.length && active; i++) {
        progress.textContent = `${i + 1} / ${files.length} 枚を準備しています…`;
        try {
          const blob = await resize(files[i], { document, Image: window.Image, urls });
          if (active) { photos.push({ blob, url: urls.createObjectURL(blob) }); showPhotos(); }
        } catch (error) { if (active) feedback.textContent += `${i + 1} 枚目：${errorMessage(error)} 写真をもう一度選び直してください。\n`; }
      }
    } finally { selecting = false; file.value = ''; if (active) { progress.textContent = ''; lock(); } }
  });
  const confirm = el('section', '', 'confirm'); confirm.hidden = true;
  const discard = button('下書きを捨てる', () => { confirm.hidden = false; });
  confirm.append(el('p', '下書きと選んだ写真を捨てますか？'), button('下書きを捨てて空にする', () => {
    if (selecting || submitting || !entries.saveDraft(null)) return;
    draft = memoryDraft({}, now());
    for (const [key, control] of Object.entries(controls)) control.value = draft[key];
    clearPhotos(); places.replaceChildren(); peopleSuggestions.replaceChildren(); showPeople(); dateFields(); count(); feedback.textContent = ''; confirm.hidden = true;
  }), button('キャンセル', () => { confirm.hidden = true; }));
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (selecting || submitting) return;
    for (const [key, control] of Object.entries(controls)) draft[key] = control.value;
    submitting = true; confirm.hidden = true; lock(); feedback.textContent = '';
    try {
      await submitMemory(draft, photos.map(photo => photo.blob), message => {
        if (active) progress.textContent = message; else announce(message);
      });
      if (active) navigate('list');
    } catch (error) { if (active) feedback.textContent = errorMessage(error); else announce(errorMessage(error)); }
    finally { submitting = false; if (active) lock(); }
  });
  form.append(feedback, submit, discard, confirm); main.append(form);
  return () => { active = false; clearPhotos(); };
}
