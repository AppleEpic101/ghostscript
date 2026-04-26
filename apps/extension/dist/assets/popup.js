const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./main-CK1udz9O.js","./pairingApi-Bsndi2-p.js","./main-DNuufJl4.css"])))=>i.map(i=>d[i]);
(function(){const c=document.createElement("link").relList;if(c&&c.supports&&c.supports("modulepreload"))return;for(const e of document.querySelectorAll('link[rel="modulepreload"]'))d(e);new MutationObserver(e=>{for(const r of e)if(r.type==="childList")for(const o of r.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&d(o)}).observe(document,{childList:!0,subtree:!0});function l(e){const r={};return e.integrity&&(r.integrity=e.integrity),e.referrerPolicy&&(r.referrerPolicy=e.referrerPolicy),e.crossOrigin==="use-credentials"?r.credentials="include":e.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function d(e){if(e.ep)return;e.ep=!0;const r=l(e);fetch(e.href,r)}})();const b="modulepreload",x=function(i,c){return new URL(i,c).href},h={},v=function(c,l,d){let e=Promise.resolve();if(l&&l.length>0){let y=function(t){return Promise.all(t.map(a=>Promise.resolve(a).then(p=>({status:"fulfilled",value:p}),p=>({status:"rejected",reason:p}))))};const o=document.getElementsByTagName("link"),n=document.querySelector("meta[property=csp-nonce]"),m=n?.nonce||n?.getAttribute("nonce");e=y(l.map(t=>{if(t=x(t,d),t in h)return;h[t]=!0;const a=t.endsWith(".css"),p=a?'[rel="stylesheet"]':"";if(d)for(let u=o.length-1;u>=0;u--){const f=o[u];if(f.href===t&&(!a||f.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${t}"]${p}`))return;const s=document.createElement("link");if(s.rel=a?"stylesheet":b,a||(s.as="script"),s.crossOrigin="",s.href=t,m&&s.setAttribute("nonce",m),document.head.appendChild(s),a)return new Promise((u,f)=>{s.addEventListener("load",u),s.addEventListener("error",()=>f(new Error(`Unable to preload CSS for ${t}`)))})}))}function r(o){const n=new Event("vite:preloadError",{cancelable:!0});if(n.payload=o,window.dispatchEvent(n),!n.defaultPrevented)throw o}return e.then(o=>{for(const n of o||[])n.status==="rejected"&&r(n.reason);return c().catch(r)})},g=document.getElementById("root");function E(){if(!g)return;const i=document.createElement("style");i.textContent=`
    :root {
      color-scheme: light;
      font-family: "Avenir Next", "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(237, 180, 88, 0.32), transparent 38%),
        linear-gradient(180deg, #f7efe0 0%, #efe4d0 100%);
      color: #1f2a30;
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
      background: rgba(255, 251, 245, 0.9);
      border: 1px solid rgba(109, 81, 38, 0.12);
      border-radius: 18px;
      padding: 16px;
      box-shadow: 0 20px 40px rgba(92, 69, 34, 0.08);
    }

    .popup-load-error-card h1 {
      margin: 0 0 10px;
      font-size: 22px;
      line-height: 1.1;
    }

    .popup-load-error-card p {
      margin: 0;
      color: #5d4e40;
      font-size: 14px;
      line-height: 1.5;
    }

    .popup-load-error-card p + p {
      margin-top: 10px;
    }

    .popup-load-error-card code {
      font-family: "SFMono-Regular", "SFMono-Regular", Consolas, monospace;
      font-size: 13px;
    }
  `,document.head.appendChild(i),g.innerHTML=`
    <main class="popup-load-error">
      <section class="popup-load-error-card">
        <h1>Ghostscript needs the built extension bundle</h1>
        <p>Run <code>corepack pnpm --filter @ghostscript/extension build</code> or <code>corepack pnpm --filter @ghostscript/extension dev</code>.</p>
        <p>Then reload the unpacked extension from <code>apps/extension/dist</code> instead of <code>apps/extension</code>.</p>
      </section>
    </main>
  `}async function L(){try{await v(()=>import("./main-CK1udz9O.js"),__vite__mapDeps([0,1,2]),import.meta.url)}catch(i){console.error("Ghostscript popup failed to load.",i),E()}}L();
