/// 汇总和 token 校验同样运行在独立虚拟机里，逻辑都放在处理函数内部。

const usageHelpers = `
function bearer(e) {
  var header = ""
  try { header = String(e.request.header.get("Authorization") || "") } catch (err) { header = "" }
  if (!header) {
    var info = e.requestInfo()
    var headers = info.headers || {}
    header = String(headers.authorization || headers.Authorization || "")
  }
  return header.replace(/^Bearer\\s+/i, "").trim()
}
function authOf(e) {
  if (e.auth) return e.auth
  var token = bearer(e)
  if (!token) return null
  try { return e.app.findAuthRecordByToken(token, "auth") } catch (err) { return null }
}
function pad(value) { return value < 10 ? "0" + value : String(value) }
function shanghaiDay(ms) {
  var shifted = new Date(ms + 8 * 60 * 60 * 1000)
  return shifted.getUTCFullYear() + "-" + pad(shifted.getUTCMonth() + 1) + "-" + pad(shifted.getUTCDate())
}
function shiftDay(day, delta) {
  var parts = String(day).split("-")
  var utc = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + delta)
  var date = new Date(utc)
  return date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate())
}
function parseTime(value) {
  var text = String(value || "").trim().replace(" ", "T")
  var time = Date.parse(text)
  return isNaN(time) ? 0 : time
}
`

routerAdd("POST", "/api/internal/verify-auth", new Function("e", usageHelpers + `
  var caller = authOf(e)
  if (!caller || caller.collection().name !== "_superusers") throw new UnauthorizedError("需要超级用户身份")
  var body = e.requestInfo().body || {}
  var token = String(body.token || "").replace(/^Bearer\\s+/i, "").trim()
  if (!token) return e.json(200, { valid: false })
  try {
    var record = e.app.findAuthRecordByToken(token, "auth")
    if (!record || record.collection().name !== "users") return e.json(200, { valid: false })
    return e.json(200, { valid: true, id: record.id })
  } catch (err) {
    return e.json(200, { valid: false })
  }
`), $apis.skipSuccessActivityLog())

routerAdd("GET", "/api/usage/summary", new Function("e", usageHelpers + `
  var auth = authOf(e)
  if (!auth || auth.collection().name !== "users") throw new UnauthorizedError("请先登录")
  var events = e.app.findRecordsByFilter("usage_events", "owner = {:owner}", "", 0, 0, { owner: auth.id })
  var sessions = e.app.findRecordsByFilter("sessions", "owner = {:owner}", "", 0, 0, { owner: auth.id })
  var today = shanghaiDay(Date.now())
  var month = today.slice(0, 7)
  var days = []
  var dayCounts = {}
  for (var offset = 6; offset >= 0; offset--) {
    var day = shiftDay(today, -offset)
    days.push({ date: day, requests: 0 })
    dayCounts[day] = days.length - 1
  }
  var requests = 0
  var tokens = 0
  var modelMap = {}
  var gatewayMap = {}
  var gatewayRequests = 0
  var gatewayTokens = 0
  for (var i = 0; i < events.length; i++) {
    var event = events[i]
    requests += 1
    var known = event.get("tokensKnown") === true
    var prompt = Number(event.get("promptTokens") || 0)
    var completion = Number(event.get("completionTokens") || 0)
    var total = known ? prompt + completion : 0
    if (known) tokens += total
    var model = String(event.get("model") || "")
    if (!modelMap[model]) modelMap[model] = { model: model, requests: 0, tokens: 0 }
    modelMap[model].requests += 1
    modelMap[model].tokens += total
    var created = parseTime(event.get("created"))
    var createdDay = created ? shanghaiDay(created) : ""
    if (dayCounts[createdDay] !== undefined) days[dayCounts[createdDay]].requests += 1
    if (event.get("gateway") === true && createdDay && createdDay.slice(0, 7) === month) {
      gatewayRequests += 1
      gatewayTokens += total
      if (!gatewayMap[model]) gatewayMap[model] = { model: model, requests: 0, tokens: 0 }
      gatewayMap[model].requests += 1
      gatewayMap[model].tokens += total
    }
  }
  var models = []
  for (var key in modelMap) models.push(modelMap[key])
  models.sort(function(a, b) { return b.requests - a.requests })
  var gatewayModels = []
  for (var gkey in gatewayMap) gatewayModels.push(gatewayMap[gkey])
  gatewayModels.sort(function(a, b) { return b.requests - a.requests })
  return e.json(200, {
    requests: requests,
    sessions: sessions.length,
    tokens: tokens,
    days: days,
    models: models,
    gatewayMonth: { requests: gatewayRequests, tokens: gatewayTokens, models: gatewayModels }
  })
`))
