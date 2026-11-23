// Smoke test: load the built single-file page in jsdom and exercise every view.
// Run with `node --test test/`. Fails the build if the page breaks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const ROOT = new URL("..", import.meta.url);
const html = readFileSync(new URL("dist/agentic-model-timeline.html", ROOT), "utf8");
const data = JSON.parse(readFileSync(new URL("data/agentic-model-timeline.json", ROOT), "utf8"));
const codeVersion = readFileSync(new URL("VERSION", ROOT), "utf8").trim();

function load(width = 1024) {
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(win) {
      win.innerWidth = width;
      win.addEventListener("error", (e) => errors.push(e.message));
    },
  });
  return { dom, doc: dom.window.document, errors };
}

test("no runtime network dependencies", () => {
  assert.doesNotMatch(html, /<(link|script)[^>]+(href|src)="https?:\/\//);
});

test("page renders with version stamp", () => {
  const { doc, errors } = load();
  assert.deepEqual(errors, []);
  const stamp = doc.getElementById("stamp-date").textContent;
  assert.match(stamp, new RegExp(`code v${codeVersion.replace(/\./g, "\\.")}`));
  assert.match(stamp, new RegExp(`data v${data.data_version.replace(/\./g, "\\.")}`));
  assert.match(doc.getElementById("foot").textContent, /code v/);
});

test("default chart draws a point per scored model", () => {
  const { doc } = load();
  const pressed = doc.querySelector('#bench-seg button[aria-pressed="true"]');
  assert.ok(pressed, "a benchmark is selected");
  const svg = doc.getElementById("chart");
  const pts = svg.querySelectorAll("rect, circle").length;
  const bench = Object.keys(data.benchmarks).find((b) =>
    pressed.textContent === data.benchmarks[b].name.replace("Terminal-Bench", "TB").replace("SWE-bench", "SWE") +
      (data.benchmarks[b].name.startsWith("Terminal") ? ` ${data.benchmarks[b].version}` : ""));
  assert.equal(bench, "tb40", "Terminal-Bench 4.0 is the default performance benchmark");
  const scored = data.models.filter((m) => m.scores[bench]).length;
  assert.equal(pts, scored);
});

test("timeline marks a November release without inventing a score", () => {
  const { doc } = load();
  const deepswe = [...doc.querySelectorAll("#bench-seg button")].find((button) => button.textContent === "DeepSWE");
  deepswe.dispatchEvent(new doc.defaultView.MouseEvent("click", { bubbles: true }));
  const markers = [...doc.querySelectorAll("#chart .unscored-release")];
  assert.ok(markers.some((marker) => /GPT-6\.2 Astra.*2026-11-17.*no published DeepSWE score/.test(marker.querySelector("title").textContent)));
  const rows = markers.map((marker) => marker.getAttribute("d").match(/^M[-.\d]+ ([-.\d]+)/)?.[1]);
  assert.equal(new Set(rows).size, markers.length, "unscored release markers use separate rows");
  assert.match(doc.getElementById("chart").textContent, /GPT-6\.2 Astra/);
});

test("timeline includes November and remains data-driven into 2027", () => {
  const { dom, doc } = load();
  assert.match(doc.getElementById("chart").textContent, /Nov/);
  assert.match(doc.title, /Nov 2026/);
  const next = structuredClone(data);
  next.window.to = "2027-12-31";
  doc.getElementById("paste").value = JSON.stringify(next);
  doc.getElementById("apply").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.match(doc.getElementById("chart").textContent, /release date, 2026–2027/);
  assert.match(doc.getElementById("chart").textContent, /'27/);
  assert.match(doc.title, /Dec 2027/);
});

test("Google Argon, Carbon and Hydrogen are tracked", () => {
  const { doc } = load();
  const expected = ["Gemini 4 Argon", "Gemini 4 Carbon", "Gemini 4 Hydrogen"];
  const googleModels = data.models.filter((model) => model.vendor === "Google");
  for (const name of expected) {
    assert.ok(googleModels.some((model) => model.name === name && model.availability === "ga"));
  }
  const options = [...doc.getElementById("compare-first").options].map((option) => option.textContent);
  for (const name of expected) assert.ok(options.includes(name));
});

test("spider plot prioritizes Terminal-Bench 4.0", () => {
  const { dom, doc } = load();
  const change = (id, value) => {
    const select = doc.getElementById(id);
    select.value = value;
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  };
  change("compare-first", "anthropic-haiku-5-5");
  change("compare-second", "google-gemini-4-argon");
  const labels = [...doc.querySelectorAll("#compare-chart .radar-label")].map((label) => label.textContent);
  assert.equal(labels[2], "TB 4.0");
});

test("every benchmark x view x vendor combination renders without error", () => {
  const { dom, doc, errors } = load();
  const click = (el) => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const n = (id) => doc.querySelectorAll(`#${id} button`).length;
  for (let v = 0; v < n("view-seg"); v++) {
    click(doc.querySelectorAll("#view-seg button")[v]);
    for (let b = 0; b < n("bench-seg"); b++) {
      click(doc.querySelectorAll("#bench-seg button")[b]);
      for (let f = 0; f < n("vendor-seg"); f++) {
        click(doc.querySelectorAll("#vendor-seg button")[f]);
        assert.ok(doc.getElementById("chart"), "chart present");
        assert.equal(doc.querySelectorAll("#cards .card").length, 4);
      }
    }
  }
  assert.deepEqual(errors, []);
});

test("sources and Copilot tables reflect the data", () => {
  const { doc } = load();
  assert.equal(doc.querySelectorAll("#sources li").length, data.sources.length);
  const sold = data.models.filter((m) => m.copilot?.available).length + (data.copilot_catalog_extra || []).length;
  assert.equal(doc.querySelectorAll("#cp-body tr").length, sold);
});

test("model comparison redraws shared scores and selected pricing", () => {
  const { dom, doc, errors } = load();
  for (const id of ["compare-first", "compare-second"]) {
    const names = [...doc.getElementById(id).options].map((option) => option.textContent);
    assert.deepEqual(names, [...names].sort((first, second) => first.localeCompare(second)));
  }
  const change = (id, value) => {
    const select = doc.getElementById(id);
    select.value = value;
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  };
  change("compare-first", "anthropic-haiku-5-5");
  change("compare-second", "google-gemini-4-argon");
  assert.equal(doc.querySelectorAll("#compare-chart .radar-series").length, 2);
  assert.equal(doc.querySelectorAll("#compare-chart .radar-axis").length, 3);
  const values = [...doc.querySelectorAll("#compare-chart .radar-value")].map((element) => element.textContent);
  assert.deepEqual(values, ["$0.1", "$2", "$0.5", "$10", "36.36%", "57.58%"]);
  const polygons = [...doc.querySelectorAll("#compare-chart .radar-series")];
  const firstAxisY = polygons.map((polygon) => Number(polygon.getAttribute("points").split(" ")[0].split(",")[1]));
  assert.ok(Math.abs(firstAxisY[0] - 90) < 0.001, "cheaper input rate reaches the outer ring");
  assert.ok(Math.abs(firstAxisY[1] - 223) < 0.001, "more expensive input rate is scaled by the price ratio");
  assert.match(doc.getElementById("compare-body").textContent, /36\.36%/);
  assert.match(doc.getElementById("compare-body").textContent, /57\.58%/);
  assert.match(doc.getElementById("compare-body").textContent, /mini-SWE-agent/);
  change("compare-pricing", "copilot");
  assert.match(doc.getElementById("compare-body").textContent, /\$0\.1 \/ 1M/);
  change("compare-second", "google-gemini-decision-1");
  assert.equal(doc.getElementById("compare-chart").hidden, true);
  assert.match(doc.getElementById("compare-empty").textContent, /three shared metrics/);
  assert.match(doc.getElementById("compare-body").textContent, /Not plotted/);
  assert.deepEqual(errors, []);
});

test("model comparison resets removed selections when data is replaced", () => {
  const { dom, doc, errors } = load();
  const next = structuredClone(data);
  next.models = next.models.filter((model) => ![doc.getElementById("compare-first").value, doc.getElementById("compare-second").value].includes(model.id));
  doc.getElementById("paste").value = JSON.stringify(next);
  doc.getElementById("apply").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.match(doc.getElementById("msg").textContent, /Redrawn/);
  assert.ok(next.models.some((model) => model.id === doc.getElementById("compare-first").value));
  assert.ok(next.models.some((model) => model.id === doc.getElementById("compare-second").value));
  assert.deepEqual(errors, []);
});

test("narrow viewport uses the mobile chart geometry", () => {
  const { doc } = load(380);
  assert.match(doc.getElementById("chart").getAttribute("viewBox"), /^0 0 380 /);
});

test("pasted JSON with an unsupported schema is rejected", () => {
  const { dom, doc } = load();
  const bad = { ...data, schema_version: "9.0" };
  doc.getElementById("paste").value = JSON.stringify(bad);
  doc.getElementById("apply").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.match(doc.getElementById("msg").textContent, /not supported/);
});
