/* v5.2 — Mic device picker + pro audio constraints + meter from selected device
   사용법:
   1) HTML 헤더 오른쪽 컨트롤에 <select id="micSelect"> 1줄 추가
   2) 이 파일로 app.js 교체
   3) 크롬 주소창 🔒 → 마이크에서 동일 장치 선택(웹스피치용)
   4) OBS/Zoom에서도 같은 장치를 마이크로 지정하면 동시 수음 가능 */
(() => {
  const $ = (id)=>document.getElementById(id);

  // --- UI refs ---
  const fileInput = $("fileInput");
  const btnSample = $("btnSample");
  const btnStart = $("btnStart");
  const btnStop = $("btnStop");
  const recDot = $("recDot");
  const recState = $("recState");
  const meterFill = $("meterFill");

  const sentList = $("sentList");
  const currEl = $("currSent");
  const nextEl = $("nextSent");
  const next2El = $("next2Sent");

  // NEW: mic device selector (HTML에 <select id="micSelect"> 추가 필요)
  const micSelect = $("micSelect");

  // --- State ---
  let sentences = []; // [{idx,text,norm}]
  let activeIdx = -1;
  let fuse = null; // Fuse over array of strings (norm text)

  // recognition + audio meter
  let rec = null, listening = false, recent = "";
  let audioStream = null, audioCtx = null, analyser = null, dataArray = null;
  let currentDeviceId = null;

  const MAX_BUF = 260;
  const SIM_THRESHOLD = 0.30; // >= 30%

  // --- Utils ---
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
    const data = sentences.map(s=>s.norm);
    fuse = new Fuse(data, {
      includeScore:true,
      threshold:0.7,
      minMatchCharLength:10,
      distance:300
    });
  }

  function setActive(i){
    if (i<0 || i>=sentences.length) return;
    activeIdx = i;
    document.querySelectorAll(".sentBtn").forEach(n=>n.classList.remove("active"));
    const node = document.querySelector(`.sentBtn[data-idx="${i}"]`);
    if (node){ node.classList.add("active"); node.scrollIntoView({block:"center"}); }
    currEl.textContent = sentences[i]?.text || "—";
    nextEl.textContent = sentences[i+1]?.text || "—";
    next2El.textContent = sentences[i+2]?.text || "—";
  }

  function renderList(){
    sentList.innerHTML = "";
    sentences.forEach((s,i)=>{
      const row = document.createElement("div");
      row.className = "sentItem";

      const num = document.createElement("div");
      num.className = "num"; num.textContent = (i+1).toString().padStart(2,"0");
      row.appendChild(num);

      const btn = document.createElement("div");
      btn.setAttribute("role","button");
      btn.setAttribute("tabindex","0");
      btn.setAttribute("contenteditable","true");
      btn.className = "sentBtn";
      btn.dataset.idx = i;
      btn.textContent = s.text;

      const commit = ()=>{
        const val = btn.textContent.trim();
        sentences[i].text = val;
        sentences[i].norm = norm(val);
        buildIndex();
        if (activeIdx === i){ setActive(i); }
      };
      btn.addEventListener("blur", commit);
      btn.addEventListener("keydown", (e)=>{
        if (e.key === "Enter"){
          e.preventDefault(); btn.blur();
          const next = document.querySelector(`.sentBtn[data-idx="${i+1}"]`);
          next && next.focus();
        }
      });
      btn.addEventListener("focus", ()=>{
        setActive(i);
        const range = document.createRange(); range.selectNodeContents(btn); range.collapse(false);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      });

      row.appendChild(btn);
      sentList.appendChild(row);
    });
  }

  async function loadText(text){
    const sents = splitSentences(text).map(x=>x.trim()).filter(Boolean);
    sentences = sents.map((t,i)=>({ idx:i, text:t, norm:norm(t) }));
    renderList();
    buildIndex();
    if (sentences.length){
      setActive(0);
      const first = document.querySelector('.sentBtn[data-idx="0"]'); first && first.focus();
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

  // ---------- Device picker ----------
  async function ensurePermission(){
    // 첫 1회 권한 요청(라벨 표시를 위해)
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      tmp.getTracks().forEach(t=>t.stop());
    } catch(e) {
      console.warn("Permission error (labels may be hidden):", e);
    }
  }

  async function listMics(){
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d=>d.kind === "audioinput");

    const prev = micSelect?.value || currentDeviceId || "";

    if (micSelect){
      micSelect.innerHTML = "";
      mics.forEach(d=>{
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `마이크(${d.deviceId.slice(0,6)}…)`;
        micSelect.appendChild(opt);
      });
      const exists = mics.some(m=>m.deviceId === prev);
      micSelect.value = exists ? prev : (mics[0]?.deviceId || "");
    }

    currentDeviceId = (micSelect && micSelect.value) ? micSelect.value : null;
  }

  micSelect?.addEventListener("change", async ()=>{
    currentDeviceId = micSelect.value || null;
    await restartMeter();
  });

  navigator.mediaDevices?.addEventListener?.("devicechange", async ()=>{
    await listMics();
  });

  // --------- Audio Meter from chosen device ---------
  const proConstraints = (deviceId)=>({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1,
      sampleRate: 48000,
      sampleSize: 16,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    },
    video: false
  });

  async function startMeter(){
    try{
      stopMeter();
      const stream = await navigator.mediaDevices.getUserMedia(proConstraints(currentDeviceId));
      audioStream = stream;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      const src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);
      src.connect(analyser);
      const loop = ()=>{
        if (!analyser) return;
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i=0;i<dataArray.length;i++){
          const v = (dataArray[i]-128)/128;
          sum += v*v;
        }
        const rms = Math.sqrt(sum/dataArray.length);
        const level = Math.min(100, Math.max(0, Math.round(rms*140)));
        meterFill.style.width = level + "%";
        requestAnimationFrame(loop);
      };
      loop();
    }catch(err){
      console.warn("meter getUserMedia error:", err);
      alert("오디오 장치 열기 실패: " + (err.message || err));
    }
  }

  async function restartMeter(){
    stopMeter();
    await startMeter();
  }

  function stopMeter(){
    meterFill.style.width = "0%";
    if (audioStream){ audioStream.getTracks().forEach(t=>t.stop()); audioStream=null; }
    if (audioCtx){ try{ audioCtx.close(); }catch{} audioCtx=null; }
    analyser=null; dataArray=null;
  }

  // --------- Recognition with grammar bias ---------
  function supported(){ return ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window); }
  function getRec(){
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return null;
    const r = new Ctor();
    r.lang = "ko-KR";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 3;

    const GList = window.SpeechGrammarList || window.webkitSpeechGrammarList;
    if (GList && sentences.length){
      const gl = new GList();
      const items = sentences.slice(0, 200).map(s=>s.text.replace(/[;|]/g," "));
      const jsgf = "#JSGF V1.0; grammar sermon; public <line> = " + items.join(" | ") + " ;";
      gl.addFromString(jsgf, 1);
      r.grammars = gl;
    }
    return r;
  }

  function updRecState(){
    recDot.className = "dot " + (listening? "rec":"ok");
    recState.textContent = listening? "듣는 중":"대기";
  }

  function ngrams(str, n){
    str = str.replace(/\s+/g," ");
    const set = new Set();
    for (let i=0;i<str.length-(n-1);i++){ set.add(str.slice(i,i+n)); }
    return set;
  }

  function diceSimilarity(a,b){
    const A = ngrams(a,2), B = ngrams(b,2);
    if (!A.size || !B.size) return 0;
    let overlap = 0;
    A.forEach(x=>{ if (B.has(x)) overlap++; });
    return (2*overlap) / (A.size + B.size);
  }

  function combineSimilarity(fuseScore, dice){
    const fuseSim = 1 - (fuseScore ?? 1);
    return 0.6*fuseSim + 0.4*dice;
  }

  function start(){
    if (!supported()){
      alert("이 브라우저는 Web Speech API를 지원하지 않습니다. Chrome을 권장합니다.");
      return;
    }
    if (!rec) rec = getRec(); if (!rec) return;

    listening = true; recent=""; updRecState();
    startMeter(); // meter uses selected device

    rec.onresult = (evt)=>{
      let chunk="";
      for (let i=evt.resultIndex;i<evt.results.length;i++){
        const r=evt.results[i];
        chunk += (r[0]?.transcript || "");
      }
      chunk = chunk.trim(); if (!chunk || !sentences.length) return;

      recent = (recent + " " + chunk).slice(-MAX_BUF);
      if (recent.length > 40 && fuse){
        const q = norm(recent).slice(-70);
        const res = fuse.search(q).slice(0,3);
        if (res.length){
          res.forEach(item=>{
            const idx = item.refIndex;
            const dice = diceSimilarity(q, sentences[idx].norm);
            item._combo = combineSimilarity(item.score, dice);
            item._idx = idx;
          });
          res.sort((a,b)=> b._combo - a._combo);
          const best = res[0];
          if (best && best._combo >= SIM_THRESHOLD){
            setActive(best._idx);
          }
        }
      }
    };

    rec.onend = ()=>{ if (listening){ try{ rec.start(); }catch{} } };

    rec.onerror = (e)=> {
      console.warn("rec error:", e);
      alert("음성 인식 오류가 발생했습니다: " + (e.error || "알 수 없음") + "\n브라우저 권한과 HTTPS 접속을 확인하세요.");
    };

    try{ rec.start(); }catch(e){ console.warn(e); }
  }

  function stop(){
    listening=false; updRecState(); stopMeter();
    try{ rec&&rec.stop(); }catch{}
  }

  // --- Events ---
  btnStart.addEventListener("click", start);
  btnStop.addEventListener("click", stop);

  window.addEventListener("keydown",(e)=>{
    if (e.code==="Space"){ e.preventDefault(); listening? stop(): start(); }
    else if (e.code==="ArrowDown"){ if (activeIdx+1 < sentences.length) setActive(activeIdx+1); }
    else if (e.code==="ArrowUp"){ if (activeIdx-1 >= 0) setActive(activeIdx-1); }
  });

  // PWA
  if ("serviceWorker" in navigator){
    window.addEventListener("load", ()=>{
      navigator.serviceWorker.register("./sw.js", {scope:"./"})
        .then(r=>console.log("[SW] ok:", r.scope))
        .catch(e=>console.warn("[SW] fail:", e));
    });
  }

  // --- Boot ---
  (async ()=>{
    try {
      await ensurePermission();
      await listMics();
    } catch(e) {
      console.warn(e);
    }
  })();

})();
