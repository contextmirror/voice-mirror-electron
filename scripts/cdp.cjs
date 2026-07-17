// CDP harness for driving + capturing the running Voice Mirror (demo media).
//   node scripts/cdp.cjs shot <out.png>     -> screenshot the VM UI
//   node scripts/cdp.cjs eval "<js>"        -> run JS in the VM webview, print result
//   node scripts/cdp.cjs key <Combo>        -> send a key chord (e.g. Control+Shift+P)
const fs = require('fs');
const CDP = 'http://127.0.0.1:9222';

async function connect() {
  const targets = await (await fetch(CDP + '/json')).json();
  const page = targets.find(
    (t) => t.type === 'page' && (t.title === 'Voice Mirror' || t.url.includes('tauri.localhost'))
  );
  if (!page) throw new Error('VM page not found: ' + JSON.stringify(targets.map((t) => t.url)));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('WS connect failed')));
  });
  return { send, ws };
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const { send, ws } = await connect();
  try {
    if (cmd === 'shot') {
      await send('Page.enable');
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(args[0], Buffer.from(data, 'base64'));
      console.log('shot saved', args[0], fs.statSync(args[0]).size, 'bytes');
    } else if (cmd === 'eval') {
      await send('Runtime.enable');
      const r = await send('Runtime.evaluate', {
        expression: args[0],
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) console.log('EXCEPTION:', JSON.stringify(r.exceptionDetails.exception));
      else console.log(JSON.stringify(r.result?.value ?? r.result));
    } else {
      console.log('usage: shot <out> | eval <js>');
    }
  } finally {
    ws.close();
    process.exit(0);
  }
}
main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
