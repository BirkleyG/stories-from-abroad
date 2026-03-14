import { useState, useEffect, useRef } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db, firestoreReady } from "../lib/firebaseClient";
import {
  completeSubscriberSignInFromLink,
  fallbackNameFromEmail,
  getCurrentAuthUser,
  getSubscriberRecord,
  isSubscriberProfileActive,
  normalizeEmail,
  onSubscriberAuthChange,
  sendSubscriberSignInLink,
  upsertSubscriberRecord,
} from "../lib/subscriberClient";
import * as THREE from "three";
import { siteCopy } from "../content/siteCopy";

// ── CONSTANTS ──────────────────────────────────────────────────────────────────

const copy = siteCopy.dispatches;
const RED = "#CC1111";
const CURRENT_LOC = copy.currentLocation;



const QUOTES = copy.quotes;
const POSTS = copy.posts;
const CATS = copy.categories;
const INITIAL_COMMENTS = copy.defaultComments;
const QUICK_REACTIONS = ["❤️", "🔥", "😂", "😮", "✈️", "🌍", "👏", "✨", "🥳", "💯"];

// ── HELPERS ───────────────────────────────────────────────────────────────────

function getElapsed(newer, older) {
  var days = Math.round(Math.abs(newer - older) / 86400000);
  if (days < 30) return days + " day" + (days !== 1 ? "s" : "");
  var m = Math.round(days / 30);
  if (days < 365) return m + " month" + (m !== 1 ? "s" : "");
  var y = Math.round(days / 365);
  return y + " year" + (y !== 1 ? "s" : "");
}

function readTime(text) {
  var words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

function matchesSearch(post, q) {
  if (!q) return true;
  var lq = q.toLowerCase();
  var cat = CATS[post.category] || { label: post.category || copy.filters.defaultCategoryLabel, color: "#8A7B6C" };
  var catLabel = cat ? cat.label : String(post.category || "");
  return (
    post.title.toLowerCase().includes(lq) ||
    post.preview.toLowerCase().includes(lq) ||
    post.full.toLowerCase().includes(lq) ||
    post.location.toLowerCase().includes(lq) ||
    catLabel.toLowerCase().includes(lq)
  );
}

function decodeLandPaths(topo) {
  var sc = topo.transform.scale, tr = topo.transform.translate;
  var decoded = topo.arcs.map(function(arc) {
    var x = 0, y = 0;
    return arc.map(function(pt) { x += pt[0]; y += pt[1]; return [x * sc[0] + tr[0], y * sc[1] + tr[1]]; });
  });
  function getArc(i) { if (i < 0) { var a = decoded[~i].slice(); a.reverse(); return a; } return decoded[i]; }
  function ringPts(indices) {
    var pts = [];
    indices.forEach(function(idx, j) { getArc(idx).forEach(function(pt, k) { if (j === 0 || k > 0) pts.push(pt); }); });
    return pts;
  }
  var paths = [];
  function processGeom(g) {
    if (!g) return;
    if (g.type === "Polygon") g.arcs.forEach(function(r) { paths.push(ringPts(r)); });
    else if (g.type === "MultiPolygon") g.arcs.forEach(function(poly) { poly.forEach(function(r) { paths.push(ringPts(r)); }); });
    else if (g.type === "GeometryCollection") g.geometries.forEach(processGeom);
  }
  processGeom(topo.objects.land);
  return paths;
}

function llToV3(lng, lat) {
  var lr = lat * Math.PI / 180, lo = lng * Math.PI / 180;
  return new THREE.Vector3(Math.cos(lr) * Math.cos(lo), Math.sin(lr), Math.cos(lr) * Math.sin(lo));
}

const COLLECTIONS = {
  posts: "scrap_sheet_posts",
  quotes: "scrap_sheet_quotes",
};

function formatDate(d) {
  try {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch (e) {
    return "";
  }
}

function formatTime(d) {
  try {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

function normalizePost(p) {
  var dateObj = p.dateObj
    ? p.dateObj
    : p.date && typeof p.date.toDate === "function"
      ? p.date.toDate()
      : p.date
        ? new Date(p.date)
        : new Date();
  var dateStr = p.dateStr || formatDate(dateObj);
  var photos = Array.isArray(p.photos) ? p.photos : [];
  var reactionCounts = Array.isArray(p.reactionCounts) ? p.reactionCounts : [];
  var defaultReactions = reactionCounts.length
    ? reactionCounts.reduce(function(acc, item) {
        if (item && item.emoji) acc[item.emoji] = Number(item.count) || 0;
        return acc;
      }, {})
    : p.defaultReactions || {};
  return {
    id: String(p.id || ""),
    category: p.category || "travel",
    location: p.location || "",
    dateStr: dateStr,
    time: p.time || "",
    dateObj: dateObj,
    title: p.title || "Untitled",
    preview: p.preview || "",
    full: p.full || "",
    photos: photos,
    defaultReactions: defaultReactions,
    pinned: Boolean(p.pinned),
  };
}

function normalizeQuote(q) {
  return {
    id: String(q.id || ""),
    text: q.text || "",
    postId: String(q.postId || ""),
  };
}

function reactionsFromPosts(list) {
  var out = {};
  list.forEach(function(p) {
    out[p.id] = p.defaultReactions || {};
  });
  return out;
}

// ── STYLES ────────────────────────────────────────────────────────────────────

function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,600&family=Jost:wght@300;400;500;600&family=Lora:ital,wght@0,400;0,500;1,400&family=Courier+Prime:ital,wght@0,400;0,700;1,400&display=swap');
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      html{scroll-behavior:smooth}
      ::-webkit-scrollbar{width:4px}
      ::-webkit-scrollbar-thumb{background:#C8BEB0}
      :root{
        --cream:#F0E9DF;--paper:#FAFAF6;--ink:#1B1410;--ink2:#4D3F34;
        --muted:#8A7B6C;--rule:#D8CFC4;--red:#CC1111;--red2:#AA0A0A;
        --red-faint:rgba(204,17,17,0.07);
      }
      @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
      @keyframes fadeIn{from{opacity:0}to{opacity:1}}
      @keyframes pop{from{opacity:0;transform:scale(0.97) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
      @keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.7);opacity:0.35}}
      @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
      @keyframes hlCard{
        0%{box-shadow:0 1px 4px rgba(27,20,16,0.06),0 4px 18px rgba(27,20,16,0.04);border-color:var(--rule)}
        30%{box-shadow:0 0 0 3px var(--red),0 6px 24px rgba(204,17,17,0.2);border-color:var(--red)}
        100%{box-shadow:0 1px 4px rgba(27,20,16,0.06),0 4px 18px rgba(27,20,16,0.04);border-color:var(--rule)}
      }

      .card{
        background:var(--paper);border:1px solid var(--rule);
        padding:28px 28px 24px;position:relative;overflow:hidden;
        box-shadow:0 1px 4px rgba(27,20,16,0.06),0 4px 18px rgba(27,20,16,0.04);
        transition:transform .22s ease,box-shadow .22s ease;cursor:pointer;
        animation:fadeUp .5s ease both;
      }
      .card:hover{transform:translateY(-2px);box-shadow:0 2px 8px rgba(27,20,16,0.1),0 8px 28px rgba(27,20,16,0.08)}
      .card.hl{animation:hlCard 1.8s ease forwards}

      .fbtn{padding:6px 15px;border:1px solid var(--rule);border-radius:2px;background:transparent;font-family:'Jost',sans-serif;font-size:12px;font-weight:500;letter-spacing:.06em;color:var(--muted);cursor:pointer;transition:all .18s ease;white-space:nowrap}
      .fbtn:hover{border-color:var(--ink);color:var(--ink)}
      .fbtn.on{background:var(--ink);color:var(--cream);border-color:var(--ink)}

      .nava{font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:400;font-style:italic;color:rgba(240,233,223,0.72);text-decoration:none;letter-spacing:.06em;transition:color .15s}
      .nava:hover{color:var(--cream)}

      .subbtn{padding:4px 13px 5px;background:transparent;color:rgba(240,233,223,0.82);border:1px solid rgba(255,255,255,0.35);border-radius:1px;font-family:'Courier Prime',monospace;font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;cursor:pointer;transition:all .2s;position:relative}
      .subbtn::before{content:'';position:absolute;inset:2px;border:1px solid rgba(255,255,255,0.15);pointer-events:none}
      .subbtn:hover{background:var(--cream);color:var(--red);border-color:var(--cream)}
      .subbtn:hover::before{border-color:rgba(204,17,17,0.25)}

      .fsubbtn{background:rgba(255,255,255,0.12);color:rgba(240,233,223,0.88);padding:4px 13px 5px;border:1px solid rgba(255,255,255,0.3);border-radius:1px;font-family:'Courier Prime',monospace;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;transition:all .2s}
      .fsubbtn:hover{background:var(--cream);color:var(--red)}

      .readmore{background:none;border:none;color:var(--red);cursor:pointer;font-family:'Jost',sans-serif;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;padding:0;transition:opacity .15s}
      .readmore:hover{opacity:.65}

      .xbtn{width:32px;height:32px;border:1px solid var(--rule);border-radius:2px;background:white;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--muted);flex-shrink:0;transition:all .15s}
      .xbtn:hover{background:var(--ink);color:var(--cream);border-color:var(--ink)}

      .tinput{flex:1;padding:9px 13px;border:1px solid var(--rule);border-radius:2px;font-family:'Lora',serif;font-size:14px;background:var(--paper);color:var(--ink);outline:none;resize:none;transition:border-color .18s}
      .tinput:focus{border-color:var(--red)}

      .sendbtn{padding:9px 16px;background:var(--ink);color:var(--cream);border:none;border-radius:2px;font-family:'Jost',sans-serif;font-size:12px;font-weight:600;letter-spacing:.07em;cursor:pointer;align-self:flex-end;transition:background .18s}
      .sendbtn:hover{background:var(--red)}

      .einput{width:100%;padding:11px 14px;border:1px solid var(--rule);border-radius:2px;font-family:'Jost',sans-serif;font-size:14px;background:white;color:var(--ink);outline:none;transition:border-color .18s}
      .einput:focus{border-color:var(--red)}

      .ctabtn{width:100%;padding:12px 24px;background:white;color:var(--red);border:none;border-radius:2px;font-family:'Jost',sans-serif;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .2s}
      .ctabtn:hover{background:var(--cream);transform:translateY(-1px)}

      .overlay{animation:fadeIn .2s ease}
      .mbox{animation:pop .28s ease}

      .pemoji{background:none;border:none;cursor:pointer;font-size:20px;padding:5px;border-radius:4px;transition:background .1s;line-height:1}
      .pemoji:hover{background:var(--cream)}

      .react-circle{width:40px;height:40px;border-radius:50%;border:1.5px solid var(--rule);background:white;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;transition:all .15s;position:relative;flex-shrink:0}
      .react-circle:hover{border-color:var(--red);transform:scale(1.1)}
      .react-circle.on{border-color:var(--red);background:var(--red-faint)}

      .react-pill{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:24px;border:1.5px solid var(--rule);background:white;font-family:'Jost',sans-serif;font-size:12px;color:var(--ink2);cursor:pointer;transition:all .15s;line-height:1}
      .react-pill:hover{border-color:var(--red)}
      .react-pill.on{border-color:var(--red);background:var(--red-faint);color:var(--red);font-weight:600}

      .quote-btn{background:none;border:none;cursor:pointer;padding:0;text-align:left;transition:opacity .18s}
      .quote-btn:hover{opacity:.72}

      .lb-arrow{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;background:rgba(27,20,16,0.6);border:1px solid rgba(255,255,255,0.15);color:white;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .18s;z-index:10;backdrop-filter:blur(4px)}
      .lb-arrow:hover{background:rgba(204,17,17,0.8)}

      .search-input{flex:1;padding:0;border:none;background:transparent;font-family:'Jost',sans-serif;font-size:13px;color:rgba(240,233,223,0.9);outline:none;letter-spacing:.02em;min-width:0}
      .search-input::placeholder{color:rgba(240,233,223,0.35)}

      .filmstrip::-webkit-scrollbar{height:3px}
      .filmstrip::-webkit-scrollbar-thumb{background:#3A2A1A}

      @media (max-width: 900px){
        .dispatch-header-inner{padding:0 16px!important;grid-template-columns:auto 1fr auto!important;gap:10px}
        .dispatch-nav{gap:12px!important}
        .dispatch-nav .nava,.dispatch-nav .subbtn{display:none!important}
        .dispatch-search-box input{width:120px!important}
        .dispatch-logo{font-size:16px!important}
        .dispatch-search-meta{right:-2px!important}
        .dispatch-hero{padding:56px 20px 112px!important;min-height:64vh!important}
        .dispatch-hero-copy{max-width:100%!important}
        .dispatch-hero-globe{right:18px!important;bottom:18px!important;transform:scale(.78);transform-origin:bottom right}
        .dispatch-filter-inner{padding:16px 16px 14px!important}
        .dispatch-main{padding:28px 16px 56px!important}
        .dispatch-about{padding:56px 20px!important}
        .dispatch-footer{padding:18px 16px!important}
        .card{padding:20px 16px 16px}
      }

      @media (max-width: 640px){
        .dispatch-header-inner{height:54px!important;padding:0 10px!important;gap:8px}
        .dispatch-logo{display:none!important}
        .dispatch-back-link{font-size:9px!important;letter-spacing:.14em!important;gap:6px!important}
        .dispatch-nav{gap:8px!important}
        .dispatch-search-box{padding:3px 7px!important;gap:5px!important}
        .dispatch-search-box input{width:94px!important}
        .dispatch-search-meta{display:none!important}
        .dispatch-hero{padding:30px 14px 104px!important;min-height:58vh!important}
        .dispatch-hero-copy h1{font-size:clamp(44px,16vw,62px)!important;margin-bottom:16px!important}
        .dispatch-hero-copy p{font-size:14px!important;line-height:1.58!important;margin-bottom:14px!important}
        .dispatch-hero-globe{left:50%!important;right:auto!important;bottom:18px!important;transform:translateX(-50%) scale(.74)!important}
        .dispatch-filter-inner{padding:14px 12px!important;gap:6px!important}
        .fbtn{font-size:10px;padding:5px 10px}
        .dispatch-main{padding:22px 12px 46px!important}
        .dispatch-about{padding:42px 14px!important}
        .dispatch-about h2{margin-bottom:24px!important}
        .dispatch-about p{font-size:14px!important;line-height:1.66!important}
        .dispatch-footer{padding:14px 12px!important;gap:8px!important}
        .dispatch-footer .fsubbtn{width:100%;text-align:center}
        .overlay{padding:10px 8px 18px!important}
        .overlay .mbox{width:100%!important;max-height:92vh!important;overflow-y:auto!important}
        .overlay .mbox [style*="padding:28px 28px"]{padding:18px 14px 0!important}
        .overlay .mbox [style*="padding:0 28px 24px"]{padding:0 14px 18px!important}
        .overlay .mbox [style*="padding:16px 28px 20px"]{padding:14px 14px 16px!important}
        .overlay .mbox [style*="padding:14px 28px 6px"]{padding:12px 14px 6px!important}
        .overlay .mbox [style*="padding:6px 28px 14px"]{padding:6px 14px 12px!important}
        .overlay .mbox [style*="padding:0 28px 22px"]{padding:0 14px 14px!important}
        .lb-overlay{flex-direction:column!important}
        .lb-main{flex:1 1 auto!important;min-height:52vh}
        .lb-side{flex:0 0 auto!important;width:100%!important;padding:16px 12px 14px!important;max-height:45vh;overflow-y:auto}
        .lb-arrow{width:36px;height:36px;font-size:18px}
      }

      @media (max-width: 420px){
        .dispatch-hero-globe{display:none!important}
        .dispatch-hero{padding-bottom:28px!important;min-height:auto!important}
      }
    `}</style>
  );
}

// ── GLOBE ─────────────────────────────────────────────────────────────────────

function Globe() {
  var mountRef = useRef(null);
  useEffect(function() {
    var el = mountRef.current;
    if (!el) return;
    var S = 200;
    var scene = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    cam.position.z = 2.65;
    var rdr = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    rdr.setSize(S, S); rdr.setClearColor(0, 0); rdr.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(rdr.domElement); rdr.domElement.style.cursor = "grab";

    var grp = new THREE.Group();
    scene.add(grp);
    grp.rotation.y = (CURRENT_LOC.lng - 90) * Math.PI / 180;

    var gridMat = new THREE.LineBasicMaterial({ color: 0xCC1111, transparent: true, opacity: 0.1 });
    var eqMat   = new THREE.LineBasicMaterial({ color: 0xCC1111, transparent: true, opacity: 0.2 });
    var ringMat = new THREE.LineBasicMaterial({ color: 0xCC1111, transparent: true, opacity: 0.82 });
    var landMat = new THREE.LineBasicMaterial({ color: 0xCC1111, transparent: true, opacity: 0.65 });

    // Grid lines
    var latVals = [-60, -30, 0, 30, 60];
    for (var li = 0; li < latVals.length; li++) {
      var lat0 = latVals[li], lr0 = lat0 * Math.PI / 180, r0 = Math.cos(lr0), y0 = Math.sin(lr0), latPts = [];
      for (var gi = 0; gi <= 64; gi++) { var ga = gi/64*Math.PI*2; latPts.push(new THREE.Vector3(r0*Math.cos(ga),y0,r0*Math.sin(ga))); }
      grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(latPts), lat0===0?eqMat:gridMat));
    }
    for (var lng0 = 0; lng0 < 360; lng0 += 30) {
      var lo0 = lng0*Math.PI/180, lngPts = [];
      for (var mi = 0; mi <= 64; mi++) { var mt = mi/64*Math.PI-Math.PI/2; lngPts.push(new THREE.Vector3(Math.cos(mt)*Math.cos(lo0),Math.sin(mt),Math.cos(mt)*Math.sin(lo0))); }
      grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(lngPts), gridMat));
    }

    // Outer ring (static)
    var rp = [];
    for (var ri = 0; ri <= 128; ri++) { var ra = ri/128*Math.PI*2; rp.push(new THREE.Vector3(Math.cos(ra),Math.sin(ra),0)); }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rp), ringMat));

    // Current location pin (filled)
    var pinV = llToV3(CURRENT_LOC.lng, CURRENT_LOC.lat);
    var pinMesh = new THREE.Mesh(new THREE.SphereGeometry(0.045,10,10), new THREE.MeshBasicMaterial({color:0xCC1111}));
    pinMesh.position.copy(pinV);
    grp.add(pinMesh);
    var prp = [];
    for (var qi = 0; qi <= 64; qi++) { var qa = qi/64*Math.PI*2; prp.push(new THREE.Vector3(Math.cos(qa)*0.09,Math.sin(qa)*0.09,0)); }
    var pinRing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(prp), new THREE.LineBasicMaterial({color:0xCC1111,transparent:true,opacity:0.5}));
    pinRing.position.copy(pinV); pinRing.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), pinV.clone().normalize());
    grp.add(pinRing);

    // GeoJSON land outlines
    fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json")
      .then(function(r) { return r.json(); })
      .then(function(topo) {
        decodeLandPaths(topo).forEach(function(ring) {
          if (ring.length < 2) return;
          grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring.map(function(c) { return llToV3(c[0],c[1]); })), landMat));
        });
      }).catch(function() {});

    var drag=false,ox=0,oy=0,spin=true,timer=null;
    var cv=rdr.domElement;
    var dn=function(x,y){drag=true;spin=false;ox=x;oy=y;cv.style.cursor="grabbing";if(timer)clearTimeout(timer);};
    var mv=function(x,y){if(!drag)return;grp.rotation.y+=(x-ox)*0.006;grp.rotation.x=Math.max(-1,Math.min(1,grp.rotation.x+(y-oy)*0.006));ox=x;oy=y;};
    var up=function(){drag=false;cv.style.cursor="grab";timer=setTimeout(function(){spin=true;},1400);};
    var md=function(e){dn(e.clientX,e.clientY);};
    var mm=function(e){mv(e.clientX,e.clientY);};
    var ts=function(e){dn(e.touches[0].clientX,e.touches[0].clientY);};
    var tm=function(e){if(!drag)return;e.preventDefault();mv(e.touches[0].clientX,e.touches[0].clientY);};
    cv.addEventListener("mousedown",md);window.addEventListener("mousemove",mm);window.addEventListener("mouseup",up);
    cv.addEventListener("touchstart",ts,{passive:true});window.addEventListener("touchmove",tm,{passive:false});window.addEventListener("touchend",up);

    var raf;
    var animate=function(){raf=requestAnimationFrame(animate);if(!drag&&spin)grp.rotation.y+=0.0018;rdr.render(scene,cam);};
    animate();
    return function(){
      cancelAnimationFrame(raf);if(timer)clearTimeout(timer);
      cv.removeEventListener("mousedown",md);window.removeEventListener("mousemove",mm);window.removeEventListener("mouseup",up);
      cv.removeEventListener("touchstart",ts);window.removeEventListener("touchmove",tm);window.removeEventListener("touchend",up);
      rdr.dispose();if(el.contains(cv))el.removeChild(cv);
    };
  }, []);
  return <div ref={mountRef} style={{width:200,height:200,userSelect:"none",flexShrink:0}} />;
}

// ── TYPEWRITER QUOTES ─────────────────────────────────────────────────────────

function TypewriterQuotes({ onQuoteClick, quotes }) {
  var list = quotes && quotes.length ? quotes : QUOTES;
  var st = useState({ idx: 0, chars: 0, del: false });
  var state = st[0], setState = st[1];
  useEffect(function() {
    if (!list.length) return;
    var idx=state.idx,chars=state.chars,del=state.del,q=list[idx].text,t;
    if (!del && chars < q.length)       t = setTimeout(function(){setState(function(s){return{idx:s.idx,chars:s.chars+1,del:false};});},48);
    else if (!del && chars===q.length)  t = setTimeout(function(){setState(function(s){return{idx:s.idx,chars:s.chars,del:true};});},2800);
    else if (del && chars > 0)          t = setTimeout(function(){setState(function(s){return{idx:s.idx,chars:s.chars-1,del:true};});},20);
    else setState(function(s){return{idx:(s.idx+1)%list.length,chars:0,del:false};});
    return function(){clearTimeout(t);};
  }, [state, list]);

  var q = list[state.idx] || { text: "", postId: "" };
  var done = state.chars === q.text.length && !state.del;
  return (
    <button className="quote-btn" onClick={function(){if(q.postId) onQuoteClick(q.postId);}}>
      <div style={{fontFamily:"'Courier Prime',monospace",fontSize:13,lineHeight:1.5,display:"flex",alignItems:"center",gap:2,flexWrap:"wrap"}}>
        <span style={{color:RED}}>{"\u201c"}</span>
        <span style={{color:RED}}>{q.text.slice(0,state.chars)}</span>
        {done
          ? <span style={{color:RED}}>{"\u201d"}</span>
          : <span style={{color:RED,animation:"blink 1s step-end infinite"}}>|</span>
        }
      </div>
    </button>
  );
}

// ── SVG COMPONENTS ────────────────────────────────────────────────────────────

function CategoryIcon({ type, color }) {
  var s = {stroke:color,fill:"none",strokeWidth:"1.25",strokeLinecap:"round",strokeLinejoin:"round"};
  if (type==="travel") return (
    <svg width="13" height="13" viewBox="0 0 13 13">
      <circle cx="6.5" cy="6.5" r="5.5" {...s}/><line x1="6.5" y1="1" x2="6.5" y2="12" {...s}/>
      <line x1="1" y1="6.5" x2="12" y2="6.5" {...s}/><circle cx="6.5" cy="6.5" r="1.5" fill={color} stroke="none"/>
    </svg>
  );
  if (type==="stories") return (
    <svg width="13" height="13" viewBox="0 0 13 13">
      <path d="M9.5 2 L7.5 4 L3 10 L2 11.5 L3.5 11 L10.5 5 L11.5 3 Z" {...s}/>
      <line x1="2.5" y1="11.5" x2="5.5" y2="10.5" {...s}/>
    </svg>
  );
  return (
    <svg width="13" height="13" viewBox="0 0 13 13">
      <ellipse cx="6.5" cy="5.5" rx="4.5" ry="3.5" {...s}/>
      <circle cx="5.5" cy="10" r="0.9" fill={color} stroke="none"/>
      <circle cx="7.5" cy="11.5" r="0.7" fill={color} stroke="none"/>
    </svg>
  );
}

function SearchIcon({ size, color }) {
  return (
    <svg width={size||16} height={size||16} viewBox="0 0 16 16" fill="none" stroke={color||"currentColor"} strokeWidth="1.5" strokeLinecap="round">
      <circle cx="6.5" cy="6.5" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
    </svg>
  );
}

function PhysicalPin() {
  return (
    <svg width="18" height="36" viewBox="0 0 18 36" style={{display:"block"}}>
      <circle cx="9" cy="9" r="8" fill="#CC1111" stroke="rgba(0,0,0,0.15)" strokeWidth="0.5"/>
      <ellipse cx="6.5" cy="6" rx="2.2" ry="1.8" fill="rgba(255,255,255,0.28)"/>
      <rect x="8" y="16" width="2" height="16" rx="1" fill="#9A0C0C"/>
      <polygon points="7.5,32 9,36 10.5,32" fill="#7A0808"/>
    </svg>
  );
}

function PostmarkStamp({ city, dateStr, category }) {
  var cat = CATS[category] || { color: "#8A7B6C" };
  var short = city.split(",")[0].toUpperCase(), color = cat.color;
  if (category==="travel") return (
    <div style={{position:"absolute",top:14,right:14,transform:"rotate(-7deg)",opacity:0.48,pointerEvents:"none",zIndex:1}}>
      <svg width="74" height="74" viewBox="0 0 74 74">
        <circle cx="37" cy="37" r="34" fill="none" stroke={color} strokeWidth="1.5"/>
        <circle cx="37" cy="37" r="27" fill="none" stroke={color} strokeWidth="0.6"/>
        <text x="37" y="33" textAnchor="middle" fontFamily="Courier Prime,monospace" fontSize="6.5" fill={color} letterSpacing="1.2">{short}</text>
        <line x1="20" y1="37" x2="54" y2="37" stroke={color} strokeWidth="0.7"/>
        <text x="37" y="44" textAnchor="middle" fontFamily="Courier Prime,monospace" fontSize="5.5" fill={color} letterSpacing="0.5">{dateStr.toUpperCase()}</text>
      </svg>
    </div>
  );
  if (category==="stories") return (
    <div style={{position:"absolute",top:14,right:14,transform:"rotate(-4deg)",opacity:0.46,pointerEvents:"none",zIndex:1}}>
      <svg width="86" height="58" viewBox="0 0 86 58">
        <rect x="2" y="2" width="82" height="54" fill="none" stroke={color} strokeWidth="1.5"/>
        <path d="M2,12 Q12,8 22,12 Q32,16 42,12 Q52,8 62,12 Q72,16 84,12" fill="none" stroke={color} strokeWidth="0.8"/>
        <path d="M2,46 Q12,42 22,46 Q32,50 42,46 Q52,42 62,46 Q72,50 84,46" fill="none" stroke={color} strokeWidth="0.8"/>
        <text x="43" y="28" textAnchor="middle" fontFamily="Courier Prime,monospace" fontSize="6.5" fill={color} letterSpacing="1">{short}</text>
        <text x="43" y="37" textAnchor="middle" fontFamily="Courier Prime,monospace" fontSize="5.5" fill={color} letterSpacing="0.3">{dateStr.toUpperCase()}</text>
      </svg>
    </div>
  );
  return (
    <div style={{position:"absolute",top:14,right:14,transform:"rotate(-5deg)",opacity:0.46,pointerEvents:"none",zIndex:1}}>
      <svg width="80" height="62" viewBox="0 0 80 62">
        <ellipse cx="40" cy="31" rx="37" ry="28" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="3,2"/>
        <ellipse cx="40" cy="31" rx="29" ry="21" fill="none" stroke={color} strokeWidth="0.5" strokeDasharray="2,3"/>
        <text x="40" y="28" textAnchor="middle" fontFamily="Courier Prime,monospace" fontSize="6.5" fill={color} letterSpacing="1">{short}</text>
        <line x1="16" y1="32" x2="64" y2="32" stroke={color} strokeWidth="0.6" strokeDasharray="2,2"/>
        <text x="40" y="40" textAnchor="middle" fontFamily="Courier Prime,monospace" fontSize="5.5" fill={color} letterSpacing="0.3">{dateStr.toUpperCase()}</text>
      </svg>
    </div>
  );
}

function FieldStamp() {
  return (
    <div style={{position:"absolute",top:34,right:52,transform:"rotate(3.5deg)",opacity:0.46,pointerEvents:"none",zIndex:2}}>
      <svg width="178" height="88" viewBox="0 0 178 88">
        <rect x="3" y="3" width="172" height="82" rx="3" fill="none" stroke={RED} strokeWidth="2.8"/>
        <rect x="9" y="9" width="160" height="70" rx="1.5" fill="none" stroke={RED} strokeWidth="0.9"/>
        <text x="89" y="31" textAnchor="middle" fontFamily="Courier Prime,monospace" fontSize="8.5" fontWeight="700" fill={RED} letterSpacing="5.5">DISPATCHES FROM</text>
        <line x1="22" y1="42" x2="156" y2="42" stroke={RED} strokeWidth="0.9"/>
        <text x="89" y="58" textAnchor="middle" fontFamily="Courier Prime,monospace" fontSize="13" fontWeight="700" fill={RED} letterSpacing="5">THE FIELD</text>
        <circle cx="22" cy="25" r="3.5" fill={RED} opacity="0.42"/>
        <circle cx="156" cy="25" r="3.5" fill={RED} opacity="0.42"/>
        <circle cx="22" cy="70" r="3.5" fill={RED} opacity="0.42"/>
        <circle cx="156" cy="70" r="3.5" fill={RED} opacity="0.42"/>
      </svg>
    </div>
  );
}

function TimeMarker({ elapsed }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:14,padding:"16px 0",margin:"4px 0"}}>
      <div style={{flex:1,height:1,background:"var(--rule)"}}/>
      <div style={{fontFamily:"'Courier Prime',monospace",fontSize:10,letterSpacing:".22em",textTransform:"uppercase",color:"var(--muted)",padding:"4px 14px",border:"1px solid var(--rule)",borderRadius:2,background:"var(--cream)",whiteSpace:"nowrap"}}>
        {elapsed}
      </div>
      <div style={{flex:1,height:1,background:"var(--rule)"}}/>
    </div>
  );
}

// ── PHOTO LIGHTBOX ────────────────────────────────────────────────────────────

function PhotoLightbox({ photos, startIdx, post, onClose }) {
  var idxS = useState(startIdx||0);
  var idx = idxS[0], setIdx = idxS[1];
  var photo = photos[idx];

  useEffect(function() {
    var h = function(e) {
      if (e.key==="Escape") onClose();
      if (e.key==="ArrowRight") setIdx(function(i){return Math.min(photos.length-1,i+1);});
      if (e.key==="ArrowLeft")  setIdx(function(i){return Math.max(0,i-1);});
    };
    document.addEventListener("keydown",h);
    return function(){document.removeEventListener("keydown",h);};
  }, [onClose, photos.length]);

  return (
    <div className="overlay lb-overlay" style={{position:"fixed",inset:0,background:"rgba(18,12,8,0.95)",zIndex:3000,display:"flex",alignItems:"stretch"}} onClick={onClose}>
      {/* Photo side */}
      <div className="lb-main" style={{flex:"1 1 60%",position:"relative",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}} onClick={function(e){e.stopPropagation();}}>
        <img src={photo.url} alt={photo.caption} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",display:"block"}}/>
        {idx > 0 && (
          <button className="lb-arrow" style={{left:20}} onClick={function(e){e.stopPropagation();setIdx(function(i){return i-1;});}}>&#8592;</button>
        )}
        {idx < photos.length-1 && (
          <button className="lb-arrow" style={{right:20}} onClick={function(e){e.stopPropagation();setIdx(function(i){return i+1;});}}>&#8594;</button>
        )}
      </div>
      {/* Caption side */}
      <div className="lb-side" style={{flex:"0 0 300px",background:"var(--paper)",display:"flex",flexDirection:"column",justifyContent:"space-between",padding:"36px 28px 28px"}} onClick={function(e){e.stopPropagation();}}>
        <div>
          <button className="xbtn" onClick={onClose} style={{marginBottom:24}}>&#215;</button>
          <div style={{fontFamily:"'Jost',sans-serif",fontSize:"9px",fontWeight:600,letterSpacing:".18em",textTransform:"uppercase",color:"var(--muted)",marginBottom:10}}>
            {idx+1} / {photos.length}
          </div>
          <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:600,color:"var(--ink)",lineHeight:1.2,marginBottom:8}}>
            {post.title}
          </h3>
          <div style={{fontFamily:"'Courier Prime',monospace",fontSize:11,color:"var(--muted)",marginBottom:20,letterSpacing:".06em"}}>
            {post.location} &mdash; {post.dateStr}
          </div>
          <div style={{height:1,background:"var(--rule)",marginBottom:20}}/>
          <p style={{fontFamily:"'Lora',serif",fontSize:15,color:"var(--ink2)",lineHeight:1.7,fontStyle:"italic"}}>
            {photo.caption}
          </p>
        </div>
        {/* Thumbnail strip */}
        <div style={{display:"flex",gap:6,marginTop:20,overflowX:"auto"}} className="filmstrip lb-filmstrip">
          {photos.map(function(p,i) {
            return (
              <img key={i} src={p.url} alt="" onClick={function(){setIdx(i);}}
                style={{width:48,height:34,objectFit:"cover",flexShrink:0,cursor:"pointer",border:i===idx?"2px solid "+RED:"2px solid transparent",opacity:i===idx?1:0.55,transition:"all .15s"}}/>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PhotoFilmstrip({ photos, onPhotoClick }) {
  var activeS = useState(0);
  var active = activeS[0], setActive = activeS[1];
  if (!photos || photos.length === 0) return null;

  return (
    <div style={{marginTop:24}}>
      {/* Strip label + count */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{fontFamily:"'Jost',sans-serif",fontSize:"9px",fontWeight:600,letterSpacing:".16em",textTransform:"uppercase",color:"var(--muted)"}}>
          Film
        </div>
        <div style={{fontFamily:"'Courier Prime',monospace",fontSize:10,color:"var(--muted)",letterSpacing:".08em"}}>
          {active+1} / {photos.length}
        </div>
      </div>

      {/* Dark filmstrip tray */}
      <div style={{
        background:"#1A1410",
        borderRadius:3,
        padding:"10px 12px",
        overflowX:"auto",
        display:"flex",
        gap:6,
        alignItems:"center",
      }} className="filmstrip">
        {photos.map(function(p, i) {
          var isActive = i === active;
          return (
            <div
              key={i}
              onClick={function(){ setActive(i); onPhotoClick(i); }}
              style={{
                flexShrink:0,
                cursor:"pointer",
                border: isActive ? "2px solid "+RED : "2px solid rgba(255,255,255,0.12)",
                borderRadius:2,
                overflow:"hidden",
                width:100,
                height:68,
                position:"relative",
                transition:"border-color .18s, transform .18s",
                transform: isActive ? "scale(1.04)" : "scale(1)",
                background:"#2A2018",
              }}
              onMouseEnter={function(e){if(!isActive)e.currentTarget.style.borderColor="rgba(204,17,17,0.6)";}}
              onMouseLeave={function(e){if(!isActive)e.currentTarget.style.borderColor="rgba(255,255,255,0.12)";}}
            >
              <img
                src={p.url}
                alt={p.caption}
                style={{width:"100%",height:"100%",objectFit:"cover",display:"block",pointerEvents:"none"}}
                onError={function(e){
                  e.currentTarget.style.display="none";
                  e.currentTarget.parentNode.style.background="#2A2018";
                }}
              />
              {/* Frame corner marks */}
              {[["0px","0px"],["0px","auto"],["auto","0px"],["auto","auto"]].map(function(pos,ci){
                return (
                  <div key={ci} style={{
                    position:"absolute",top:pos[0],bottom:pos[1],
                    left:ci<2?"0px":"auto",right:ci>=2?"0px":"auto",
                    width:6,height:6,
                    borderTop:ci<2?"1.5px solid rgba(255,255,255,0.28)":"none",
                    borderBottom:ci>=2?"1.5px solid rgba(255,255,255,0.28)":"none",
                    borderLeft:(ci===0||ci===2)?"1.5px solid rgba(255,255,255,0.28)":"none",
                    borderRight:(ci===1||ci===3)?"1.5px solid rgba(255,255,255,0.28)":"none",
                    pointerEvents:"none",
                  }}/>
                );
              })}
              {/* Frame number */}
              <div style={{
                position:"absolute",bottom:2,right:4,
                fontFamily:"'Courier Prime',monospace",fontSize:8,
                color:"rgba(255,255,255,0.22)",letterSpacing:".06em",
                pointerEvents:"none",
              }}>{String(i+1).padStart(2,"0")}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── EMOJI PICKER ──────────────────────────────────────────────────────────────

var PRESET = QUICK_REACTIONS;

// ── POST CARD ─────────────────────────────────────────────────────────────────

function PostCard({ post, reactions, userReacted, onReact, onExpand, highlighted }) {
  var cat = CATS[post.category] || { label: post.category || copy.filters.defaultCategoryLabel, color: "#8A7B6C" };
  var topR = Object.entries(reactions).filter(function(e){return e[1]>0;}).sort(function(a,b){return b[1]-a[1];}).slice(0,4);

  return (
    <div id={"dispatch-"+post.id} style={{position:"relative",paddingTop:26,scrollMarginTop:"68px"}}>
      <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",zIndex:5}}>
        <PhysicalPin />
      </div>
      <div className={"card"+(highlighted?" hl":"")} onClick={onExpand}>
        <PostmarkStamp city={post.location} dateStr={post.dateStr} category={post.category}/>
        <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%) rotate(-12deg)",fontFamily:"'Courier Prime',monospace",fontSize:34,fontWeight:700,color:"rgba(204,17,17,0.03)",whiteSpace:"nowrap",pointerEvents:"none",userSelect:"none",textTransform:"uppercase",letterSpacing:".08em",lineHeight:1.2,textAlign:"center"}}>
          {post.location.split(",")[0]}<br/>{post.dateStr}
        </div>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,color:cat.color,fontFamily:"'Jost',sans-serif",fontSize:10,fontWeight:600,letterSpacing:".15em",textTransform:"uppercase"}}>
            <CategoryIcon type={post.category} color={cat.color}/>{cat.label}
            {post.pinned&&<span style={{marginLeft:6,opacity:0.6,fontSize:9}}>&#9679; {copy.pinnedLabel}</span>}
          </div>
        </div>

        <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,fontWeight:600,color:"var(--ink)",lineHeight:1.2,marginBottom:10,letterSpacing:"-.01em"}}>
          {post.title}
        </h2>

        <div style={{fontFamily:"'Courier Prime',monospace",fontSize:11,color:"var(--muted)",marginBottom:14,letterSpacing:".07em",transform:"rotate(-1.2deg)",transformOrigin:"left center",display:"inline-block"}}>
          {post.location} &mdash; {post.dateStr} &middot; {post.time}
        </div>

        <p style={{fontFamily:"'Lora',serif",fontSize:14,color:"var(--ink2)",lineHeight:1.72,marginBottom:16}}>
          {post.preview}
        </p>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <button className="readmore" onClick={function(e){e.stopPropagation();onExpand();}}>{copy.postCard.openLabel}</button>
          {post.photos&&post.photos.length>0&&(
            <div style={{fontFamily:"'Courier Prime',monospace",fontSize:10,color:"var(--muted)",letterSpacing:".06em",display:"flex",alignItems:"center",gap:5}}>
              <svg width="11" height="10" viewBox="0 0 11 10" fill="none" stroke="var(--muted)" strokeWidth="1" strokeLinecap="round"><rect x="1" y="2.5" width="9" height="7" rx="1"/><circle cx="5.5" cy="6" r="1.6"/><path d="M3.5 2.5 L4 1 L7 1 L7.5 2.5"/></svg>
              {post.photos.length} {post.photos.length>1?copy.postCard.photoPlural:copy.postCard.photoSingular}
            </div>
          )}
        </div>

        {topR.length>0&&(
          <div style={{marginTop:16,paddingTop:14,borderTop:"1px solid var(--rule)",display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}} onClick={function(e){e.stopPropagation();}}>
            {topR.map(function(item){
              var emoji=item[0],count=item[1],active=userReacted[post.id+"-"+emoji];
              return <button key={emoji} className={"react-pill"+(active?" on":"")} onClick={function(){onReact(emoji);}}>{emoji} <span style={{fontFamily:"'Jost',sans-serif",fontSize:11}}>{count}</span></button>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── POST MODAL ────────────────────────────────────────────────────────────────

function PostModal({
  post,
  reactions,
  userReacted,
  comments,
  onReact,
  onClose,
  onComment,
  newComment,
  setNewComment,
  threadRef,
  canComment,
  commentAuthorName,
  commentWarning,
  commentSignInEmail,
  setCommentSignInEmail,
  onRequestCommentSignIn,
  sendingCommentSignIn,
}) {
  var lbS = useState(null); // lightbox start index or null
  var lbIdx = lbS[0], setLbIdx = lbS[1];
  var cat = CATS[post.category] || { label: post.category || copy.filters.defaultCategoryLabel, color: "#8A7B6C" };
  var paras = post.full.split("\n\n");
  var rt = readTime(post.full);

  return (
    <>
      <div className="overlay" style={{position:"fixed",inset:0,background:"rgba(27,20,16,0.72)",backdropFilter:"blur(6px)",zIndex:1000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"44px 16px 60px",overflowY:"auto"}} onClick={onClose}>
        <div className="mbox" style={{background:"var(--paper)",maxWidth:660,width:"100%",border:"1px solid var(--rule)",boxShadow:"0 24px 72px rgba(0,0,0,0.3)",overflow:"hidden"}} onClick={function(e){e.stopPropagation();}}>

          <div style={{padding:"28px 28px 0"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{display:"inline-flex",alignItems:"center",gap:6,color:cat.color,fontFamily:"'Jost',sans-serif",fontSize:10,fontWeight:600,letterSpacing:".15em",textTransform:"uppercase"}}>
                <CategoryIcon type={post.category} color={cat.color}/>{cat.label}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:14}}>
                <span style={{fontFamily:"'Courier Prime',monospace",fontSize:10,color:"var(--muted)",letterSpacing:".06em"}}>{rt} {copy.postModal.minReadSuffix}</span>
                <button className="xbtn" onClick={onClose}>&#215;</button>
              </div>
            </div>
            <div style={{marginTop:10,fontFamily:"'Courier Prime',monospace",fontSize:11,color:"var(--muted)",letterSpacing:".07em"}}>
              {post.location} &mdash; {post.dateStr} &middot; {post.time}
            </div>
            <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:600,color:"var(--ink)",lineHeight:1.18,margin:"12px 0 20px",letterSpacing:"-.015em"}}>
              {post.title}
            </h2>
          </div>

          <div style={{padding:"0 28px 24px"}}>
            {paras.map(function(p,i){return <p key={i} style={{fontFamily:"'Lora',serif",fontSize:15,color:"var(--ink2)",lineHeight:1.82,marginBottom:i<paras.length-1?16:0}}>{p}</p>;})}
          </div>

          {post.photos&&post.photos.length>0&&(
            <div style={{padding:"0 28px 24px",borderTop:"1px solid var(--rule)",paddingTop:20}}>
              <PhotoFilmstrip photos={post.photos} onPhotoClick={function(i){setLbIdx(i);}}/>
            </div>
          )}

          <div style={{padding:"16px 28px 20px",borderTop:"1px solid var(--rule)",background:"white"}}>
            <div style={{fontFamily:"'Jost',sans-serif",fontSize:"9px",fontWeight:600,letterSpacing:".18em",textTransform:"uppercase",color:"var(--muted)",marginBottom:12}}>{copy.postModal.reactLabel}</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
              {PRESET.map(function(emoji){
                var count=reactions[emoji]||0,active=userReacted[post.id+"-"+emoji];
                return (
                  <div key={emoji} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                    <button className={"react-circle"+(active?" on":"")} onClick={function(){onReact(emoji);}}>
                      {emoji}
                      {count>0&&<span style={{position:"absolute",bottom:-3,right:-3,background:active?"var(--red)":"var(--muted)",color:"white",borderRadius:8,fontSize:8,padding:"1px 4px",fontFamily:"'Jost',sans-serif",fontWeight:600,lineHeight:1.4,border:"1px solid white"}}>{count}</span>}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{background:"var(--cream)",borderTop:"1px solid var(--rule)"}}>
            <div style={{padding:"14px 28px 6px",fontFamily:"'Jost',sans-serif",fontSize:"9px",fontWeight:600,letterSpacing:".18em",textTransform:"uppercase",color:"var(--muted)"}}>
              {copy.postModal.repliesLabel.replace("{count}", String(comments.length))}
            </div>
            <div ref={threadRef} style={{padding:"6px 28px 14px",maxHeight:260,overflowY:"auto",display:"flex",flexDirection:"column",gap:10}}>
              {comments.length===0&&(
                <p style={{fontFamily:"'Lora',serif",fontStyle:"italic",fontSize:13,color:"var(--muted)",textAlign:"center",padding:"18px 0"}}>{copy.postModal.emptyReplies}</p>
              )}
              {comments.map(function(c){
                return (
                  <div key={c.id} style={{display:"flex",flexDirection:"column",alignItems:c.isAuthor?"flex-end":"flex-start",gap:3}}>
                    <div style={{fontFamily:"'Jost',sans-serif",fontSize:10,color:"var(--muted)",fontWeight:500,letterSpacing:".04em"}}>{c.author} &middot; {c.time}</div>
                    <div style={{padding:"9px 13px",borderRadius:c.isAuthor?"10px 2px 10px 10px":"2px 10px 10px 10px",background:c.isAuthor?"var(--ink)":"white",color:c.isAuthor?"var(--cream)":"var(--ink2)",fontFamily:"'Lora',serif",fontSize:14,lineHeight:1.6,maxWidth:"84%",border:"1px solid "+(c.isAuthor?"transparent":"var(--rule)")}}>
                      {c.text}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{padding:"0 28px 22px",display:"flex",flexDirection:"column",gap:8}}>
              {canComment ? (
                <>
                  <div style={{fontFamily:"'Jost',sans-serif",fontSize:11,color:"var(--muted)",letterSpacing:".04em"}}>
                    Commenting as <strong style={{color:"var(--ink2)"}}>{commentAuthorName}</strong>
                  </div>
                  <div style={{display:"flex",gap:7,alignItems:"flex-start"}}>
                    <textarea
                      className="tinput"
                      placeholder={copy.postModal.commentPlaceholder}
                      value={newComment}
                      onChange={function(e){setNewComment(e.target.value);}}
                      rows={2}
                      onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();onComment();}}}
                    />
                    <button className="sendbtn" onClick={onComment}>{copy.postModal.sendLabel}</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{fontFamily:"'Lora',serif",fontSize:13,color:"var(--muted)",lineHeight:1.6}}>
                    Sign in with your subscriber email to comment.
                  </div>
                  <div style={{display:"flex",gap:7,alignItems:"flex-start"}}>
                    <input
                      className="tinput"
                      type="email"
                      placeholder={copy.subscribeModal.emailPlaceholder}
                      value={commentSignInEmail}
                      onChange={function(e){setCommentSignInEmail(e.target.value);}}
                      onKeyDown={function(e){if(e.key==="Enter"){e.preventDefault();onRequestCommentSignIn();}}}
                    />
                    <button className="sendbtn" onClick={onRequestCommentSignIn} disabled={sendingCommentSignIn}>
                      {sendingCommentSignIn ? "Sending..." : "Email Sign-In Link"}
                    </button>
                  </div>
                </>
              )}
              {commentWarning ? (
                <div style={{fontFamily:"'Jost',sans-serif",fontSize:11,color:"var(--red)",lineHeight:1.5}}>
                  {commentWarning}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {lbIdx!==null&&(
        <PhotoLightbox photos={post.photos} startIdx={lbIdx} post={post} onClose={function(){setLbIdx(null);}}/>
      )}
    </>
  );
}

// ── SUBSCRIBE MODAL ───────────────────────────────────────────────────────────

function SubModal({ email, setEmail, subscribed, onSubscribe, onClose, statusMessage, sending }) {
  return (
    <div className="overlay" style={{position:"fixed",inset:0,background:"rgba(27,20,16,0.72)",backdropFilter:"blur(6px)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div className="mbox" style={{background:"var(--red)",maxWidth:400,width:"100%",padding:"44px 36px 36px",position:"relative",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}} onClick={function(e){e.stopPropagation();}}>
        <button onClick={onClose} style={{position:"absolute",top:16,right:16,width:32,height:32,border:"1px solid rgba(255,255,255,0.25)",borderRadius:2,background:"rgba(255,255,255,0.1)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"rgba(240,233,223,0.8)"}}>&#215;</button>
        {!subscribed ? (
          <>
            <div style={{fontFamily:"'Jost',sans-serif",fontSize:"10px",fontWeight:600,letterSpacing:".2em",textTransform:"uppercase",color:"rgba(240,233,223,0.6)",marginBottom:14}}>{copy.subscribeModal.label}</div>
            <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:600,color:"var(--cream)",marginBottom:10,lineHeight:1.15}}>{copy.subscribeModal.title}</h3>
            <p style={{fontFamily:"'Lora',serif",fontSize:14,color:"rgba(240,233,223,0.65)",lineHeight:1.7,marginBottom:22}}>{copy.subscribeModal.body}</p>
            <div style={{display:"flex",flexDirection:"column",gap:9}}>
              <input className="einput" type="email" placeholder={copy.subscribeModal.emailPlaceholder} value={email} onChange={function(e){setEmail(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")onSubscribe();}}/>
              <button className="ctabtn" onClick={onSubscribe} disabled={sending}>{sending ? "Sending..." : copy.subscribeModal.button}</button>
              {statusMessage ? (
                <div style={{fontFamily:"'Jost',sans-serif",fontSize:11,color:"rgba(240,233,223,0.88)",lineHeight:1.5}}>
                  {statusMessage}
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div style={{fontSize:30,marginBottom:16}}>&#9993;</div>
            <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:26,color:"var(--cream)",marginBottom:10}}>{copy.subscribeModal.successTitle}</h3>
            <p style={{fontFamily:"'Lora',serif",fontSize:14,color:"rgba(240,233,223,0.65)",lineHeight:1.7}}>{copy.subscribeModal.successBody}</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

export default function ScrapSheet({ backHref = "/" }) {
  var filterS=useState("all"),filter=filterS[0],setFilter=filterS[1];
  var expandedS=useState(null),expandedId=expandedS[0],setExpandedId=expandedS[1];
  var fallbackPosts = POSTS.map(normalizePost);
  var fallbackQuotes = QUOTES.map(normalizeQuote);
  var postsS=useState(fallbackPosts),posts=postsS[0],setPosts=postsS[1];
  var quotesS=useState(fallbackQuotes),quotes=quotesS[0],setQuotes=quotesS[1];
  var reactionsS=useState(reactionsFromPosts(fallbackPosts)),reactions=reactionsS[0],setReactions=reactionsS[1];
  var urS=useState({}),userReacted=urS[0],setUserReacted=urS[1];
  var commentsS=useState(INITIAL_COMMENTS),comments=commentsS[0],setComments=commentsS[1];
  var showSubS=useState(false),showSub=showSubS[0],setShowSub=showSubS[1];
  var newComS=useState(""),newComment=newComS[0],setNewComment=newComS[1];
  var emailS=useState(""),email=emailS[0],setEmail=emailS[1];
  var subscribedS=useState(false),subscribed=subscribedS[0],setSubscribed=subscribedS[1];
  var subStatusS=useState(""),subStatus=subStatusS[0],setSubStatus=subStatusS[1];
  var subSendingS=useState(false),subSending=subSendingS[0],setSubSending=subSendingS[1];
  var commentEmailS=useState(""),commentSignInEmail=commentEmailS[0],setCommentSignInEmail=commentEmailS[1];
  var commentWarningS=useState(""),commentWarning=commentWarningS[0],setCommentWarning=commentWarningS[1];
  var commentSignInSendingS=useState(false),commentSignInSending=commentSignInSendingS[0],setCommentSignInSending=commentSignInSendingS[1];
  var authUserS=useState(null),authUser=authUserS[0],setAuthUser=authUserS[1];
  var subscriberProfileS=useState(null),subscriberProfile=subscriberProfileS[0],setSubscriberProfile=subscriberProfileS[1];
  var hlS=useState(null),highlightId=hlS[0],setHighlightId=hlS[1];
  var searchQS=useState(""),searchQ=searchQS[0],setSearchQ=searchQS[1];
  var searchOpenS=useState(false),searchOpen=searchOpenS[0],setSearchOpen=searchOpenS[1];
  var anonS=useState(""),anonId=anonS[0],setAnonId=anonS[1];
  var threadRef=useRef(null);
  var searchInputRef=useRef(null);

  useEffect(function(){
    if (typeof window === "undefined") return;
    var stored = window.localStorage.getItem("ss6-anon");
    if (!stored) {
      stored = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : "anon-" + Math.random().toString(36).slice(2);
      window.localStorage.setItem("ss6-anon", stored);
    }
    setAnonId(stored);
  },[]);

  useEffect(function(){
    var active = true;
    var unsubscribe = null;
    (async function(){
      try {
        await completeSubscriberSignInFromLink();
      } catch (error) {
        // Ignore completion errors and continue auth observation.
      }

      try {
        var currentUser = await getCurrentAuthUser();
        if (active) {
          setAuthUser(currentUser);
          setCommentSignInEmail(currentUser?.email ? normalizeEmail(currentUser.email) : "");
        }
        if (currentUser?.uid) {
          var profile = await getSubscriberRecord(currentUser.uid);
          if (active) {
            setSubscriberProfile(profile);
            if (isSubscriberProfileActive(profile)) setSubscribed(true);
          }
        }
      } catch (error) {
        if (active) setSubscriberProfile(null);
      }

      unsubscribe = await onSubscriberAuthChange(async function(user){
        if (!active) return;
        setAuthUser(user);
        setCommentSignInEmail(user?.email ? normalizeEmail(user.email) : "");
        if (!user?.uid) {
          setSubscriberProfile(null);
          return;
        }
        var profile = await getSubscriberRecord(user.uid);
        if (!active) return;
        setSubscriberProfile(profile);
        if (isSubscriberProfileActive(profile)) setSubscribed(true);
      });
    })();
    return function(){
      active = false;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  useEffect(function(){
    var active = true;
    (async function(){
      if (!firestoreReady || !db) {
        if (active) {
          setPosts(fallbackPosts);
          setQuotes(fallbackQuotes);
          setReactions(reactionsFromPosts(fallbackPosts));
        }
        return;
      }
      try {
        var postSnap = await getDocs(query(collection(db, COLLECTIONS.posts), orderBy("date", "desc")));
        var loadedPosts = postSnap.docs.map(function(doc){ return normalizePost(Object.assign({ id: doc.id }, doc.data())); });
        if (!loadedPosts.length) loadedPosts = fallbackPosts;
        if (active) {
          setPosts(loadedPosts);
          setReactions(reactionsFromPosts(loadedPosts));
        }
      } catch (e) {
        if (active) {
          setPosts(fallbackPosts);
          setReactions(reactionsFromPosts(fallbackPosts));
        }
      }
      try {
        var quoteSnap = await getDocs(collection(db, COLLECTIONS.quotes));
        var loadedQuotes = quoteSnap.docs.map(function(doc){ return normalizeQuote(Object.assign({ id: doc.id }, doc.data())); }).filter(function(q){return q.text;});
        if (active) setQuotes(loadedQuotes.length ? loadedQuotes : fallbackQuotes);
      } catch (e) {
        if (active) setQuotes(fallbackQuotes);
      }
    })();
    return function(){active=false;};
  }, [firestoreReady, db]);

  useEffect(function(){
    if (!firestoreReady || !db || !anonId || !posts.length) return;
    var active = true;
    (async function(){
      var reactionMapByPost = {};
      var next = {};
      await Promise.all(posts.map(async function(p) {
        try {
          var snap = await getDocs(collection(db, COLLECTIONS.posts, String(p.id), "anon_reactions"));
          var counts = {};
          snap.forEach(function(rdoc){
            var data = rdoc.data() || {};
            var reacts = data.reactions && typeof data.reactions === "object" ? data.reactions : {};
            Object.keys(reacts).forEach(function(emoji) {
              if (!PRESET.includes(emoji)) return;
              if (reacts[emoji]) {
                counts[emoji] = (counts[emoji] || 0) + 1;
              }
              if (rdoc.id === anonId && reacts[emoji]) {
                next[p.id + "-" + emoji] = true;
              }
            });
          });
          reactionMapByPost[p.id] = Object.assign({}, p.defaultReactions || {}, counts);
        } catch (e) {
          reactionMapByPost[p.id] = Object.assign({}, p.defaultReactions || {});
        }
      }));
      if (active) {
        setReactions(function(prev){
          return Object.assign({}, prev, reactionMapByPost);
        });
        setUserReacted(next);
      }
    })();
    return function(){active=false;};
  }, [firestoreReady, db, anonId, posts]);

  useEffect(function(){
    if (!expandedId || !firestoreReady || !db) return;
    (async function(){
      try {
        var comSnap = await getDocs(query(collection(db, COLLECTIONS.posts, String(expandedId), "comments"), orderBy("createdAt", "asc")));
        var loaded = comSnap.docs.map(function(doc){
          var data = doc.data() || {};
          var created = data.createdAt && typeof data.createdAt.toDate === "function" ? data.createdAt.toDate() : null;
          return {
            id: doc.id,
            text: data.text || "",
            author: data.authorName || copy.postModal.defaultAuthor,
            time: created ? formatTime(created) : "",
            isAuthor: Boolean(authUser?.uid && data.authorUid === authUser.uid),
          };
        });
        setComments(function(prev){ return Object.assign({}, prev, (function(){var o={};o[expandedId]=loaded;return o;})()); });
      } catch (e) {}
    })();
  }, [expandedId, firestoreReady, db, authUser]);

  useEffect(function(){
    if (expandedId) return;
    setNewComment("");
    setCommentWarning("");
  }, [expandedId]);

  var getR=function(post){return reactions[post.id]||post.defaultReactions||{};};

  var handleReact=async function(postId,emoji){
    if (!PRESET.includes(emoji)) return;
    var key=postId+"-"+emoji,already=userReacted[key];
    var post=posts.find(function(p){return p.id===String(postId);});
    if (!post) return;
    var cur=reactions[postId]||post.defaultReactions||{};
    var next=Object.assign({},cur);next[emoji]=already?Math.max(0,(cur[emoji]||0)-1):(cur[emoji]||0)+1;
    var nr=Object.assign({},reactions);nr[postId]=next;
    var nu=Object.assign({},userReacted);nu[key]=!already;
    setReactions(nr);setUserReacted(nu);
    if (!firestoreReady || !db || !anonId) return;
    try {
      await runTransaction(db, async function(tx) {
        var userRef = doc(db, COLLECTIONS.posts, String(postId), "anon_reactions", anonId);
        var userSnap = await tx.get(userRef);
        var userData = userSnap.exists() && userSnap.data().reactions ? Object.assign({}, userSnap.data().reactions) : {};
        if (already) delete userData[emoji]; else userData[emoji] = true;
        tx.set(userRef, { reactions: userData, updatedAt: serverTimestamp() }, { merge: true });
      });
    } catch (e) {}
  };

  function secondsUntilThrottleReset(throttleDoc) {
    if (!throttleDoc?.windowStart || typeof throttleDoc.windowStart.toMillis !== "function") return 60;
    var elapsedMs = Date.now() - throttleDoc.windowStart.toMillis();
    return Math.max(1, Math.ceil((60000 - elapsedMs) / 1000));
  }

  var handleComment=async function(postId){
    var trimmed = newComment.trim();
    if(!trimmed)return;
    if (!authUser?.uid || !isSubscriberProfileActive(subscriberProfile)) {
      setCommentWarning("Sign in with an active subscriber account to comment.");
      return;
    }

    setCommentWarning("");
    var authorName =
      (subscriberProfile && typeof subscriberProfile.name === "string" && subscriberProfile.name.trim()) ||
      fallbackNameFromEmail(authUser.email || "") ||
      copy.postModal.defaultAuthor;
    if (!firestoreReady || !db) {
      setCommentWarning("Comments are temporarily unavailable.");
      return;
    }

    try {
      var throttleRef = doc(db, "comment_throttles", authUser.uid);
      var throttle = await getDoc(throttleRef).then(function(snap){ return snap.exists() ? snap.data() : null; }).catch(function(){ return null; });
      var activeWindow = Boolean(
        throttle &&
        throttle.windowStart &&
        typeof throttle.windowStart.toMillis === "function" &&
        Date.now() - throttle.windowStart.toMillis() < 60000
      );
      var nextCount = activeWindow ? Number(throttle.count || 0) + 1 : 1;
      if (activeWindow && nextCount > 3) {
        setCommentWarning("You have reached the comment limit. Try again in " + secondsUntilThrottleReset(throttle) + "s.");
        return;
      }

      await runTransaction(db, async function(tx) {
        var txnThrottleSnap = await tx.get(throttleRef);
        var txnThrottle = txnThrottleSnap.exists() ? txnThrottleSnap.data() : null;
        var txnActiveWindow = Boolean(
          txnThrottle &&
          txnThrottle.windowStart &&
          typeof txnThrottle.windowStart.toMillis === "function" &&
          Date.now() - txnThrottle.windowStart.toMillis() < 60000
        );
        var txnNextCount = txnActiveWindow ? Number(txnThrottle.count || 0) + 1 : 1;
        if (txnActiveWindow && txnNextCount > 3) {
          throw new Error("RATE_LIMIT");
        }

        var commentRef = doc(collection(db, COLLECTIONS.posts, String(postId), "comments"));
        tx.set(commentRef, {
          authorUid: authUser.uid,
          authorName: authorName.slice(0, 80),
          text: trimmed.slice(0, 1200),
          createdAt: serverTimestamp(),
        });
        tx.set(throttleRef, {
          uid: authUser.uid,
          windowStart: txnActiveWindow ? txnThrottle.windowStart : serverTimestamp(),
          count: txnNextCount,
          updatedAt: serverTimestamp(),
        });
      });
      var c={id:Date.now(),text:trimmed,author:authorName,time:formatTime(new Date()),isAuthor:true};
      var next=Object.assign({},comments);next[postId]=[...(comments[postId]||[]),c];
      setComments(next);
      setNewComment("");
      setTimeout(function(){if(threadRef.current)threadRef.current.scrollTop=threadRef.current.scrollHeight;},80);
    } catch (e) {
      if (String(e?.message || "").includes("RATE_LIMIT")) {
        setCommentWarning("You have reached the comment limit. Please wait about a minute.");
      } else if (String(e?.message || "").toLowerCase().includes("permission")) {
        setCommentWarning("Comment blocked by security rules or rate limit. Please try again shortly.");
      } else {
        setCommentWarning("Could not post comment. Please try again.");
      }
    }
  };

  var handleRequestCommentSignIn = async function() {
    var targetEmail = normalizeEmail(commentSignInEmail || email);
    if (!targetEmail.includes("@")) {
      setCommentWarning("Enter a valid subscriber email.");
      return;
    }
    setEmail(targetEmail);
    setCommentSignInSending(true);
    setCommentWarning("");
    try {
      var result = await sendSubscriberSignInLink({
        email: targetEmail,
        source: "travel_comment",
        redirectUrl: window.location.href,
      });
      if (!result.ok) {
        setCommentWarning("Could not send sign-in link. Please try again.");
      } else if (result.linked) {
        var signedInUser = await getCurrentAuthUser();
        if (signedInUser) {
          await upsertSubscriberRecord(signedInUser, { source: "travel_comment" });
          setAuthUser(signedInUser);
          var profile = await getSubscriberRecord(signedInUser.uid);
          setSubscriberProfile(profile);
        }
        setCommentWarning("Signed in. You can comment now.");
      } else {
        setCommentWarning("Sign-in link sent. Check your inbox.");
      }
    } catch (error) {
      setCommentWarning("Sign-in request failed. Please retry.");
    } finally {
      setCommentSignInSending(false);
    }
  };

  var handleSubscribe = async function() {
    var targetEmail = normalizeEmail(email);
    if (!targetEmail.includes("@")) {
      setSubStatus("Please enter a valid email.");
      return;
    }
    setCommentSignInEmail(targetEmail);
    setSubSending(true);
    setSubStatus("");
    try {
      var result = await sendSubscriberSignInLink({
        email: targetEmail,
        source: "travel_subscribe",
        redirectUrl: window.location.href,
      });
      if (!result.ok) {
        setSubStatus("Unable to send sign-in link. Please retry.");
        return;
      }
      if (result.linked) {
        var signedUser = await getCurrentAuthUser();
        if (signedUser) {
          await upsertSubscriberRecord(signedUser, { source: "travel_subscribe" });
          setAuthUser(signedUser);
          var signedProfile = await getSubscriberRecord(signedUser.uid);
          setSubscriberProfile(signedProfile);
        }
        setSubscribed(true);
        setSubStatus("");
        return;
      }
      setSubscribed(true);
      setSubStatus("Check your inbox to confirm your subscription.");
    } catch (error) {
      setSubStatus("Subscription failed. Try again in a moment.");
    } finally {
      setSubSending(false);
    }
  };

  var handleQuoteClick=function(postId){
    var pid = String(postId);
    var el=document.getElementById("dispatch-"+pid);
    if(el){el.scrollIntoView({behavior:"smooth",block:"center"});setHighlightId(pid);setTimeout(function(){setHighlightId(null);},2000);}
  };

  var base = filter==="all"?posts:posts.filter(function(p){return p.category===filter;});
  var filtered = searchQ.trim() ? base.filter(function(p){return matchesSearch(p,searchQ);}) : base;
  var expanded = expandedId?posts.find(function(p){return p.id===String(expandedId);}):null;
  var heroLastReported = copy.hero.lastReported.replace("{location}", CURRENT_LOC.name);
  var heroLocationLabel = copy.hero.locationLabel.replace("{location}", CURRENT_LOC.name);
  var dispatchCount = copy.hero.countTemplate
    .replace("{current}", String(posts.length).padStart(2,"0"))
    .replace("{total}", String(posts.length).padStart(2,"0"));
  var canComment = Boolean(authUser?.uid && isSubscriberProfileActive(subscriberProfile));
  var commentAuthorName =
    (subscriberProfile && typeof subscriberProfile.name === "string" && subscriberProfile.name.trim()) ||
    fallbackNameFromEmail(authUser?.email || "") ||
    copy.postModal.defaultAuthor;

  return (
    <div className="dispatch-root" style={{background:"var(--cream)",minHeight:"100vh"}}>
      <Styles/>

      {/* HEADER */}
      <header className="dispatch-header" style={{position:"sticky",top:0,zIndex:100,background:"var(--red)",boxShadow:"0 2px 14px rgba(140,8,8,0.28)"}}>
        <div className="dispatch-header-inner" style={{height:60,padding:"0 36px",display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center"}}>

          <a href={backHref} className="dispatch-back-link" style={{fontFamily:"'Jost',sans-serif",fontSize:10,fontWeight:600,letterSpacing:".18em",textTransform:"uppercase",color:"rgba(240,233,223,0.7)",textDecoration:"none",justifySelf:"start",display:"inline-flex",alignItems:"center",gap:8}}>
            {copy.nav.backLabel}
          </a>

          {/* Logo */}
          <div className="dispatch-logo" style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,fontWeight:600,color:"var(--cream)",letterSpacing:".01em",justifySelf:"center"}}>
            {copy.nav.title}
          </div>

          {/* Nav + inline search toggle */}
          <nav className="dispatch-nav" style={{display:"flex",alignItems:"center",gap:24,justifySelf:"end"}}>

            {/* Search — icon or expanded input */}
            <div className="dispatch-search-wrap" style={{display:"flex",alignItems:"center",position:"relative"}}>
              {searchOpen ? (
                <div className="dispatch-search-box" style={{display:"flex",alignItems:"center",gap:7,padding:"4px 10px",background:"rgba(0,0,0,0.22)",border:"1px solid rgba(255,255,255,0.28)",borderRadius:2,animation:"fadeIn .15s ease"}}>
                  <SearchIcon size={11} color="rgba(240,233,223,0.5)"/>
                  <input
                    ref={searchInputRef}
                    className="search-input"
                    placeholder={copy.nav.searchPlaceholder}
                    value={searchQ}
                    style={{width:160}}
                    onChange={function(e){setSearchQ(e.target.value);}}
                    onFocus={function(){var el=document.getElementById("feed");if(el)el.scrollIntoView({behavior:"smooth"});}}
                    onBlur={function(){setTimeout(function(){setSearchOpen(false);setSearchQ("");},150);}}
                    onKeyDown={function(e){
                      if(e.key==="Escape"){setSearchQ("");setSearchOpen(false);}
                    }}
                    autoFocus
                  />
                  {searchQ
                    ? <button onClick={function(){setSearchQ("");}} style={{background:"none",border:"none",color:"rgba(240,233,223,0.55)",cursor:"pointer",fontSize:15,lineHeight:1,padding:0,flexShrink:0}}>&#215;</button>
                    : <button onClick={function(){setSearchOpen(false);}} style={{background:"none",border:"none",color:"rgba(240,233,223,0.4)",cursor:"pointer",fontSize:15,lineHeight:1,padding:0,flexShrink:0}}>&#215;</button>
                  }
                </div>
              ) : (
                <button onClick={function(){setSearchOpen(true);}} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(240,233,223,0.62)",display:"flex",alignItems:"center",padding:4,transition:"color .15s"}}
                  title={copy.nav.searchTooltip}
                  onMouseEnter={function(e){e.currentTarget.style.color="var(--cream)";}}
                  onMouseLeave={function(e){e.currentTarget.style.color="rgba(240,233,223,0.62)";}}>
                  <SearchIcon size={15} color="currentColor"/>
                </button>
              )}
              {searchOpen&&searchQ&&(
                <div className="dispatch-search-meta" style={{position:"absolute",top:"calc(100% + 6px)",right:0,fontFamily:"'Jost',sans-serif",fontSize:"10px",color:"rgba(240,233,223,0.5)",letterSpacing:".07em",whiteSpace:"nowrap",background:"rgba(0,0,0,0.3)",padding:"3px 8px",borderRadius:2}}>
                  {filtered.length} {copy.nav.searchResultsSuffix}
                </div>
              )}
            </div>

            <a href="#feed" className="nava" onClick={function(e){e.preventDefault();var el=document.getElementById("feed");if(el)el.scrollIntoView({behavior:"smooth"});}}>{copy.nav.links[0]}</a>
            <a href="#about" className="nava" onClick={function(e){e.preventDefault();var el=document.getElementById("about");if(el)el.scrollIntoView({behavior:"smooth"});}}>{copy.nav.links[1]}</a>
            <button className="subbtn" onClick={function(){setShowSub(true);}}>{copy.nav.links[2]}</button>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="dispatch-hero" style={{background:"var(--ink)",position:"relative",minHeight:"75vh",padding:"72px 56px 80px",overflow:"hidden",display:"flex",alignItems:"flex-start"}}>
        <div style={{position:"absolute",inset:0,opacity:0.18,pointerEvents:"none",backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.12'/%3E%3C/svg%3E\")"}}/>
        <FieldStamp/>
        <div className="dispatch-hero-globe" style={{position:"absolute",bottom:28,right:44,opacity:0.88,display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
          <Globe/>
          <div style={{fontFamily:"'Jost',sans-serif",fontSize:"8px",fontWeight:600,letterSpacing:".2em",textTransform:"uppercase",color:"rgba(240,233,223,0.22)"}}>{heroLocationLabel}</div>
        </div>
        <div className="dispatch-hero-copy" style={{maxWidth:520,flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:8,fontFamily:"'Jost',sans-serif",fontSize:"11px",fontWeight:500,letterSpacing:".12em",textTransform:"uppercase",color:RED,marginBottom:28}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:RED,display:"inline-block",animation:"pulse 2s ease infinite"}}/>
            {heroLastReported}
          </div>
          <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"clamp(56px,8vw,90px)",fontWeight:300,lineHeight:0.9,letterSpacing:"-.025em",color:"var(--cream)",marginBottom:28}}>
            <em style={{fontWeight:600,display:"block"}}>{copy.hero.titleMain}</em>
            <span style={{fontSize:".56em",fontWeight:300,fontStyle:"normal",color:"rgba(240,233,223,0.48)",display:"block",marginTop:10}}>{copy.hero.titleEm}</span>
          </h1>
          <p style={{fontFamily:"'Lora',serif",fontSize:16,color:"rgba(240,233,223,0.42)",lineHeight:1.68,maxWidth:400,marginBottom:22,whiteSpace:"pre-line"}}>
            {copy.hero.subcopy}
          </p>
          <TypewriterQuotes onQuoteClick={handleQuoteClick} quotes={quotes}/>
          <div style={{marginTop:28,display:"flex",alignItems:"center",gap:10}}>
            <div style={{height:1,width:24,background:"rgba(204,17,17,0.4)"}}/>
            <div style={{fontFamily:"'Courier Prime',monospace",fontSize:11,color:"rgba(240,233,223,0.25)",letterSpacing:".14em",textTransform:"uppercase"}}>
              {dispatchCount}
            </div>
          </div>
        </div>
      </section>

      {/* FILTER */}
      <div id="feed" style={{borderBottom:"1px solid var(--rule)",background:"var(--cream)",scrollMarginTop:"60px"}}>
        <div className="dispatch-filter-inner" style={{maxWidth:720,margin:"0 auto",padding:"22px 48px 20px",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontFamily:"'Jost',sans-serif",fontSize:"9px",fontWeight:600,letterSpacing:".18em",textTransform:"uppercase",color:"var(--muted)",marginRight:4}}>{copy.filters.label}</span>
          {copy.filters.buttons.map(function(item){
            return <button key={item.key} className={"fbtn"+(filter===item.key?" on":"")} onClick={function(){setFilter(item.key);}}>{item.label}</button>;
          })}
        </div>
      </div>

      {/* FEED */}
      <main className="dispatch-main" style={{maxWidth:720,margin:"0 auto",padding:"40px 48px 72px"}}>
        {filtered.length===0&&(
          <div style={{textAlign:"center",padding:"48px 0",fontFamily:"'Lora',serif",fontStyle:"italic",fontSize:15,color:"var(--muted)"}}>
            {copy.filters.emptyState}
          </div>
        )}
        {filtered.map(function(post,i){
          return (
            <div key={post.id}>
              <PostCard post={post} reactions={getR(post)} userReacted={userReacted}
                onReact={function(emoji){handleReact(post.id,emoji);}}
                onExpand={function(){setExpandedId(post.id);}}
                highlighted={highlightId===post.id}/>
              {i<filtered.length-1&&<TimeMarker elapsed={getElapsed(post.dateObj,filtered[i+1].dateObj)}/>}
            </div>
          );
        })}
      </main>

      {/* ABOUT */}
      <section id="about" className="dispatch-about" style={{background:"var(--ink)",padding:"80px 56px",borderTop:"1px solid rgba(240,233,223,0.06)",scrollMarginTop:"60px"}}>
        <div style={{maxWidth:660,margin:"0 auto"}}>
          <div style={{fontFamily:"'Jost',sans-serif",fontSize:"9px",fontWeight:600,letterSpacing:".2em",textTransform:"uppercase",color:RED,marginBottom:18}}>{copy.about.label}</div>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"clamp(30px,5vw,46px)",fontWeight:400,fontStyle:"italic",color:"var(--cream)",lineHeight:1.1,marginBottom:36,letterSpacing:"-.02em"}}>
            {copy.about.titleMain}<br/><span style={{fontStyle:"normal",fontWeight:600}}>{copy.about.titleEm}</span>
          </h2>
          <div style={{display:"flex",flexDirection:"column",gap:18,marginBottom:44}}>
            {copy.about.paragraphs.map(function(text,i){
              var isLast = i === copy.about.paragraphs.length - 1;
              return (
                <p key={i} style={{fontFamily:"'Lora',serif",fontSize:16,lineHeight:1.78,fontStyle:isLast?"italic":"normal",color:isLast?"rgba(240,233,223,0.82)":"rgba(240,233,223,0.56)"}}>
                  {text}
                </p>
              );
            })}
          </div>
          <div style={{paddingTop:30,borderTop:"1px solid rgba(240,233,223,0.08)",display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:46,height:46,borderRadius:"50%",border:"1px solid rgba(204,17,17,0.4)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Cormorant Garamond',serif",fontSize:17,fontWeight:600,color:"var(--cream)",flexShrink:0,background:"rgba(204,17,17,0.1)"}}>{copy.about.signatureInitials}</div>
            <div>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,fontWeight:600,color:"var(--cream)"}}>{copy.about.signatureName}</div>
              <div style={{fontFamily:"'Jost',sans-serif",fontSize:"10px",color:"rgba(240,233,223,0.28)",marginTop:3,letterSpacing:".07em"}}>{copy.about.signatureLine}</div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="dispatch-footer" style={{background:"var(--red)",padding:"20px 48px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12,boxShadow:"0 -2px 12px rgba(140,8,8,0.2)"}}>
        <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:15,color:"rgba(240,233,223,0.78)"}}>{copy.footer.title}</span>
        <span style={{fontFamily:"'Courier Prime',monospace",fontSize:"10px",color:"rgba(240,233,223,0.38)",letterSpacing:".1em",textTransform:"uppercase"}}>{copy.footer.subtitle}</span>
        <button className="fsubbtn" onClick={function(){setShowSub(true);}}>{copy.footer.subscribeLabel}</button>
      </footer>

      {expanded&&(
        <PostModal post={expanded} reactions={getR(expanded)} userReacted={userReacted}
          comments={comments[expanded.id]||[]}
          onReact={function(emoji){handleReact(expanded.id,emoji);}}
          onClose={function(){setExpandedId(null);}}
          onComment={function(){handleComment(expanded.id);}}
          newComment={newComment} setNewComment={setNewComment}
          threadRef={threadRef}
          canComment={canComment}
          commentAuthorName={commentAuthorName}
          commentWarning={commentWarning}
          commentSignInEmail={commentSignInEmail}
          setCommentSignInEmail={setCommentSignInEmail}
          onRequestCommentSignIn={handleRequestCommentSignIn}
          sendingCommentSignIn={commentSignInSending}/>
      )}
      {showSub&&(
        <SubModal email={email} setEmail={setEmail} subscribed={subscribed}
          statusMessage={subStatus}
          sending={subSending}
          onSubscribe={handleSubscribe}
          onClose={function(){setShowSub(false);setSubscribed(false);setEmail("");setSubStatus("");}}/>
      )}
    </div>
  );
}
