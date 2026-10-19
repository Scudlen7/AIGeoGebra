/// PocketBase 0.40 migration.
/// 验证码胡椒只写进 secrets 记录，不写进仓库。不要在这里创建超级用户或改邮件设置。

migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  users.fields.add(new TextField({
    name: "model",
    required: false,
    min: 0,
    max: 200,
  }))
  const password = users.fields.getByName("password")
  if (password) password.min = 8
  users.listRule = "id = @request.auth.id"
  users.viewRule = "id = @request.auth.id"
  users.createRule = null
  users.updateRule = "id = @request.auth.id"
  users.deleteRule = "id = @request.auth.id"
  users.passwordAuth.enabled = true
  users.otp.enabled = false
  users.oauth2.enabled = false
  users.mfa.enabled = false
  app.save(users)

  const secrets = new Collection({
    type: "base",
    name: "secrets",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  })
  secrets.fields.add(new TextField({ name: "key", required: true, min: 1, max: 80 }))
  secrets.fields.add(new TextField({ name: "value", required: true, hidden: true, min: 1, max: 500 }))
  secrets.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
  secrets.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
  secrets.addIndex("idx_secrets_key", true, "key", "")
  app.save(secrets)

  const pepper = new Record(secrets)
  pepper.set("key", "email_code_pepper")
  pepper.set("value", $security.randomString(48))
  app.save(pepper)

  const codes = new Collection({
    type: "base",
    name: "email_codes",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  })
  codes.fields.add(new TextField({ name: "email", required: true, min: 3, max: 250 }))
  codes.fields.add(new SelectField({
    name: "purpose",
    required: true,
    maxSelect: 1,
    values: ["register", "reset", "email_change"],
  }))
  codes.fields.add(new TextField({ name: "codeHash", required: true, hidden: true, min: 16, max: 200 }))
  codes.fields.add(new DateField({ name: "expires", required: true }))
  codes.fields.add(new NumberField({ name: "attempts", onlyInt: true, min: 0 }))
  codes.fields.add(new BoolField({ name: "used" }))
  codes.fields.add(new TextField({ name: "userId", required: false, max: 20 }))
  codes.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
  codes.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
  app.save(codes)

  const sessions = new Collection({
    type: "base",
    name: "sessions",
    listRule: "owner = @request.auth.id",
    viewRule: "owner = @request.auth.id",
    createRule: "@request.auth.id != '' && owner = @request.auth.id",
    updateRule: "owner = @request.auth.id",
    deleteRule: "owner = @request.auth.id",
  })
  sessions.fields.add(new RelationField({
    name: "owner",
    required: true,
    collectionId: users.id,
    cascadeDelete: true,
    minSelect: 1,
    maxSelect: 1,
  }))
  sessions.fields.add(new TextField({ name: "name", required: true, min: 1, max: 80 }))
  sessions.fields.add(new SelectField({
    name: "mode",
    required: true,
    maxSelect: 1,
    values: ["geometry", "3d", "probability", "scientific"],
  }))
  sessions.fields.add(new JSONField({ name: "messages", maxSize: 2000000 }))
  sessions.fields.add(new TextField({ name: "input", max: 8000 }))
  sessions.fields.add(new JSONField({ name: "report", maxSize: 2000000 }))
  sessions.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
  sessions.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
  sessions.addIndex("idx_sessions_owner_mode", false, "owner, mode", "")
  app.save(sessions)

  const usage = new Collection({
    type: "base",
    name: "usage_events",
    listRule: "owner = @request.auth.id",
    viewRule: "owner = @request.auth.id",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  })
  usage.fields.add(new RelationField({
    name: "owner",
    required: true,
    collectionId: users.id,
    cascadeDelete: true,
    minSelect: 1,
    maxSelect: 1,
  }))
  usage.fields.add(new TextField({ name: "model", required: true, min: 1, max: 200 }))
  usage.fields.add(new BoolField({ name: "gateway" }))
  usage.fields.add(new BoolField({ name: "tokensKnown" }))
  usage.fields.add(new NumberField({ name: "promptTokens", onlyInt: true, min: 0 }))
  usage.fields.add(new NumberField({ name: "completionTokens", onlyInt: true, min: 0 }))
  usage.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
  usage.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
  app.save(usage)
}, (app) => {
  const names = ["usage_events", "sessions", "email_codes", "secrets"]
  for (let i = 0; i < names.length; i++) {
    try {
      app.delete(app.findCollectionByNameOrId(names[i]))
    } catch (err) {
      // 回滚时集合可能已经不存在。
    }
  }
  try {
    const users = app.findCollectionByNameOrId("users")
    users.fields.removeByName("model")
    users.createRule = ""
    app.save(users)
  } catch (err) {
    // users 集合由 PocketBase 自带，回滚只撤掉本阶段字段。
  }
})
