// Independently implemented, local-only GPT compatibility adapter.
// API contract: https://developers.google.com/publisher-tag/reference
// No ad auctions, network calls, impressions or reward events are generated.
(() => {
  "use strict";
  const tag = window.googletag && typeof window.googletag === "object" ? window.googletag : {};
  if (tag.apiReady) return;
  const pending = Array.isArray(tag.cmd) ? tag.cmd.slice() : [];
  const slots = new Set(), listeners = new Map();
  const values = () => {
    const store = new Map();
    return {
      set(key, value) { store.set(String(key), Array.isArray(value) ? value.map(String) : [String(value)]); },
      get(key) { return (store.get(String(key)) || []).slice(); },
      keys() { return [...store.keys()]; },
      clear(key) { key === undefined ? store.clear() : store.delete(String(key)); }
    };
  };
  function targeting(object) {
    const data = values();
    object.setTargeting = function(key,value) { data.set(key,value); return this; };
    object.getTargeting = key => data.get(key);
    object.getTargetingKeys = () => data.keys();
    object.clearTargeting = function(key) { data.clear(key); return this; };
    object.updateTargetingFromMap = function(map) { for (const [key,value] of Object.entries(map || {})) data.set(key,value); return this; };
    return object;
  }
  const chain = function() { return this; }, nothing = function() {};
  function makeSlot(unit, sizes, element) {
    if (typeof unit !== "string" || !unit) return null;
    const id = typeof element === "string" ? element : "";
    const services = new Set(), exclusions = new Set(), attributes = new Map();
    const slot = targeting({
      addService(service) { if(service) services.add(service); return this; },
      getServices() { return [...services]; },
      getAdUnitPath() { return unit; }, getSlotElementId() { return id; }, getDomId() { return id; }, getSlotId() { return slot; },
      getSizes() { return Array.isArray(sizes) ? sizes.slice() : []; },
      getResponseInformation() { return null; },
      set(key,value) { attributes.set(key,value); return this; }, get(key) { return attributes.get(key) ?? null; },
      getAttributeKeys() { return [...attributes.keys()]; },
      setCategoryExclusion(value) { exclusions.add(String(value)); return this; },
      getCategoryExclusions() { return [...exclusions]; }, clearCategoryExclusions() { exclusions.clear(); return this; }
    });
    for (const key of ['defineSizeMapping','setClickUrl','setCollapseEmptyDiv','setConfig','setForceSafeFrame','setSafeFrameConfig']) slot[key] = chain;
    slots.add(slot); return slot;
  }
  function emptyRender(slot) {
    if (!slots.has(slot)) return;
    queueMicrotask(() => {
      if (!slots.has(slot)) return;
      const event = { slot, serviceName:'publisher_ads', isEmpty:true, size:null, advertiserId:null, campaignId:null, creativeId:null, lineItemId:null, isBackfill:false, slotContentChanged:false };
      for (const callback of [...(listeners.get('slotRenderEnded') || [])]) { try { callback(event); } catch (_) {} }
    });
  }
  const service = targeting({
    getSlots() { return [...slots]; },
    addEventListener(name, callback) {
      if (typeof callback === 'function') { if(!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name).add(callback); }
      return this;
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); return this; },
    refresh(selected) { for (const slot of selected || slots) emptyRender(slot); },
    clear(selected) { return [...(selected || slots)].every(slot=>slots.has(slot)); },
    isInitialLoadDisabled() { return true; }, get() { return null; }, getAttributeKeys() { return []; },
    definePassback(unit,sizes) { return makeSlot(unit,sizes); }, defineOutOfPagePassback(unit) { return makeSlot(unit,[]); }
  });
  for (const key of ['clearCategoryExclusions','clearTagForChildDirectedTreatment','setCategoryExclusion','setPrivacySettings','setSafeFrameConfig','setTagForChildDirectedTreatment','set']) service[key]=chain;
  for (const key of ['collapseEmptyDivs','disableInitialLoad','display','enable','enableAsyncRendering','enableLazyLoad','enableSingleRequest','enableSyncRendering','enableVideoAds','setCentering','setCookieOptions','setForceSafeFrame','setLocation','setPublisherProvidedId','setRequestNonPersonalizedAds','setVideoContent','updateCorrelator']) service[key]=nothing;
  let config = {};
  const commands = [];
  let draining = false;
  commands.push = function(...callbacks) {
    const accepted = callbacks.filter(fn=>typeof fn==='function');
    pending.push(...accepted);
    if (!draining) {
      draining=true;
      try { while(pending.length) { const callback=pending.shift(); try { Reflect.apply(callback,window,[]); } catch (_) {} } }
      finally { draining=false; }
    }
    return accepted.length;
  };
  Object.assign(tag, {
    apiReady:true, pubadsReady:true, cmd:commands,
    pubads() { return service; },
    defineSlot:makeSlot,
    // Unsupported automatic/rewarded formats return null, per the API contract.
    defineOutOfPageSlot(unit,element) { return typeof element==='string' ? makeSlot(unit,[],element) : null; },
    destroySlots(selected) { const items=selected || [...slots]; for(const slot of items) slots.delete(slot); return true; },
    display(element) { const id=typeof element==='string' ? element : element?.id; for(const slot of slots) if(slot.getSlotElementId()===id) emptyRender(slot); },
    enableServices:nothing, disablePublisherConsole:nothing, openConsole:nothing, setAdIframeTitle:nothing,
    setConfig(next) { config={...config,...next}; }, getConfig() { return Object.freeze({...config}); },
    getVersion() { return 'local'; },
    companionAds() { return {addEventListener:chain,enableSyncLoading:nothing,setRefreshUnfilledSlots:nothing}; },
    content() { return {addEventListener:chain,setContent:nothing}; },
    sizeMapping() { const mapping=[];return {addSize(viewport,sizes){mapping.push([viewport,sizes]);return this;},build(){return mapping.slice();}}; }
  });
  // Publish the complete API BEFORE draining the page's pre-load queue.
  window.googletag=tag;
  commands.push();
})();
