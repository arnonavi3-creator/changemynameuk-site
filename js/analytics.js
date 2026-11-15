// Cookie-free visitor counts with Cloudflare Web Analytics.
// It sets no cookies and stores nothing on the visitor's device, so no cookie banner is needed.
// To turn it on, paste the site token from Cloudflare (Analytics & Logs > Web Analytics) below.
(function () {
  var TOKEN = "";
  if (!TOKEN) return;
  var s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", JSON.stringify({ token: TOKEN }));
  document.head.appendChild(s);
})();
