// Independent opt-in page protections. Each capability is selected separately.
// Static document_start policy files precede this script, avoiding an async
// settings round trip that would expose the native APIs during initial load.
(() => {
  "use strict";
  const policy=globalThis.__voidyPrivacyInstall || {};
  delete globalThis.__voidyPrivacyInstall;
  const apply=Reflect.apply;
  const permitted=()=>policy.canvas==="gesture"&&!!navigator.userActivation?.isActive;
  const denied=feature=>new DOMException(feature+" is blocked by this site's privacy settings.","SecurityError");
  function wrap(prototype,key,make) {
    if(!prototype)return;
    const d=Object.getOwnPropertyDescriptor(prototype,key);
    if(!d || typeof d.value!=="function" || (!d.writable&&!d.configurable))return;
    const replacement=make(d.value);
    Object.defineProperty(replacement,"name",{value:d.value.name});
    Object.defineProperty(replacement,"length",{value:d.value.length});
    Object.defineProperty(prototype,key,{...d,value:replacement});
  }
  if(policy.canvas==="gesture"||policy.canvas==="strict"){
  wrap(globalThis.HTMLCanvasElement?.prototype,"toDataURL",original=>({toDataURL(){if(!permitted())throw denied("Canvas export");return apply(original,this,arguments);}}).toDataURL);
  wrap(globalThis.HTMLCanvasElement?.prototype,"toBlob",original=>({toBlob(){if(!permitted())throw denied("Canvas export");return apply(original,this,arguments);}}).toBlob);
  for(const prototype of [globalThis.CanvasRenderingContext2D?.prototype,globalThis.OffscreenCanvasRenderingContext2D?.prototype])
    wrap(prototype,"getImageData",original=>({getImageData(){const result=apply(original,this,arguments);if(!permitted())throw denied("Canvas readout");return result;}}).getImageData);
  wrap(globalThis.OffscreenCanvas?.prototype,"convertToBlob",original=>({convertToBlob(){if(!permitted())return Promise.reject(denied("Canvas export"));return apply(original,this,arguments);}}).convertToBlob);
  }
  if(policy.webgl==="mask")for(const prototype of [globalThis.WebGLRenderingContext?.prototype,globalThis.WebGL2RenderingContext?.prototype])
    wrap(prototype,"getParameter",original=>({getParameter(parameter){const result=apply(original,this,arguments);if(parameter===37445)return "WebKit";if(parameter===37446)return "WebKit WebGL";return result;}}).getParameter);
  if(policy.webgl==="block"){
    for(const prototype of [globalThis.HTMLCanvasElement?.prototype,globalThis.OffscreenCanvas?.prototype])wrap(prototype,"getContext",original=>({getContext(type){const args=[...arguments];args[0]=String(type);if(["webgl","experimental-webgl","webgl2","webgpu"].includes(args[0]))return null;return apply(original,this,args);}}).getContext);
    if(navigator.gpu)wrap(Object.getPrototypeOf(navigator.gpu),"requestAdapter",()=>({requestAdapter(){return Promise.resolve(null);}}).requestAdapter);
  }
  if(policy.audio){
    for(const prototype of new Set([globalThis.OfflineAudioContext?.prototype,globalThis.webkitOfflineAudioContext?.prototype]))wrap(prototype,"startRendering",()=>({startRendering(){return Promise.reject(denied("Offline audio rendering"));}}).startRendering);
    for(const key of ["getFloatFrequencyData","getByteFrequencyData","getFloatTimeDomainData","getByteTimeDomainData"])wrap(globalThis.AnalyserNode?.prototype,key,()=>({readout(){throw denied("Audio analysis readout");}}).readout);
  }
  if(policy.audioStrict){
    const replacements=new Map();
    for(const name of ["AudioContext","webkitAudioContext"]){
      const d=Object.getOwnPropertyDescriptor(globalThis,name);
      if(!d||typeof d.value!=="function"||!d.configurable&&!d.writable)continue;
      if(!replacements.has(d.value))replacements.set(d.value,new Proxy(d.value,{construct(){throw denied("Web Audio contexts");}}));
      Object.defineProperty(globalThis,name,{...d,value:replacements.get(d.value)});
    }
  }
  if(policy.fonts){
    wrap(globalThis.FontFaceSet?.prototype,"check",()=>({check(){throw denied("Font availability queries");}}).check);
    wrap(globalThis,"queryLocalFonts",()=>({queryLocalFonts(){return Promise.reject(denied("Local font enumeration"));}}).queryLocalFonts);
  }
  if(policy.fontMetrics)for(const prototype of [globalThis.CanvasRenderingContext2D?.prototype,globalThis.OffscreenCanvasRenderingContext2D?.prototype])
    wrap(prototype,"measureText",()=>({measureText(){throw denied("Canvas font measurements");}}).measureText);
  if(policy.clientHints){
    const uaData=navigator.userAgentData;
    if(uaData)wrap(Object.getPrototypeOf(uaData),"getHighEntropyValues",original=>({getHighEntropyValues(hints){
      if(arguments.length===0)return apply(original,this,arguments);
      return apply(original,this,[[]]);
    }}).getHighEntropyValues);
  }
  if(policy.rtc){
    const replacements=new Map();
    for(const name of ["RTCPeerConnection","webkitRTCPeerConnection"]){const d=Object.getOwnPropertyDescriptor(globalThis,name);if(!d||typeof d.value!=="function"||!d.configurable&&!d.writable)continue;
      if(!replacements.has(d.value))replacements.set(d.value,new Proxy(d.value,{construct(){throw denied("WebRTC peer connections");}}));
      Object.defineProperty(globalThis,name,{...d,value:replacements.get(d.value)});
    }
  }
})();
