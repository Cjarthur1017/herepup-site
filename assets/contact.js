/* HerePup feedback and contact forms. What a person types is sent through Web3Forms to chris@herepup.health.
   Nothing from the app (documents, plans, claims, amounts) is ever added to a message. */
(function () {
  "use strict";
  var KEY = "72457766-2197-4758-9862-11941a59e07c", ADDRESS = "chris@herepup.health";

  function fallback(status) {
    status.textContent = "";
    var p = document.createElement("span");
    p.textContent = "We couldn't send that just now. You can email " + ADDRESS + " instead. ";
    var b = document.createElement("button");
    b.type = "button"; b.className = "copy-email"; b.textContent = "Copy email address";
    b.addEventListener("click", function () {
      var done = function () { b.textContent = "Copied"; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ADDRESS).then(done, function () { b.textContent = ADDRESS; });
      else b.textContent = ADDRESS;
    });
    status.appendChild(p); status.appendChild(b);
  }

  function wire(form) {
    if (!form || form.getAttribute("data-wired")) return;
    form.setAttribute("data-wired", "1");
    var status = form.querySelector("[data-status]"), send = form.querySelector("[type=submit]");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (form.reportValidity && !form.reportValidity()) return;
      var trap = form.querySelector("[name=botcheck]");
      if (trap && trap.checked) return;
      var need = form.getAttribute("data-need-one");
      if (need) {
        var any = need.split(",").some(function (n) {
          var els = form.querySelectorAll("[name='" + n + "']");
          return Array.prototype.some.call(els, function (el) { return (el.type === "radio" || el.type === "checkbox") ? el.checked : el.value.trim(); });
        });
        if (!any) { status.textContent = form.getAttribute("data-need-msg") || "Please answer at least one question."; return; }
      }
      var fields = {}, order = [];
      new FormData(form).forEach(function (v, k) {
        if (k === "botcheck" || String(v).trim() === "") return;
        if (!(k in fields)) { fields[k] = String(v); order.push(k); } else fields[k] += ", " + v;
      });
      var out = new FormData();
      out.append("access_key", KEY);
      out.append("subject", form.getAttribute("data-subject") || "HerePup message");
      out.append("from_name", "HerePup website");
      order.forEach(function (k) { out.append(k, fields[k]); });
      send.disabled = true; status.textContent = "Sending...";
      fetch("https://api.web3forms.com/submit", { method: "POST", body: out, headers: { Accept: "application/json" } })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return r.ok && j.success; }); })
        .then(function (ok) {
          send.disabled = false;
          if (!ok) return fallback(status);
          form.reset(); status.textContent = "";
          var sent = form.parentNode.querySelector("[data-sent]");
          if (sent) { form.hidden = true; sent.hidden = false; var f = sent.querySelector("button,a"); if (f) f.focus(); }
          else status.textContent = "Thanks, your message was sent.";
          form.dispatchEvent(new CustomEvent("herepup:sent", { bubbles: true }));
        })
        .catch(function () { send.disabled = false; fallback(status); });
    });
  }
  window.HerePupContact = { wire: wire, reset: function (form) {
    form.hidden = false; var s = form.parentNode.querySelector("[data-sent]"); if (s) s.hidden = true;
    var st = form.querySelector("[data-status]"); if (st) st.textContent = "";
  } };
  function all() { Array.prototype.forEach.call(document.querySelectorAll("form[data-contact-form]"), wire); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", all); else all();
})();
