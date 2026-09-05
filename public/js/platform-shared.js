(()=>{
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const escUrl=v=>String(v||'').replace(/"/g,'%22');
  async function applyBrand(){
    try{
      const r=await fetch('/api/site'); const d=await r.json(); const s=d.settings||{};
      document.documentElement.style.setProperty('--primary-custom',s.primaryColor||'#151a16');
      document.documentElement.style.setProperty('--nav-hover',s.navHoverColor||'#00C9A7');
      const logo=$('#sharedBrandLogo'), mark=$('#sharedBrandMark');
      if(logo&&mark){if(s.logo){logo.src=s.logo;logo.hidden=false;mark.hidden=true}else{logo.hidden=true;mark.hidden=false}}
      let fav=$('#sharedFavicon'); if(!fav){fav=document.createElement('link');fav.rel='icon';fav.id='sharedFavicon';document.head.appendChild(fav)} if(s.favicon)fav.href=s.favicon;
      const footerName=$('#sharedFooterName'); if(footerName)footerName.textContent=s.siteName||'Yuran Multicerviços';
      const footerSocial=$('#sharedSocialLinks');
      if(footerSocial){const map={Instagram:'bi-instagram',Facebook:'bi-facebook',LinkedIn:'bi-linkedin',YouTube:'bi-youtube',TikTok:'bi-tiktok',X:'bi-twitter-x',WhatsApp:'bi-whatsapp',Telegram:'bi-telegram',Pinterest:'bi-pinterest',GitHub:'bi-github',Behance:'bi-behance',Dribbble:'bi-dribbble',Website:'bi-globe2'};footerSocial.innerHTML=(d.socials||[]).filter(x=>x.url&&x.url!=='#').map(x=>`<a class="social-icon-link" href="${escUrl(x.url)}" target="_blank" rel="noopener" aria-label="${x.platform||'Rede social'}"><i class="bi ${x.iconClass||map[x.platform]||'bi-link-45deg'}"></i></a>`).join('')}
    }catch(e){console.error(e)}
  }
  const saved=localStorage.getItem('theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=saved;
  const theme=$('#themeToggle'); if(theme)theme.onclick=()=>{const n=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=n;localStorage.setItem('theme',n)};
  const menu=$('#menuToggle'),nav=$('#nav');if(menu&&nav)menu.onclick=()=>nav.classList.toggle('open');$$('#nav a').forEach(a=>a.onclick=()=>nav?.classList.remove('open'));
  const year=$('#sharedYear');if(year)year.textContent=new Date().getFullYear();
  applyBrand();
})();
