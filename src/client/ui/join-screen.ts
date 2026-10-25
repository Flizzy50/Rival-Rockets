import { DISPLAY_NAME_MAX_GRAPHEMES, ROOM_CODE_LENGTH } from '../../shared/config';
import type { Intent } from '../../shared/protocol';
import type { AppContext } from '../app';
import { isRoomCode } from '../net/session';
import { DEVELOPER_ONLY, FALLBACK_REJECT, rejectCopy, ROOM_COPY } from './copy';
import { button, el } from './dom';

// Create and Join forms (PRD 7.7). The client checks early so mistakes show
// at once, but the server decides (Requirement 2.6). Names are only ever
// rendered with textContent.

const FORBIDDEN_NAME_CHARS = /[\p{Cc}\u2028\u2029]/u;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function nameIsValid(raw: string): boolean {
  if (FORBIDDEN_NAME_CHARS.test(raw)) return false;
  const count = Array.from(segmenter.segment(raw.trim().normalize('NFC'))).length;
  return count >= 1 && count <= DISPLAY_NAME_MAX_GRAPHEMES;
}

let fieldCount = 0;

function field(label: string, input: HTMLInputElement): { wrap: HTMLElement; error: HTMLElement } {
  fieldCount += 1;
  const id = `field-${fieldCount}`;
  const errorId = `${id}-error`;
  input.id = id;
  input.setAttribute('aria-describedby', errorId);
  const error = el('p', { className: 'field-error', attrs: { id: errorId } });
  const wrap = el('div', { className: 'field' }, el('label', { text: label, attrs: { for: id } }), input, error);
  return { wrap, error };
}

export function mountJoinScreen(root: HTMLElement, ctx: AppContext): () => void {
  const mode = ctx.joinMode;
  let disposed = false;
  let busy = false;

  const codeInput = el('input', {
    className: 'input input-code tabular',
    attrs: {
      type: 'text',
      inputmode: 'text',
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      maxlength: String(ROOM_CODE_LENGTH),
    },
  });
  codeInput.value = ctx.prefillCode ?? '';
  // Auto-uppercase as the player types (PRD 7.7).
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase();
  });
  const nameInput = el('input', {
    className: 'input',
    attrs: { type: 'text', autocomplete: 'nickname', enterkeyhint: 'go' },
  });
  const code = field(ROOM_COPY.codeLabel, codeInput);
  const name = field(ROOM_COPY.nameLabel, nameInput);

  const watchBox = el('input', { attrs: { type: 'checkbox', id: 'join-watch' } });
  const watchRow = el(
    'div',
    { className: 'check-row' },
    watchBox,
    el('label', { text: ROOM_COPY.watchToggle, attrs: { for: 'join-watch' } }),
  );

  const formError = el('p', { className: 'field-error', attrs: { role: 'alert' } });
  const watchInstead = button('Watch instead', 'btn btn-secondary btn-block', () => void submit('watch'));
  watchInstead.hidden = true;
  const submitButton = el(
    'button',
    { className: 'btn btn-primary btn-block', attrs: { type: 'submit' } },
    el('span', { className: 'btn-label', text: mode === 'create' ? ROOM_COPY.createTitle : ROOM_COPY.joinTitle }),
  );

  const form = el(
    'form',
    { className: 'stack', attrs: { novalidate: '' } },
    ...(mode === 'join' ? [code.wrap] : []),
    name.wrap,
    ...(mode === 'join' ? [watchRow] : []),
    formError,
    submitButton,
    watchInstead,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(watchBox.checked ? 'watch' : 'play');
  });

  root.append(
    el(
      'main',
      { className: 'screen menu-screen join-screen' },
      el('h1', {
        className: 'screen-title',
        text: mode === 'create' ? ROOM_COPY.createTitle : ROOM_COPY.joinTitle,
        attrs: { tabindex: '-1' },
      }),
      form,
      button('Back', 'btn btn-small', () => ctx.go('home')),
    ),
  );

  function showErrors(codeText: string, nameText: string, formText: string): void {
    code.error.textContent = codeText;
    name.error.textContent = nameText;
    formError.textContent = formText;
    codeInput.setAttribute('aria-invalid', String(codeText !== ''));
    nameInput.setAttribute('aria-invalid', String(nameText !== ''));
  }

  async function submit(intent: Intent): Promise<void> {
    if (busy) return;
    const codeValue = codeInput.value.trim().toUpperCase();
    const codeText = mode === 'join' && !isRoomCode(codeValue) ? (rejectCopy('room-not-found') as string) : '';
    const nameText = nameIsValid(nameInput.value) ? '' : ROOM_COPY.nameHint;
    watchInstead.hidden = true;
    showErrors(codeText, nameText, '');
    if (codeText) {
      codeInput.focus();
      return;
    }
    if (nameText) {
      nameInput.focus();
      return;
    }

    busy = true;
    submitButton.disabled = true;
    const reply = await ctx.enterRoom({ mode, name: nameInput.value, code: codeValue, intent });
    if (disposed) return;
    busy = false;
    submitButton.disabled = false;

    if (reply === null) {
      showErrors('', '', ROOM_COPY.connectFailed);
      return;
    }
    if (reply.type === 'request.rejected') {
      const copy = rejectCopy(reply.reason);
      const text = copy === DEVELOPER_ONLY ? FALLBACK_REJECT : copy;
      if (reply.reason === 'room-not-found' || reply.reason === 'invalid-value') showErrors(text, '', '');
      else if (reply.reason === 'invalid-name') showErrors('', text, '');
      else showErrors('', '', text);
      watchInstead.hidden = !reply.offerWatch;
      return;
    }
    ctx.prefillCode = null;
    const phase = ctx.room?.roomState?.phase;
    ctx.go(phase === 'results' ? 'results' : phase === 'running' || phase === 'countdown' || intent === 'watch' ? 'room-watch' : 'lobby');
  }

  return () => {
    disposed = true;
  };
}
