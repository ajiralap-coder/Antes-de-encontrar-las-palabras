/* Libro digital: el manuscrito original se conserva en manuscript.txt y book-content.js. */
const $ = (selector) => document.querySelector(selector);
const intro = $("#intro"), reader = $("#reader"), leftPage = $("#leftPage"), rightPage = $("#rightPage");
const turnSheet = $("#turnSheet"), turnFront = $("#turnFront"), turnBack = $("#turnBack");
const pageCounter = $("#pageCounter"), sectionHeading = $("#sectionHeading"), prevButton = $("#prevButton"), nextButton = $("#nextButton");
const progressFill = $("#progressFill"), contentsPanel = $("#contentsPanel"), contentsList = $("#contentsList"), soundButton = $("#soundButton");
let current = 0, isTurning = false, audioContext = null, soundEnabled = false;
function escapeHTML(value = "") { return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[c]); }
function isMobile() { return window.matchMedia("(max-width: 700px)").matches; }

// Parse the supplied Markdown without rewriting any manuscript wording.
function parseManuscript(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const title = (lines.find(l => l.startsWith("# ")) || "# Antes de encontrar las palabras").slice(2).trim();
  const subtitleLine = lines.find(l => /^\*[^*].*\*$/.test(l.trim())) || "*Un libro para Agustina*";
  const subtitle = subtitleLine.trim().slice(1, -1);
  const blocks = [];
  let chapter = "", active = null, paragraph = [];
  const flushParagraph = () => { if (paragraph.length && active) { active.paragraphs.push(paragraph.join("\n")); paragraph = []; } else paragraph = []; };
  const flushSection = () => { flushParagraph(); if (active) { blocks.push(active); active = null; } };
  for (const line of lines) {
    if (line.startsWith("# ")) {
      flushSection();
      const heading = line.slice(2).trim();
      if (heading.startsWith("Capítulo ")) { chapter = heading; blocks.push({type:"chapter", title:heading, chapter, paragraphs:[]}); }
      else if (heading !== title) { active = {type:"section", title:heading, chapter, paragraphs:[]}; }
      continue;
    }
    if (line.startsWith("## ")) {
      flushSection();
      active = {type:"section", title:line.slice(3).trim(), chapter, paragraphs:[]};
      continue;
    }
    if (/^\*[^*].*\*$/.test(line.trim()) && !active && !paragraph.length) continue;
    if (!line.trim()) { flushParagraph(); continue; }
    if (!active) active = {type:"section", title:"", chapter, paragraphs:[]};
    paragraph.push(line);
  }
  flushSection();
  return {title, subtitle, blocks};
}

// Keep complete sentences together where possible. Very long sentences are split at word boundaries for pagination only.
function splitParagraph(text, maxChars = 650) {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+[”’"')\]]*|$)/g) || [text];
  const chunks = []; let current = "";
  for (let sentence of sentences) {
    if (!sentence) continue;
    if (sentence.length > maxChars) {
      if (current.trim()) { chunks.push(current.trim()); current = ""; }
      const words = sentence.match(/\S+\s*/g) || [sentence]; let piece = "";
      for (const word of words) { if (piece.length + word.length > maxChars && piece) { chunks.push(piece.trim()); piece = ""; } piece += word; }
      if (piece.trim()) chunks.push(piece.trim());
    } else if (current.length + sentence.length > maxChars && current.trim()) { chunks.push(current.trim()); current = sentence; }
    else current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}
function paginate(parsed) {
  const pages = [{type:"cover", title:parsed.title, subtitle:parsed.subtitle}];
  parsed.blocks.forEach(block => {
    if (block.type === "chapter") { pages.push({type:"chapter", title:block.title, kicker:"UN NUEVO CAPÍTULO", chapter:block.title, paragraphs:[]}); return; }
    const pieces = [];
    block.paragraphs.forEach(p => splitParagraph(p).forEach(chunk => pieces.push({text:chunk, originalParagraph:p})));
    let bucket = [], size = 0;
    const pushPage = () => { if (bucket.length) { pages.push({type:"section", title:block.title, kicker:block.chapter, paragraphs:bucket.map(x=>x.text)}); bucket=[]; size=0; } };
    for (const piece of pieces) {
      const extra = piece.text.length + 1;
      if (size + extra > 650 && bucket.length) pushPage();
      bucket.push(piece); size += extra;
    }
    pushPage();
  });
  return pages;
}
const parsed = parseManuscript(window.RAW_MANUSCRIPT || "");
const BOOK_PAGES = paginate(parsed);
function pageMarkup(page, index) {
  const number = String(index + 1).padStart(2,"0");
  if (!page) return `<div class="page-ornament">✳</div>`;
  if (page.type === "cover") return `<div class="cover-page"><div class="cover-frame"></div><div class="cover-small">un libro personal</div><h2 class="cover-title">${escapeHTML(page.title).replace("las palabras", "<em>las palabras</em>")}</h2><p class="cover-subtitle">${escapeHTML(page.subtitle)}</p><div class="cover-flower">✳</div></div>`;
  if (page.type === "end") return `<div class="cover-page end-page"><div class="cover-frame"></div><div class="cover-small">fin de estas páginas</div><h2 class="cover-title">${escapeHTML(page.title)}</h2><p class="cover-subtitle">${escapeHTML(page.subtitle)}</p><div class="cover-flower">✳</div></div>`;
  if (page.type === "chapter") return `<div class="chapter-page"><div class="cover-frame"></div><p class="page-kicker">${escapeHTML(page.kicker)}</p><h3 class="chapter-title">${escapeHTML(page.title)}</h3><div class="cover-flower">✳</div></div>`;
  const paragraphs = (page.paragraphs || []).map(p => `<p>${escapeHTML(p)}</p>`).join("");
  return `<p class="page-kicker">${escapeHTML(page.kicker || "")}</p><h3 class="page-title">${escapeHTML(page.title || "")}</h3><div class="page-body">${paragraphs}</div><span class="page-number">${number}</span>`;
}
function renderPage(element, page, index, side="") {
  element.className = `paper ${side}-paper`;
  if (page && ["cover","end","chapter"].includes(page.type)) element.classList.add("special-paper");
  element.innerHTML = pageMarkup(page,index);
}
function currentSpreadIndexes() { return isMobile() ? {left:null,right:current} : {left:current,right:current+1}; }
function renderSpread() {
  const {left,right} = currentSpreadIndexes();
  if (isMobile()) { renderPage(leftPage,null,-1,"left"); renderPage(rightPage,BOOK_PAGES[right],right,"right"); }
  else { renderPage(leftPage,BOOK_PAGES[left],left,"left"); renderPage(rightPage,BOOK_PAGES[right],right,"right"); }
  const visibleIndex = isMobile() ? current : Math.min(current+1,BOOK_PAGES.length-1);
  sectionHeading.textContent = BOOK_PAGES[visibleIndex]?.title || "Estas páginas";
  pageCounter.textContent = `${String(visibleIndex+1).padStart(2,"0")} / ${String(BOOK_PAGES.length).padStart(2,"0")}`;
  prevButton.disabled = current <= 0 || isTurning;
  nextButton.disabled = current >= BOOK_PAGES.length - (isMobile()?1:2) || isTurning;
  progressFill.style.width = `${((visibleIndex+1)/BOOK_PAGES.length)*100}%`;
  $("#turnHint").textContent = isMobile() ? "Deslizá o usá las flechas" : "Usá las flechas para pasar las páginas";
  buildContents();
}
function buildContents() {
  contentsList.innerHTML = "";
  BOOK_PAGES.forEach((page,index) => {
    if (["cover","end"].includes(page.type)) return;
    // The index includes chapter openers and only the first page of each repeated section title.
    if (page.type === "section" && index > 0 && BOOK_PAGES[index-1].type === "section" && BOOK_PAGES[index-1].title === page.title) return;
    const li=document.createElement("li"), button=document.createElement("button"); button.type="button";
    button.innerHTML=`<span class="contents-number">${String(index+1).padStart(2,"0")}</span><span>${escapeHTML(page.title)}</span>`;
    button.addEventListener("click",()=>{current=index;if(!isMobile()&&current%2!==0)current-=1;closeContents();renderSpread();reader.scrollIntoView({behavior:"smooth",block:"start"});});
    li.appendChild(button); contentsList.appendChild(li);
  });
}
function playPageSound() {
  if(!soundEnabled)return;
  try { audioContext ||= new (window.AudioContext||window.webkitAudioContext)(); const duration=.07, size=Math.floor(audioContext.sampleRate*duration), buffer=audioContext.createBuffer(1,size,audioContext.sampleRate), data=buffer.getChannelData(0); for(let i=0;i<size;i++)data[i]=(Math.random()*2-1)*(1-i/size)*.13; const source=audioContext.createBufferSource(),filter=audioContext.createBiquadFilter(),gain=audioContext.createGain();filter.type="lowpass";filter.frequency.value=1300;gain.gain.value=.12;source.buffer=buffer;source.connect(filter);filter.connect(gain);gain.connect(audioContext.destination);source.start(); } catch(_) {}
}
function turn(direction) {
  if(isTurning)return; const max=BOOK_PAGES.length-(isMobile()?1:2), target=Math.max(0,Math.min(max,current+direction*(isMobile()?1:2))); if(target===current)return;
  isTurning=true;const forward=direction>0,currentIndex=isMobile()?current:current+1;
  turnFront.innerHTML=pageMarkup(BOOK_PAGES[currentIndex],currentIndex);turnBack.innerHTML=pageMarkup(BOOK_PAGES[target],target);
  turnSheet.classList.remove("turning");void turnSheet.offsetWidth;turnSheet.style.display="block";turnSheet.style.animationDirection=forward?"normal":"reverse";turnSheet.classList.add("turning");playPageSound();
  window.setTimeout(()=>{current=target;turnSheet.classList.remove("turning");turnSheet.style.display="none";isTurning=false;renderSpread();},830);
}
function openBook(){intro.classList.add("hidden");reader.classList.remove("hidden");current=0;renderSpread();reader.scrollIntoView({behavior:"smooth",block:"start"});}
function closeContents(){contentsPanel.classList.add("hidden");}
$("#openBookButton").addEventListener("click",openBook);
$("#homeLink").addEventListener("click",e=>{e.preventDefault();reader.classList.add("hidden");intro.classList.remove("hidden");closeContents();window.scrollTo({top:0,behavior:"smooth"});});
prevButton.addEventListener("click",()=>turn(-1));nextButton.addEventListener("click",()=>turn(1));
$("#backToIntro").addEventListener("click",()=>{reader.classList.add("hidden");intro.classList.remove("hidden");window.scrollTo({top:0,behavior:"smooth"});});
$("#contentsButton").addEventListener("click",()=>{if(reader.classList.contains("hidden"))openBook();contentsPanel.classList.remove("hidden");});
$("#closeContents").addEventListener("click",closeContents);contentsPanel.addEventListener("click",e=>{if(e.target===contentsPanel)closeContents();});
soundButton.addEventListener("click",()=>{soundEnabled=!soundEnabled;soundButton.textContent=`Sonido: ${soundEnabled?"encendido":"apagado"}`;soundButton.setAttribute("aria-pressed",String(soundEnabled));});
document.addEventListener("keydown",e=>{if(!contentsPanel.classList.contains("hidden")){if(e.key==="Escape")closeContents();return;}if(reader.classList.contains("hidden")){if(e.key==="Enter"&&document.activeElement===$("#openBookButton"))openBook();return;}if(e.key==="ArrowRight")turn(1);if(e.key==="ArrowLeft")turn(-1);});
let touchStartX=null;$("#book").addEventListener("touchstart",e=>{touchStartX=e.changedTouches[0].clientX;},{passive:true});$("#book").addEventListener("touchend",e=>{if(touchStartX===null)return;const delta=e.changedTouches[0].clientX-touchStartX;if(Math.abs(delta)>45)turn(delta<0?1:-1);touchStartX=null;});
window.addEventListener("resize",()=>{if(!reader.classList.contains("hidden")&&!isTurning)renderSpread();});
renderSpread();
