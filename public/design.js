/* XTECH — detalhes de identidade: preço com cêntimos pequenos, faixa a correr e nome no rodapé */
(function(){
  // "699,99 €" / "699.99€" → <span class="e">699</span><span class="c">,99 €</span>
  function fmt(el){
    if(!el || el.querySelector('.xt-pr')) return;
    const t = (el.textContent || '').trim();
    const m = t.match(/^([\d\s. ]*\d)[.,](\d{2})\s*€$/);
    if(!m) return;
    const euros = m[1].replace(/[\s. ]/g, '');
    el.innerHTML = `<span class="xt-pr"><span class="e">${Number(euros).toLocaleString('pt-PT')}</span><span class="c">,${m[2]} €</span></span>`;
  }
  function run(root){
    (root || document).querySelectorAll('#products-grid .price b, #product-detail-root [data-bind="price"]').forEach(fmt);
  }
  const mo = new MutationObserver(muts => {
    for(const m of muts){ if(m.target && m.target.closest && (m.target.closest('#products-grid') || m.target.closest('#product-detail-root'))){ run(); break; } }
  });
  function start(){
    run();
    mo.observe(document.body, { childList:true, subtree:true, characterData:true });
    // faixa a correr por baixo do topo da página inicial
    const hero = document.querySelector('#page-home .hero');
    if(hero && !document.querySelector('.xt-ticker')){
      const items = ['Garantia de 18 meses nos usados', 'Testados um a um', 'Diagnóstico gratuito', 'Levantamento em Goães, Amares', 'MB WAY e transferência', 'Retoma do teu usado', 'Reparações em todas as marcas'];
      const row = items.map(i => `<span>${i}</span>`).join('');
      hero.insertAdjacentHTML('afterend', `<div class="xt-ticker" aria-hidden="true"><div class="xt-ticker-track">${row}${row}</div></div>`);
    }
    // nome gigante no rodapé
    const fb = document.querySelector('#site-view footer.site-footer .footer-bottom');
    if(fb && !document.querySelector('.xt-footer-word')) fb.insertAdjacentHTML('beforebegin', '<div class="xt-footer-word" aria-hidden="true">XTECH</div>');
  }
  if(document.readyState !== 'loading') start(); else document.addEventListener('DOMContentLoaded', start);
})();
