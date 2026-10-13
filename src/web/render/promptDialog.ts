// One-line text input as an HTML overlay, for hosts whose webview has no window.prompt (WKWebView in Tauri).

export function promptDialog(message: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'prompt-back';
    back.innerHTML = '<form class="prompt-box"><p></p><input type="text"><div><button type="submit">확인</button><button type="button">취소</button></div></form>';
    const form = back.querySelector('form')!, input = back.querySelector('input')!;
    back.querySelector('p')!.textContent = message;
    input.value = initial;
    const done = (v: string | null) => { back.remove(); resolve(v); };
    form.onsubmit = (e) => { e.preventDefault(); done(input.value); };
    back.querySelector<HTMLButtonElement>('button[type=button]')!.onclick = () => done(null);
    // keep the game's key listeners out of the text field
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(null); });
    document.body.appendChild(back);
    input.focus();
    input.select();
  });
}
