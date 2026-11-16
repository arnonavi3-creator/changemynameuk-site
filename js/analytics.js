// Cookie-free visitor counts with Cloudflare Web Analytics.
// It sets no cookies and stores nothing on the visitor's device, so no cookie banner is needed.
// Site token from Cloudflare (Analytics > Web analytics). Set TOKEN to "" to switch it off.
(function () {
  var TOKEN = "a723f5fe2567446d9a403ae702107f5f";
  if (!TOKEN) return;
  var s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", JSON.stringify({ token: TOKEN }));
  document.head.appendChild(s);
})();
