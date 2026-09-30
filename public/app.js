(function () {
  var nav = document.getElementById("nav");
  function onScroll() { nav.classList.toggle("solid", window.scrollY > 40); }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  document.getElementById("year").textContent = String(new Date().getFullYear());

  var service = "tint";
  var chips = Array.prototype.slice.call(document.querySelectorAll("#chips .chip"));
  function pick(value) {
    service = value;
    chips.forEach(function (c) { c.setAttribute("aria-pressed", c.dataset.value === value ? "true" : "false"); });
  }
  chips.forEach(function (c) { c.addEventListener("click", function () { pick(c.dataset.value); }); });
  document.querySelectorAll("[data-service]").forEach(function (a) {
    a.addEventListener("click", function () { pick(a.dataset.service); });
  });

  var form = document.getElementById("lead-form");
  var done = document.getElementById("form-done");
  var errorEl = document.getElementById("form-error");
  var btn = document.getElementById("submit-btn");

  function showError(msg) { errorEl.textContent = msg; errorEl.hidden = !msg; }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var fd = new FormData(form);
    var data = {
      name: String(fd.get("name") || "").trim(),
      phone: String(fd.get("phone") || "").trim(),
      car: String(fd.get("car") || ""),
      preferredDate: String(fd.get("preferredDate") || ""),
      comment: String(fd.get("comment") || ""),
      website: String(fd.get("website") || ""),
      service: service
    };
    if (data.name.length < 2) return showError("Как к вам обращаться?");
    if (!/^[+\d\s()-]{7,24}$/.test(data.phone)) return showError("Проверьте номер телефона");
    showError("");
    btn.disabled = true;
    btn.firstElementChild.textContent = "Отправляем...";
    fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.body && res.body.error ? res.body.error : "error");
        form.reset(); pick("tint");
        form.hidden = true; done.hidden = false;
      })
      .catch(function (err) {
        showError(err && err.message && err.message !== "error" ? err.message : "Не получилось отправить. Позвоните нам или попробуйте ещё раз.");
      })
      .finally(function () { btn.disabled = false; btn.firstElementChild.textContent = "Отправить заявку"; });
  });

  document.getElementById("again").addEventListener("click", function () { done.hidden = true; form.hidden = false; });
})();
