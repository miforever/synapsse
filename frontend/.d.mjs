import { chromium } from "@playwright/test";
const OUT = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
await p.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await p.evaluate(() => window.scrollTo({ top: document.querySelector("#see").offsetTop - 40, behavior: "instant" }));
await p.waitForTimeout(4500);            // let the auto-trace finish
await p.screenshot({ path: `${OUT}/d-trace.png` });
// hover a node
const box = await p.locator("#demo-graph").boundingBox();
await p.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
await p.waitForTimeout(900);
await p.screenshot({ path: `${OUT}/d-hover.png` });
console.log(errs.length ? "ERRORS: " + errs.join(" | ") : "ok");
await b.close();
