/* Sermon Cue Assist
   - Load a sermon text (.txt/.md)
   - Show full script
   - Listen to live speech (Web Speech API) and align to manuscript
   - Highlight and enlarge the matched segment
   - PWA with offline cache
*/

(() => {
  // ---------- DOM ----------
  const el = (id) => document.getElementById(id);
  const scriptEl = el("script");
  const zoomTitle = el("zoomTitle");
  const zoomText = el("zoomText");
  const recDot = el("recDot");
  const recState = el("recState");
  const drop = el("drop");

  const btnStart = el("btnStart");
  const btnStop = el("btnStop");
  const btnCalib = el("btnCalib");
  const btnShowAll = el("btnShowAll");
  const fileInput = el("fileInput");
  const btnSample = el("btnSample");

  // ---------- State ----------
  let segments = []; // [{idx, title, text, norm, charStart, charEnd}]
  let manuscriptRaw = "";
  let manuscriptNorm = "";
  let activeIdx = -1;
  let userCalibOffset = 0; // manual calibration shift in segments
  let fuse = null; // fuzzy search index on segments

  // Recognition
  let rec = null;
  let listening = false;
  let recentBuffer = ""; // rolling transcript buffer
  const MAX_BUF_LEN = 240; // chars

  // ---------- Utils ----------
  const norm = (str) => (str || "")
    .toLowerCase()
    .replace(/[^\p{Script=Hangul}a-z0-9\s#]/gu, "") // keep Hangul/latin/nums/space/#
    .replace(/\s+/g, " ")
    .trim();

  function splitToSegments(text){
    const lines = text.replace(/\r\n/g,"\n").split("\n");
    const segs = [];
    let cur = { title:"", body:[] };
    function pushSeg(){
      const body = cur.body.join("\n").trim();
      if (body.length===0 && !cur.title) return;
      segs.push({ title:cur.title, text: body });
      cur = { title:"", body:[] };
    }
    for (const ln of lines){
      if (ln.trim()===""){ // blank line -> new segment
        pushSeg();
        continue;
      }
      if (ln.trim().startsWith("#")){ // heading
        pushSeg();
        cur.title = ln.replace(/^#+\s?/,"").trim();
        continue;
      }
      cur.body.push(ln);
    }
    pushSeg();
    // annotate norm and char spans
    let offset = 0;
    const big = [];
    segs.forEach((s,i)=>{
      s.idx = i;
      s.norm = norm((s.title? (s.title+" "):"") + s.text);
      s.charStart = offset;
      big.push(s.norm);
      offset += s.norm.length + 1;
      s.charEnd = offset;
    });
    return {segs, big: big.join(" ")};
  }

  function renderScript(){
    scriptEl.innerHTML = "";
    segments.forEach((s,i)=>{
      const div = document.createElement("div");
      div.className = "seg";
      div.dataset.idx = i;
      const head = s.title ? `<small><span class="badge">섹션</span> ${s.title}</small>` : "";
      div.innerHTML = `${head}${s.text.replace(/</g,"&lt;")}`;
      div.addEventListener("click", ()=> setActive(i, true));
      scriptEl.appendChild(div);
    });
  }

  function setActive(i, fromUser=false){
    if (i<0 || i>=segments.length) return;
    if (activeIdx === i) return;
    const prev = scriptEl.querySelector(".seg.active");
    if (prev) prev.classList.remove("active");
    const node = scriptEl.querySelector(`.seg[data-idx="${i}"]`);
    if (!node) return;
    node.classList.add("active");
    node.scrollIntoView({block:"center"});
    activeIdx = i;
    zoomTitle.textContent = segments[i].title ? `섹션: ${segments[i].title}` : `단락 ${i+1}`;
    zoomText.textContent = segments[i].text;
    if (fromUser) {
      // If user clicked, we "calibrate" soft-lock around that area
      userCalibOffset = 0;
    }
  }

  function rebuildIndex(){
    fuse = new Fuse(segments.map(s=>({idx:s.idx, text:s.norm})), {
      includeScore: true,
      keys: ["text"],
      threshold: 0.35, // stricter match
      minMatchCharLength: 12,
      distance: 500
    });
  }

  // Search strategy: try a few longest substrings from recentBuffer; if no good, use Fuse fuzzy search
  function findPosition(queryStr){
    const q = norm(queryStr);
    if (!q) return -1;
    // take longest 40 chars window
    const wins = [];
    for (let L of [48, 40, 32, 24]){
      if (q.length >= L) {
        wins.push(q.slice(-L));
        break;
      }
    }
    let candidate = -1;
    let bestScore = -1;
    // try direct window match across segments
    for (const w of wins){
      // use fuse to find segment
      const r = fuse.search(w).slice(0, 5);
      for (const it of r){
        const segIdx = it.item.idx;
        const score = 1 - (it.score ?? 1);
        if (score > bestScore){
          bestScore = score;
          candidate = segIdx;
        }
      }
    }
    // fallback: fuzzy on whole buffer
    if (candidate === -1){
      const r = fuse.search(q).slice(0,3);
      if (r.length){
        candidate = r[0].item.idx;
      }
    }
    return candidate;
  }

  function updateRecState(){
    recDot.className = "dot " + (listening ? "rec" : "ok");
    recState.textContent = listening ? "듣는 중" : "대기";
  }

  // ---------- File Loading ----------
  async function handleTextLoad(text){
    manuscriptRaw = text;
    const {segs, big} = splitToSegments(text);
    segments = segs;
    manuscriptNorm = big;
    renderScript();
    rebuildIndex();
    if (segments.length){
      setActive(0);
      el("hint").textContent = "인식이 진행되면 현재 단락이 자동으로 이동됩니다.";
    }
  }

  async function loadSample(){
    const res = await fetch("sample-sermon.txt");
    const t = await res.text();
    handleTextLoad(t);
  }

  fileInput.addEventListener("change", async (e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    handleTextLoad(text);
  });

  // Drag & Drop
  drop.addEventListener("dragover", (e)=>{ e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", ()=> drop.classList.remove("drag"));
  drop.addEventListener("drop", async (e)=>{
    e.preventDefault();
    drop.classList.remove("drag");
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    const text = await f.text();
    handleTextLoad(text);
  });

  btnSample.addEventListener("click", loadSample);

  // ---------- Recognition ----------
  function supported(){
    return ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window);
  }
  function getRecognizer(){
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return null;
    const r = new Ctor();
    r.lang = "ko-KR"; // set to Korean; change in Settings later if needed
    r.continuous = true;
    r.interimResults = true;
    return r;
  }

  function startListening(){
    if (!supported()){
      alert("이 브라우저는 Web Speech API를 지원하지 않습니다. Chrome 데스크톱/안드로이드를 권장합니다.");
      return;
    }
    if (!rec) rec = getRecognizer();
    if (!rec) return;
    recentBuffer = "";
    listening = true;
    updateRecState();

    rec.onresult = (evt) => {
      let interim = "";
      let final = "";
      for (let i = evt.resultIndex; i < evt.results.length; i++) {
        const res = evt.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      const chunk = (final || interim).trim();
      if (!chunk) return;
      recentBuffer += " " + chunk;
      if (recentBuffer.length > MAX_BUF_LEN) {
        recentBuffer = recentBuffer.slice(-MAX_BUF_LEN);
      }

      // Align occasionally (throttle by length)
      if (recentBuffer.length > 60 && segments.length){
        const pos = findPosition(recentBuffer);
        if (pos >= 0){
          const target = Math.min(Math.max(pos + userCalibOffset, 0), segments.length-1);
          setActive(target);
        }
      }
    };

    rec.onend = () => {
      if (listening){
        // auto-restart to keep continuous
        try { rec.start(); } catch {}
      }
    }
    rec.onerror = (e) => {
      console.warn("Recognition error:", e);
    }

    try { rec.start(); } catch (e){ console.warn(e); }
  }

  function stopListening(){
    listening = false;
    updateRecState();
    try { rec && rec.stop(); } catch {}
  }

  // ---------- Controls ----------
  btnStart.addEventListener("click", startListening);
  btnStop.addEventListener("click", stopListening);
  btnCalib.addEventListener("click", ()=>{
    // If user clicks "calibrate", we assume recognition is slightly ahead/behind.
    // A single press snaps userCalibOffset=0 to current active; double-press nudges forward.
    userCalibOffset = 0;
    if (activeIdx>=0) setActive(activeIdx, true);
  });
  btnShowAll.addEventListener("click", ()=>{
    scriptEl.scrollTo({top:0, behavior:"smooth"});
  });

  // Keyboard shortcuts
  window.addEventListener("keydown", (e)=>{
    if (e.code === "Space"){
      e.preventDefault();
      listening ? stopListening() : startListening();
    } else if (e.code === "ArrowDown"){
      setActive(Math.min(activeIdx+1, segments.length-1), true);
    } else if (e.code === "ArrowUp"){
      setActive(Math.max(activeIdx-1, 0), true);
    } else if (e.key.toLowerCase() === "c"){
      userCalibOffset = 0;
      if (activeIdx>=0) setActive(activeIdx, true);
    }
  });

  // ---------- PWA ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" })
        .then(reg => console.log("[SW] registered:", reg.scope))
        .catch(err => console.warn("[SW] register failed:", err));
    });
  }
})();
