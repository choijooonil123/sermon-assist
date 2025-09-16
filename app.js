/* Sermon Cue Assist — Sentence Focus */
(() => {
  const $ = (id) => document.getElementById(id);
  const scriptEl = $("script");
  const drop = $("drop");
  const fileInput = $("fileInput");
  const btnSample = $("btnSample");
  const btnStart = $("btnStart");
  const btnStop = $("btnStop");
  const btnCalib = $("btnCalib");
  const recState = $("recState");
  const recDot = $("recDot");
  const rightTitle = $("rightTitle");
  const prevSentEl = $("prevSent");
  const currSentEl = $("currSent");
  const nextSentEl = $("nextSent");

  let segments = []; // [{idx, title, sentences:[{idx,text,norm}]}]
  let active = { seg:-1, sent:-1 };
  let sentIndex = null;

  let rec = null, listening = false, recentBuffer = "";
  const MAX_BUF_LEN = 260;

  const norm = (s)=> (s||"").toLowerCase().replace(/[^\p{Script=Hangul}a-z0-9\s#]/gu,"").replace(/\s+/g," ").trim();

  function splitSentences(block){
    const t = block.replace(/\r\n/g,"\n").replace(/\n+/g," ").trim();
    if (!t) return [];
    const parts = t.split(/(?<=[\.!\?！\?。…])\s+/u);
    if (parts.length===1){
      const res = [];
      let s=t;
      while(s.length>0){ res.push(s.slice(0,80)); s=s.slice(80); }
      return res;
    }
    return parts;
  }
  function parseManuscript(text){
    const lines = text.replace(/\r\n/g,"\n").split("\n");
    const segs = [];
    let cur = { title:"", body:[] };
    const push = ()=>{
      const body = cur.body.join("\n").trim();
      if (!body && !cur.title) return;
      const sentences = splitSentences(body).map(s=>s.trim()).filter(Boolean);
      segs.push({
        idx: segs.length, title: cur.title, text: body,
        sentences: sentences.map((s,i)=>({idx:i, text:s, norm:norm(s)}))
      });
      cur = { title:"", body:[] };
    };
    for (const ln of lines){
      if (ln.trim()===""){ push(); continue; }
      if (ln.trim().startsWith("#")){ push(); cur.title = ln.replace(/^#+\s?/,"").trim(); continue; }
      cur.body.push(ln);
    }
    push();
    return segs;
  }

  function renderScript(){
    scriptEl.innerHTML = "";
    for (const seg of segments){
      const segDiv = document.createElement("div");
      segDiv.className = "seg";
      segDiv.dataset.seg = seg.idx;
      if (seg.title){
        const st = document.createElement("span");
        st.className = "title"; st.textContent = `섹션: ${seg.title}`;
        segDiv.appendChild(st);
      }
      for (const st of seg.sentences){
        const sp = document.createElement("span");
        sp.className = "sentence"; sp.dataset.seg = seg.idx; sp.dataset.sent = st.idx;
        sp.textContent = st.text;
        sp.addEventListener("click", ()=> setActiveSentence(seg.idx, st.idx, true));
        segDiv.appendChild(sp);
        segDiv.appendChild(document.createTextNode(" "));
      }
      segDiv.addEventListener("click", ()=> setActiveSegment(seg.idx, true));
      scriptEl.appendChild(segDiv);
    }
  }

  function setActiveSegment(segIdx, user=false){
    if (segIdx<0 || segIdx>=segments.length) return;
    const first = segments[segIdx].sentences.length? 0 : -1;
    setActiveSentence(segIdx, first, user);
  }
  function setActiveSentence(segIdx, sentIdx, user=false){
    if (segIdx<0 || segIdx>=segments.length) return;
    const seg = segments[segIdx];
    if (sentIdx<0) sentIdx = 0;
    if (sentIdx>=seg.sentences.length) sentIdx = seg.sentences.length-1;
    active = { seg: segIdx, sent: sentIdx };

    document.querySelectorAll(".seg").forEach(n=>n.classList.remove("active"));
    const segNode = document.querySelector(`.seg[data-seg="${segIdx}"]`);
    if (segNode) segNode.classList.add("active");
    document.querySelectorAll(".sentence").forEach(n=>n.classList.remove("active"));
    const sNode = document.querySelector(`.sentence[data-seg="${segIdx}"][data-sent="${sentIdx}"]`);
    if (sNode){ sNode.classList.add("active"); sNode.scrollIntoView({block:"center"}); }

    const prev = seg.sentences[sentIdx-1]?.text || "—";
    const curr = seg.sentences[sentIdx]?.text || "—";
    const next = seg.sentences[sentIdx+1]?.text || "—";
    prevSentEl.textContent = prev; currSentEl.textContent = curr; nextSentEl.textContent = next;
    rightTitle.textContent = seg.title ? `섹션: ${seg.title} · 단락 ${segIdx+1} · 문장 ${sentIdx+1}/${seg.sentences.length}`
                                       : `단락 ${segIdx+1} · 문장 ${sentIdx+1}/${seg.sentences.length}`;
  }

  function buildSentenceIndex(){
    const docs = [];
    for (const seg of segments){
      for (const st of seg.sentences){
        docs.push({ seg:seg.idx, sent:st.idx, text: st.norm });
      }
    }
    sentIndex = new Fuse(docs, { includeScore:true, keys:["text"], threshold:0.35, minMatchCharLength:10, distance:300 });
  }

  async function handleTextLoad(text){
    segments = parseManuscript(text);
    renderScript();
    buildSentenceIndex();
    if (segments.length) setActiveSegment(0);
  }

  async function loadSample(){
    const res = await fetch("sample-sermon.txt");
    handleTextLoad(await res.text());
  }

  drop.addEventListener("dragover",(e)=>{ e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave",()=> drop.classList.remove("drag"));
  drop.addEventListener("drop", async (e)=>{
    e.preventDefault(); drop.classList.remove("drag");
    const f = e.dataTransfer.files?.[0]; if (!f) return;
    handleTextLoad(await f.text());
  });
  fileInput.addEventListener("change", async (e)=>{
    const f = e.target.files?.[0]; if (!f) return;
    handleTextLoad(await f.text());
  });
  btnSample?.addEventListener("click", loadSample);

  function supported(){ return ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window); }
  function getRecognizer(){
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return null;
    const r = new Ctor(); r.lang = "ko-KR"; r.continuous = true; r.interimResults = true; return r;
  }
  function updateRecState(){ recDot.className = "dot " + (listening? "rec":"ok"); recState.textContent = listening? "듣는 중":"대기"; }
  function startListening(){
    if (!supported()){ alert("이 브라우저는 Web Speech API를 지원하지 않습니다. Chrome 권장."); return; }
    if (!rec) rec = getRecognizer(); if (!rec) return;
    recentBuffer = ""; listening = true; updateRecState();
    rec.onresult = (evt)=>{
      let text=""; for (let i=evt.resultIndex;i<evt.results.length;i++){ const r=evt.results[i]; text += (r[0]?.transcript||""); }
      text = text.trim(); if (!text) return;
      recentBuffer = (recentBuffer + " " + text).slice(-MAX_BUF_LEN);
      if (recentBuffer.length>50 && sentIndex){
        const tail = norm(recentBuffer).slice(-60);
        const res = sentIndex.search(tail).slice(0,5).sort((a,b)=> (a.score??1)-(b.score??1));
        if (res.length){ const { seg, sent } = res[0].item; setActiveSentence(seg, sent); }
      }
    };
    rec.onend = ()=>{ if (listening){ try{ rec.start(); }catch{} } };
    rec.onerror = (e)=> console.warn("rec error", e);
    try{ rec.start(); }catch(e){ console.warn(e); }
  }
  function stopListening(){ listening=false; updateRecState(); try{ rec&&rec.stop(); }catch{} }

  btnStart.addEventListener("click", startListening);
  btnStop.addEventListener("click", stopListening);
  btnCalib.addEventListener("click", ()=>{ if (active.seg>=0) setActiveSentence(active.seg, active.sent, true); });

  window.addEventListener("keydown",(e)=>{
    if (e.code==="Space"){ e.preventDefault(); listening? stopListening(): startListening(); }
    else if (e.code==="ArrowDown"){
      const seg = segments[active.seg]; if (!seg) return;
      const n = active.sent+1;
      if (n < seg.sentences.length) setActiveSentence(active.seg, n, true);
      else if (active.seg+1 < segments.length) setActiveSentence(active.seg+1, 0, true);
    } else if (e.code==="ArrowUp"){
      const seg = segments[active.seg]; if (!seg) return;
      const p = active.sent-1;
      if (p >= 0) setActiveSentence(active.seg, p, true);
      else if (active.seg-1>=0){ const prev = segments[active.seg-1]; setActiveSentence(active.seg-1, Math.max(0, prev.sentences.length-1), true); }
    }
  });

  if ("serviceWorker" in navigator){
    window.addEventListener("load", ()=>{
      navigator.serviceWorker.register("./sw.js", { scope:"./" })
        .then(reg=>console.log("[SW] registered:", reg.scope))
        .catch(err=>console.warn("[SW] failed:", err));
    });
  }
})();