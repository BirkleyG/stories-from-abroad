import { collection, getDocs } from "firebase/firestore";
import { db, firestoreReady } from "../lib/firebaseClient";
const copy = window.__facesCopy || {};
/* === DATA === */
const fallbackInterviews = [
  {slug:'amara-osei',name:'Amara Osei',age:34,religion:'Christian',occupation:'Carpenter',city:'Accra',country:'Ghana',date:'2026-03-05',lngLat:[-0.187,5.604],pic:24,descriptor:'A craftsman working with memory',excerpt:'The wood remembers everything. The grain tells you where the tree grew in shadow, where it grew in struggle.',article:[{type:'para',text:'In a courtyard workshop in Accra\'s Labadi neighborhood, Amara Osei works before dawn. By 5 a.m. the sound of hand-planing fills the still morning air.'},{type:'photo',id:'p1'},{type:'qa',q:'What does your father\'s workshop look like in your memory?',a:'Small. Always smaller than I remember. But the smell is identical \u2014 sawdust and palm oil and something underneath that I think is just time.'},{type:'pull',text:'I don\'t think of myself as making furniture. I think of myself as giving wood a second life.'},{type:'qa',q:'Do you think about who will own your furniture?',a:'Always. A chair should be made for the person who will sit in it for twenty years. Wood holds stories. So does sitting.'},{type:'photo',id:'p2'}]},
  {slug:'mei-lan-xu',name:'Mei-Lan Xu',age:67,religion:'Buddhist',occupation:'Tea Farmer',city:'Pu\'er',country:'China',date:'2026-02-18',lngLat:[101.0,22.8],pic:43,descriptor:'Keeper of ancient tea groves',excerpt:'A good tea should make you feel like you are standing in the place where the leaves were grown. That is the only test that matters.',article:[{type:'para',text:'Mei-Lan Xu has tended the same hillside tea garden in Yunnan\'s Pu\'er Prefecture for forty years. The oldest trees on her land are over three hundred years old.'},{type:'photo',id:'p1'},{type:'qa',q:'How do you decide when the tea is ready to pick?',a:'You look at the second leaf. Not the first \u2014 the first is always eager. The second leaf will tell you the truth.'},{type:'pull',text:'My grandmother told me that tea keeps memory. She thought you could taste the past in a very old tree.'},{type:'qa',q:'What do you hope for from your grove in the next hundred years?',a:'That someone will still be here to tend it. They need a person who comes every morning and pays attention.'}]},
  {slug:'sebastian-mora',name:'Sebasti\u00e1n Mora',age:28,religion:'Catholic',occupation:'Fisherman',city:'Cartagena',country:'Colombia',date:'2026-03-01',lngLat:[-75.5,10.4],pic:65,descriptor:'Young fisherman of the Colombian coast',excerpt:'The sea doesn\'t care about you personally. That\'s what I respect about it. You cannot talk your way out of a wave.',article:[{type:'para',text:'Sebasti\u00e1n Mora grew up watching his grandfather repair nets in the harbor at Bocagrande. Now he runs a three-man boat that leaves before sunrise most days of the year.'},{type:'photo',id:'p1'},{type:'qa',q:'What do you think about out on the water at night?',a:'Mostly I think about nothing. That\'s the gift of it. My mind just clears. I think that\'s the real reason people fish. Not the fish.'},{type:'pull',text:'My grandfather said the ocean would always feed us. I still believe him, mostly. Though I think we are testing that patience.'}]},
  {slug:'fatima-al-rashidi',name:'Fatima Al-Rashidi',age:45,religion:'Muslim',occupation:'Midwife',city:'Amman',country:'Jordan',date:'2026-01-22',lngLat:[35.93,31.95],pic:91,descriptor:'A midwife who has witnessed four thousand beginnings',excerpt:'I have been in the room for more than four thousand births. Each one is the first time. You cannot get used to it.',article:[{type:'para',text:'Fatima Al-Rashidi trained as a nurse in Amman and became a midwife almost by accident. She now runs a small clinic serving Jordanian and refugee families.'},{type:'photo',id:'p1'},{type:'qa',q:'What do you carry from the difficult births?',a:'There are faces I have memorized without trying to. They stay because they need to.'},{type:'pull',text:'I have watched the impossible happen four thousand times.'}]},
  {slug:'elspeth-macdougall',name:'Elspeth MacDougall',age:72,religion:'Presbyterian',occupation:'Lighthouse Keeper, ret.',city:'Stromness',country:'Scotland',date:'2026-02-10',lngLat:[-3.3,58.97],pic:14,descriptor:'Forty years keeping the light on the Orkney coast',excerpt:'You learn to love small things when there\'s nothing between you and the horizon. A proper cup of tea becomes a very serious matter.',article:[{type:'para',text:'Elspeth MacDougall kept the light at Hoy High from 1978 until automation arrived in 2001.'},{type:'photo',id:'p1'},{type:'qa',q:'What surprised you most about living alone on a lighthouse?',a:'That I was never lonely. There is a difference between loneliness and solitude. Loneliness is an absence. Solitude is a presence.'},{type:'pull',text:'The light was never mine. I only kept it going. You are temporary. The light is permanent.'}]},
  {slug:'dmitri-volkov',name:'Dmitri Volkov',age:48,religion:'Russian Orthodox',occupation:'Ice Road Trucker',city:'Irkutsk',country:'Russia',date:'2026-01-15',lngLat:[104.3,52.3],pic:37,descriptor:'Driver of roads that exist only in winter',excerpt:'In Siberia, the cold is not your enemy. You can respect the cold. What kills people is impatience.',article:[{type:'para',text:'For three months each year, Dmitri Volkov drives trucks across ice roads over Lake Baikal that vanish in spring.'},{type:'photo',id:'p1'},{type:'qa',q:'How do you know when the ice is safe?',a:'Experience and instruments, and never trusting just one. The ice speaks if you know how to listen.'},{type:'pull',text:'There is a road that exists only because of the cold. That feels like a gift you cannot decline.'}]},
  {slug:'priya-nair',name:'Priya Nair',age:31,religion:'Hindu',occupation:'Handloom Weaver',city:'Thrissur',country:'India',date:'2026-03-08',lngLat:[76.21,10.52],pic:83,descriptor:'Weaving tradition into the contemporary',excerpt:'Every Kasavu sari begins with a thread count. But what you are counting is the hours of someone\'s life that went into the cloth.',article:[{type:'para',text:'Priya Nair learned to weave at fifteen, from her grandmother, on a loom still in use today.'},{type:'photo',id:'p1'},{type:'qa',q:'What gets lost when weaving is industrialized?',a:'The irregularity. When you wear handloom cloth, you\'re wearing someone\'s attention, their particular hands. That\'s what disappears.'},{type:'pull',text:'I used to think I was saving a craft. Now I think the craft is saving me.'},{type:'photo',id:'p2'}]},
  {slug:'tomas-varga',name:'Tom\u00e1s Varga',age:55,religion:'Catholic',occupation:'Beekeeper',city:'Mendoza',country:'Argentina',date:'2026-02-28',lngLat:[-68.84,-32.89],pic:52,descriptor:'A keeper of fifty thousand small lives',excerpt:'A hive is not a colony. It is a single organism that happens to be made of individual creatures. That distinction is everything.',article:[{type:'para',text:'Tom\u00e1s Varga keeps nineteen hives in the foothills east of Mendoza, between vineyards and scrubland.'},{type:'photo',id:'p1'},{type:'qa',q:'What have bees taught you that nothing else could?',a:'That everything in nature operates with a purpose that doesn\'t require your understanding. Bees remind me to have more humility.'},{type:'pull',text:'Fear and respect are not the same thing, and bees deserve the second, not the first.'}]}
];

let interviews = fallbackInterviews;
let byDate = [];

function setDerived() {
  byDate = [...interviews].sort((a,b) => new Date(b.date) - new Date(a.date));
}

function normalizeInterview(iv, idx) {
  let dateVal = iv.date && typeof iv.date.toDate === "function" ? iv.date.toDate() : iv.date;
  let dateStr = dateVal ? new Date(dateVal).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
  let lngLat = Array.isArray(iv.lngLat) && iv.lngLat.length === 2
    ? iv.lngLat
    : (iv.location && typeof iv.location.longitude === "number" && typeof iv.location.latitude === "number")
      ? [iv.location.longitude, iv.location.latitude]
      : (typeof iv.lng === "number" && typeof iv.lat === "number")
        ? [iv.lng, iv.lat]
        : [0,0];
  let article = Array.isArray(iv.article) ? iv.article : [];
  return {
    slug: iv.slug || iv.id || portrait-,
    name: iv.name || "Unknown",
    age: iv.age || "",
    religion: iv.religion || "",
    occupation: iv.occupation || "",
    city: iv.city || "",
    country: iv.country || "",
    date: dateStr,
    lngLat: lngLat,
    pic: iv.pic ?? (idx + 1),
    descriptor: iv.descriptor || "",
    excerpt: iv.excerpt || "",
    article: article,
  };
}

async function loadInterviews() {
  if (!firestoreReady || !db) {
    interviews = fallbackInterviews;
    return;
  }
  try {
    const snap = await getDocs(collection(db, "faces"));
    const data = snap.docs.map((doc, idx) => normalizeInterview({ id: doc.id, ...doc.data() }, idx));
    interviews = data.length ? data : fallbackInterviews;
  } catch (err) {
    console.warn("Firestore unavailable, using fallback.", err);
    interviews = fallbackInterviews;
  }
}

/* === MAP === */
const W=960, H=500;
let proj, geoPath, worldData, countriesData;
const svgEl = document.getElementById('map-svg');
const svgD3 = d3.select(svgEl);

async function buildMap() {
  try {
    worldData = await d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
    document.getElementById('map-loading').style.display = 'none';
    proj = d3.geoEquirectangular().scale(153).translate([W/2, H/2+20]).precision(.1);
    geoPath = d3.geoPath().projection(proj);
    const defs = svgD3.append('defs');
    const gf = defs.append('filter').attr('id','gg').attr('x','-22%').attr('y','-22%').attr('width','144%').attr('height','144%');
    gf.append('feGaussianBlur').attr('in','SourceGraphic').attr('stdDeviation','2').attr('result','b');
    gf.append('feColorMatrix').attr('in','b').attr('type','matrix').attr('values','0.8 0.5 0 0 0  0.5 0.36 0 0 0  0 0 0 0 0  0 0 0 0.5 0').attr('result','g');
    const gm = gf.append('feMerge'); gm.append('feMergeNode').attr('in','g'); gm.append('feMergeNode').attr('in','SourceGraphic');
    svgD3.append('rect').attr('width',W).attr('height',H).attr('fill','#000');
    svgD3.append('path').attr('d', geoPath(d3.geoGraticule().step([20,20])())).attr('fill','none').attr('stroke','rgba(201,168,76,.044)').attr('stroke-width',.25);
    countriesData = topojson.feature(worldData, worldData.objects.countries);
    countriesData.features.forEach(f => {
      svgD3.append('path').attr('d', geoPath(f)).attr('fill','none').attr('stroke','rgba(201,168,76,.09)').attr('stroke-width',.18).attr('stroke-linejoin','round');
    });
    svgD3.append('path').attr('d', geoPath(topojson.mesh(worldData, worldData.objects.countries, (a,b) => a===b))).attr('fill','none').attr('stroke','rgba(201,168,76,.86)').attr('stroke-width',.6).attr('stroke-linejoin','round').attr('stroke-linecap','round').attr('filter','url(#gg)');
    [{t:'PACIFIC OCEAN',lng:-150,lat:4},{t:'ATLANTIC OCEAN',lng:-30,lat:4},{t:'INDIAN OCEAN',lng:75,lat:-20},{t:'ARCTIC OCEAN',lng:0,lat:82}].forEach(o => {
      const [x,y] = proj([o.lng, o.lat]);
      svgD3.append('text').attr('x',x).attr('y',y).attr('text-anchor','middle').attr('fill','rgba(201,168,76,.14)').attr('font-size','7.2').attr('font-family',"'EB Garamond',serif").attr('font-style','italic').attr('letter-spacing','2').text(o.t);
    });
    buildPins();
    cloneMap('prof-map-bg');
    buildAboutMap();
  } catch(e) { document.getElementById('map-loading').textContent = copy.mapUnavailable; console.error(e); }
}

function cloneMap(id) {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = '';
  const c = svgEl.cloneNode(true); c.style.cssText = 'width:100%;height:100%;display:block;';
  el.appendChild(c);
}

/* === ABOUT MAP — 1/4 of world map centered on Shanghai coast, hero-style crimson pin === */
function buildAboutMap() {
  const el = document.getElementById('about-map-left'); if (!el || !proj) return;
  el.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  /* 1/4 of full map (960x500) = 240x125. Center on Shanghai (804,187).
     Nudge left so coast fills the element nicely. */
  svg.setAttribute('viewBox', '690 125 240 130');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';

  const defs = document.createElementNS(NS, 'defs');

  /* Gold glow for China outline */
  const fg = document.createElementNS(NS, 'filter'); fg.id = 'cg'; fg.setAttribute('x','-20%'); fg.setAttribute('y','-20%'); fg.setAttribute('width','140%'); fg.setAttribute('height','140%');
  const fgb = document.createElementNS(NS, 'feGaussianBlur'); fgb.setAttribute('in','SourceGraphic'); fgb.setAttribute('stdDeviation','1.5'); fgb.setAttribute('result','b');
  const fgc = document.createElementNS(NS, 'feColorMatrix'); fgc.setAttribute('in','b'); fgc.setAttribute('type','matrix'); fgc.setAttribute('values','0.8 0.5 0 0 0  0.5 0.3 0 0 0  0 0 0 0 0  0 0 0 0.75 0'); fgc.setAttribute('result','g');
  const fgm = document.createElementNS(NS, 'feMerge');
  ['g','SourceGraphic'].forEach(s => { const n = document.createElementNS(NS,'feMergeNode'); n.setAttribute('in',s); fgm.appendChild(n); });
  fg.appendChild(fgb); fg.appendChild(fgc); fg.appendChild(fgm); defs.appendChild(fg);

  /* Crimson glow for pin — matches hero map */
  const fr = document.createElementNS(NS, 'filter'); fr.id = 'rg'; fr.setAttribute('x','-60%'); fr.setAttribute('y','-60%'); fr.setAttribute('width','220%'); fr.setAttribute('height','220%');
  const frb = document.createElementNS(NS, 'feGaussianBlur'); frb.setAttribute('in','SourceGraphic'); frb.setAttribute('stdDeviation','2.5'); frb.setAttribute('result','b');
  const frc = document.createElementNS(NS, 'feColorMatrix'); frc.setAttribute('in','b'); frc.setAttribute('type','matrix'); frc.setAttribute('values','1.5 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.75 0'); frc.setAttribute('result','g');
  const frm = document.createElementNS(NS, 'feMerge');
  ['g','SourceGraphic'].forEach(s => { const n = document.createElementNS(NS,'feMergeNode'); n.setAttribute('in',s); frm.appendChild(n); });
  fr.appendChild(frb); fr.appendChild(frc); fr.appendChild(frm); defs.appendChild(fr);

  svg.appendChild(defs);

  /* Black bg */
  const bg = document.createElementNS(NS, 'rect'); bg.setAttribute('x','0'); bg.setAttribute('y','0'); bg.setAttribute('width','960'); bg.setAttribute('height','500'); bg.setAttribute('fill','#000'); svg.appendChild(bg);

  /* Faint graticule */
  const grat = geoPath(d3.geoGraticule().step([10,10])());
  const gr = document.createElementNS(NS, 'path'); gr.setAttribute('d', grat); gr.setAttribute('fill','none'); gr.setAttribute('stroke','rgba(201,168,76,.035)'); gr.setAttribute('stroke-width','0.28'); svg.appendChild(gr);

  if (countriesData) {
    /* Neighboring countries — faint */
    [704, 418, 356, 524, 104, 496, 398, 643, 408, 392, 410].forEach(cid => {
      const feat = countriesData.features.find(f => +f.id === cid); if (!feat) return;
      const p = document.createElementNS(NS, 'path'); p.setAttribute('d', geoPath(feat));
      p.setAttribute('fill','none'); p.setAttribute('stroke','rgba(201,168,76,.12)'); p.setAttribute('stroke-width','0.3'); p.setAttribute('stroke-linejoin','round'); svg.appendChild(p);
    });
    /* China fill + glowing outline */
    const china = countriesData.features.find(f => +f.id === 156);
    if (china) {
      const pf = document.createElementNS(NS, 'path'); pf.setAttribute('d', geoPath(china)); pf.setAttribute('fill','rgba(201,168,76,.026)'); pf.setAttribute('stroke','none'); svg.appendChild(pf);
      const po = document.createElementNS(NS, 'path'); po.setAttribute('d', geoPath(china)); po.setAttribute('fill','none'); po.setAttribute('stroke','rgba(201,168,76,.85)'); po.setAttribute('stroke-width','0.72'); po.setAttribute('stroke-linejoin','round'); po.setAttribute('filter','url(#cg)'); svg.appendChild(po);
    }
  }

  /* Shanghai crimson pin — same shape as hero pins, with non-scaling stroke */
  const [shX, shY] = proj([121.47, 31.23]);
  /* Scale pin to look similar in size to hero map pins.
     viewBox shows 240 SVG units ≈ (at 1440px screen, 64vw=921px) scale=3.84px/unit.
     Hero pin is 22px wide. Target: ~6 units wide → 6/20 = 0.3 scale. */
  const ps = 0.3;
  const pinG = document.createElementNS(NS, 'g');
  pinG.setAttribute('transform', 'translate('+shX+','+shY+') scale('+ps+') translate(-10,-27)');
  pinG.setAttribute('filter', 'url(#rg)');

  const pinBody = document.createElementNS(NS, 'path');
  pinBody.setAttribute('d', 'M10 1.5C5.86 1.5 2.5 4.82 2.5 8.95c0 5.92 6.38 10.62 7.1 16.18.07.4.58.4.65 0C11.02 19.57 17.5 14.84 17.5 8.95c0-4.13-3.36-7.45-7.5-7.45z');
  pinBody.setAttribute('fill', 'none');
  pinBody.setAttribute('stroke', '#ff2828');
  /* non-scaling-stroke keeps stroke width consistent regardless of transform */
  pinBody.setAttribute('vector-effect', 'non-scaling-stroke');
  pinBody.setAttribute('stroke-width', '1.3');
  pinBody.setAttribute('stroke-linejoin', 'round');
  pinG.appendChild(pinBody);

  const pinDot = document.createElementNS(NS, 'circle');
  pinDot.setAttribute('cx','10'); pinDot.setAttribute('cy','8.95'); pinDot.setAttribute('r','1.75');
  pinDot.setAttribute('fill','none'); pinDot.setAttribute('stroke','rgba(255,100,100,.6)');
  pinDot.setAttribute('vector-effect','non-scaling-stroke'); pinDot.setAttribute('stroke-width','0.8');
  pinG.appendChild(pinDot);

  const pinStem = document.createElementNS(NS, 'line');
  pinStem.setAttribute('x1','10'); pinStem.setAttribute('y1','20.8'); pinStem.setAttribute('x2','10'); pinStem.setAttribute('y2','27');
  pinStem.setAttribute('stroke','rgba(255,40,40,.6)');
  pinStem.setAttribute('vector-effect','non-scaling-stroke'); pinStem.setAttribute('stroke-width','0.9'); pinStem.setAttribute('stroke-linecap','round');
  pinG.appendChild(pinStem);

  svg.appendChild(pinG);

  el.appendChild(svg);
}

/* === PINS === */
function pinSVGHTML() {
  return '<svg class="pin-icon" viewBox="0 0 20 28" aria-hidden="true"><path class="pin-body" d="M10 1.5C5.86 1.5 2.5 4.82 2.5 8.95c0 5.92 6.38 10.62 7.1 16.18.07.4.58.4.65 0C11.02 19.57 17.5 14.84 17.5 8.95c0-4.13-3.36-7.45-7.5-7.45z"/><circle class="pin-dot" cx="10" cy="8.95" r="1.75"/><line class="pin-stem" x1="10" y1="20.8" x2="10" y2="27"/></svg>';
}

function buildPins() {
  const layer = document.getElementById('pin-layer'); layer.innerHTML = '';
  interviews.forEach(iv => {
    const el = document.createElement('div'); el.className = 'pin'; el.dataset.slug = iv.slug;
    el.innerHTML = pinSVGHTML() + '<div class="pin-name"><span class="typewriter"></span></div>';
    el.addEventListener('click', e => { e.stopPropagation(); showPreview(iv, el); });
    layer.appendChild(el);
  });
  requestAnimationFrame(() => {
    document.querySelectorAll('.pin-body').forEach(p => {
      try { const l = p.getTotalLength(); p.dataset.l = l; p.style.strokeDasharray = l; p.style.strokeDashoffset = l; } catch(e) {}
    });
    positionPins();
  });
}

function positionPins() {
  if (!proj) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  const ratio = W/H, sr = vw/vh;
  let scale, ox, oy;
  if (sr >= ratio) { scale = vw/W; ox = 0; oy = (H*scale-vh)/2; }
  else             { scale = vh/H; ox = (W*scale-vw)/2; oy = 0; }
  interviews.forEach(iv => {
    const pin = document.querySelector('.pin[data-slug="' + iv.slug + '"]'); if (!pin) return;
    const [px, py] = proj(iv.lngLat);
    pin.style.left = (px*scale - ox) + 'px';
    pin.style.top  = (py*scale - oy) + 'px';
  });
}

window.addEventListener('resize', () => {
  positionPins();
  if (document.getElementById('archive-view').style.display !== 'none' && archPs.length) { setArchHeight(); runArch(); }
});

/* === PIN DRAW / UNDRAW === */
function drawPin(pin) {
  pin._gen = (pin._gen || 0) + 1;
  const myGen = pin._gen;
  const pb = pin.querySelector('.pin-body'), pd = pin.querySelector('.pin-dot');
  const ps = pin.querySelector('.pin-stem'), pn = pin.querySelector('.pin-name');
  if (!pb) return;
  const l = parseFloat(pb.dataset.l || 82);
  pb.getAnimations().forEach(a => a.cancel());
  if (pd) { pd.getAnimations().forEach(a => a.cancel()); pd.style.opacity = '0'; }
  if (ps) { ps.getAnimations().forEach(a => a.cancel()); ps.style.opacity = '0'; }
  if (pn) pn.classList.remove('show');
  pin._drawn = false; delete pin.dataset.drawn;
  pin.style.opacity = '1'; pin.classList.add('show');
  pin.style.filter = 'drop-shadow(0 0 7px rgba(255,40,40,.55))';
  pb.style.strokeDasharray = l; pb.style.strokeDashoffset = l;
  const anim = pb.animate([{strokeDashoffset: l+'px'}, {strokeDashoffset: '0px'}], {duration:900, easing:'cubic-bezier(0.22,0.5,0.36,1)', fill:'forwards'});
  anim.onfinish = () => {
    if (pin._gen !== myGen) return;
    pin._drawn = true; pin.dataset.drawn = '1';
    if (pd) pd.animate([{opacity:0},{opacity:1}], {duration:240, fill:'forwards'});
    if (ps) ps.animate([{opacity:0},{opacity:1}], {duration:240, fill:'forwards'});
    if (pn) pn.classList.add('show');
  };
}

function resetPin(pin) {
  pin._gen = (pin._gen || 0) + 1;
  const myGen = pin._gen;
  const pb = pin.querySelector('.pin-body'), pd = pin.querySelector('.pin-dot');
  const ps = pin.querySelector('.pin-stem'), pn = pin.querySelector('.pin-name');
  const tw = pn ? pn.querySelector('.typewriter') : null;
  if (pd) { pd.getAnimations().forEach(a => a.cancel()); pd.style.opacity = '0'; }
  if (ps) { ps.getAnimations().forEach(a => a.cancel()); ps.style.opacity = '0'; }
  if (pn) pn.classList.remove('show');
  if (tw) { tw.textContent = ''; tw.classList.remove('done'); }
  const wasDrawn = pin._drawn === true;
  pin._drawn = false; delete pin.dataset.drawn;
  if (!pb) { pin.style.opacity='0'; pin.classList.remove('show'); pin.style.filter=''; return; }
  const l = parseFloat(pb.dataset.l || 82);
  pb.getAnimations().forEach(a => a.cancel());
  if (wasDrawn) {
    pb.style.strokeDashoffset = '0px';
    const anim = pb.animate([{strokeDashoffset:'0px'},{strokeDashoffset:l+'px'}], {duration:520, easing:'cubic-bezier(0.55,0,0.9,0.4)', fill:'forwards'});
    anim.onfinish = () => {
      if (pin._gen !== myGen) return;
      pb.style.strokeDashoffset = l + 'px';
      pin.style.opacity = '0'; pin.classList.remove('show'); pin.style.filter = '';
    };
  } else {
    pb.style.strokeDashoffset = l + 'px';
    pin.style.opacity = '0'; pin.classList.remove('show'); pin.style.filter = '';
  }
}

/* === HERO SCROLL (3680vh total) === */
setDerived();
const CART_END  = 0.06;   /* cartouche exits — 1.5× longer */
const SEQ_START = 0.07;   /* first pin */
const PIN_STEP  = 0.0792; /* 10% faster than before */
const TYPE_DELAY= 0.022;
const TYPE_DUR  = 0.048;
const ALL_AT    = 0.86;
const SEQ_COUNT = 5;      /* first 5 pins sequential, rest burst */
const BURST_AT  = SEQ_START + SEQ_COUNT * PIN_STEP + 0.01;
const revealed  = new Set();
let   heroLocked = false, lockScrollY = 0;

function initScroll() {
  const heroEl = document.getElementById('hero');
  const cart   = document.getElementById('hero-cartouche');

  /* 4. Scroll lock — block downward scroll once all pins are revealed */
  window.addEventListener('wheel', e => {
    if (heroLocked && e.deltaY > 0 && document.getElementById('main-view').style.display !== 'none') {
      e.preventDefault();
    }
  }, {passive: false});
  let _touchStartY = 0;
  window.addEventListener('touchstart', e => { _touchStartY = e.touches[0].clientY; }, {passive:true});
  window.addEventListener('touchmove', e => {
    if (heroLocked && e.touches[0].clientY < _touchStartY && document.getElementById('main-view').style.display !== 'none') {
      e.preventDefault();
    }
  }, {passive: false});

  window.addEventListener('scroll', () => {
    if (document.getElementById('main-view').style.display === 'none') return;
    const max = heroEl.offsetHeight - window.innerHeight; if (max <= 0) return;
    const p = Math.min(1, Math.max(0, window.scrollY / max));

    /* Lock at ALL_AT — snap back if user somehow scrolled past */
    if (p >= ALL_AT) {
      if (!heroLocked) { heroLocked = true; lockScrollY = window.scrollY; }
      if (window.scrollY > lockScrollY) window.scrollTo(0, lockScrollY);
    } else {
      heroLocked = false;
    }

    const cp = Math.min(1, p / CART_END);
    cart.style.transform = 'translateY(' + (cp * -120) + 'vh)';
    cart.style.opacity   = String(1 - cp * 0.28);
    const showAll = p >= ALL_AT;
    byDate.forEach((iv, i) => {
      const pin = document.querySelector('.pin[data-slug="' + iv.slug + '"]'); if (!pin) return;
      const pn  = pin.querySelector('.pin-name'), tw = pn.querySelector('.typewriter');
      const isBurst  = i >= SEQ_COUNT;
      const pinStart = isBurst ? BURST_AT : SEQ_START + i * PIN_STEP;
      const typeStart = pinStart + TYPE_DELAY;
      const rev = p >= pinStart || showAll;
      if (rev) {
        if (!revealed.has(iv.slug)) { revealed.add(iv.slug); drawPin(pin); }
        /* All pins show their name — burst pins show it immediately after draw */
        if (pin.dataset.drawn) {
          const chars = Math.ceil(Math.min(1, Math.max(0, (p - typeStart) / (TYPE_DUR || 0.001))) * iv.name.length);
          tw.textContent = iv.name.slice(0, chars);
          chars >= iv.name.length ? tw.classList.add('done') : tw.classList.remove('done');
        }
      } else if (revealed.has(iv.slug)) {
        revealed.delete(iv.slug);
        resetPin(pin);
      }
    });
  }, {passive:true});
}

/* === PIN PREVIEW (viewport-clamped) === */
let activePv = null;
function showPreview(iv, pinEl) {
  closePreview();
  const card = document.createElement('div'); card.className = 'pin-preview';
  const layer = document.getElementById('pin-layer');
  const pr = pinEl.getBoundingClientRect(), lr = layer.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const PW = 270, PH = 240, NAV = 62;
  let lv = pr.right + 10, tv = pr.top - PH/2;
  if (lv + PW > vw - 12) lv = pr.left - PW - 10;
  lv = Math.max(12, Math.min(lv, vw - PW - 12));
  tv = Math.max(NAV, Math.min(tv, vh - PH - 12));
  card.style.left = (lv - lr.left) + 'px';
  card.style.top  = (tv - lr.top)  + 'px';
  card.innerHTML = '<button class="pv-close">\u2715</button><p class="pv-loc">' + iv.city + ', ' + iv.country + '</p><p class="pv-name">' + iv.name + '</p><p class="pv-occ">' + iv.occupation + '</p><p class="pv-excerpt">' + iv.excerpt + '</p><button class="pv-btn">' + copy.previewButton + '</button>';
  card.querySelector('.pv-close').addEventListener('click', e => { e.stopPropagation(); closePreview(); });
  card.querySelector('.pv-btn').addEventListener('click', () => goProfile(iv.slug));
  layer.appendChild(card); activePv = card;
}
function closePreview() { if (activePv) { activePv.remove(); activePv = null; } }
document.addEventListener('click', e => { if (activePv && !activePv.contains(e.target)) closePreview(); });

/* === NAV SEARCH OVERLAY === */
function initNavSearch() {
  const wrap    = document.getElementById('nav-search-wrap');
  const ico     = document.getElementById('nav-search-ico');
  const inp     = document.getElementById('nav-search-inp');
  const overlay = document.getElementById('search-overlay');

  function renderDropdown(hits, query) {
    const label = query
      ? '<div class="so-header">' + copy.searchHeaderMatches + ' &ldquo;' + query + '&rdquo;</div>'
      : '<div class="so-header">' + copy.searchHeaderAll + '</div>';
    if (!hits.length) {
      overlay.innerHTML = label + '<div class="so-none">' + copy.searchEmpty + '</div>';
    } else {
      overlay.innerHTML = label +
        hits.slice(0, 8).map(iv =>
          '<div class="so-card" data-slug="' + iv.slug + '">' +
            '<span class="so-name">' + iv.name + '</span>' +
            '<span class="so-loc">' + iv.city + ', ' + iv.country + '</span>' +
            '<span class="so-occ">' + iv.occupation + '</span>' +
          '</div>'
        ).join('');
      overlay.querySelectorAll('.so-card').forEach(c => {
        c.addEventListener('mousedown', e => {
          e.preventDefault(); // don't blur input
          closeSearch();
          goProfile(c.dataset.slug);
        });
      });
    }
    overlay.style.display = 'block';
  }

  function doSearch() {
    const q = inp.value.trim().toLowerCase();
    const hits = q
      ? interviews.filter(iv =>
          [iv.name, iv.city, iv.country, iv.occupation, iv.religion, iv.descriptor, iv.excerpt].join(' ').toLowerCase().includes(q)
        )
      : [...interviews].sort((a,b) => new Date(b.date) - new Date(a.date));
    renderDropdown(hits, inp.value.trim());
  }

  function closeSearch() {
    overlay.style.display = 'none';
    wrap.classList.remove('open');
    inp.value = '';
  }

  ico.addEventListener('click', () => {
    const opening = !wrap.classList.contains('open');
    if (opening) {
      wrap.classList.add('open');
      setTimeout(() => { inp.focus(); doSearch(); }, 360);
    } else {
      closeSearch();
    }
  });

  inp.addEventListener('input', doSearch);
  inp.addEventListener('focus', doSearch);

  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSearch();
    if (e.key === 'Enter' && inp.value.trim()) doSearch();
  });

  document.addEventListener('click', e => {
    if (!wrap.contains(e.target) && !overlay.contains(e.target)) {
      overlay.style.display = 'none';
    }
  });
}

/* === ARCHIVE === */
let archPs = [], lastArchIdx = -1;
const PER    = 4.5;
const PH_BLUR = 0.18, PH_HOLD = 0.44, PH_SLIDE = 0.68, PH_DONE = 0.96;

function filterInterviews() {
  const q  = (document.getElementById('af-search')?.value  || '').toLowerCase().trim();
  const fa = document.getElementById('af-faith')?.value  || '';
  const oc = document.getElementById('af-occ')?.value    || '';
  const yr = document.getElementById('af-year')?.value   || '';
  let r = interviews;
  if (q)  r = r.filter(iv => [iv.name,iv.city,iv.country,iv.occupation,iv.religion,iv.excerpt,iv.descriptor].join(' ').toLowerCase().includes(q));
  if (fa) r = r.filter(iv => iv.religion  === fa);
  if (oc) r = r.filter(iv => iv.occupation=== oc);
  if (yr) r = r.filter(iv => iv.date.startsWith(yr));
  return r;
}

function setArchHeight() {
  const d = document.getElementById('archive-scroll-driver'); if (!d) return;
  d.style.height = (archPs.length * PER * window.innerHeight + window.innerHeight) + 'px';
}

function makeSlide(iv, idx, total) {
  const isRight = idx % 2 === 1;
  const div = document.createElement('div'); div.className = 'stage-slot';
  const img = document.createElement('img');
  img.src = 'https://picsum.photos/seed/' + iv.pic + '/1600/900';
  img.alt = iv.name;
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;filter:brightness(0.62) saturate(0.75)';
  div.appendChild(img);
  const ul = document.createElement('label'); ul.className = 'stage-upload';
  ul.style[isRight ? 'right' : 'left'] = '1.1rem';
  const ui = document.createElement('input'); ui.type='file'; ui.accept='image/*';
  const us = document.createElement('span'); us.textContent = copy.replacePhotoLabel;
  ul.appendChild(ui); ul.appendChild(us);
  ui.addEventListener('change', e => { const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>{img.src=ev.target.result;}; r.readAsDataURL(f); });
  div.appendChild(ul);
  const ov = document.createElement('div'); ov.style.cssText='position:absolute;inset:0;pointer-events:none'; ov.dataset.ov='1'; div.appendChild(ov);
  const panel = document.createElement('div'); panel.className='ptp '+(isRight?'ptp-r':'ptp-l');
  panel.style.opacity = '0'; // start hidden; scroll-driven blur phase fades it in
  panel.innerHTML = '<p class="ptp-idx">' + copy.portraitPrefix + ' ' + String(idx+1).padStart(2,'0') + ' / ' + String(total).padStart(2,'0') + '</p><p class="ptp-loc">' + iv.city + ', ' + iv.country + '</p><h2 class="ptp-name">' + iv.name + '</h2><div class="ptp-div"></div><p class="ptp-occ">' + iv.occupation + '</p><p class="ptp-exc">' + iv.excerpt + '</p><button class="ptp-rb" data-slug="' + iv.slug + '">' + copy.previewButton + '</button>';
  panel.querySelector('.ptp-rb').addEventListener('click', () => goProfile(iv.slug));
  div.appendChild(panel);
  return div;
}

function renderArchive(data) {
  archPs = [...data].sort((a,b) => new Date(b.date) - new Date(a.date));
  lastArchIdx = -1;
  const empty = document.getElementById('arch-empty'), stage = document.getElementById('archive-stage');
  const bubblesEl = document.getElementById('arch-bubbles');
  if (!archPs.length) { empty.style.display='flex'; stage.style.display='none'; bubblesEl.style.display='none'; document.getElementById('archive-scroll-driver').style.height='10px'; return; }
  empty.style.display = 'none'; stage.style.display = 'block'; setArchHeight();
  /* Build navigation bubbles */
  bubblesEl.innerHTML = '';
  bubblesEl.style.display = 'flex';
  archPs.forEach((iv, i) => {
    const b = document.createElement('div');
    b.className = 'arch-bub' + (i === 0 ? ' active' : '');
    b.title = iv.name;
    b.addEventListener('click', () => {
      const driver = document.getElementById('archive-scroll-driver');
      if (!driver) return;
      const driverTop = driver.getBoundingClientRect().top + window.scrollY;
      const targetY = driverTop + i * PER * window.innerHeight + PER * window.innerHeight * PH_BLUR;
      window.scrollTo({ top: targetY, behavior: 'smooth' });
    });
    bubblesEl.appendChild(b);
  });
  document.getElementById('stage-back').innerHTML  = '';
  document.getElementById('stage-front').innerHTML = '';
  document.getElementById('stage-front').style.transform = 'translateY(0)';
  document.getElementById('stage-back').style.opacity = '0';
  requestAnimationFrame(runArch);
}

function runArch() {
  if (document.getElementById('archive-view').style.display === 'none') return;
  if (!archPs.length) return;
  const driver = document.getElementById('archive-scroll-driver'); if (!driver) return;
  const driverTop = driver.getBoundingClientRect().top + window.scrollY;
  const vh = window.innerHeight, perPx = PER * vh;
  const scrolled = Math.max(0, window.scrollY - driverTop);
  const raw = scrolled / perPx;
  let idx = Math.floor(raw), prog = raw - Math.floor(raw);
  if (idx >= archPs.length) { idx = archPs.length - 1; prog = 1; }
  /* FINAL portrait: lock — never slide up */
  const isLast = idx >= archPs.length - 1;
  if (isLast) prog = Math.min(prog, PH_HOLD + 0.005);
  const front = document.getElementById('stage-front');
  const back  = document.getElementById('stage-back');
  if (idx !== lastArchIdx) {
    lastArchIdx = idx;
    front.style.transform = 'translateY(0)';
    back.style.opacity = '0';
    front.innerHTML = '';
    const fs = makeSlide(archPs[idx], idx, archPs.length);
    fs.style.cssText = 'position:absolute;inset:0';
    front.appendChild(fs);
    /* Back shows next portrait — always behind front */
    back.innerHTML = '';
    if (!isLast && idx + 1 < archPs.length) {
      const bs = makeSlide(archPs[idx+1], idx+1, archPs.length);
      bs.style.cssText = 'position:absolute;inset:0';
      back.appendChild(bs);
    }
    /* Update active bubble */
    document.querySelectorAll('.arch-bub').forEach((b,i) => b.classList.toggle('active', i === idx));
  }
  animSlide(front.firstElementChild, prog, idx % 2 === 1, back, isLast);
}

function animSlide(slide, prog, isRight, backEl, isLast) {
  if (!slide) return;
  const img   = slide.querySelector('img');
  const ov    = slide.querySelector('[data-ov]');
  const panel = slide.querySelector('.ptp');
  const frontEl = document.getElementById('stage-front');

  if (prog < PH_BLUR) {
    if (img)   img.style.filter   = 'brightness(0.62) saturate(0.75) blur(0px)';
    if (ov)    ov.style.background = 'rgba(0,0,0,0)';
    if (panel) { panel.style.opacity='0'; panel.style.transform='translateX('+(isRight?'22px':'-22px')+')'; panel.style.pointerEvents='none'; }
    frontEl.style.transform = 'translateY(0)';
    if (backEl) backEl.style.opacity = '0';
  } else if (prog < PH_HOLD) {
    const t = (prog - PH_BLUR) / (PH_HOLD - PH_BLUR);
    if (img)   img.style.filter   = 'brightness('+(0.62-t*0.24)+') saturate(0.75) blur('+(t*12)+'px)';
    if (ov)    ov.style.background = 'rgba(0,0,0,'+(t*0.18)+')';
    if (panel) { const op=Math.min(1,t*1.4); panel.style.opacity=String(op); panel.style.transform='translateX('+((1-op)*(isRight?22:-22))+'px)'; if(t>0.1)panel.style.pointerEvents='auto'; }
    frontEl.style.transform = 'translateY(0)';
    if (backEl) backEl.style.opacity = '0';
  } else if (prog < PH_SLIDE || isLast) {
    /* Hold phase (and locked final portrait stays here forever) */
    if (img)   img.style.filter   = 'brightness(0.38) saturate(0.75) blur(12px)';
    if (ov)    ov.style.background = 'rgba(0,0,0,.18)';
    if (panel) { panel.style.opacity='1'; panel.style.transform='translateX(0)'; panel.style.pointerEvents='auto'; }
    frontEl.style.transform = 'translateY(0)';
    if (backEl) backEl.style.opacity = '0';
  } else {
    /* Slide up — back is already visible underneath (z-index lower), front lifts to reveal it */
    const t = Math.min(1, (prog - PH_SLIDE) / (PH_DONE - PH_SLIDE));
    if (img)   img.style.filter   = 'brightness('+(0.38-t*0.3)+') saturate(0.75) blur('+(12+t*4)+'px)';
    if (panel) { const fade=Math.max(0,1-t*2.2); panel.style.opacity=String(fade); panel.style.transform='translateX('+(t*(isRight?18:-18))+'px)'; if(fade<0.05)panel.style.pointerEvents='none'; }
    frontEl.style.transform = 'translateY(-'+(t*100)+'vh)';
    /* Back is always behind front — just make it visible so it's there when front lifts */
    if (backEl) backEl.style.opacity = '1';
  }
}

function initArchiveFilters() {
  ['af-search','af-faith','af-occ','af-year'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.addEventListener(el.tagName==='INPUT' ? 'input' : 'change', () => { lastArchIdx=-1; renderArchive(filterInterviews()); });
  });
}

window.addEventListener('scroll', () => {
  if (document.getElementById('archive-view').style.display !== 'none') runArch();
}, {passive:true});

/* === PROFILE === */
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function fmtDate(d) { const dt=new Date(d+'T00:00:00'); return MONTHS[dt.getMonth()]+' '+dt.getDate()+', '+dt.getFullYear(); }

function renderProfile(iv) {
  const blocks = iv.article.map(b => {
    if (b.type==='para')  return '<p class="art-para">'+b.text+'</p>';
    if (b.type==='qa')    return '<div class="art-qa"><div class="art-q">'+b.q+'</div><div class="art-a">'+b.a+'</div></div>';
    if (b.type==='pull')  return '<div class="art-pull"><div class="art-pull-text">'+b.text+'</div></div>';
    if (b.type==='photo') return '<div class="art-photo-slot"><div class="art-photo-ph"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(201,168,76,.28)" stroke-width="1.2"><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>' + copy.addPhotoLabel + '</span></div><input type="file" accept="image/*"></div>';
    return '';
  }).join('');
  document.getElementById('prof-content').innerHTML = '<div class="prof-hero-cart"><div class="prof-split"><div class="prof-portrait-zone" id="ppz"><div class="prof-portrait-bg"></div><div class="upload-hint"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(201,168,76,.38)" stroke-width="1.1"><circle cx="12" cy="8" r="5"/><path d="M3 20c0-5 4-8.5 9-8.5s9 3.5 9 8.5"/></svg>' + copy.uploadPortraitLabel + '</div><input type="file" accept="image/*" id="pp-inp"></div><div class="prof-meta"><p class="prof-location">'+iv.city+', '+iv.country+' \u00b7 '+fmtDate(iv.date)+'</p><h1 class="prof-name">'+iv.name+'</h1><p class="prof-desc">'+iv.descriptor+'</p><div class="prof-dets"><div class="prof-det"><span class="det-k">' + copy.profileLabels.age + '</span><span class="det-v">'+iv.age+'</span></div><div class="prof-det"><span class="det-k">' + copy.profileLabels.faith + '</span><span class="det-v">'+iv.religion+'</span></div><div class="prof-det"><span class="det-k">' + copy.profileLabels.work + '</span><span class="det-v">'+iv.occupation+'</span></div><div class="prof-det"><span class="det-k">' + copy.profileLabels.location + '</span><span class="det-v">'+iv.city+', '+iv.country+'</span></div></div><p class="prof-excerpt">'+iv.excerpt+'</p></div></div></div><div class="prof-article-wrap"><div class="prof-article-cart">'+blocks+'</div></div>';
  const bw = document.createElement('div'); bw.style.cssText='position:relative;z-index:2;padding:.75rem 2.8vw';
  bw.innerHTML='<button class="back-btn" id="prof-back"><svg width="13" height="9" viewBox="0 0 14 10" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="13" y1="5" x2="1" y2="5"/><polyline points="5,1 1,5 5,9"/></svg> ' + copy.backLabel + '</button>';
  document.getElementById('prof-content').insertBefore(bw, document.getElementById('prof-content').firstChild);
  document.getElementById('prof-back').addEventListener('click', goArchive);
  const ppz=document.getElementById('ppz'), ppi=document.getElementById('pp-inp');
  ppz.addEventListener('click', () => ppi.click());
  ppi.addEventListener('change', e => { const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>{ppz.innerHTML='<img src="'+ev.target.result+'" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">'; ppz.style.cursor='default'; ppz.style.pointerEvents='none';}; r.readAsDataURL(f); });
  document.querySelectorAll('.art-photo-slot').forEach(slot => {
    const inp=slot.querySelector('input'), ph=slot.querySelector('.art-photo-ph');
    slot.addEventListener('click', () => inp.click());
    inp.addEventListener('change', e => { const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>{ ph.classList.add('hidden'); const imgEl=document.createElement('img'); imgEl.src=ev.target.result; slot.appendChild(imgEl); slot.style.border='none'; slot.style.cursor='default'; }; r.readAsDataURL(f); });
  });
}

/* === ROUTING === */
function goProfile(s) { window.location.hash = '#/profile/' + s; }
function goHome()     { window.location.hash = ''; }
function goArchive()  { window.location.hash = '#/archive'; }
function goAbout()    { window.location.hash = '#/about'; }

function handleRoute() {
  const h = window.location.hash;
  ['main-view','archive-view','about-view','profile-view'].forEach(id => document.getElementById(id).style.display='none');
  document.getElementById('archive-stage').style.display = 'none';
  document.getElementById('arch-bubbles').style.display = 'none';
  if (h.startsWith('#/profile/')) {
    const iv = interviews.find(i => i.slug === h.slice(10));
    if (iv) { renderProfile(iv); document.getElementById('profile-view').style.display='block'; window.scrollTo(0,0); return; }
  }
  if (h === '#/archive') {
    document.getElementById('archive-view').style.display = 'block';
    lastArchIdx = -1; renderArchive(filterInterviews()); window.scrollTo(0,0); return;
  }
  if (h === '#/about') {
    document.getElementById('about-view').style.display = 'block';
    if (proj && !document.getElementById('about-map-left').firstElementChild) buildAboutMap();
    window.scrollTo(0,0); return;
  }
  document.getElementById('main-view').style.display = 'block';
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadInterviews();
  setDerived();
  buildMap();
  initScroll();
  initArchiveFilters();
  initNavSearch();
  handleRoute();
  document.getElementById('nav-home').addEventListener('click', goHome);
  document.getElementById('nav-archive-btn').addEventListener('click', goArchive);
  document.getElementById('nav-about-btn').addEventListener('click', goAbout);
  window.addEventListener('hashchange', handleRoute);
});
