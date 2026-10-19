/// 每个路由处理函数都会被 PocketBase 序列化到独立的 JS 虚拟机。
/// 辅助函数必须写在处理函数体内，不能依赖文件作用域。

const authHelpers = `
function charLength(text) {
  var count = 0
  var value = String(text || "")
  for (var i = 0; i < value.length; i++) count += 1
  return count
}
function validEmail(email) {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)
}
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
function bodyOf(e) {
  var info = e.requestInfo()
  return info.body || {}
}
function pepperOf(app) {
  var rows = app.findRecordsByFilter("secrets", "key = {:key}", "", 1, 0, { key: "email_code_pepper" })
  if (!rows.length || !rows[0].get("value")) throw new BadRequestError("验证码服务未就绪")
  return String(rows[0].get("value"))
}
function hashCode(app, code) {
  return $security.hs256(String(code), pepperOf(app))
}
function parseTime(value) {
  var text = String(value || "").trim().replace(" ", "T")
  var time = Date.parse(text)
  return isNaN(time) ? 0 : time
}
function findUserByEmail(app, email) {
  try { return app.findAuthRecordByEmail("users", email) } catch (err) { return null }
}
function latestCode(app, email, purpose) {
  var rows = app.findRecordsByFilter("email_codes", "email = {:email} && purpose = {:purpose}", "-created", 1, 0, { email: email, purpose: purpose })
  return rows.length ? rows[0] : null
}
function resendWait(app, email, purpose) {
  var recent = latestCode(app, email, purpose)
  if (!recent) return 0
  var elapsed = Date.now() - parseTime(recent.get("created"))
  if (elapsed >= 0 && elapsed < 60000) return Math.max(1, Math.ceil((60000 - elapsed) / 1000))
  return 0
}
function retireUnused(app, email, purpose) {
  var rows = app.findRecordsByFilter("email_codes", "email = {:email} && purpose = {:purpose} && used = false", "", 0, 0, { email: email, purpose: purpose })
  for (var i = 0; i < rows.length; i++) {
    rows[i].set("used", true)
    app.save(rows[i])
  }
}
function subjectFor(purpose) {
  if (purpose === "reset") return "AI 几何画板重置密码验证码"
  if (purpose === "email_change") return "AI 几何画板修改邮箱验证码"
  return "AI 几何画板注册验证码"
}
function sendCodeMail(app, email, code, purpose) {
  var settings = app.settings().meta
  var message = new MailerMessage({
    from: { address: settings.senderAddress, name: settings.senderName },
    to: [{ address: email }],
    subject: subjectFor(purpose),
    html: "<p>你的验证码是 <b>" + code + "</b></p><p>验证码 10 分钟内有效。用过后即失效，请不要告诉他人。</p>"
  })
  app.newMailClient().send(message)
}
function issueCode(app, email, purpose, userId, send) {
  retireUnused(app, email, purpose)
  var code = $security.randomStringWithAlphabet(4, "0123456789")
  var collection = app.findCollectionByNameOrId("email_codes")
  var record = new Record(collection)
  record.set("email", email)
  record.set("purpose", purpose)
  record.set("codeHash", hashCode(app, code))
  record.set("expires", new Date(Date.now() + 600000).toISOString())
  record.set("attempts", 0)
  record.set("used", false)
  record.set("userId", userId || "")
  app.save(record)
  if (send) {
    try {
      sendCodeMail(app, email, code, purpose)
    } catch (err) {
      app.delete(record)
      throw new BadRequestError("验证码邮件发送失败，请稍后重试")
    }
  }
}
function checkPasswordPair(password, passwordConfirm) {
  if (String(password).length < 8) throw new BadRequestError("密码至少 8 位")
  if (password !== passwordConfirm) throw new BadRequestError("两次输入的密码不一致")
}
function consumeCode(app, email, purpose, code, userId) {
  if (!/^\\d{4}$/.test(String(code || ""))) throw new BadRequestError("验证码不正确")
  var record = latestCode(app, email, purpose)
  if (!record || record.get("used")) throw new BadRequestError("验证码不正确或已失效")
  if (purpose === "email_change" && String(record.get("userId") || "") !== String(userId || "")) {
    throw new BadRequestError("验证码不正确或已失效")
  }
  if (parseTime(record.get("expires")) < Date.now()) {
    record.set("used", true)
    app.save(record)
    throw new BadRequestError("验证码已过期")
  }
  var expected = String(record.get("codeHash") || "")
  var actual = hashCode(app, String(code))
  if (!$security.equal(expected, actual)) {
    var attempts = Number(record.get("attempts") || 0) + 1
    record.set("attempts", attempts)
    if (attempts >= 5) {
      record.set("used", true)
      app.save(record)
      throw new BadRequestError("验证码已失效，请重新获取")
    }
    app.save(record)
    throw new BadRequestError("验证码不正确")
  }
  record.set("used", true)
  app.save(record)
  return record
}
`

function authRoute(method, path, body, middleware) {
  const handler = new Function("e", authHelpers + "\n" + body)
  if (middleware) routerAdd(method, path, handler, middleware)
  else routerAdd(method, path, handler)
}

authRoute("POST", "/api/auth/request-code", `
  var body = bodyOf(e)
  var email = String(body.email || "").trim().toLowerCase()
  var purpose = String(body.purpose || "")
  if (purpose !== "register" && purpose !== "reset" && purpose !== "email_change") throw new BadRequestError("验证码用途不正确")
  if (!validEmail(email)) throw new BadRequestError("请输入正确的邮箱地址")
  if (purpose === "register" && findUserByEmail(e.app, email)) throw new BadRequestError("该邮箱已注册")
  var auth = null
  if (purpose === "email_change") {
    auth = authOf(e)
    if (!auth || auth.collection().name !== "users") throw new UnauthorizedError("请先登录")
    if (email === String(auth.email() || "").toLowerCase()) throw new BadRequestError("新邮箱不能与当前邮箱相同")
    if (findUserByEmail(e.app, email)) throw new BadRequestError("该邮箱已注册")
  }
  var wait = resendWait(e.app, email, purpose)
  if (wait) return e.json(429, { message: "请稍后再获取验证码", retryAfter: wait })
  if (purpose === "register") {
    issueCode(e.app, email, purpose, "", true)
    return e.json(200, { ok: true })
  }
  if (purpose === "email_change") {
    issueCode(e.app, email, purpose, auth.id, true)
    return e.json(200, { ok: true })
  }
  var exists = findUserByEmail(e.app, email) ? true : false
  issueCode(e.app, email, purpose, "", exists)
  return e.json(200, { ok: true })
`, $apis.skipSuccessActivityLog())

authRoute("POST", "/api/auth/register", `
  var body = bodyOf(e)
  var name = String(body.name || "").trim()
  var email = String(body.email || "").trim().toLowerCase()
  var password = String(body.password || "")
  var passwordConfirm = String(body.passwordConfirm || "")
  if (charLength(name) < 2) throw new BadRequestError("昵称至少 2 个字符")
  if (!validEmail(email)) throw new BadRequestError("请输入正确的邮箱地址")
  if (findUserByEmail(e.app, email)) throw new BadRequestError("该邮箱已注册")
  checkPasswordPair(password, passwordConfirm)
  var codeRecord = consumeCode(e.app, email, "register", body.code, "")
  var users = e.app.findCollectionByNameOrId("users")
  var user = new Record(users)
  user.setEmail(email)
  user.set("name", name)
  user.setVerified(true)
  user.setPassword(password)
  user.set("model", "")
  try {
    e.app.save(user)
  } catch (err) {
    codeRecord.set("used", false)
    e.app.save(codeRecord)
    if (findUserByEmail(e.app, email)) throw new BadRequestError("该邮箱已注册")
    throw new BadRequestError("注册失败，请稍后重试")
  }
  return e.json(200, { token: user.newAuthToken(), record: user })
`, $apis.skipSuccessActivityLog())

authRoute("POST", "/api/auth/reset-password", `
  var body = bodyOf(e)
  var email = String(body.email || "").trim().toLowerCase()
  var password = String(body.password || "")
  var passwordConfirm = String(body.passwordConfirm || "")
  if (!validEmail(email)) throw new BadRequestError("请输入正确的邮箱地址")
  checkPasswordPair(password, passwordConfirm)
  var user = findUserByEmail(e.app, email)
  if (!user) throw new BadRequestError("验证码不正确或已失效")
  var codeRecord = consumeCode(e.app, email, "reset", body.code, "")
  user.setPassword(password)
  try {
    e.app.save(user)
  } catch (err) {
    codeRecord.set("used", false)
    e.app.save(codeRecord)
    throw new BadRequestError("重置密码失败，请稍后重试")
  }
  return e.json(200, { ok: true })
`, $apis.skipSuccessActivityLog())

authRoute("POST", "/api/auth/change-email", `
  var auth = authOf(e)
  if (!auth || auth.collection().name !== "users") throw new UnauthorizedError("请先登录")
  var body = bodyOf(e)
  var email = String(body.email || "").trim().toLowerCase()
  if (!validEmail(email)) throw new BadRequestError("请输入正确的邮箱地址")
  if (email === String(auth.email() || "").toLowerCase()) throw new BadRequestError("新邮箱不能与当前邮箱相同")
  if (findUserByEmail(e.app, email)) throw new BadRequestError("该邮箱已注册")
  var codeRecord = consumeCode(e.app, email, "email_change", body.code, auth.id)
  auth.setEmail(email)
  auth.setVerified(true)
  try {
    e.app.save(auth)
  } catch (err) {
    codeRecord.set("used", false)
    e.app.save(codeRecord)
    throw new BadRequestError("修改邮箱失败，请稍后重试")
  }
  return e.json(200, { ok: true, email: email })
`, $apis.skipSuccessActivityLog())

onRecordUpdateRequest(new Function("e", authHelpers + `
  var record = e.record
  if (!record) return e.next()
  var original = record.original()
  if (record.email() !== original.email()) throw new BadRequestError("请先验证新邮箱")
  var name = String(record.get("name") || "").trim()
  if (charLength(name) < 2) throw new BadRequestError("昵称至少 2 个字符")
  return e.next()
`), "users")

onRecordCreateRequest(new Function("e", `
  if (!e.hasSuperuserAuth()) throw new ForbiddenError("请使用注册页面")
  return e.next()
`), "users")
