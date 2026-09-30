(function () {
  var KEY = "hy-admin-pass";
  var STATUSES = [["new","Новая"],["called","Перезвонили"],["booked","Записан"],["done","Выполнено"],["rejected","Отказ"]];
  var pass = "";
  try { pass = sessionStorage.getItem(KEY) || ""; } catch (e) {}

  var login = document.getElementById("login");
  var board = document.getElementById("board");
  var rows = document.getElementById("rows");

  function msg(err) {
    if (err === "NO_PASSWORD_SET") return "Пароль не задан. Добавьте переменную ADMIN_PASSWORD в Railway.";
    if (err === "BAD_PASSWORD") return "Неверный пароль.";
    return "Не удалось загрузить заявки.";
  }
  function setErr(id, text) { var el = document.getElementById(id); el.textContent = text; el.hidden = !text; }
  function td(text, cls) { var c = document.createElement("td"); c.textContent = text || ""; if (cls) c.className = cls; return c; }
  function api(method, url, body) {
    return fetch(url, { method: method, headers: { "content-type": "application/json", "x-admin-password": pass }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "error"); return j; }); });
  }

  function render(leads) {
    rows.innerHTML = "";
    document.getElementById("count").textContent = "Всего: " + leads.length;
    if (!leads.length) { var tr = document.createElement("tr"); var c = td("Заявок пока нет.", "mute"); c.colSpan = 8; tr.appendChild(c); rows.appendChild(tr); return; }
    leads.forEach(function (l) {
      var tr = document.createElement("tr");
      tr.appendChild(td(new Date(l.created_at).toLocaleString("ru-RU"), "nowrap"));
      tr.appendChild(td(l.name));
      var ph = document.createElement("td"); ph.className = "nowrap";
      var a = document.createElement("a"); a.href = "tel:" + String(l.phone).replace(/[^+\d]/g, ""); a.className = "cta-phone"; a.textContent = l.phone; ph.appendChild(a); tr.appendChild(ph);
      tr.appendChild(td(l.service_label));
      tr.appendChild(td(l.car));
      tr.appendChild(td(l.preferred_date, "nowrap"));
      tr.appendChild(td(l.comment));
      var st = document.createElement("td"); var sel = document.createElement("select");
      STATUSES.forEach(function (s) { var o = document.createElement("option"); o.value = s[0]; o.textContent = s[1]; if (s[0] === l.status) o.selected = true; sel.appendChild(o); });
      sel.addEventListener("change", function () { api("PATCH", "/api/leads/" + l.id, { status: sel.value }).catch(function (e) { setErr("board-error", msg(e.message)); }); });
      st.appendChild(sel); tr.appendChild(st);
      rows.appendChild(tr);
    });
  }

  function load() {
    return api("GET", "/api/leads").then(function (j) {
      try { sessionStorage.setItem(KEY, pass); } catch (e) {}
      login.hidden = true; board.hidden = false; setErr("board-error", "");
      if (j.warning === "NO_DATABASE") setErr("board-error", "База не подключена: заявки не сохраняются. Добавьте PostgreSQL в Railway.");
      render(j.leads);
    }).catch(function (e) {
      board.hidden = true; login.hidden = false; setErr("login-error", msg(e.message));
    });
  }

  login.addEventListener("submit", function (e) { e.preventDefault(); pass = document.getElementById("pass").value; if (pass) load(); });
  document.getElementById("refresh").addEventListener("click", load);
  document.getElementById("logout").addEventListener("click", function () { try { sessionStorage.removeItem(KEY); } catch (e) {} pass = ""; board.hidden = true; login.hidden = false; });
  if (pass) load();
})();
