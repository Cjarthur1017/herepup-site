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
      var out = new FormData(), sf = form.getAttribute("data-subject-field");
      out.append("access_key", KEY);
      out.append("subject", (form.getAttribute("data-subject") || "HerePup message") + (sf && fields[sf] ? ": " + fields[sf] : ""));
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
          var ev2 = form.getAttribute("data-count");
          if (ev2 && typeof window.plausible === "function") { try { window.plausible(ev2); } catch (e) { /* never block */ } }
          form.dispatchEvent(new CustomEvent("herepup:sent", { bubbles: true }));
        })
        .catch(function () { send.disabled = false; fallback(status); });
    });
  }
  window.HerePupContact = { wire: wire, reset: function (form) {
    form.hidden = false; var s = form.parentNode.querySelector("[data-sent]"); if (s) s.hidden = true;
    var st = form.querySelector("[data-status]"); if (st) st.textContent = "";
  } };
  // "Request this insurer": one small dialog, built on first use, shared by the app and the insurer page.
  function requestInsurer(name, from) {
    var d = document.getElementById("ins-req");
    if (!d) {
      d = document.createElement("dialog"); d.id = "ins-req"; d.className = "hp-dialog"; d.setAttribute("aria-labelledby", "ins-req-h");
      d.innerHTML = '<form data-contact-form data-subject="Insurer request" data-subject-field="insurer" data-count="Insurer requested">' +
        '<div class="hp-dialog-head"><h2 id="ins-req-h">Request a direct connection</h2><button type="button" class="hp-close" data-close-dialog>Close</button></div>' +
        '<p>Tell us which insurer you have. Requests show us which insurers to connect first.</p>' +
        '<label>Insurer<input name="insurer" required maxlength="120" autocomplete="off"></label>' +
        '<label>Your email <span class="hp-opt">(optional)</span><input type="email" name="email" autocomplete="email"></label>' +
        '<p class="hp-small">Add your email and we\'ll write to you once, when this insurer is connected. We won\'t use it for anything else.</p>' +
        '<input type="checkbox" name="botcheck" style="display:none" tabindex="-1" autocomplete="off"><input type="hidden" name="sent_from" value="">' +
        '<p class="hp-send"><button type="submit" class="hp-primary">Send request</button> <span data-status role="status"></span></p></form>' +
        '<div data-sent hidden><h2>Thanks, your request is in.</h2><p>We count every request when deciding which insurers to connect next.</p><button type="button" class="hp-primary" data-close-dialog>Close</button></div>';
      document.body.appendChild(d); wire(d.querySelector("form"));
    }
    var f = d.querySelector("form");
    window.HerePupContact.reset(f); f.reset();
    f.querySelector("[name=insurer]").value = name || "";
    f.querySelector("[name=sent_from]").value = from || location.pathname;
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
    f.querySelector(name ? "[name=email]" : "[name=insurer]").focus();
  }
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-request-insurer]");
    if (b) { ev.preventDefault(); requestInsurer(b.getAttribute("data-request-insurer"), b.getAttribute("data-from")); return; }
    var c = ev.target.closest && ev.target.closest("#ins-req [data-close-dialog]");
    if (c) { var d = document.getElementById("ins-req"); if (d.close) d.close(); else d.removeAttribute("open"); }
  });
  window.HerePupContact.requestInsurer = requestInsurer;

  function all() { Array.prototype.forEach.call(document.querySelectorAll("form[data-contact-form]"), wire); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", all); else all();
})();
