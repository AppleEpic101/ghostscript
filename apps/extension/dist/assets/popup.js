const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./main-C1RDQNCc.js","./main-CUI6vui0.css"])))=>i.map(i=>d[i]);
(function(){const c=document.createElement("link").relList;if(c&&c.supports&&c.supports("modulepreload"))return;for(const e of document.querySelectorAll('link[rel="modulepreload"]'))d(e);new MutationObserver(e=>{for(const o of e)if(o.type==="childList")for(const r of o.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&d(r)}).observe(document,{childList:!0,subtree:!0});function l(e){const o={};return e.integrity&&(o.integrity=e.integrity),e.referrerPolicy&&(o.referrerPolicy=e.referrerPolicy),e.crossOrigin==="use-credentials"?o.credentials="include":e.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function d(e){if(e.ep)return;e.ep=!0;const o=l(e);fetch(e.href,o)}})();const y="modulepreload",x=function(s,c){return new URL(s,c).href},h={},v=function(c,l,d){let e=Promise.resolve();if(l&&l.length>0){let b=function(t){return Promise.all(t.map(a=>Promise.resolve(a).then(p=>({status:"fulfilled",value:p}),p=>({status:"rejected",reason:p}))))};const r=document.getElementsByTagName("link"),n=document.querySelector("meta[property=csp-nonce]"),m=n?.nonce||n?.getAttribute("nonce");e=b(l.map(t=>{if(t=x(t,d),t in h)return;h[t]=!0;const a=t.endsWith(".css"),p=a?'[rel="stylesheet"]':"";if(d)for(let u=r.length-1;u>=0;u--){const f=r[u];if(f.href===t&&(!a||f.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${t}"]${p}`))return;const i=document.createElement("link");if(i.rel=a?"stylesheet":y,a||(i.as="script"),i.crossOrigin="",i.href=t,m&&i.setAttribute("nonce",m),document.head.appendChild(i),a)return new Promise((u,f)=>{i.addEventListener("load",u),i.addEventListener("error",()=>f(new Error(`Unable to preload CSS for ${t}`)))})}))}function o(r){const n=new Event("vite:preloadError",{cancelable:!0});if(n.payload=r,window.dispatchEvent(n),!n.defaultPrevented)throw r}return e.then(r=>{for(const n of r||[])n.status==="rejected"&&o(n.reason);return c().catch(o)})},g=document.getElementById("root");function E(){if(!g)return;const s=document.createElement("style");s.textContent=`
    :root {
      color-scheme: dark;
      font-family: "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
      background: #313338;
      color: #dbdee1;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-width: 360px;
    }

    .popup-load-error {
      padding: 18px;
    }

    .popup-load-error-card {
      background: #2b2d31;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
    }

    .popup-load-error-card h1 {
      margin: 0 0 10px;
      font-size: 22px;
      line-height: 1.1;
      color: #ffffff;
    }

    .popup-load-error-card p {
      margin: 0;
      color: #b5bac1;
      font-size: 14px;
      line-height: 1.5;
    }

    .popup-load-error-card p + p {
      margin-top: 10px;
    }

    .popup-load-error-card code {
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 13px;
      background: #1e1f22;
      padding: 2px 4px;
      border-radius: 3px;
    }
  `,document.head.appendChild(s),g.innerHTML=`
    <main class="popup-load-error">
      <section class="popup-load-error-card">
        <h1>Ghostscript needs the built extension bundle</h1>
        <p>Run <code>corepack pnpm --filter @ghostscript/extension build</code> or <code>corepack pnpm --filter @ghostscript/extension dev</code>.</p>
        <p>Then reload the unpacked extension from <code>apps/extension/dist</code> instead of <code>apps/extension</code>.</p>
      </section>
    </main>
  `}async function L(){try{await v(()=>import("./main-C1RDQNCc.js"),__vite__mapDeps([0,1]),import.meta.url)}catch(s){console.error("Ghostscript popup failed to load.",s),E()}}L();
