/*
  CleanTV · servicio puente

  TizenBrew sirve la página de CleanTV desde http://127.0.0.1:8081, y en ese
  origen la tele no expone el objeto `tizen`. Los servicios de módulo, en
  cambio, sí lo reciben. Este servicio hace de puente: escucha en el puerto
  8092 y la página le pide por HTTP la lista de apps, abrir una app, los
  iconos y los datos de red y entradas.

  Escrito en ES5 a propósito: el Node de las teles Samsung puede ser antiguo.
*/

var http = require("http");
var fs = require("fs");

var PORT = 8092;

/* Si getAppsInfo no está permitido, se prueban estas apps una a una contra
   la API REST de la tele (puerto 8001). Solo aparecen las que estén
   instaladas. */
var CATALOG = [
  ["Samsung TV Plus", "3202405035480"],
  ["YouTube", "111299001912"],
  ["Netflix", "3201907018807"], ["Netflix", "11101200001"],
  ["Prime Video", "3201910019365"], ["Prime Video", "3201512006785"],
  ["Disney+", "3201901017640"], ["Disney+", "3202009021709"], ["Disney+", "3202204027038"],
  ["Max", "3202301029760"],
  ["SkyShowtime", "3202208028071"],
  ["Rakuten TV", "3201511006428"],
  ["Apple TV", "3201807016597"],
  ["DAZN", "3201806016390"],
  ["Spotify", "3201606009684"],
  ["Amazon Music", "3201710014874"],
  ["Apple Music", "3201908019041"],
  ["Deezer", "3201608010191"],
  ["Plex", "3201512006963"],
  ["Pluto TV", "3201808016802"],
  ["Twitch", "3202203026841"],
  ["Crunchyroll", "3202302030097"],
  ["TikTok", "3202008021577"],
  ["Xbox", "3202203026799"],
  ["GeForce NOW", "3202102023078"],
  ["Paramount+", "3201710014981"], ["Paramount+", "3202110025305"],
  ["Galería", "3201710015037"],
  ["Internet", "org.tizen.browser"], ["Internet", "3201907018784"], ["Internet", "3202010022079"]
];

var iconById = {};
var appsCache = null;

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendJson(res, obj) {
  send(res, 200, JSON.stringify(obj));
}

function sendError(res, msg) {
  send(res, 500, JSON.stringify({ error: String(msg || "Error") }));
}

function parseQuery(url) {
  var out = {};
  var q = url.indexOf("?") >= 0 ? url.split("?")[1] : "";
  var parts = q.split("&");
  var i, kv;
  for (i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    kv = parts[i].split("=");
    out[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || "").replace(/\+/g, " "));
  }
  return out;
}

function restRequest(method, appId, cb) {
  /* Forma (options, callback): la única que entiende el Node antiguo de la tele. */
  var req = http.request({
    host: "127.0.0.1",
    port: 8001,
    path: "/api/v2/applications/" + encodeURIComponent(appId),
    method: method
  }, function (res) {
    var data = "";
    res.on("data", function (c) { data += c; });
    res.on("end", function () {
      var json = null;
      try { json = JSON.parse(data); } catch (e) {}
      cb(res.statusCode, json);
    });
  });
  req.on("error", function () { cb(0, null); });
  req.setTimeout(2500, function () { req.abort(); });
  req.end();
}

/* ---------------- Lista de apps ---------------- */

function appsFromTizen(ok, fail) {
  try {
    tizen.application.getAppsInfo(function (list) {
      var ownPkg = "";
      try { ownPkg = tizen.application.getAppInfo().packageId; } catch (e) {}

      var out = [];
      var i, a;
      for (i = 0; i < list.length; i++) {
        a = list[i];
        if (!a || !a.id || a.show === false) continue;
        if (ownPkg && a.packageId === ownPkg) continue;
        if (a.iconPath) iconById[a.id] = String(a.iconPath).replace(/^file:\/\//, "");
        out.push({
          id: a.id,
          name: a.name || a.id,
          packageId: a.packageId || "",
          hasIcon: !!a.iconPath
        });
      }
      ok(out, "tizen");
    }, function (err) {
      fail(err && err.message);
    });
  } catch (e) {
    fail(e && e.message);
  }
}

function appsFromRest(done) {
  var found = [];
  var seenName = {};
  var index = 0;

  function next() {
    if (index >= CATALOG.length) {
      done(found, "rest");
      return;
    }
    var entry = CATALOG[index++];
    if (seenName[entry[0]]) { next(); return; }

    restRequest("GET", entry[1], function (status, json) {
      if (status === 200 && json && json.id) {
        seenName[entry[0]] = true;
        found.push({
          id: entry[1],
          name: json.name || entry[0],
          packageId: "",
          hasIcon: false
        });
      }
      next();
    });
  }

  next();
}

function handleApps(res, force) {
  if (appsCache && !force) {
    sendJson(res, appsCache);
    return;
  }

  appsFromTizen(function (apps, source) {
    appsCache = { source: source, apps: apps };
    sendJson(res, appsCache);
  }, function (reason) {
    appsFromRest(function (apps, source) {
      appsCache = { source: source, reason: reason || "", apps: apps };
      sendJson(res, appsCache);
    });
  });
}

/* ---------------- Abrir apps ---------------- */

function handleLaunch(res, id) {
  if (!id) { sendError(res, "Falta el id"); return; }

  function viaRest(firstError) {
    restRequest("POST", id, function (status) {
      if (status >= 200 && status < 300) sendJson(res, { ok: true, via: "rest" });
      else sendError(res, firstError || ("La tele respondió " + status));
    });
  }

  try {
    tizen.application.launch(id, function () {
      sendJson(res, { ok: true, via: "tizen" });
    }, function (err) {
      viaRest(err && err.message);
    });
  } catch (e) {
    viaRest(e && e.message);
  }
}

/* ---------------- Iconos ---------------- */

function handleIcon(res, id) {
  var path = iconById[id];
  if (!path) { send(res, 404, "", "text/plain"); return; }

  fs.readFile(path, function (err, data) {
    if (err) { send(res, 404, "", "text/plain"); return; }
    var lowerPath = path.toLowerCase();
    var type = lowerPath.indexOf(".jpg") > 0 || lowerPath.indexOf(".jpeg") > 0
      ? "image/jpeg" : "image/png";
    res.writeHead(200, {
      "Content-Type": type,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "max-age=86400"
    });
    res.end(data);
  });
}

/* ---------------- Red, entradas, info ---------------- */

function sysProp(name, cb) {
  try {
    tizen.systeminfo.getPropertyValue(name, function (v) { cb(v); }, function () { cb(null); });
  } catch (e) {
    cb(null);
  }
}

function handleNetwork(res) {
  sysProp("WIFI_NETWORK", function (wifi) {
    sysProp("ETHERNET_NETWORK", function (eth) {
      sendJson(res, {
        wifi: wifi ? {
          status: wifi.status, ssid: wifi.ssid,
          ipAddress: wifi.ipAddress, signalStrength: wifi.signalStrength
        } : null,
        ethernet: eth ? {
          cable: eth.cable, status: eth.status, ipAddress: eth.ipAddress
        } : null
      });
    });
  });
}

function handleSources(res) {
  sysProp("VIDEOSOURCE", function (info) {
    var list = [];
    var c = (info && info.connected) || [];
    var i;
    for (i = 0; i < c.length; i++) {
      list.push({ type: c[i].type, number: c[i].number, name: c[i].name });
    }
    sendJson(res, { connected: list });
  });
}

function handleInfo(res) {
  var model = "";
  try { model = tizen.systeminfo.getCapability("http://tizen.org/system/model_name"); } catch (e) {}
  sendJson(res, { model: model || "" });
}

/* ---------------- Servidor ---------------- */

var server = http.createServer(function (req, res) {
  var url = req.url || "/";
  var path = url.split("?")[0];
  var q = parseQuery(url);

  try {
    if (path === "/ping") sendJson(res, { ok: true });
    else if (path === "/apps") handleApps(res, q.refresh === "1");
    else if (path === "/launch") handleLaunch(res, q.id);
    else if (path === "/icon") handleIcon(res, q.id);
    else if (path === "/network") handleNetwork(res);
    else if (path === "/sources") handleSources(res);
    else if (path === "/info") handleInfo(res);
    else send(res, 404, "{}");
  } catch (e) {
    sendError(res, e && e.message);
  }
});

server.on("error", function () {
  /* Puerto ocupado: ya hay otra copia del servicio funcionando. */
});

server.listen(PORT, "127.0.0.1");
