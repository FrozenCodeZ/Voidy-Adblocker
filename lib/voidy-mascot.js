// Builds Voidy's markup in a kawaii style: a round face with big shiny eyes,
// wrapped in a cosmic "form" (black hole, nebula, aurora…), plus expressions,
// props (sunglasses, mask, coffee mug), accessories and a speech bubble.
// Layers sit at different depths so tilting in 3D shows parallax.
//   VOIDY_MASCOT.mount(element, { mini, form })  -> the .voidy element
// Without `form`, the mascot follows the saved choice (html[data-form]).
(() => {
  const FORMS = ["blackhole", "whitehole", "nebula", "supernova", "pulsar", "aurora", "eclipse", "galaxy", "comet"];
  const blackholeArt = new URL("../assets/voidy/blackhole-base-v2.png", document.currentScript.src).href;
  let count = 0;
  const range = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join("");
  const SPARK = "M0 -5 L1.2 -1.2 L5 0 L1.2 1.2 L0 5 L-1.2 1.2 L-5 0 L-1.2 -1.2 Z";   // 4-point star
  const spark = (x, y, s, d, cls = "twinkle") => `<path d="${SPARK}" class="${cls}" style="animation-delay:${d}s" transform="translate(${x} ${y}) scale(${s})"/>`;
  const gloss = `<ellipse cx="81" cy="71" rx="13" ry="6.5" class="v-gloss" transform="rotate(-32 81 71)"/><circle cx="70" cy="83" r="2.4" class="v-gloss v-gloss2"/>`;
  const AURORA_BODY = "M52 106 C52 70 73 52 100 52 C127 52 148 70 148 106 L148 144 Q140 132 132 146 Q124 134 116 148 Q108 135 100 149 Q92 135 84 148 Q76 134 68 146 Q60 132 52 144 Z";
  const CLOUD = "M62 124 C40 124 36 98 56 92 C52 66 80 56 94 70 C100 48 134 50 136 76 C160 72 170 100 150 110 C164 126 146 146 128 136 C118 152 84 152 76 138 C64 144 50 136 62 124 Z";

  function forms(url) {
    return `
    <g class="f f-blackhole">
      <g class="f-main">
        <image class="bh-painted bh-flowing" href="${blackholeArt}" x="-100" y="10" width="400" height="200" preserveAspectRatio="xMidYMid meet" filter="${url("bh-flow")}"/>
        <image class="bh-painted bh-center" href="${blackholeArt}" x="-100" y="10" width="400" height="200" preserveAspectRatio="xMidYMid meet" mask="${url("bh-center-mask")}"/>
        <path class="bh-spark-track" d="M10 125 C41 135 73 139 100 139 C130 139 162 135 190 125">
          <animate attributeName="d" values="M10 125 C41 135 73 139 100 139 C130 139 162 135 190 125;M10 127 C44 139 72 137 100 137 C131 141 162 138 190 126;M10 125 C41 135 73 139 100 139 C130 139 162 135 190 125" dur="4.6s" repeatCount="indefinite"/>
        </path>
        <path class="bh-spark-track bh-spark-upper" d="M23 100 C45 89 60 52 79 48 C92 42 108 42 121 48 C143 55 151 88 177 99">
          <animate attributeName="d" values="M23 100 C45 89 60 52 79 48 C92 42 108 42 121 48 C143 55 151 88 177 99;M23 101 C47 94 61 57 79 51 C94 43 109 45 123 50 C146 62 151 85 177 100;M23 100 C45 89 60 52 79 48 C92 42 108 42 121 48 C143 55 151 88 177 99" dur="5.4s" repeatCount="indefinite"/>
        </path>
      </g>
    </g>
    <g class="f f-whitehole">
      <circle cx="100" cy="100" r="92" fill="${url("wh-glow")}"/>
      <g class="spin-slow">${range(12, i => `<ellipse cx="100" cy="34" rx="7" ry="15" class="wh-petal p${i % 3}" transform="rotate(${i * 30} 100 100)"/>`)}</g>
      <circle cx="100" cy="100" r="58" class="wh-halo"/>
      <g class="f-main"><circle cx="100" cy="100" r="48" fill="${url("wh-core")}"/><circle cx="100" cy="100" r="48" class="wh-rim"/>${gloss}</g>
    </g>

    <g class="f f-nebula">
      <path d="${CLOUD}" class="neb-glow" filter="${url("blur")}"/>
      <g class="drift"><g class="f-main"><path d="${CLOUD}" fill="${url("neb-body")}"/>
        <circle cx="76" cy="84" r="16" class="neb-puff"/><circle cx="128" cy="80" r="18" class="neb-puff neb-puff2"/><circle cx="104" cy="128" r="16" class="neb-puff"/>
        <path d="${CLOUD}" class="neb-edge"/>${gloss}</g>
        ${spark(66, 108, .7, .2)}${spark(140, 104, .6, 1.1)}${spark(118, 66, .55, 1.8)}</g>
    </g>

    <g class="f f-supernova">
      <circle cx="100" cy="100" r="60" class="sn-shock"/><circle cx="100" cy="100" r="60" class="sn-shock sn-shock2"/>
      <circle cx="100" cy="100" r="90" fill="${url("sn-glow")}"/>
      <g class="spin-slow"><polygon fill="${url("sn-burst")}" points="${range(20, i => {
        const a = (i * Math.PI) / 10, r = i % 2 ? 56 : i % 4 ? 72 : 80; return `${(100 + r * Math.sin(a)).toFixed(1)},${(100 - r * Math.cos(a)).toFixed(1)} `; })}" stroke-linejoin="round" class="sn-poly"/></g>
      <g class="f-main"><circle cx="100" cy="100" r="48" fill="${url("sn-core")}"/><circle cx="100" cy="100" r="48" class="sn-rim"/>${gloss}</g>
      <g class="spin-fast">${range(7, i => `<circle cx="${(100 + 70 * Math.cos(i * .9)).toFixed(1)}" cy="${(100 + 70 * Math.sin(i * .9)).toFixed(1)}" r="${2 + (i % 3)}" class="sn-ember"/>`)}</g>
    </g>

    <g class="f f-pulsar">
      <circle cx="100" cy="100" r="80" fill="${url("ps-glow")}"/>
      <g class="ps-field"><ellipse cx="100" cy="100" rx="32" ry="76" class="ps-line"/><ellipse cx="100" cy="100" rx="54" ry="82" class="ps-line"/></g>
      <g class="ps-beams"><path d="M100 100 L86 -8 Q100 -14 114 -8 Z" fill="${url("ps-beam")}"/>
        <path d="M100 100 L86 -8 Q100 -14 114 -8 Z" fill="${url("ps-beam")}" transform="rotate(180 100 100)"/></g>
      <g class="f-main"><circle cx="100" cy="100" r="48" fill="${url("ps-core")}"/><circle cx="100" cy="100" r="48" class="ps-rim"/>${gloss}</g>
    </g>

    <g class="f f-aurora">
      <path d="${AURORA_BODY}" class="au-glow" filter="${url("blur")}"/>
      <g class="f-main"><path d="${AURORA_BODY}" fill="${url("au-body")}"/>
        <g clip-path="${url("au-clip")}"><g class="au-curtains" filter="${url("soft")}">
          ${[[40, 16, .8], [66, 26, .55], [98, 12, .9], [118, 30, .5], [150, 18, .75]].map(([x, w, o]) =>
            `<path d="M${x} 40 q${w / 2} 50 ${w / 4} 120 h${w} q${w / 4} -70 ${-w / 4} -120 z" fill="${url("au-band")}" opacity="${o}"/>`).join("")}</g></g>
        <path d="${AURORA_BODY}" class="au-edge"/>${gloss}</g>
      <path d="M42 60 Q70 28 100 44 T158 38" class="au-ribbon" pathLength="100"/>
      <path d="M52 46 Q80 20 112 32 T166 26" class="au-ribbon au-ribbon2" pathLength="100"/>
    </g>

    <g class="f f-eclipse">
      <circle cx="100" cy="100" r="88" fill="${url("ec-glow")}"/>
      <g filter="${url("fire")}"><g class="spin-slow"><circle cx="100" cy="100" r="70" fill="${url("ec-corona")}"/>
        ${range(8, i => `<path d="M100 44 Q${i % 2 ? 94 : 106} 24 100 ${i % 2 ? 10 : 18}" class="ec-streamer" transform="rotate(${i * 45} 100 100)"/>`)}</g></g>
      <g class="f-main"><circle cx="100" cy="100" r="48" fill="${url("ec-moon")}"/>
        <circle cx="78" cy="122" r="6" class="ec-crater"/><circle cx="126" cy="76" r="4.5" class="ec-crater"/><circle cx="130" cy="124" r="3" class="ec-crater"/>
        <circle cx="100" cy="100" r="48.6" class="ec-rim"/>${gloss}</g>
      <g class="ec-diamond" transform="translate(136 66)"><circle r="8" class="ec-flare" filter="${url("blur")}"/><path d="${SPARK}" transform="scale(2.4)" class="ec-spark"/></g>
    </g>

    <g class="f f-galaxy">
      <circle cx="100" cy="100" r="92" fill="${url("gx-glow")}"/>
      <g class="spin-arms">${[0, 180].map(r => `<g transform="rotate(${r} 100 100)">
          <path d="M140 82 C170 100 166 148 126 164 C92 178 52 166 34 132" class="gx-arm-glow" stroke="${url("gx-arm")}" filter="${url("blur")}"/>
          <path d="M140 82 C170 100 166 148 126 164 C92 178 52 166 34 132" class="gx-arm" stroke="${url("gx-arm")}"/>
          ${[[164, 118], [150, 150], [118, 168], [84, 170], [50, 150]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.9" class="gx-star"/>`).join("")}</g>`).join("")}</g>
      <g class="f-main"><circle cx="100" cy="100" r="48" fill="${url("gx-body")}"/>
        ${[[76, 116], [124, 76], [132, 118], [88, 64], [112, 136], [66, 96]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 2 ? 1 : 1.5}" class="gx-speck"/>`).join("")}
        <circle cx="100" cy="100" r="48" class="gx-rim"/>${gloss}</g>
    </g>

    <g class="f f-comet">
      <path d="M64 78 Q14 128 -34 214 L52 232 Q84 170 124 132 Z" fill="${url("co-dust")}" class="co-tail" filter="${url("soft")}"/>
      <path d="M78 90 Q38 142 4 222 L28 226 Q58 160 110 118 Z" fill="${url("co-ion")}" class="co-tail co-ion"/>
      <circle cx="100" cy="100" r="64" fill="${url("co-coma")}" filter="${url("blur")}"/>
      <g class="f-main"><circle cx="100" cy="100" r="48" fill="${url("co-core")}"/><circle cx="100" cy="100" r="48" class="co-rim"/>${gloss}</g>
    </g>
    <g class="kw-sparks">${spark(36, 44, 1.1, 0, "kw-spark")}${spark(166, 54, .8, .9, "kw-spark")}${spark(162, 152, 1, 1.7, "kw-spark")}${spark(38, 154, .7, 2.4, "kw-spark")}
      <circle cx="150" cy="30" r="1.6" class="kw-dot"/><circle cx="52" cy="176" r="1.3" class="kw-dot"/></g>`;
  }

  // Eye drawing styles (Appearance setting, html[data-eyes]). Every style keeps
  // its moving parts in .v-pupils so looking around, winking and blinking work.
  const EYES = [["shiny", "Shiny"], ["starry", "Starry"], ["anime", "Anime"], ["beans", "Beans"],
    ["chill", "Chill"], ["rings", "Horizon"], ["pixel", "Pixel"]];
  function eyeStyle(style, x, side, id) {
    const y = 98;
    switch (style) {
      case "starry": return `<ellipse cx="${x}" cy="${y}" rx="10" ry="12.5" class="v-eye"/>
        <g class="v-pupils"><circle cx="${x + 1}" cy="${y + 1.5}" r="7.2" class="v-pupil"/>
        <g transform="translate(${x + 1} ${y + 1}) scale(1.05)"><path d="${SPARK}" class="v-glint ey-star"/></g><circle cx="${x - 2.6}" cy="${y + 6}" r="1.2" class="v-glint"/></g>`;
      case "anime": return `<ellipse cx="${x}" cy="${y + .5}" rx="10.5" ry="13.5" class="v-eye"/>
        <g class="v-pupils"><ellipse cx="${x + side}" cy="${y + 2}" rx="7.4" ry="10" class="ey-iris"/>
        <path d="M${x + side - 7.4} ${y + 1} A7.4 10 0 0 1 ${x + side + 7.4} ${y + 1} Z" class="ey-iris-shade"/>
        <ellipse cx="${x + side}" cy="${y + 3}" rx="3.4" ry="4.8" class="v-pupil"/>
        <ellipse cx="${x + side + 3}" cy="${y - 3.5}" rx="2.8" ry="3.6" class="v-glint"/><circle cx="${x + side - 2.6}" cy="${y + 7}" r="1.5" class="v-glint"/></g>
        <path d="M${x - 11} ${y - 6} Q${x} ${y - 17.5} ${x + 11} ${y - 6} M${x + side * 10} ${y - 9} l${side * 4.5} -3.4" class="ey-lash"/>`;
      case "beans": return `<g class="v-pupils"><ellipse cx="${x}" cy="${y + 1}" rx="6" ry="8.6" class="ey-bean"/>
        <ellipse cx="${x + 2}" cy="${y - 2.5}" rx="1.8" ry="2.4" class="ey-bean-glint"/></g>`;
      case "chill": return `<g clip-path="url(#${id(side < 0 ? "chill-l" : "chill-r")})"><ellipse cx="${x}" cy="${y}" rx="10.5" ry="12.5" class="v-eye"/>
        <g class="v-pupils"><circle cx="${x + 1.5}" cy="${y + 2.5}" r="6.6" class="v-pupil"/><circle cx="${x + 3.6}" cy="${y + 1}" r="1.8" class="v-glint"/></g></g>
        <path d="M${x - 11.5} ${y - 1 + side * .6} L${x + 11.5} ${y - 1 - side * .6}" class="ey-lid"/>`;
      case "rings": return `<circle cx="${x}" cy="${y}" r="9" class="ey-ring"/>
        <g class="v-pupils"><circle cx="${x + 1}" cy="${y + 1}" r="3.4" class="ey-ring-core"/><circle cx="${x + 3.8}" cy="${y - 3.4}" r="1.8" class="v-glint"/></g>`;
      case "pixel": return `<path d="M${x - 6} ${y - 11} h12 v2 h2 v18 h-2 v2 h-12 v-2 h-2 v-18 h2 z" class="v-eye ey-px"/>
        <g class="v-pupils"><path d="M${x - 2} ${y - 4} h7 v11 h-7 z" class="v-pupil ey-px"/><path d="M${x + 1} ${y - 3} h3 v3 h-3 z" class="v-glint ey-px"/></g>`;
      default: return `<ellipse cx="${x}" cy="${y}" rx="10" ry="12.5" class="v-eye"/>
        <g class="v-pupils"><circle cx="${x + 1.5}" cy="${y + 2}" r="6.8" class="v-pupil"/><circle cx="${x + 4.2}" cy="${y - 2}" r="2.7" class="v-glint"/><circle cx="${x - 1}" cy="${y + 5.6}" r="1.3" class="v-glint"/></g>`;
    }
  }
  const eyeStyles = (x, side, id) => EYES.map(([k]) => `<g class="ey ey-${k}">${eyeStyle(k, x, side, id)}</g>`).join("");
  // A small picture of one eye style, for the Appearance pickers.
  let previews = 0;
  function eyePreview(style) {
    const n = "p" + (++previews), id = k => `v${n}-${k}`;
    return `<svg class="eye-prev" viewBox="66 80 68 34" aria-hidden="true"><defs>
      <clipPath id="${id("chill-l")}"><path d="M72.5 97 A10.5 10.5 0 0 0 93.5 97 Z"/></clipPath>
      <clipPath id="${id("chill-r")}"><path d="M106.5 97 A10.5 10.5 0 0 0 127.5 97 Z"/></clipPath></defs>
      <g class="ey ey-${style}">${eyeStyle(style, 83, -1, id)}${eyeStyle(style, 117, 1, id)}</g></svg>`;
  }

  function markup(n) {
    const id = k => `v${n}-${k}`, url = k => `url(#${id(k)})`;
    const stops = s => s.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("");
    const radial = (k, s, cx = ".5", cy = ".5", r = ".5") => `<radialGradient id="${id(k)}" cx="${cx}" cy="${cy}" r="${r}">${stops(s)}</radialGradient>`;
    const ring = (k, s, r) => `<radialGradient id="${id(k)}" gradientUnits="userSpaceOnUse" cx="100" cy="100" r="${r}">${stops(s)}</radialGradient>`;
    const linear = (k, s, x2 = "0", y2 = "1") => `<linearGradient id="${id(k)}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops(s)}</linearGradient>`;
    return `
<svg class="v-defs" aria-hidden="true" width="0" height="0"><defs>
  ${radial("bh-glow", [[0, "#ff6aa8", .35], [.5, "#8a4dff", .25], [1, "#4b2bd6", 0]])}
  ${linear("bh-disk", [[0, "#ffb347"], [.35, "#ff8a2a"], [.7, "#ff9a3c"], [1, "#ff6a1f"]], "1", "0")}
  ${linear("bh-disk-back", [[0, "#ffb347"], [1, "#ff8a2a"]])}
  ${linear("bh-disk-front", [[0, "#ffa040"], [.55, "#ff8a2a"], [1, "#e8641c"]])}
  ${radial("bh-body", [[0, "#ff4f7f"], [.22, "#7a1840"], [.5, "#1c0816"], [1, "#050207"]], ".5", "0", ".85")}
  <radialGradient id="${id("bh-center-fade")}" gradientUnits="userSpaceOnUse" cx="100" cy="112" r="52">
    <stop offset="68%" stop-color="white"/><stop offset="100%" stop-color="white" stop-opacity="0"/>
  </radialGradient>
  <mask id="${id("bh-center-mask")}" maskUnits="userSpaceOnUse" x="48" y="60" width="104" height="104">
    <circle cx="100" cy="112" r="52" fill="${url("bh-center-fade")}"/>
  </mask>
  ${radial("wh-glow", [[0, "#fffaf0", .95], [.5, "#ffe7b0", .45], [1, "#ffcf7a", 0]])}
  ${radial("wh-core", [[0, "#ffffff"], [.6, "#fff7e6"], [1, "#ffdca0"]], ".4", ".35", ".75")}
  ${linear("neb-body", [[0, "#ff9ee6"], [.5, "#b27dff"], [1, "#5fc8ff"]], "1", "1")}
  ${radial("sn-glow", [[0, "#ffb347", .6], [.6, "#ff7a2f", .25], [1, "#ff4d2a", 0]])}
  ${radial("sn-burst", [[0, "#fffbe6"], [.55, "#ffd34d"], [.8, "#ff7a2f"], [1, "#e0402a", .9]])}
  ${radial("sn-core", [[0, "#fffdf0"], [.55, "#ffe27a"], [1, "#ff9a3c"]], ".42", ".38", ".7")}
  ${radial("ps-glow", [[0, "#6fd3ff", .35], [1, "#3a74ff", 0]])}
  ${linear("ps-beam", [[0, "#dffbff", 0], [.25, "#b8f1ff", .8], [1, "#6fd3ff", 0]])}
  ${radial("ps-core", [[0, "#5c9bff"], [.6, "#2448c4"], [1, "#0e1f66"]], ".4", ".35", ".75")}
  ${linear("au-body", [[0, "#2a2466"], [.45, "#127066"], [1, "#4ff0b0"]])}
  ${linear("au-band", [[0, "#b07dff", 0], [.25, "#b07dff", .55], [.55, "#8affd8", .85], [1, "#7dffcf", .1]])}
  ${radial("ec-glow", [[0, "#fff4d0", .25], [1, "#f0c46a", 0]])}
  ${ring("ec-corona", [[0, "#fff", 0], [.66, "#fff", 0], [.69, "#ffffff"], [.76, "#fff1c8", .85], [.88, "#f0c46a", .35], [1, "#c9a45c", 0]], 70)}
  ${radial("ec-moon", [[0, "#2a2a30"], [.6, "#131317"], [1, "#050507"]], ".4", ".35", ".75")}
  ${radial("gx-glow", [[0, "#b98cff", .4], [.6, "#ff7adf", .15], [1, "#5fc8ff", 0]])}
  ${linear("gx-arm", [[0, "#ff9be6"], [.5, "#c38bff"], [1, "#6fe0ff"]], "1", "1")}
  ${radial("gx-body", [[0, "#5b3cc4"], [.6, "#2a1a6e"], [1, "#120a33"]], ".4", ".35", ".75")}
  ${linear("co-dust", [[0, "#fff6e0", .8], [.45, "#ffd8a8", .3], [.75, "#ffb88a", 0]], "-.6", "1")}
  ${linear("co-ion", [[0, "#bff4ff", .85], [.45, "#6fb8ff", .35], [.8, "#6fa8ff", 0]], "-.6", "1")}
  ${radial("co-coma", [[0, "#bff0ff", .7], [.6, "#7fc8ff", .25], [1, "#7fc8ff", 0]])}
  ${radial("co-core", [[0, "#5a93c0"], [.6, "#27507a"], [1, "#132d4a"]], ".4", ".35", ".75")}
  <filter id="${id("blur")}" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="5"/></filter>
  <filter id="${id("soft")}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.5"/></filter>
  <filter id="${id("glow")}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="${id("bh-flow")}" x="-12%" y="-26%" width="124%" height="152%">
    <feTurbulence type="fractalNoise" baseFrequency=".009 .018" numOctaves="1" seed="4" result="current">
      <animate attributeName="baseFrequency" values=".009 .018;.014 .024;.010 .015;.009 .018" dur="7s" repeatCount="indefinite"/>
    </feTurbulence>
    <feDisplacementMap in="SourceGraphic" in2="current" scale="24" xChannelSelector="R" yChannelSelector="G">
      <animate attributeName="scale" values="20;29;22;20" dur="7s" repeatCount="indefinite"/>
    </feDisplacementMap>
  </filter>
  <filter id="${id("fire")}" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency=".034" numOctaves="2" seed="${n}" result="n">
      <animate attributeName="baseFrequency" dur="6s" values=".03;.046;.03" repeatCount="indefinite"/></feTurbulence>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="13" xChannelSelector="R" yChannelSelector="G"/></filter>
  <clipPath id="${id("chill-l")}"><path d="M72.5 97 A10.5 10.5 0 0 0 93.5 97 Z"/></clipPath>
  <clipPath id="${id("chill-r")}"><path d="M106.5 97 A10.5 10.5 0 0 0 127.5 97 Z"/></clipPath>
  <clipPath id="${id("au-clip")}"><path d="${AURORA_BODY}"/></clipPath>
</defs></svg>
<div class="v-bob"><div class="v-tilt"><div class="v-squish">
  <svg class="v-layer v-hole" viewBox="0 0 200 200" aria-hidden="true">${forms(url)}</svg>
  <div class="v-layer v-crumbs"></div>
  <svg class="v-layer v-face" viewBox="0 0 200 200" aria-hidden="true">
    <g class="v-greeting"><path d="M149 107 Q160 92 169 83"/><path d="M166 81 L171 75 L175 81 L181 83 L175 87 L173 93 L168 87 L162 85Z"/></g>
    <g class="v-eyes">
      <g class="v-eye-l">${eyeStyles(83, -1, id)}</g>
      <g class="v-eye-r">${eyeStyles(117, 1, id)}</g>
    </g>
    <g class="v-lids v-happy"><path d="M73 101 Q83 89 93 101"/><path d="M107 101 Q117 89 127 101"/></g>
    <g class="v-lids v-wink-r"><path d="M107 99 Q117 91 127 99"/></g>
    <g class="v-lids v-sleep"><path d="M74 99 Q83 106 92 99"/><path d="M108 99 Q117 106 126 99"/></g>
    <g class="v-lids v-dizzy"><path d="M83 98 m-7 0 a7 7 0 1 1 7 7 a5 5 0 1 1 -5 -5 a3 3 0 1 1 3 3"/><path d="M117 98 m-7 0 a7 7 0 1 1 7 7 a5 5 0 1 1 -5 -5 a3 3 0 1 1 3 3"/></g>
    <g class="v-hearts"><path d="M83 106 l-8 -7.5 a4.6 4.6 0 0 1 8 -5 a4.6 4.6 0 0 1 8 5 z"/><path d="M117 106 l-8 -7.5 a4.6 4.6 0 0 1 8 -5 a4.6 4.6 0 0 1 8 5 z"/></g>
    <g class="v-shades"><rect x="69" y="89" width="28" height="17" rx="6"/><rect x="103" y="89" width="28" height="17" rx="6"/>
      <path d="M97 95 H103" class="v-bridge"/><path class="v-shine" d="M74 93 L80 93 M108 93 L114 93"/></g>
    <g class="v-mask"><path d="M52 90 Q100 80 148 90 L148 106 Q100 116 52 106 Z"/>
      <path class="v-slit" d="M73 98 Q83 94 93 98"/><path class="v-slit" d="M107 98 Q117 94 127 98"/>
      <path class="v-tail" d="M148 94 q14 -6 20 4 M148 100 q12 2 16 12"/></g>
    <ellipse class="v-blush" cx="68" cy="115" rx="8" ry="4.4"/><ellipse class="v-blush" cx="132" cy="115" rx="8" ry="4.4"/>
    <g class="v-mouths">
      <path class="v-smile" d="M93 116 Q100 123 107 116"/>
      <path class="v-cat" d="M91 115 q4.5 5 9 0 q4.5 5 9 0"/>
      <g class="v-tongue"><path d="M93 115 Q100 122 107 115" class="v-smile-t"/><path d="M98 119 q2 6 5 0" class="v-tongue-t"/></g>
      <ellipse class="v-mouth" cx="100" cy="119" rx="5.5" ry="6.5"/>
      <ellipse class="v-yawn" cx="100" cy="120" rx="7" ry="9"/>
    </g>
    <g class="v-mug"><path class="mug-steam" d="M104 104 q-3 -4 0 -8 q3 -4 0 -8"/><path class="mug-steam m2" d="M112 104 q-3 -4 0 -8 q3 -4 0 -8"/>
      <rect x="98" y="108" width="20" height="18" rx="4" class="mug-body"/><path d="M118 112 h3 a4 4 0 0 1 0 8 h-3" class="mug-handle"/>
      <path d="M104.5 117 l-2.3 -2.1 a1.4 1.4 0 0 1 2.3 -1.6 a1.4 1.4 0 0 1 2.3 1.6 z" class="mug-heart"/></g>
  </svg>
  <svg class="v-layer v-acc" viewBox="0 0 200 200" aria-hidden="true">
    <g class="acc acc-halo"><ellipse cx="100" cy="36" rx="24" ry="6.5" filter="${url("blur")}"/><ellipse cx="100" cy="36" rx="22" ry="5.5"/></g>
    <g class="acc acc-crown"><path d="M78 56 L81 36 L91 47 L100 31 L109 47 L119 36 L122 56 Z"/>
      <circle cx="100" cy="47" r="3" class="gem"/><circle cx="86" cy="51" r="2" class="gem"/><circle cx="114" cy="51" r="2" class="gem"/></g>
    <g class="acc acc-ears"><path d="M64 70 L68 34 L92 55 Z" class="ear"/><path d="M136 70 L132 34 L108 55 Z" class="ear"/>
      <path d="M70 58 L72 43 L83 53 Z" class="inner"/><path d="M130 58 L128 43 L117 53 Z" class="inner"/></g>
    <g class="acc acc-bow"><path d="M126 60 L110 50 L112 70 Z"/><path d="M126 60 L142 50 L140 70 Z"/><circle cx="126" cy="60" r="5" class="knot"/></g>
    <g class="acc acc-antenna"><g class="sway"><path d="M100 52 Q98 38 106 26" class="stem"/><circle cx="106" cy="24" r="6" class="ball"/>
      <circle cx="106" cy="24" r="10" class="ball-glow" filter="${url("blur")}"/></g></g>
    <g class="acc acc-wizard"><path d="M72 58 Q100 46 128 58 L112 8 Q108 2 104 10 Z"/><ellipse cx="100" cy="57" rx="32" ry="6" class="brim"/>
      <path d="M106 28 l2 4 4 1 -4 2 -2 4 -1 -4 -4 -2 4 -1z M96 44 l1.5 3 3 .8 -3 1.5 -1.5 3 -1 -3 -3 -1.5 3 -.8z" class="stars"/></g>
    <g class="acc acc-phones"><path d="M50 100 A50 52 0 0 1 150 100" class="band"/><rect x="42" y="88" width="14" height="28" rx="6"/><rect x="144" y="88" width="14" height="28" rx="6"/></g>
    <g class="acc acc-sprout"><path d="M100 52 Q99 42 101 34" class="stem"/><path d="M101 38 Q86 26 82 36 Q92 44 101 38" class="leaf"/><path d="M101 36 Q114 22 120 32 Q110 42 101 36" class="leaf"/></g>
  </svg>
</div></div></div>
<div class="v-bubble" aria-hidden="true"></div>
<span class="v-wave" aria-hidden="true"></span><span class="v-wave v-wave2" aria-hidden="true"></span>
<span class="v-zero" aria-hidden="true"></span><span class="v-flash" aria-hidden="true"></span>
<div class="v-zzz" aria-hidden="true"><span>z</span><span>z</span><span>Z</span></div>
<div class="v-floor" aria-hidden="true"></div>`;
  }

  const savedForm = () => FORMS.includes(document.documentElement.dataset.form) ? document.documentElement.dataset.form : "blackhole";
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  const isStill = () => document.documentElement.classList.contains("still") || motionPreference.matches;
  function setForm(el, form) {
    for (const f of FORMS) el.classList.toggle("form-" + f, f === form);
  }
  // SVG filter motion (Voidy's flowing disk and eclipse flame) needs an explicit pause.
  function syncStill(el) {
    for (const svg of el.querySelectorAll("svg")) try { isStill() ? svg.pauseAnimations() : svg.unpauseAnimations(); } catch (_) {}
  }
  function mount(el, opts = {}) {
    el.classList.add("voidy");
    if (opts.mini) el.classList.add("mini");
    if (![...el.classList].some(c => c.startsWith("is-"))) el.classList.add("is-happy");
    el.innerHTML = markup(++count);
    if (opts.form) el.dataset.fixedForm = opts.form;
    setForm(el, opts.form || savedForm());
    syncStill(el);
    return el;
  }
  // Follow the saved form (lib/theme.js sets html[data-form]) on every
  // mascot that wasn't mounted with a fixed form; pause flames when still.
  new MutationObserver(() => {
    for (const el of document.querySelectorAll(".voidy:not([data-fixed-form])")) setForm(el, savedForm());
    for (const el of document.querySelectorAll(".voidy")) syncStill(el);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-form", "class"] });
  motionPreference.addEventListener("change", () => { for (const el of document.querySelectorAll(".voidy")) syncStill(el); });
  globalThis.VOIDY_MASCOT = { mount, FORMS, EYES, eyePreview };
})();
