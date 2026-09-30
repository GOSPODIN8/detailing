(function () {
  var TG = window.Telegram && window.Telegram.WebApp;
  var initData = TG ? TG.initData : "";
  var STATUSES = [["new", "Новая"], ["called", "Перезвонили"], ["booked", "Записан"], ["done", "Выполнено"], ["rejected", "Отказ"]];
  var filter = "active";
  var all = [];

  var stateEl = document.getElementById("state");
  var board = document.getElementById("board");
  var list = document.getElementById("leads");

  if (TG) {
    TG.ready();
    TG.expand();
    try { TG.setHeaderColor("#0a0a0b"); TG.setBackgroundColor("#0a0a0b"); } catch (e) {}
  }

  function setState(text) { stateEl.textContent = text; stateEl.hidden = !text; }

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: { "content-type": "application/json", "x-telegram-init-data": initData },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || "error"); e.data = j; throw e; } return j; });
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function visible() {
    return all.filter(function (l) {
      if (filter === "all") return true;
      if (filter === "done") return l.status === "done" || l.status === "rejected";
      return l.status !== "done" && l.status !== "rejected";
    });
  }

  function render() {
    var leads = visible();
    list.innerHTML = "";
    document.getElementById("count").textContent = "Показано: " + leads.length + " из " + all.length;
    if (!leads.length) { list.appendChild(el("p", "mute", "Здесь пока пусто.")); return; }
    leads.forEach(function (l) {
      var card = el("article", "lead");
      var top = el("div", "lead-top");
      top.appendChild(el("span", "lead-num", "№" + l.id));
      top.appendChild(el("span", "mute small", new Date(l.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })));
      card.appendChild(top);
      card.appendChild(el("h3", "lead-name", l.name));
      card.appendChild(el("p", "lead-service", l.service_label + (l.car ? " · " + l.car : "")));
      if (l.preferred_date) card.appendChild(el("p", "mute small", "Удобная дата: " + l.preferred_date));
      if (l.comment) card.appendChild(el("p", "lead-comment", l.comment));

      var actions = el("div", "lead-actions");
      var call = el("a", "lead-call", l.phone);
      call.href = "tel:" + String(l.phone).replace(/[^+\d]/g, "");
      actions.appendChild(call);
      if (l.tg_username) {
        var tgLink = el("a", "lead-tg", "@" + l.tg_username);
        tgLink.href = "https://t.me/" + l.tg_username;
        tgLink.addEventListener("click", function (e) {
          if (TG) { e.preventDefault(); TG.openTelegramLink(tgLink.href); }
        });
        actions.appendChild(tgLink);
      }
      card.appendChild(actions);

      var statuses = el("div", "chips lead-status");
      STATUSES.forEach(function (s) {
        var b = el("button", "chip", s[1]);
        b.type = "button";
        b.setAttribute("aria-pressed", l.status === s[0] ? "true" : "false");
        b.addEventListener("click", function () {
          if (l.status === s[0]) return;
          var prev = l.status;
          l.status = s[0];
          render();
          if (TG && TG.HapticFeedback) TG.HapticFeedback.selectionChanged();
          api("PATCH", "/api/leads/" + l.id, { status: s[0] }).catch(function () {
            l.status = prev; render();
            if (TG) TG.showAlert("Не удалось сохранить статус"); else alert("Не удалось сохранить статус");
          });
        });
        statuses.appendChild(b);
      });
      card.appendChild(statuses);
      list.appendChild(card);
    });
  }

  function load() {
    if (!initData) { setState("Откройте эту страницу через Telegram-бота: кнопка «Заявки» или команда /admin."); return; }
    api("GET", "/api/leads").then(function (j) {
      all = j.leads;
      setState(j.warning === "NO_DATABASE" ? "База не подключена: заявки не сохраняются. Добавьте PostgreSQL в Railway." : "");
      board.hidden = false;
      render();
    }).catch(function (e) {
      if (e.message === "NOT_ADMIN") setState("У вас нет доступа. Ваш ID: " + e.data.userId + ". Добавьте его в ADMIN_IDS на Railway.");
      else if (e.message === "NOT_TELEGRAM") setState("Сессия устарела. Закройте и откройте панель заново через бота.");
      else setState("Не удалось загрузить заявки.");
    });
  }

  document.querySelectorAll("#filters .chip").forEach(function (b) {
    b.addEventListener("click", function () {
      filter = b.dataset.f;
      document.querySelectorAll("#filters .chip").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      render();
    });
  });

  load();
  document.addEventListener("visibilitychange", function () { if (!document.hidden && initData) load(); });
})();
