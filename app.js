/* v3 — Left: editable sentence buttons; Right: prev/curr/next; 30% similarity highlight */
(() => {
  const $ = (id)=>document.getElementById(id);

  const fileInput = $("fileInput");
  const btnSample = $("btnSample");
  const btnStart = $("btnStart");
  const btnStop = $("btnStop");
  const recDot = $("recDot");
  const recState = $("recState");

  const sentList = $("sentList");
  const prevEl = $("prevSent");
  const currEl = $("currSent");
  const nextEl = $("nextSent");

  let sentences = []; // [{idx,text,norm}]
  let activeIdx = -1;
  let fuse = null;

  // recognition
  let rec = null, listening = false, recent = "";
  const MAX_BUF = 260;
  const SIM_THRESHOLD = 0.30; // >= 30%

  const norm = (s)=> (s||"").toLowerCase()
    .replace(/[^\p{Script=Hangul}a-z0-9\s]/gu," ")
    .replace(/\s+/g," ")
    .trim();

  function splitSentences(text){
    const t = text.replace(/\r\n/g,"\n").replace(/\n+/g," ").trim();
    if (!t) return [];
    const parts = t.split(/(?<=[\.!\?！\?。…])\s+/u);
    if (parts.length===1){ // fallback chunking
      const res=[]; let s=t; const CH=80;
      while(s.length>0){ res.push(s.slice(0,CH)); s=s.slice(CH); }
      return res;
    }
    return parts;
  }

  function buildIndex(){
    fuse = new Fuse(sentences.map(s=>({idx:s.idx, text:s.norm})), {
      includeScore:true,
      keys:["text"],
      threshold:0.7,       // allow fuzziness; we'll gate by similarity ourselves
      minMatchCharLength:10,
      distance:300
    });
  }

  function renderList(){
    sentList.innerHTML = "";
    sentences.forEach((s,i)=>{
      const row = document.createElement("div");
      row.className = "sentItem";

      const num = document.createElement("div");
      num.className = "num"; num.textContent = (i+1).toString().padStart(2,"0");
      row.appendChild(num);

      const input = document.createElement("input");
      input.type = "text";
      input.value = s.text;
      input.className = "sentBtn";
      input.dataset.idx = i;
      input.addEventListener("input", (e)=>{
        const val = e.target.value;
        sentences[i].text = val;
        sentences[i].norm = norm(val);
        buildIndex(); // rebuild for live edits (small n, OK)
      });
      input.addEventListener("focus", ()=> setActive(i,true));
      row.appendChild(input);

      sentList.appendChild(row);
    });
  }

  function setActive(i, fromUser=false){
    if (i<0 || i>=sentences.length) return;
    activeIdx = i;
    document.querySelectorAll(".sentBtn").forEach(n=>n.classList.remove("active"));
    const node = document.querySelector(`.sentBtn[data-idx="${i}"]`);
    if (node){
      node.classList.add("active");
      node.scrollIntoView({block:"center"});
    }
    prevEl.textContent = sentences[i-1]?.text || "—";
    currEl.textContent = sentences[i]?.text || "—";
    nextEl.textContent = sentences[i+1]?.text || "—";
  }

  async function loadText(text){
    const sents = splitSentences(text).map(x=>x.trim()).filter(Boolean);
    sentences = sents.map((t,i)=>({ idx:i, text:t, norm:norm(t) }));
    renderList();
    buildIndex();
    if (sentences.length){
      setActive(0);
      const first = document.querySelector('.sentBtn[data-idx="0"]');
      first && first.focus();
    }
  }

  async function loadSample(){
    const res = await fetch("sample-sermon.txt");
    const t = await res.text();
    loadText(t);
  }

  fileInput.addEventListener("change", async (e)=>{
    const f = e.target.files?.[0]; if (!f) return;
    loadText(await f.text());
  });
  btnSample.addEventListener("click", loadSample);

  // Speech
  function supported(){ return ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window); }
  function getRec(){
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return null;
    const r = new Ctor();
    r.lang = "ko-KR"; r.continuous=true; r.interimResults=true;
    return r;
  }
  function updRecState(){ recDot.className = "dot " + (listening? "rec":"ok"); recState.textContent = listening? "듣는 중":"대기"; }

  function start(){
    if (!supported()){ alert("이 브라우저는 Web Speech API를 지원하지 않습니다. Chrome을 권장합니다."); return; }
    if (!rec) rec = getRec(); if (!rec) return;
    listening = true; recent=""; updRecState();
    rec.onresult = (evt)=>{
      let chunk="";
      for (let i=evt.resultIndex;i<evt.results.length;i++){ const r=evt.results[i]; chunk += (r[0]?.transcript||""); }
      chunk = chunk.trim(); if (!chunk || !sentences.length) return;
      recent = (recent + " " + chunk).slice(-MAX_BUF);
      if (recent.length > 40 && fuse){
        const q = norm(recent).slice(-60);
        const res = fuse.search(q).slice(0,3);
        if (res.length){
          res.sort((a,b)=> (a.score??1) - (b.score??1));
          const best = res[0];
          const sim = 1 - (best.score ?? 1);
          if (sim >= 0.30){
            const idx = best.item.idx;
            setActive(idx);
          }
        }
      }
    };
    rec.onend = ()=>{ if (listening){ try{ rec.start(); }catch{} } };
    rec.onerror = (e)=> console.warn("rec error:", e);
    try{ rec.start(); }catch(e){ console.warn(e); }
  }
  function stop(){ listening=false; updRecState(); try{ rec&&rec.stop(); }catch{} }

  btnStart.addEventListener("click", start);
  btnStop.addEventListener("click", stop);

  window.addEventListener("keydown",(e)=>{
    if (e.code==="Space"){ e.preventDefault(); listening? stop(): start(); }
    else if (e.code==="ArrowDown"){ if (activeIdx+1 < sentences.length) setActive(activeIdx+1, true); }
    else if (e.code==="ArrowUp"){ if (activeIdx-1 >= 0) setActive(activeIdx-1, true); }
  });

  // PWA
  if ("serviceWorker" in navigator){
    window.addEventListener("load", ()=>{
      navigator.serviceWorker.register("./sw.js", {scope:"./"})
        .then(r=>console.log("[SW] ok:", r.scope))
        .catch(e=>console.warn("[SW] fail:", e));
    });
  }
})();