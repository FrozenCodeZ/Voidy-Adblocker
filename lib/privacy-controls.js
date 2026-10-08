// Shared, explicit privacy controls for the popup and dashboard.
(() => {
  const off={canvas:'off',webgl:'off',audio:false,audioStrict:false,fonts:false,fontMetrics:false,clientHints:false,collectors:false,rtc:false};
  const strong={canvas:'strict',webgl:'mask',audio:true,audioStrict:false,fonts:true,fontMetrics:false,clientHints:false,collectors:true,rtc:false};
  const maximum={canvas:'strict',webgl:'block',audio:true,audioStrict:true,fonts:true,fontMetrics:true,clientHints:true,collectors:true,rtc:true};
  function mount(root,context={}) {
    let host=context.host||'',level=context.level||'off',settings={},busy=false;
    root.innerHTML=`<h3><i data-ico="cloak"></i>Extra privacy</h3>
      <label class="privacy-choice privacy-every"><span>Every site<small data-every-sub>Applies to every site that has no setting of its own, including sites you open for the first time.</small></span><select id="fp-every"><option value="off">Standard</option><option value="strong">Extra</option><option value="maximum">Maximum</option></select></label>
      <p class="privacy-scope" data-site></p><p class="privacy-note" data-own hidden><span data-own-text></span> <button class="privacy-link" id="fp-follow" type="button">Use the every-site setting</button></p>
      <label class="privacy-choice"><input id="fingerprint" type="checkbox"><span>Extra fingerprint protection<small>Strict canvas, reduced GPU details, audio and font queries, known collectors.</small></span></label>
      <button class="privacy-max" id="fp-maximum" type="button" aria-pressed="false"><span class="pm-text"><b>Maximum privacy</b><small data-pm-sub>Every protection on for this site</small></span><span class="pm-sw" aria-hidden="true"></span></button>
      <details class="privacy-details" ${context.expanded?'open':''}><summary><i data-ico="fingerprint"></i>Choose protections for this site</summary>
        <label class="privacy-choice"><span>Canvas readouts<small>Strict blocks image export even after a click. Click-compatible permits reads briefly after interaction, including tracking reads.</small></span><select id="fp-canvas"><option value="off">Off</option><option value="gesture">Click-compatible</option><option value="strict">Strict</option></select></label>
        <label class="privacy-choice"><span>WebGL / GPU<small>Reduce details masks the GPU name only. Blocking prevents WebGL/WebGPU rendering and can break 3D maps and games.</small></span><select id="fp-webgl"><option value="off">Off</option><option value="mask">Reduce details</option><option value="block">Block WebGL / WebGPU</option></select></label>
        <label class="privacy-choice"><input id="fp-audio" type="checkbox"><span>Block audio fingerprint readouts<small>Blocks offline audio rendering and analysis reads. Ordinary video/audio playback remains available; visualizers may fail.</small></span></label>
        <label class="privacy-choice"><input id="fp-audioStrict" type="checkbox"><span>Block all Web Audio contexts<small>Stronger but can break games, calls and site audio. HTML video/audio elements still work.</small></span></label>
        <label class="privacy-choice"><input id="fp-fonts" type="checkbox"><span>Block font availability queries<small>Blocks font-query APIs. Does not hide fonts inferred from page layout; some editors may need this off.</small></span></label>
        <label class="privacy-choice"><input id="fp-fontMetrics" type="checkbox"><span>Block canvas text measurements<small>Covers ordinary and offscreen canvas. Can disrupt editors; CSS and DOM font measurements can still reveal fonts.</small></span></label>
        <label class="privacy-choice"><input id="fp-clientHints" type="checkbox"><span>Limit detailed browser hints<small>Page JavaScript receives only basic browser hints. HTTP headers and Web Workers may still reveal detailed hints; device-specific sites may need this off.</small></span></label>
        <label class="privacy-choice"><input id="fp-collectors" type="checkbox"><span>Block known fingerprint collectors<small>Blocks selected third-party collection services while the Privacy filter is enabled. May affect fraud checks.</small></span></label>
        <label class="privacy-choice"><input id="fp-rtc" type="checkbox"><span>Disable WebRTC on this site<small>Stops new page peer connections, including IPv4/IPv6 discovery. Calls and screen sharing on this site will not work.</small></span></label>
      </details>
      <details class="privacy-details" ${context.expanded?'open':''}><summary><i data-ico="satellite"></i>Network privacy · every site</summary>
        <label class="privacy-choice"><input id="webrtc" data-global="webrtc" type="checkbox"><span>Reduce WebRTC IP exposure<small>Uses the browser's routing policy. May affect calls; it does not disable all WebRTC.</small></span></label>
        <label class="privacy-choice"><input id="ipv6" data-global="ipv6" type="checkbox"><span>Block direct IPv6-address requests<small>Blocks URLs containing an IPv6 address, even on sites set to Off. Cannot block IPv6 behind domain names or protect other apps. Full IPv6 leak prevention needs a VPN or network configuration.</small></span></label>
        <label class="privacy-choice"><input id="privacy-prefetch" data-global="prefetch" type="checkbox"><span>Turn off browser preloading<small>Reduces speculative page requests. Links may open more slowly. Page-initiated DNS hints can remain.</small></span></label>
        <label class="privacy-choice"><input id="privacy-cookies" data-global="cookies" type="checkbox"><span>Block third-party cookies<small>Reduces cross-site tracking; some sign-ins or embedded tools may need exceptions. Exceptions you allowed in your browser's settings still apply.</small></span></label>
      </details><p class="privacy-note privacy-footnote">Site changes reload this tab. Other tabs need a reload. Protections are limited, including in Web Workers.</p><p id="privacy-status" role="status" aria-live="polite"></p>`;
    if(globalThis.VOIDY_ICONS)VOIDY_ICONS.fill(root);
    // Firefox has no third-party-cookie switch for extensions, and already keeps each site's cookies apart.
    if(location.protocol==='moz-extension:'){const c=root.querySelector('#privacy-cookies');if(c)c.closest('label').hidden=true;}
    const get=id=>root.querySelector('#'+id);
    function render(next,newLevel=level){
      settings=next||{};level=newLevel;const p=settings.policy||off;
      root.querySelector('[data-site]').textContent=host?'This site: '+host:'Choose a website for site protections. Network controls apply to the whole browser.';
      const every=settings.fingerprintDefault||'off';get('fp-every').value=every;
      root.querySelector('[data-every-sub]').textContent=every==='maximum'
        ?'Maximum everywhere: video calls (WebRTC), 3D maps and browser games stop working unless you lower those sites below.'
        :every==='strong'?'Extra everywhere: canvas, audio and font fingerprinting blocked on every site without its own setting.'
        :'Applies to every site that has no setting of its own, including sites you open for the first time.';
      root.querySelector('[data-own]').hidden=!(host&&settings.ownChoice&&every!=='off');
      root.querySelector('[data-own-text]').textContent='This site has its own setting.';
      get('fingerprint').checked=!!settings.fingerprint;
      // The quick switch shows On only when every protection is at maximum.
      const isMax=Object.keys(maximum).every(k=>p[k]===maximum[k]);
      get('fp-maximum').setAttribute('aria-pressed',String(isMax));
      get('fp-maximum').querySelector('[data-pm-sub]').textContent=isMax?(settings.ownChoice?'All on. Switch off to go back to standard privacy.':'On through your every-site setting. Switch off for just this site.'):'Every protection on for this site';
      for(const k of ['canvas','webgl'])get('fp-'+k).value=p[k]||'off';
      for(const k of ['audio','audioStrict','fonts','fontMetrics','clientHints','collectors','rtc'])get('fp-'+k).checked=!!p[k];
      get('fp-every').disabled=busy;get('fp-follow').disabled=busy||!host;
      for(const e of root.querySelectorAll('[data-global]')){const key=e.dataset.global,info=settings.browserControls?.[key];e.checked=key==='ipv6'?!!settings.ipv6:!!info?.enabled;e.disabled=busy||!!info&&['not_controllable','controlled_by_other_extensions','unavailable'].includes(info.control);}
      for(const e of root.querySelectorAll('#fingerprint,[id^="fp-"]'))e.disabled=busy||!host||level==='off';
      const warnings=Object.entries(settings.browserControls||{}).filter(([,v])=>v.requested&&!v.enabled||['not_controllable','controlled_by_other_extensions'].includes(v.control)).map(([key])=>key+': controlled elsewhere or not applied');
      get('privacy-status').textContent=warnings.join('. ')||(!host?'':level==='off'?'Site protections are paused while this site is Off.':'');
    }
    async function save(patch,site){
      if(busy)return;busy=true;for(const e of root.querySelectorAll('input,select,button'))e.disabled=true;get('privacy-status').textContent='Applying…';
      try{
        // Request directly in the checkbox's click gesture, before any other await.
        if(['webrtc','prefetch','cookies'].some(k=>patch[k]===true)&&!await chrome.permissions.request({permissions:['privacy']}))throw Error('The browser did not grant the privacy permission.');
        const result=await chrome.runtime.sendMessage({type:'setExtraPrivacy',host,...patch});if(!result?.ok)throw Error(result?.error||'Could not save this setting.');
        render(result);get('privacy-status').textContent=site?'Saved. Reloading this tab…':patch.fingerprintDefault?'Saved. Applies to every site from its next page load.':'Saved. Network protection applies to the whole browser.';
        if(site&&context.reload)await context.reload();else if(site)get('privacy-status').textContent='Saved. Reload open tabs for this site.';
      }catch(error){render(settings);get('privacy-status').textContent=error.message;}
      finally{busy=false;const status=get('privacy-status').textContent;render(settings);get('privacy-status').textContent=status;}
    }
    get('fingerprint').addEventListener('change',e=>save({policy:e.target.checked?strong:off},true));
    // Every site: no reload needed here; open tabs pick it up on their next load.
    get('fp-every').addEventListener('change',e=>save({fingerprintDefault:e.target.value},false));
    get('fp-follow').addEventListener('click',()=>save({followDefault:true},true));
    // Toggle: maximum, or back to standard privacy (no extra protections).
    get('fp-maximum').addEventListener('click',e=>save({policy:e.currentTarget.getAttribute('aria-pressed')==='true'?off:maximum},true));
    for(const k of ['canvas','webgl','audio','audioStrict','fonts','fontMetrics','clientHints','collectors','rtc'])get('fp-'+k).addEventListener('change',e=>save({policy:{...(settings.policy||off),[k]:['canvas','webgl'].includes(k)?e.target.value:e.target.checked}},true));
    for(const e of root.querySelectorAll('[data-global]'))e.addEventListener('change',()=>save({[e.dataset.global]:e.checked},false));
    return {render,setContext(nextHost,nextLevel){host=nextHost;level=nextLevel;},async refresh(){render(await chrome.runtime.sendMessage({type:'getExtraPrivacy',host}));}};
  }
  globalThis.VOIDY_PRIVACY={mount};
})();
