/*
 * chart.js — graphiques épurés en SVG : pas de grille, une courbe,
 * un léger dégradé dessous, et une infobulle qui suit le doigt.
 *
 * Chart.line(points, { unit, height, format }) → Element
 *   points : [{ label: "S42", value: 4.5 }, …]
 */

const Chart = (() => {
  let gradientCount = 0;

  // Courbe lissée (Catmull-Rom → Bézier) qui passe par tous les points.
  function smoothPath(coords) {
    if (coords.length < 2) return "";
    let d = `M${coords[0][0]},${coords[0][1]}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i - 1] || coords[i];
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const p3 = coords[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
    }
    return d;
  }

  function line(points, { unit = "", height = 120, format = Fmt.number } = {}) {
    const width = 320;
    const pad = 6;
    const values = points.map((p) => p.value);
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const coords = points.map((p, i) => [
      pad + (i * (width - 2 * pad)) / Math.max(1, points.length - 1),
      pad + (height - 2 * pad) * (1 - (p.value - min) / span),
    ]);
    const path = smoothPath(coords);
    const gid = `chart-grad-${++gradientCount}`;
    const last = points[points.length - 1];
    const first = points[0];

    const el = html(`
      <div class="chart">
        <svg viewBox="0 0 ${width} ${height}" height="${height}" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
              <stop class="chart-area-stop" offset="0" stop-opacity="0.22"/>
              <stop class="chart-area-stop" offset="1" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path d="${path} L${coords[coords.length - 1][0]},${height} L${coords[0][0]},${height} Z" fill="url(#${gid})"/>
          <path class="chart-line" d="${path}" vector-effect="non-scaling-stroke"/>
          <line class="chart-cursor" x1="0" x2="0" y1="0" y2="${height}" vector-effect="non-scaling-stroke" visibility="hidden"/>
        </svg>
        <div class="chart-tip"></div>
        <div class="chart-axis"><span>${escapeHtml(first.label)}</span><span>${escapeHtml(last.label)}</span></div>
      </div>
    `);
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", `${points.length} valeurs, dernière : ${format(last.value)} ${unit}`);

    const cursor = el.querySelector(".chart-cursor");
    const tip = el.querySelector(".chart-tip");
    const svg = el.querySelector("svg");
    let dot = null;
    let lastIndex = -1;

    function show(clientX) {
      const rect = svg.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * width;
      let index = 0;
      coords.forEach((c, i) => {
        if (Math.abs(c[0] - x) < Math.abs(coords[index][0] - x)) index = i;
      });
      if (index !== lastIndex) {
        lastIndex = index;
        Haptic.tap();
      }
      const [cx, cy] = coords[index];
      cursor.setAttribute("x1", cx);
      cursor.setAttribute("x2", cx);
      cursor.setAttribute("visibility", "visible");

      // Le point est dessiné en HTML pour rester rond malgré l'étirement du SVG.
      if (!dot) {
        dot = html(`<span style="position:absolute;width:11px;height:11px;border-radius:50%;background:var(--text);box-shadow:0 0 0 3px var(--surface);transform:translate(-50%,-50%);pointer-events:none"></span>`);
        el.appendChild(dot);
      }
      const px = (cx / width) * rect.width;
      dot.style.left = `${px}px`;
      dot.style.top = `${(cy / height) * rect.height}px`;
      dot.hidden = false;

      const p = points[index];
      tip.innerHTML = `<strong>${escapeHtml(format(p.value))}${unit ? ` ${escapeHtml(unit)}` : ""}</strong><span>${escapeHtml(p.label)}</span>`;
      const half = tip.offsetWidth / 2;
      tip.style.left = `${Math.min(rect.width - half, Math.max(half, px))}px`;
      el.classList.add("is-active");
    }

    function hide() {
      el.classList.remove("is-active");
      cursor.setAttribute("visibility", "hidden");
      if (dot) dot.hidden = true;
      lastIndex = -1;
    }

    el.addEventListener("pointerdown", (event) => show(event.clientX));
    el.addEventListener("pointermove", (event) => {
      if (event.pointerType === "mouse" || event.buttons) show(event.clientX);
    });
    el.addEventListener("pointerup", (event) => {
      if (event.pointerType !== "mouse") hide();
    });
    el.addEventListener("pointerleave", hide);
    el.addEventListener("pointercancel", hide);

    return el;
  }

  // Barres (volume par semaine ou par mois) ; même infobulle au toucher que la courbe.
  function bars(points, { unit = "", height = 140, format = Fmt.number, highlightLast = true } = {}) {
    const max = Math.max(...points.map((p) => p.value), 0) || 1;
    const el = html(`
      <div class="chart chart-bars" style="height:${height + 22}px">
        <div class="bars" style="height:${height}px">
          ${points
            .map(
              (p, i) =>
                `<span class="bar${highlightLast && i === points.length - 1 ? " current" : ""}" style="height:${Math.max(p.value > 0 ? 3 : 0, (p.value / max) * 100)}%"></span>`
            )
            .join("")}
        </div>
        <div class="chart-tip"></div>
        <div class="chart-axis"><span>${escapeHtml(points[0].label)}</span><span>${escapeHtml(points[points.length - 1].label)}</span></div>
      </div>
    `);
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", points.map((p) => `${p.label} : ${format(p.value)} ${unit}`).join(", "));
    const tip = el.querySelector(".chart-tip");
    const barEls = [...el.querySelectorAll(".bar")];
    let lastIndex = -1;

    function show(clientX) {
      const rect = el.querySelector(".bars").getBoundingClientRect();
      const index = Math.min(points.length - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * points.length)));
      if (index !== lastIndex) {
        lastIndex = index;
        Haptic.tap();
      }
      barEls.forEach((b, i) => b.classList.toggle("active", i === index));
      const p = points[index];
      tip.innerHTML = `<strong>${escapeHtml(format(p.value))}${unit ? ` ${escapeHtml(unit)}` : ""}</strong><span>${escapeHtml(p.label)}</span>`;
      const center = ((index + 0.5) / points.length) * rect.width;
      const half = tip.offsetWidth / 2;
      tip.style.left = `${Math.min(rect.width - half, Math.max(half, center))}px`;
      el.classList.add("is-active");
    }

    function hide() {
      el.classList.remove("is-active");
      barEls.forEach((b) => b.classList.remove("active"));
      lastIndex = -1;
    }

    el.addEventListener("pointerdown", (event) => show(event.clientX));
    el.addEventListener("pointermove", (event) => {
      if (event.pointerType === "mouse" || event.buttons) show(event.clientX);
    });
    el.addEventListener("pointerup", (event) => {
      if (event.pointerType !== "mouse") hide();
    });
    el.addEventListener("pointerleave", hide);
    el.addEventListener("pointercancel", hide);
    return el;
  }

  return { line, bars };
})();
