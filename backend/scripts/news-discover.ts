// Shows what data requests a web page makes when it loads, to find the address a JavaScript-built page
// gets its notices from (then a JSON_LIST source can read that address directly, with no browser).
//   bun run news:discover https://site.example/home [seconds to wait, default 12]
// Needs Google Chrome on this machine (set CHROME_BIN if it is not `google-chrome`). A developer tool:
// the news worker never starts a browser.
export {}; // makes this file a module, so top-level await is allowed

const url = process.argv[2];
if (!url) {
  console.error("Usage: bun run news:discover <page address> [seconds]");
  process.exit(1);
}
const waitMs = Number(process.argv[3] ?? 12) * 1000;
const port = 9300 + Math.floor(Math.random() * 400);
const profile = `${process.env.TMPDIR ?? "/tmp"}/bp-discover-${port}`;
const chrome = Bun.spawn([process.env.CHROME_BIN ?? "google-chrome", "--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });

try {
  await Bun.sleep(2500);
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const send = (method: string, params: object = {}) =>
    new Promise<any>((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const reqs = new Map<string, { url: string; method: string; post?: string; type: string }>();
  const finished = new Set<string>();
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)!(d.result);
      pending.delete(d.id);
    } else if (d.method === "Network.requestWillBeSent") reqs.set(d.params.requestId, { url: d.params.request.url, method: d.params.request.method, post: d.params.request.postData, type: d.params.type });
    else if (d.method === "Network.loadingFinished") finished.add(d.params.requestId);
  };
  await send("Network.enable");
  await send("Page.enable");
  await send("Page.navigate", { url });
  await Bun.sleep(waitMs);
  let shown = 0;
  for (const [rid, r] of reqs) {
    if (!["XHR", "Fetch"].includes(r.type) || /google-analytics|googletagmanager/.test(r.url)) continue;
    const body: string = finished.has(rid) ? ((await send("Network.getResponseBody", { requestId: rid }).catch(() => ({})))?.body ?? "") : "";
    console.log(`\n${r.method} ${r.url}${r.post ? `\n  body sent: ${r.post.slice(0, 300)}` : ""}\n  answer: ${body.length} bytes  ${body.slice(0, 220).replace(/\s+/g, " ")}`);
    shown++;
  }
  console.log(`\n${shown} data request(s). Look for one whose answer holds the notices, then give a JSON_LIST source its address and the paths to the list, title, date and address.`);
} finally {
  chrome.kill();
  process.exit(0);
}
