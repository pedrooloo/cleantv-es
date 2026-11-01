(function () {
  "use strict";

  /* ------------------------------------------------------------------
     Ajustes. Cambia solo esto para personalizar el launcher.
     ------------------------------------------------------------------ */

  var CONFIG = {
    columns: 4,            // columnas de la cuadrícula (3 a 7)
    rows: 3,               // filas de la cuadrícula
    maxFavorites: 4,       // favoritos en el dock
    tile: 261,             // ancho de cada ficha en px. Menos columnas y la zona
                           // de apps se estrecha, dejando ver más fondo a la derecha
    hideHintsAfter: 9000,  // ms hasta que se oculta la ayuda de abajo (0 = siempre visible)
    greetName: "",         // nombre en el saludo, p.ej. "Miguel". Vacío = solo "Buenas tardes"
    scenes: true,          // false deja un fondo fijo, sin cambiar con la hora
    wallpaper: "fondo.jpg",// foto propia, p.ej. "fondo.jpg" junto a index.html.
                           // Con valor sustituye al paisaje dibujado
    preferred: [           // se fijan solos la primera vez, en este orden
      "youtube", "samsung tv plus", "netflix", "prime video", "disney", "movistar",
      "max", "rtve", "atresplayer", "mitele", "filmin",
      "spotify", "apple tv", "plex", "jellyfin", "twitch"
    ]
  };

  var COLS = CONFIG.columns;
  var ROWS = CONFIG.rows;
  var PAGE_SIZE = COLS * ROWS;
  var MAX_FAVORITES = CONFIG.maxFavorites;
  var TILE = CONFIG.tile;

  var FAVORITES_KEY = "cleantv.favorites.v4";
  var FIRST_RUN_KEY = "cleantv.favorites.initialized.v4";

  var DAYS = ["Domingo", "Lunes", "Martes", "Miércoles",
              "Jueves", "Viernes", "Sábado"];
  var MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                "julio", "agosto", "septiembre", "octubre",
                "noviembre", "diciembre"];

  /* ------------------------------------------------------------------
     Estado
     ------------------------------------------------------------------ */

  var favoritesEl = document.getElementById("favorites");
  var gridEl = document.getElementById("grid");
  var pillsEl = document.getElementById("pills");
  var focusedNameEl = document.getElementById("focusedName");
  var focusedMetaEl = document.getElementById("focusedMeta");
  var favoriteCountEl = document.getElementById("favoriteCount");
  var pageInfoEl = document.getElementById("pageInfo");
  var toastEl = document.getElementById("toast");
  var greetingEl = document.getElementById("greeting");
  var hintsEl = document.getElementById("hints");
  var panelEl = document.getElementById("panel");
  var panelTitleEl = document.getElementById("panelTitle");
  var panelBodyEl = document.getElementById("panelBody");

  var allApps = [];
  var favoriteIds = [];
  var favoriteApps = [];
  var pageApps = [];

  var section = "favorites";   // "top" | "favorites" | "grid"
  var focusIndex = 0;
  var page = 0;
  var lastFocused = null;

  var panelOpen = false;
  var panelRows = [];
  var panelIndex = 0;

  var toastTimer = null;
  var hintsTimer = null;
  var loading = false;
  var hasPhoto = false;

  /* ------------------------------------------------------------------
     Utilidades
     ------------------------------------------------------------------ */

  function safeText(v) { return v == null ? "" : String(v); }
  function lower(v) { return safeText(v).toLowerCase(); }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.className = "show";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.className = "";
    }, 2400);
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }

  function hasTizen(path) {
    try {
      if (!window.tizen) return false;
      if (path === "app") {
        return !!(tizen.application && tizen.application.getAppsInfo);
      }
      if (path === "sysinfo") {
        return !!(tizen.systeminfo && tizen.systeminfo.getPropertyValue);
      }
      if (path === "tvwindow") {
        return !!(tizen.tvwindow && tizen.tvwindow.setSource);
      }
    } catch (e) {}
    return false;
  }

  /* ------------------------------------------------------------------
     Puente con el servicio (service.js)

     TizenBrew sirve esta página desde http://127.0.0.1:8081 y ahí la tele
     no expone `tizen`. El servicio del módulo sí lo tiene, así que la
     página le pide las cosas por HTTP.
     ------------------------------------------------------------------ */

  var BRIDGE = "http://127.0.0.1:8092";
  var bridgeReady = false;

  function bridgeGet(path, timeout, ok, fail) {
    var xhr = new XMLHttpRequest();
    var done = false;

    function finish(fn, arg) {
      if (done) return;
      done = true;
      fn(arg);
    }

    try {
      xhr.open("GET", BRIDGE + path, true);
      xhr.timeout = timeout;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300 && data) finish(ok, data);
        else finish(fail, { status: xhr.status, data: data });
      };
      xhr.ontimeout = function () { finish(fail, { status: 0, data: null }); };
      xhr.onerror = function () { finish(fail, { status: 0, data: null }); };
      xhr.send();
    } catch (e) {
      finish(fail, { status: 0, data: null });
    }
  }

  /* El servicio arranca a la vez que la página, así que se reintenta
     unas cuantas veces antes de rendirse. */
  function waitForBridge(attempt, ok, fail) {
    bridgeGet("/ping", 1500, function () {
      bridgeReady = true;
      ok();
    }, function () {
      if (attempt >= 12) { fail(); return; }
      setTimeout(function () { waitForBridge(attempt + 1, ok, fail); }, 600);
    });
  }

  function sceneFor(hour) {
    if (hour >= 6 && hour < 9) return "amanecer";
    if (hour >= 9 && hour < 18) return "dia";
    if (hour >= 18 && hour < 22) return "tarde";
    return "noche";
  }

  function greetingFor(hour) {
    var hello;
    if (hour >= 6 && hour < 12) hello = "Buenos días";
    else if (hour >= 12 && hour < 20) hello = "Buenas tardes";
    else hello = "Buenas noches";

    return CONFIG.greetName
      ? hello + ", " + CONFIG.greetName
      : hello;
  }

  function applyScene(hour) {
    var next = CONFIG.scenes ? sceneFor(hour) : "tarde";
    if (hasPhoto) next += " conFoto";

    if (document.body.className !== next) {
      document.body.className = next;
    }
  }

  function applyWallpaper() {
    if (!CONFIG.wallpaper) return;

    var photo = document.getElementById("photo");
    if (!photo) return;

    photo.style.backgroundImage = 'url("' + CONFIG.wallpaper + '")';
    hasPhoto = true;
  }

  function updateClock() {
    var d = new Date();
    var hour = d.getHours();
    var hh = ("0" + hour).slice(-2);
    var mm = ("0" + d.getMinutes()).slice(-2);

    document.getElementById("clock").textContent = hh + ":" + mm;
    document.getElementById("date").textContent =
      DAYS[d.getDay()] + ", " + d.getDate() + " de " + MONTHS[d.getMonth()];

    greetingEl.textContent = greetingFor(hour);
    applyScene(hour);
  }

  function scheduleHints() {
    if (!CONFIG.hideHintsAfter) return;
    if (hintsTimer) clearTimeout(hintsTimer);
    hintsEl.className = "hints";
    hintsTimer = setTimeout(function () {
      hintsEl.className = "hints hidden";
    }, CONFIG.hideHintsAfter);
  }

  function initials(name) {
    var clean = safeText(name).replace(/[^a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ+ ]/g, " ");
    var parts = clean.split(/\s+/);
    var result = "";
    var i;
    for (i = 0; i < parts.length && result.length < 3; i++) {
      if (parts[i]) result += parts[i].charAt(0).toUpperCase();
    }
    return result || "APP";
  }

  /* ------------------------------------------------------------------
     Tiles
     ------------------------------------------------------------------ */

  function hasFavorite(id) {
    var i;
    for (i = 0; i < favoriteIds.length; i++) {
      if (favoriteIds[i] === id) return true;
    }
    return false;
  }

  function appendInitials(parent, name) {
    var fallback = document.createElement("div");
    fallback.className = "initials";
    fallback.textContent = initials(name);
    parent.appendChild(fallback);
  }

  function makeTile(info) {
    var tile = document.createElement("div");
    tile.className = "tile" + (hasFavorite(info.id) ? " favoriteMark" : "");
    tile.setAttribute("data-app-id", info.id);

    var iconWrap = document.createElement("div");
    iconWrap.className = "iconWrap";

    if (info.iconPath) {
      var img = document.createElement("img");
      img.alt = "";
      img.src = info.iconPath;
      img.onerror = function () {
        if (!img.parentNode) return;
        img.parentNode.removeChild(img);
        appendInitials(iconWrap, info.name);
      };
      iconWrap.appendChild(img);
    } else {
      appendInitials(iconWrap, info.name);
    }

    var label = document.createElement("div");
    label.className = "label";
    label.textContent = info.name;

    tile.appendChild(iconWrap);
    tile.appendChild(label);
    return tile;
  }

  /* ------------------------------------------------------------------
     Foco
     ------------------------------------------------------------------ */

  function currentApp() {
    if (section === "favorites") return favoriteApps[focusIndex] || null;
    if (section === "grid") return pageApps[focusIndex] || null;
    return null;
  }

  function currentTiles() {
    if (section === "favorites") return favoritesEl.children;
    if (section === "grid") return gridEl.children;
    return pillsEl.children;
  }

  function clearFocus() {
    if (lastFocused && lastFocused.classList) {
      lastFocused.classList.remove("focused");
    }
    lastFocused = null;
  }

  function applyFocus() {
    clearFocus();
    scheduleHints();

    var tiles = currentTiles();
    var el = tiles[focusIndex];

    if (el && el.classList) {
      lastFocused = el;
      el.classList.add("focused");
    }

    if (section === "top") {
      var labels = ["Fuentes HDMI y TV", "Conexión de red", "Sobre esta tele"];
      focusedNameEl.textContent =
        el ? el.querySelector(".pillText").textContent : "";
      focusedMetaEl.textContent = labels[focusIndex] || "";
      return;
    }

    var app = currentApp();

    if (!app) {
      focusedNameEl.textContent = allApps.length
        ? "Sin aplicaciones en esta sección"
        : "No se ha encontrado ninguna app";
      focusedMetaEl.textContent = "";
      return;
    }

    focusedNameEl.textContent = app.name;
    focusedMetaEl.textContent =
      hasFavorite(app.id) ? "En favoritos" : "Pulsa el botón verde para fijarla";
  }

  function normalizeFocus() {
    if (section === "top") {
      if (focusIndex < 0) focusIndex = 0;
      if (focusIndex > pillsEl.children.length - 1) {
        focusIndex = pillsEl.children.length - 1;
      }
      return;
    }

    var list = section === "favorites" ? favoriteApps : pageApps;

    if (section === "favorites" && !list.length) {
      section = "grid";
      list = pageApps;
      focusIndex = 0;
    }

    if (focusIndex < 0) focusIndex = 0;
    if (focusIndex > list.length - 1) focusIndex = list.length - 1;
    if (focusIndex < 0) focusIndex = 0;
  }

  /* ------------------------------------------------------------------
     Render
     ------------------------------------------------------------------ */

  function renderFavorites() {
    favoritesEl.innerHTML = "";
    favoriteApps = [];

    var i, j;
    for (i = 0; i < favoriteIds.length; i++) {
      for (j = 0; j < allApps.length; j++) {
        if (allApps[j].id === favoriteIds[i]) {
          favoriteApps.push(allApps[j]);
          break;
        }
      }
    }

    if (favoriteApps.length !== favoriteIds.length) {
      favoriteIds = [];
      for (i = 0; i < favoriteApps.length; i++) {
        favoriteIds.push(favoriteApps[i].id);
      }
      writeJson(FAVORITES_KEY, favoriteIds);
    }

    if (!favoriteApps.length) {
      var empty = document.createElement("div");
      empty.className = "emptyFavorites";
      empty.textContent =
        "Elige una app de abajo y pulsa el botón VERDE para fijarla aquí";
      favoritesEl.appendChild(empty);
    } else {
      for (i = 0; i < favoriteApps.length; i++) {
        favoritesEl.appendChild(makeTile(favoriteApps[i]));
      }
    }

    favoriteCountEl.textContent =
      favoriteApps.length + " de " + MAX_FAVORITES;
  }

  function pageCount() {
    return Math.max(1, Math.ceil(allApps.length / PAGE_SIZE));
  }

  function applyLayout() {
    gridEl.style.gridTemplateColumns = "repeat(" + COLS + ", " + TILE + "px)";
    gridEl.style.gridTemplateRows = "repeat(" + ROWS + ", 138px)";

    var i;
    var tiles = favoritesEl.getElementsByClassName("tile");
    for (i = 0; i < tiles.length; i++) {
      tiles[i].style.width = TILE + "px";
      tiles[i].style.flex = "0 0 " + TILE + "px";
    }
  }

  function renderGrid() {
    gridEl.innerHTML = "";

    var count = pageCount();
    if (page >= count) page = count - 1;
    if (page < 0) page = 0;

    var start = page * PAGE_SIZE;
    var end = Math.min(start + PAGE_SIZE, allApps.length);
    pageApps = allApps.slice(start, end);

    var i;
    for (i = 0; i < pageApps.length; i++) {
      gridEl.appendChild(makeTile(pageApps[i]));
    }

    pageInfoEl.textContent = allApps.length
      ? allApps.length + " apps · Página " + (page + 1) + " de " + count
      : "";
  }

  function renderAll(keepFocus) {
    var previousId = keepFocus && currentApp() ? currentApp().id : "";

    renderFavorites();
    renderGrid();
    applyLayout();

    if (previousId) {
      var list = section === "favorites" ? favoriteApps : pageApps;
      var i;
      for (i = 0; i < list.length; i++) {
        if (list[i].id === previousId) {
          focusIndex = i;
          break;
        }
      }
    }

    normalizeFocus();
    applyFocus();
  }

  /* ------------------------------------------------------------------
     Favoritos
     ------------------------------------------------------------------ */

  function defaultFavorites() {
    var chosen = [];
    var used = {};
    var i, j, name;

    for (i = 0; i < CONFIG.preferred.length && chosen.length < MAX_FAVORITES; i++) {
      for (j = 0; j < allApps.length; j++) {
        name = lower(allApps[j].name);
        if (!used[allApps[j].id] &&
            name.indexOf(CONFIG.preferred[i]) !== -1) {
          chosen.push(allApps[j].id);
          used[allApps[j].id] = true;
          break;
        }
      }
    }

    for (i = 0; i < allApps.length && chosen.length < MAX_FAVORITES; i++) {
      if (!used[allApps[i].id]) {
        chosen.push(allApps[i].id);
        used[allApps[i].id] = true;
      }
    }

    return chosen;
  }

  function ensureFavorites() {
    var initialized = false;

    try {
      initialized = localStorage.getItem(FIRST_RUN_KEY) === "1";
    } catch (e) {}

    if (!initialized) {
      favoriteIds = defaultFavorites();
      writeJson(FAVORITES_KEY, favoriteIds);
      try { localStorage.setItem(FIRST_RUN_KEY, "1"); } catch (e2) {}
      return;
    }

    favoriteIds = readJson(FAVORITES_KEY, []);
    if (!favoriteIds || typeof favoriteIds.length !== "number") {
      favoriteIds = [];
    }
    if (favoriteIds.length > MAX_FAVORITES) {
      favoriteIds = favoriteIds.slice(0, MAX_FAVORITES);
    }
  }

  function toggleFavorite() {
    var app = currentApp();
    if (!app) return;

    var i;
    var next = [];

    if (hasFavorite(app.id)) {
      for (i = 0; i < favoriteIds.length; i++) {
        if (favoriteIds[i] !== app.id) next.push(favoriteIds[i]);
      }

      favoriteIds = next;
      writeJson(FAVORITES_KEY, favoriteIds);
      toast(app.name + " ya no está en favoritos");

      if (section === "favorites") {
        renderFavorites();
        if (!favoriteApps.length) {
          section = "grid";
          focusIndex = 0;
        } else if (focusIndex >= favoriteApps.length) {
          focusIndex = favoriteApps.length - 1;
        }
        renderGrid();
        applyFocus();
      } else {
        renderAll(true);
      }

      return;
    }

    if (favoriteIds.length >= MAX_FAVORITES) {
      toast("Ya tienes " + MAX_FAVORITES + " favoritos, el máximo");
      return;
    }

    favoriteIds.push(app.id);
    writeJson(FAVORITES_KEY, favoriteIds);
    toast(app.name + " fijada en favoritos");
    renderAll(true);
  }

  /* ------------------------------------------------------------------
     Abrir apps
     ------------------------------------------------------------------ */

  function launchCurrent() {
    var app = currentApp();
    if (!app) return;

    if (bridgeReady) {
      bridgeGet("/launch?id=" + encodeURIComponent(app.id), 8000, function () {}, function (err) {
        var msg = err && err.data && err.data.error;
        toast("No se ha podido abrir " + app.name + (msg ? ": " + msg : ""));
      });
      return;
    }

    if (!(window.tizen && tizen.application && tizen.application.launch)) {
      toast("La API de aplicaciones de Tizen no está disponible");
      return;
    }

    try {
      tizen.application.launch(
        app.id,
        function () {},
        function (err) {
          toast("No se ha podido abrir " + app.name +
                (err && err.message ? ": " + err.message : ""));
        }
      );
    } catch (e) {
      toast("No se ha podido abrir " + app.name);
    }
  }

  /* ------------------------------------------------------------------
     Panel: entradas, red, info
     ------------------------------------------------------------------ */

  function closePanel() {
    panelOpen = false;
    panelRows = [];
    panelIndex = 0;
    panelEl.className = "panel";
    panelBodyEl.innerHTML = "";
    applyFocus();
  }

  function openPanel(title) {
    panelOpen = true;
    panelRows = [];
    panelIndex = 0;
    panelTitleEl.textContent = title;
    panelBodyEl.innerHTML = "";
    panelEl.className = "panel open";
  }

  function panelFocus() {
    var i;
    for (i = 0; i < panelRows.length; i++) {
      panelRows[i].el.className =
        "panelRow" + (i === panelIndex ? " focused" : "");
    }
  }

  function addPanelRow(label, meta, action) {
    var row = document.createElement("div");
    row.className = "panelRow";

    var name = document.createElement("div");
    name.textContent = label;

    var info = document.createElement("div");
    info.className = "rowMeta";
    info.textContent = meta || "";

    row.appendChild(name);
    row.appendChild(info);
    panelBodyEl.appendChild(row);

    panelRows.push({ el: row, action: action });
  }

  function addPanelNote(text) {
    var note = document.createElement("div");
    note.className = "panelNote";
    note.textContent = text;
    panelBodyEl.appendChild(note);
  }

  function sourceLabel(src) {
    var type = safeText(src.type);
    var num = src.number ? " " + src.number : "";
    if (type === "HDMI") return "HDMI" + num;
    if (type === "TV") return "TV / Antena";
    if (type === "AV") return "AV" + num;
    if (type === "COMPONENT") return "Componentes" + num;
    if (type === "PC") return "PC" + num;
    return type + num;
  }

  function selectSource(src) {
    if (!hasTizen("tvwindow")) {
      toast("Esta tele no permite cambiar de entrada desde una app web");
      return;
    }

    try {
      tizen.tvwindow.setSource(
        src,
        function () {
          closePanel();
          toast("Cambiado a " + sourceLabel(src));
        },
        function (err) {
          toast("No se ha podido cambiar de entrada" +
                (err && err.message ? ": " + err.message : ""));
        }
      );
    } catch (e) {
      toast("No se ha podido cambiar de entrada");
    }
  }

  function openInputs() {
    openPanel("Entradas");

    if (bridgeReady && !hasTizen("sysinfo")) {
      bridgeGet("/sources", 4000, function (info) {
        if (!panelOpen) return;
        var list = info.connected || [];
        var i;
        for (i = 0; i < list.length; i++) {
          addPanelRow(sourceLabel(list[i]), safeText(list[i].name) || "Conectado", null);
        }
        if (!list.length) addPanelNote("No hay ninguna fuente conectada ahora mismo.");
        addPanelNote("Para cambiar de entrada usa el botón Fuente del mando: desde TizenBrew no se puede.");
        panelFocus();
      }, function () {
        if (!panelOpen) return;
        addPanelNote("No se ha podido leer la lista de entradas.");
      });
      return;
    }

    if (!hasTizen("sysinfo")) {
      addPanelNote("No se puede leer la lista de entradas: la API de Tizen no está disponible.");
      return;
    }

    try {
      tizen.systeminfo.getPropertyValue(
        "VIDEOSOURCE",
        function (info) {
          if (!panelOpen) return;

          var connected = (info && info.connected) || [];
          var i, src;

          for (i = 0; i < connected.length; i++) {
            src = connected[i];
            (function (s) {
              addPanelRow(
                sourceLabel(s),
                safeText(s.name) || "Conectado",
                function () { selectSource(s); }
              );
            })(src);
          }

          if (!connected.length) {
            addPanelNote("No hay ninguna fuente conectada ahora mismo.");
          } else if (!hasTizen("tvwindow")) {
            addPanelNote("Solo lectura: esta tele no deja cambiar de entrada desde una app web. Usa el botón Fuente del mando.");
          }

          panelFocus();
        },
        function () {
          if (!panelOpen) return;
          addPanelNote("No se ha podido leer la lista de entradas.");
        }
      );
    } catch (e) {
      addPanelNote("No se ha podido leer la lista de entradas.");
    }
  }

  function openNetwork() {
    openPanel("Red");

    if (bridgeReady && !hasTizen("sysinfo")) {
      bridgeGet("/network", 4000, function (info) {
        if (!panelOpen) return;
        var wifi = info.wifi;
        var eth = info.ethernet;

        if (wifi && wifi.status === "ON") {
          addPanelRow("Conexión", "Wi-Fi", null);
          addPanelRow("Red", safeText(wifi.ssid) || "—", null);
          addPanelRow("Señal", wifi.signalStrength
            ? Math.round(Number(wifi.signalStrength) * 100) + "%" : "—", null);
          addPanelRow("Dirección IP", safeText(wifi.ipAddress) || "—", null);
        } else if (eth && eth.ipAddress) {
          addPanelRow("Conexión", "Cable", null);
          addPanelRow("Dirección IP", safeText(eth.ipAddress), null);
        } else {
          addPanelNote("No se ha podido leer la conexión.");
        }
        addPanelNote("Para cambiar de red, usa los ajustes de la tele.");
        panelFocus();
      }, function () {
        if (!panelOpen) return;
        addPanelNote("No se ha podido leer la red.");
      });
      return;
    }

    if (!hasTizen("sysinfo")) {
      addPanelNote("No se puede leer la red: la API de Tizen no está disponible.");
      return;
    }

    try {
      tizen.systeminfo.getPropertyValue(
        "WIFI_NETWORK",
        function (net) {
          if (!panelOpen) return;

          if (!net || net.status !== "ON") {
            addPanelNote("Wi-Fi desconectado. Puede que la tele esté por cable.");
            return;
          }

          var signal = net.signalStrength
            ? Math.round(Number(net.signalStrength) * 100) + "%"
            : "—";

          addPanelRow("Red", safeText(net.ssid) || "—", null);
          addPanelRow("Señal", signal, null);
          addPanelRow("Dirección IP", safeText(net.ipAddress) || "—", null);
          addPanelNote("Para cambiar de red, usa los ajustes de la tele.");
          panelFocus();
        },
        function () {
          if (!panelOpen) return;
          addPanelNote("No se ha podido leer el estado del Wi-Fi.");
        }
      );
    } catch (e) {
      addPanelNote("No se ha podido leer el estado del Wi-Fi.");
    }
  }

  function openInfo() {
    openPanel("Info");

    addPanelRow("Aplicaciones visibles", String(allApps.length), null);
    addPanelRow("Favoritos", favoriteApps.length + " de " + MAX_FAVORITES, null);
    addPanelRow("Cuadrícula", COLS + " x " + ROWS + " por página", null);

    var model = "—";
    try {
      if (window.webapis && webapis.productinfo &&
          webapis.productinfo.getRealModel) {
        model = webapis.productinfo.getRealModel();
      }
    } catch (e) {}

    if (model === "—" && bridgeReady) {
      bridgeGet("/info", 3000, function (info) {
        if (!panelOpen || !info.model) return;
        var rows = panelBodyEl.querySelectorAll(".panelRow");
        var i;
        for (i = 0; i < rows.length; i++) {
          if (rows[i].textContent.indexOf("Modelo") === 0) {
            var val = rows[i].lastChild;
            if (val) val.textContent = info.model;
          }
        }
      }, function () {});
    }

    addPanelRow("Modelo", model, null);
    addPanelNote("Los ajustes de la tele se abren con el botón del mando: Tizen no deja abrirlos desde una app web.");
    panelFocus();
  }

  function activatePill() {
    var which = pillsEl.children[focusIndex];
    if (!which) return;

    var kind = which.getAttribute("data-pill");
    if (kind === "inputs") openInputs();
    else if (kind === "network") openNetwork();
    else if (kind === "info") openInfo();
  }

  /* ------------------------------------------------------------------
     Navegación
     ------------------------------------------------------------------ */

  function changePage(delta) {
    if (section === "top") return;

    var next = page + delta;
    var count = pageCount();

    if (next < 0 || next >= count) return;

    page = next;
    section = "grid";
    focusIndex = 0;
    renderGrid();
    applyFocus();
  }

  function moveLeft() {
    if (section === "top" || section === "favorites") {
      if (focusIndex > 0) focusIndex--;
    } else {
      if (focusIndex % COLS > 0) focusIndex--;
    }
    applyFocus();
  }

  function moveRight() {
    if (section === "top") {
      if (focusIndex + 1 < pillsEl.children.length) focusIndex++;
    } else if (section === "favorites") {
      if (focusIndex + 1 < favoriteApps.length) focusIndex++;
    } else {
      if (focusIndex % COLS < COLS - 1 && focusIndex + 1 < pageApps.length) {
        focusIndex++;
      }
    }
    applyFocus();
  }

  function moveDown() {
    if (section === "top") {
      if (favoriteApps.length) {
        section = "favorites";
        focusIndex = 0;
      } else {
        section = "grid";
        focusIndex = 0;
      }
    } else if (section === "favorites") {
      section = "grid";
      focusIndex = Math.min(focusIndex, Math.max(0, pageApps.length - 1));
    } else {
      var target = focusIndex + COLS;
      if (target < pageApps.length) focusIndex = target;
    }
    applyFocus();
  }

  function moveUp() {
    if (section === "grid") {
      var target = focusIndex - COLS;

      if (target >= 0) {
        focusIndex = target;
      } else if (favoriteApps.length) {
        section = "favorites";
        focusIndex = Math.min(focusIndex % COLS, favoriteApps.length - 1);
      } else {
        section = "top";
        focusIndex = 0;
      }
    } else if (section === "favorites") {
      section = "top";
      focusIndex = 0;
    }
    applyFocus();
  }

  function goBack() {
    try {
      if (window.history && history.length > 1) {
        history.back();
        return;
      }
    } catch (e) {}

    try {
      if (window.tizen && tizen.application) {
        tizen.application.getCurrentApplication().exit();
      }
    } catch (e2) {}
  }

  /* ------------------------------------------------------------------
     Lista de aplicaciones
     ------------------------------------------------------------------ */

  function isLikelyHiddenSystemApp(app) {
    var name = lower(app.name);
    var id = lower(app.id);

    if (!name) return true;
    if (name.indexOf("com.") === 0) return true;

    if ((name.indexOf("service") !== -1 || name.indexOf("daemon") !== -1) &&
        (id.indexOf("service") !== -1 || id.indexOf("daemon") !== -1)) {
      return true;
    }

    return false;
  }

  function normalizeApps(apps) {
    var currentId = "";
    try {
      currentId = tizen.application.getCurrentApplication().appInfo.id;
    } catch (e) {}

    var seen = {};
    var out = [];
    var i, app, info;

    for (i = 0; i < apps.length; i++) {
      app = apps[i];

      if (!app || !app.id || app.id === currentId) continue;
      if (app.show === false) continue;
      if (seen[app.id]) continue;

      info = {
        id: app.id,
        name: app.name || app.id,
        iconPath: app.iconPath || "",
        packageId: app.packageId || ""
      };

      if (isLikelyHiddenSystemApp(info)) continue;

      seen[app.id] = true;
      out.push(info);
    }

    out.sort(function (a, b) {
      var aa = lower(a.name);
      var bb = lower(b.name);
      if (aa < bb) return -1;
      if (aa > bb) return 1;
      return 0;
    });

    return out;
  }

  function loadApps(showMessage) {
    if (loading) return;

    loading = true;
    focusedNameEl.textContent = "Leyendo aplicaciones…";
    focusedMetaEl.textContent = "";

    if (bridgeReady) {
      loadAppsFromBridge(showMessage);
      return;
    }

    waitForBridge(0, function () {
      loadAppsFromBridge(showMessage);
    }, function () {
      loadAppsDirect(showMessage);
    });
  }

  function loadAppsFromBridge(showMessage) {
    focusedNameEl.textContent = "Leyendo aplicaciones…";

    bridgeGet("/apps" + (showMessage ? "?refresh=1" : ""), 30000, function (data) {
      loading = false;

      var raw = data.apps || [];
      var mapped = [];
      var i;
      for (i = 0; i < raw.length; i++) {
        mapped.push({
          id: raw[i].id,
          name: raw[i].name,
          packageId: raw[i].packageId || "",
          iconPath: raw[i].hasIcon
            ? BRIDGE + "/icon?id=" + encodeURIComponent(raw[i].id)
            : ""
        });
      }

      allApps = normalizeApps(mapped);
      ensureFavorites();

      if (page >= pageCount()) page = pageCount() - 1;
      if (page < 0) page = 0;

      renderAll(false);

      if (showMessage) {
        toast("Lista actualizada: " + allApps.length + " apps");
      }

      if (!allApps.length) {
        toast("No se ha encontrado ninguna app");
      }
    }, function (err) {
      loading = false;
      var msg = err && err.data && err.data.error;
      toast("No se ha podido leer la lista de apps" + (msg ? ": " + msg : ""));
      renderAll(false);
    });
  }

  function loadAppsDirect(showMessage) {
    if (!hasTizen("app")) {
      loading = false;

      allApps = [
        { id: "demo.youtube", name: "YouTube", iconPath: "" },
        { id: "demo.netflix", name: "Netflix", iconPath: "" },
        { id: "demo.prime", name: "Prime Video", iconPath: "" },
        { id: "demo.movistar", name: "Movistar Plus+", iconPath: "" },
        { id: "demo.rtve", name: "RTVE Play", iconPath: "" },
        { id: "demo.spotify", name: "Spotify", iconPath: "" },
        { id: "demo.internet", name: "Internet", iconPath: "" }
      ];

      favoriteIds = defaultFavorites();
      page = 0;
      renderAll(false);
      toast("Modo demo: no responde el servicio de CleanTV");
      return;
    }

    try {
      tizen.application.getAppsInfo(
        function (apps) {
          loading = false;
          allApps = normalizeApps(apps || []);
          ensureFavorites();

          if (page >= pageCount()) page = pageCount() - 1;

          renderAll(false);

          if (showMessage) {
            toast("Lista actualizada: " + allApps.length + " apps");
          }

          if (!allApps.length) {
            toast("No se ha encontrado ninguna app");
          }
        },
        function (err) {
          loading = false;
          toast("No se ha podido leer la lista de apps" +
                (err && err.message ? ": " + err.message : ""));
          renderAll(false);
        }
      );
    } catch (e) {
      loading = false;
      toast("Error de la API de Tizen: " + e.message);
      renderAll(false);
    }
  }

  /* ------------------------------------------------------------------
     Teclas del mando
     ------------------------------------------------------------------ */

  function onPanelKey(code) {
    if (code === 38) {
      if (panelIndex > 0) { panelIndex--; panelFocus(); }
    } else if (code === 40) {
      if (panelIndex + 1 < panelRows.length) { panelIndex++; panelFocus(); }
    } else if (code === 13) {
      var row = panelRows[panelIndex];
      if (row && row.action) row.action();
    } else if (code === 10009 || code === 27) {
      closePanel();
    } else {
      return false;
    }
    return true;
  }

  function onKey(e) {
    var code = e.keyCode || e.which;
    var handled = true;

    if (panelOpen) {
      handled = onPanelKey(code);
      if (handled && e.preventDefault) e.preventDefault();
      return;
    }

    if (code === 37) {
      moveLeft();
    } else if (code === 39) {
      moveRight();
    } else if (code === 38) {
      moveUp();
    } else if (code === 40) {
      moveDown();
    } else if (code === 13) {
      if (section === "top") activatePill();
      else launchCurrent();
    } else if (code === 10009 || code === 27) {
      goBack();
    } else if (code === 403) {
      changePage(-1);
    } else if (code === 404) {
      toggleFavorite();
    } else if (code === 405) {
      loadApps(true);
    } else if (code === 406) {
      changePage(1);
    } else {
      handled = false;
    }

    if (handled && e.preventDefault) e.preventDefault();
  }

  /* ------------------------------------------------------------------
     Arranque
     ------------------------------------------------------------------ */

  window.addEventListener("keydown", onKey, false);

  applyWallpaper();
  updateClock();
  setInterval(updateClock, 20000);
  scheduleHints();
  loadApps(false);
})();
