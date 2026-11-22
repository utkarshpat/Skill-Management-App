export function companyRecoveryPage(failed: boolean, nonce: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Resume your work | Skill Management App</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; font: 16px system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; box-sizing: border-box; padding: 1rem; display: grid; place-items: center; }
    main { width: min(100%, 30rem); box-sizing: border-box; padding: clamp(1rem, 5vw, 2rem); border: 1px solid GrayText; border-radius: 1rem; }
    p { line-height: 1.5; }
    h1 { font-size: 1.5rem; }
    a { display: inline-block; padding-block: .5rem; }
  </style>
</head>
<body>
  <main>
    <p>Skill Management App</p>
    <h1>${failed ? 'Microsoft sign-in could not finish' : 'Return to your work'}</h1>
    <p id="status" role="status">${
      failed
        ? 'Try again with the work account you used in your original tab.'
        : 'Go back to your original tab to continue with your unsaved work. If that tab is closed, open a new workspace below.'
    }</p>
    ${failed ? '<a href="/api/auth/login?mode=choose&amp;returnTo=%2Fapi%2Fauth%2Fresume-complete">Try Microsoft sign-in again</a><br>' : ''}
    <a href="/workspace">Open a new workspace</a>
  </main>
  ${
    failed
      ? ''
      : `<script nonce="${nonce}">
    if (typeof BroadcastChannel === 'function') {
      const channel = new BroadcastChannel('skill-company-recovery');
      channel.onmessage = ({ data }) => {
        if (data !== 'resumed') return;
        document.getElementById('status').textContent = 'Your original tab is ready. You can close this tab.';
        channel.close();
        window.close();
      };
      channel.postMessage('complete');
    }
  </script>`
  }
</body>
</html>`;
}
