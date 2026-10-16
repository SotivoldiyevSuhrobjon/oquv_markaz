/* ===== "Dastur haqida" bloki — boshqa dasturlarga ham ko'chirib ishlatiladi =====
   Faqat ABOUT ob'ektini o'zgartiring. tg — Telegram username (@siz), bo'sh bo'lsa tgId orqali ochiladi. */
const ABOUT={
 name:"Olimpiya akademiyasi",
 ver:"1.0",
 desc:"O'quv markaz uchun boshqaruv dasturi: guruhlar, davomat, to'lovlar, xonalar jadvali, xodimlar va hisobotlar bitta joyda.",
 feats:["Guruhlar va o'quvchilar bazasi","Davomat va 3 tadan ortiq qoldirganlar ogohlantirishi","Oylik to'lov, qarz, chegirma va kassa","Xona va dars vaqti jadvali (ustma-ust tushmaslik nazorati)","O'qituvchi oyligi va support xodimlar","Rollar: admin, administrator, bugalter, o'qituvchi"],
 author:"Suhrobjon",role:"Dasturchi",tg:"",tgId:"781462705",year:2026};
(function(){
 const st=document.createElement('style');st.textContent=`.ab-b{display:flex;gap:12px;align-items:center;padding:12px;border:1px solid var(--bd);border-radius:14px;background:var(--card);text-decoration:none;color:inherit;transition:transform .2s,border-color .2s,box-shadow .2s}.ab-b:hover{transform:translateY(-2px);border-color:#229ed9;box-shadow:0 12px 26px -14px #229ed9}.ab-av{flex:none;width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#2aabee,#229ed9);display:grid;place-items:center}.ab-av svg{width:22px;height:22px;fill:#fff;margin-right:2px}.ab-l{margin:8px 0 0;padding-left:18px}.ab-l li{margin:3px 0}`;document.head.appendChild(st);
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const link=()=>ABOUT.tg?`https://t.me/${ABOUT.tg.replace(/^@/,'')}`:`tg://user?id=${ABOUT.tgId}`;
 function open(){close();const d=document.createElement('div');d.id='about';d.className='modal enter';d.innerHTML=`<div class="mb" style="max-width:480px" role="dialog" aria-modal="true" aria-label="Dastur haqida"><div class="row" style="margin-top:0"><h2 style="margin:0;flex:1">Dastur haqida</h2><button class="btn" data-ab-x aria-label="Yopish">✕</button></div><b style="font-size:17px">${esc(ABOUT.name)}</b> <span class="tag">${esc(ABOUT.ver)}</span><p style="margin:8px 0">${esc(ABOUT.desc)}</p><ul class="ab-l">${ABOUT.feats.map(f=>`<li>${esc(f)}</li>`).join('')}</ul><h2>Muallif</h2><a class="ab-b" href="${link()}" target="_blank" rel="noopener"><span class="ab-av"><svg viewBox="0 0 24 24"><path d="M9.8 15.6l-.4 4.2c.6 0 .9-.3 1.2-.6l2.9-2.7 6 4.4c1.1.6 1.9.3 2.2-1l3.9-18.3c.4-1.6-.6-2.3-1.6-1.9L1.3 9.4c-1.6.6-1.5 1.5-.3 1.9l5.9 1.8L20.6 4.5c.6-.4 1.2-.2.7.2z"/></svg></span><span><b>${esc(ABOUT.author)}</b><div class="mu">${esc(ABOUT.role)} · Telegramda yozish uchun bosing</div></span></a><div class="demo" style="margin-top:10px">© ${ABOUT.year} ${esc(ABOUT.author)}</div></div>`;document.body.appendChild(d)}
 function close(){const d=document.getElementById('about');if(d)d.remove()}
 document.addEventListener('click',e=>{const t=e.target;if(t.closest&&t.closest('[data-about]')){e.preventDefault();open();return}if(t.id=='about'||(t.closest&&t.closest('[data-ab-x]')))close()});
 document.addEventListener('keydown',e=>{if(e.key=='Escape')close()});
})();
