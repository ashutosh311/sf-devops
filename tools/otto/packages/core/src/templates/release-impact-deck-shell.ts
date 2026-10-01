/**
 * The self-contained HTML shell for the impact-assessment slide deck (GH-90).
 *
 * The Release agent copies this verbatim into `impact-assessment.html`, replacing the single
 * `__FINDINGS_JSON__` marker with the findings register; the page's own script then draws every
 * slide from that JSON. Layout and branding are therefore identical on every run.
 *
 * Constraints (asserted by render tests):
 *  - no double-open-brace sequence anywhere (Handlebars compiles the surrounding template)
 *  - no backticks and no dollar-brace sequences (this is a String.raw template literal)
 *  - no network URLs, external fonts or files — the deck must open offline
 *  - one brand-token block; rating colours are never the brand blue
 *  - every rating and exposure is also shown as text, never by colour alone
 *  - Constitution III (v1.1.0): presentation markup only — no procedure text or instructions
 */
export const releaseImpactDeckShell = compact(String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Salesforce impact assessment</title>
<style>
/* Brand tokens - the only place brand colours are defined. */
:root{
  --brand-navy:#0b1437; --brand-blue:#0C62FB; --brand-pale:#eff6ff;
  --ink:#1e293b; --muted:#64748b; --line:#e2e8f0; --paper:#ffffff;
  /* Risk colours - deliberately not the brand blue. */
  --critical:#b91c1c; --high:#ea580c; --medium:#ca8a04; --low:#15803d; --na:#64748b;
}
@page{size:1280px 720px;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#cbd5e1;color:var(--ink);font-family:"Segoe UI",system-ui,-apple-system,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.slide{width:1280px;height:720px;background:var(--paper);position:relative;overflow:hidden;margin:16px auto;padding:72px 56px 56px;page-break-after:always;break-after:page}
.slide:last-child{page-break-after:auto;break-after:auto}
@media print{html,body{background:#fff}.slide{margin:0}}
.band{position:absolute;left:0;right:0;top:0;height:48px;background:var(--brand-navy);color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 56px;font-size:14px;letter-spacing:.02em}
.band .mark{font-weight:700;font-size:20px;letter-spacing:.04em;color:#fff}
.band .mark b{color:var(--brand-blue)}
.foot{position:absolute;left:56px;right:56px;bottom:20px;display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}
h1{font-size:44px;line-height:1.1;margin:0 0 12px;color:var(--brand-navy)}
h2{font-size:28px;margin:0 0 18px;color:var(--brand-navy)}
h3{font-size:16px;margin:0 0 8px;color:var(--brand-navy);text-transform:uppercase;letter-spacing:.06em}
p{margin:0 0 10px;font-size:16px;line-height:1.4}
.muted{color:var(--muted)}
.cover{display:flex;flex-direction:column;justify-content:center;height:100%}
.cover .kicker{color:var(--brand-blue);font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:15px;margin-bottom:12px}
.chip{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#fff;white-space:nowrap}
.chip.critical{background:var(--critical)}.chip.high{background:var(--high)}.chip.medium{background:var(--medium);color:#1e293b}.chip.low{background:var(--low)}.chip.na{background:var(--na)}
.chip.rec-go{background:var(--low)}.chip.rec-go-with-conditions{background:var(--medium);color:#1e293b}.chip.rec-not-ready{background:var(--critical)}
.exp{display:inline-block;padding:1px 9px;border-radius:4px;font-size:12px;font-weight:700;text-transform:uppercase;border:2px solid var(--brand-navy);color:var(--brand-navy);background:#fff}
.exp.confirmed{background:var(--brand-navy);color:#fff}
.exp.unknown{border-style:dashed}
.exp.none{border-color:var(--na);color:var(--na)}
.caveat{display:inline-block;padding:1px 9px;border-radius:4px;font-size:12px;font-weight:700;text-transform:uppercase;border:2px solid var(--high);color:#7c2d12;background:repeating-linear-gradient(45deg,#fff7ed,#fff7ed 4px,#ffedd5 4px,#ffedd5 8px)}
.cols{display:grid;gap:24px}
.cols.c3{grid-template-columns:1.1fr 1fr 1fr}
.exec .panel{min-height:480px}.exec p,.exec li{font-size:17px}.exec td{font-size:15px;padding:10px}.exec td.num{font-size:24px}.exec th{font-size:13px}.exec .timeline li{font-size:16px}
.panel{border:1px solid var(--line);border-radius:10px;padding:16px 18px;background:#fff}
.panel.pale{background:var(--brand-pale);border-color:#bfdbfe}
ul.tight{margin:0;padding-left:20px}ul.tight li{font-size:15px;line-height:1.35;margin-bottom:6px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top;font-size:13px;line-height:1.3}
th{background:var(--brand-pale);color:var(--brand-navy);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
td.num{text-align:center;font-weight:700;font-size:16px}
.heat-critical{background:#fee2e2}.heat-high{background:#ffedd5}.heat-medium{background:#fef9c3}.heat-low{background:#dcfce7}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card{border:1px solid var(--line);border-left:8px solid var(--na);border-radius:8px;padding:12px 14px;height:262px;overflow:hidden}
.card.critical{border-left-color:var(--critical)}.card.high{border-left-color:var(--high)}.card.medium{border-left-color:var(--medium)}.card.low{border-left-color:var(--low)}
.card .top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.card .id{font-weight:700;color:var(--muted);font-size:13px}
.card .area{font-weight:700;font-size:17px;color:var(--brand-navy);margin-bottom:6px}
.card p{font-size:14px;margin-bottom:6px}
.timeline li{margin-bottom:8px;font-size:14px;list-style:none}
.timeline ul{padding:0;margin:0}
.when{font-weight:700;color:var(--brand-navy)}
/* Long text is clipped, never allowed to overflow a slide; full text is in the markdown. */
.clip2,.clip3,.clip5{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden}
.clip2{-webkit-line-clamp:2}.clip3{-webkit-line-clamp:3}.clip5{-webkit-line-clamp:5}
.callout{border-left:6px solid var(--high);background:#fff7ed;padding:10px 12px;border-radius:6px;margin-top:12px}
.callout,.callout b{font-size:15px;line-height:1.35}
</style>
</head>
<body>
<div id="deck"></div>
<script id="findings" type="application/json">__FINDINGS_JSON__</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById("findings").textContent);
  var deck = document.getElementById("deck");
  var RATINGS = ["critical", "high", "medium", "low"];
  var RATING_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low", na: "Not applicable" };
  var TIERS = [
    ["act-before-date", "Act before a date"],
    ["test-in-preview", "Test in the preview"],
    ["opportunity", "Opportunities"]
  ];
  var REC_LABEL = { "go": "Go", "go-with-conditions": "Go with conditions", "not-ready": "Not ready" };
  var EXPOSURE_LABEL = { confirmed: "Confirmed exposure", possible: "Possible exposure", unknown: "Unknown exposure", none: "No exposure" };
  var title = "Salesforce " + data.release.label + " impact assessment";
  document.title = data.project + " - " + title;

  /* Register values used as CSS class names are whitelisted, never concatenated raw. */
  function cls(v) { return /^[a-z][a-z-]*$/.test(String(v)) ? String(v) : "invalid"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function dayNumber(iso) {
    var p = iso.split("-");
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }
  /* One rule for relative wording, shared with the markdown report: N = date - assessedOn. */
  function inDays(f) {
    if (!f.date) return "no date given";
    var n = dayNumber(f.date) - dayNumber(data.assessedOn);
    var when = n === 0 ? "today" : n > 0 ? "in " + n + " day" + (n === 1 ? "" : "s") : Math.abs(n) + " day" + (n === -1 ? "" : "s") + " ago";
    return when + " (" + f.date + ")";
  }
  function ratingChip(f) { return '<span class="chip ' + cls(f.rating) + '">' + esc(RATING_LABEL[f.rating] || f.rating) + "</span>"; }
  function exposureChip(f) { return '<span class="exp ' + cls(f.exposure) + '">' + esc(EXPOSURE_LABEL[f.exposure] || f.exposure) + "</span>"; }
  function caveatChip(f) {
    return f.caveat === "none" ? "" : '<span class="caveat">' + (f.caveat === "provisional" ? "Provisional" : "Unverified") + "</span>";
  }
  var pageNo = 0;
  function slide(inner, label) {
    pageNo += 1;
    return '<section class="slide"><div class="band"><span class="mark">slalom<b>.</b></span><span>' + esc(label || title) + "</span></div>" +
      inner + '<div class="foot"><span>' + esc(data.project) + " &middot; " + esc(data.release.label) + " &middot; assessed " + esc(data.assessedOn) +
      "</span><span>" + pageNo + "</span></div></section>";
  }
  function chunk(list, size) {
    var out = [];
    for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }
  var byId = {};
  data.findings.forEach(function (f) { byId[f.id] = f; });
  var live = data.findings.filter(function (f) { return f.rating !== "na"; });
  var featured = data.findings.filter(function (f) { return f.featured; });
  var html = "";

  /* 1. Title */
  pageNo += 1;
  html += '<section class="slide"><div class="band"><span class="mark">slalom<b>.</b></span><span>Impact assessment</span></div>' +
    '<div class="cover"><div class="kicker">Salesforce seasonal release</div><h1>' + esc(data.release.label) + " impact assessment</h1>" +
    "<p class=\"muted\" style=\"font-size:22px\">" + esc(data.project) + "</p>" +
    "<p class=\"muted\">Assessed " + esc(data.assessedOn) + " &middot; " + (data.scope === "repo" ? "repository evidence only" : "repository and live sandbox " + esc(data.sandbox || "")) + " &middot; advisory</p></div>" +
    '<div class="foot"><span>Prepared by Slalom</span><span>' + pageNo + "</span></div></section>";

  /* 2. Executive */
  var heat = '<table><tr><th>Tier</th>' + RATINGS.map(function (r) { return "<th>" + RATING_LABEL[r] + "</th>"; }).join("") + "</tr>" +
    TIERS.map(function (t) {
      return "<tr><td>" + t[1] + "</td>" + RATINGS.map(function (r) {
        var n = data.findings.filter(function (f) { return f.tier === t[0] && f.rating === r; }).length;
        return '<td class="num ' + (n ? "heat-" + r : "") + '">' + n + "</td>";
      }).join("") + "</tr>";
    }).join("") + "</table>";
  var dated = live.filter(function (f) { return f.date && f.tier === "act-before-date"; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 7);
  var timeline = dated.length
    ? '<div class="timeline"><ul>' + dated.map(function (f) {
        return '<li><span class="when">' + esc(inDays(f)) + "</span> &mdash; " + esc(f.area) + " " + ratingChip(f) + "</li>";
      }).join("") + "</ul></div>"
    : "<p class=\"muted\">No dated deadlines.</p>";
  var blind = data.findings.filter(function (f) { return f.exposure === "unknown" && f.ratingBasis.impact === "breaks"; });
  var blindHtml = blind.length
    ? '<div class="callout"><b>' + blind.length + " finding" + (blind.length === 1 ? "" : "s") + " could break existing behaviour but cannot be ruled out from the repository</b> (exposure unknown): " +
      esc(blind.slice(0, 8).map(function (f) { return f.id; }).join(", ")) + (blind.length > 8 ? " and " + (blind.length - 8) + " more" : "") + ". See the verification pack.</div>"
    : "";
  var allLow = live.every(function (f) { return f.rating === "low"; });
  var conditions = data.conditions.length
    ? '<ul class="tight">' + data.conditions.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul>"
    : "<p class=\"muted\">None.</p>";
  html += slide(
    "<h2>Executive summary</h2>" +
    '<div class="cols c3 exec"><div class="panel pale"><h3>Recommendation</h3><p><span class="chip rec-' + cls(data.recommendation) + '" style="font-size:16px">' + esc(REC_LABEL[data.recommendation] || data.recommendation) + "</span></p>" +
    (allLow ? "<p>No action is needed before the upgrade.</p>" : "") + "<h3 style=\"margin-top:12px\">Conditions</h3>" + conditions + "</div>" +
    '<div class="panel"><h3>Findings by tier and rating</h3>' + heat +
    '<p class="muted" style="margin-top:10px;font-size:13px">' + data.findings.length + " findings; " + data.findings.filter(function (f) { return f.rating === "na"; }).length + " not applicable.</p>" +
    blindHtml + (data.featuredOverflow > 0 ? '<p style="font-size:13px"><b>' + data.featuredOverflow + " further Critical finding" + (data.featuredOverflow === 1 ? "" : "s") + "</b> are in the appendix.</p>" : "") + "</div>" +
    '<div class="panel"><h3>Decide or act by</h3>' + timeline + "</div></div>",
    "Executive summary");

  /* 3. Top findings (featured), four per slide */
  chunk(featured, 4).forEach(function (group, i, all) {
    html += slide("<h2>Top findings" + (all.length > 1 ? " (" + (i + 1) + " of " + all.length + ")" : "") + "</h2>" +
      '<div class="cards">' + group.map(function (f) {
        return '<div class="card ' + cls(f.rating) + '"><div class="top"><span class="id">' + esc(f.id) + "</span>" + ratingChip(f) + exposureChip(f) + caveatChip(f) + "</div>" +
          '<div class="area clip2">' + esc(f.area) + '</div><p class="clip3">' + esc(f.summary) + '</p><p class="clip3"><b>Action:</b> ' + esc(f.action) + "</p>" +
          '<p class="muted" style="font-size:13px">' + esc(inDays(f)) + "</p></div>";
      }).join("") + "</div>", "Top findings");
  });

  /* 4. Questions for owners */
  if (data.ownerQuestions.length) {
    html += slide("<h2>Questions for the owners</h2><table><tr><th style=\"width:60%\">Question</th><th>For</th><th>Findings</th></tr>" +
      data.ownerQuestions.slice(0, 8).map(function (q) {
        return "<tr><td>" + esc(q.question) + "</td><td>" + esc(q.forWhom) + "</td><td>" + esc(q.findingIds.join(", ")) + "</td></tr>";
      }).join("") + "</table>", "Questions for the owners");
  }

  /* 5. Blind spots and verification pack */
  if (data.blindSpots.length) {
    html += slide("<h2>What the repository cannot show</h2><table><tr><th>Area</th><th>Why not visible</th><th>Check to run</th><th>Ask</th><th>Findings</th></tr>" +
      data.blindSpots.slice(0, 7).map(function (b) {
        return "<tr><td>" + esc(b.metadataType) + "</td><td>" + esc(b.reason) + "</td><td>" + esc(b.check) + "</td><td>" + esc(b.ask) + "</td><td>" + esc(b.affects.join(", ")) + "</td></tr>";
      }).join("") + "</table>", "Verification pack");
  }

  /* 6. Appendix: every finding, five per slide; not applicable collapsed to one line */
  var rows = data.findings.filter(function (f) { return f.rating !== "na"; });
  chunk(rows, 5).forEach(function (group, i, all) {
    html += slide("<h2>Appendix: findings (" + (i + 1) + " of " + all.length + ")</h2><table><tr><th>Finding</th><th>Rating</th><th>Evidence</th><th>Action</th><th>Source</th></tr>" +
      group.map(function (f) {
        return "<tr><td><b>" + esc(f.id) + '</b> <span class="clip2">' + esc(f.area) + "</span>" + exposureChip(f) + " " + caveatChip(f) + "</td><td>" + ratingChip(f) + "<br><span class=\"muted\">" + esc(inDays(f)) + "</span></td><td>" +
          '<div class="clip5">' + esc(f.evidence) + '</div></td><td><div class="clip5">' + esc(f.action) + "</div></td><td>" + esc(f.sourceIds.join(", ")) + "</td></tr>";
      }).join("") + "</table>", "Appendix");
  });
  var nas = data.findings.filter(function (f) { return f.rating === "na"; });
  if (nas.length) {
    html += slide("<h2>Appendix: not applicable</h2><p>" + nas.length + " item" + (nas.length === 1 ? "" : "s") + " reviewed with no plausible dependency: " +
      esc(nas.map(function (f) { return f.id + " " + f.area; }).join("; ")) + ".</p>", "Appendix");
  }

  /* 7. Sources */
  chunk(data.sources, 9).forEach(function (group, i, all) {
    html += slide("<h2>Appendix: sources (" + (i + 1) + " of " + all.length + ")</h2><table><tr><th>Id</th><th>Source</th><th>Obtained</th><th>Read</th></tr>" +
      group.map(function (s) {
        return "<tr><td>" + esc(s.id) + "</td><td>" + esc(s.title) + "<br><span class=\"muted\">" + esc(s.location) + "</span></td><td>" + esc(s.obtained) + "</td><td>" +
          esc(s.completeness) + (s.unreadPart ? " - not read: " + esc(s.unreadPart) : "") + "</td></tr>";
      }).join("") + "</table>", "Appendix");
  });

  deck.innerHTML = html;
})();
</script>
</body>
</html>
`);

/** Drops indentation and blank lines: the shell is carried in every prompt, so size matters. */
function compact(source: string): string {
  return source.replace(/^[ \t]+/gm, "").replace(/\n{2,}/g, "\n");
}
