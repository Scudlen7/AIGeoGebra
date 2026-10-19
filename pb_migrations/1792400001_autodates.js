/// 0.40 的 new Collection 不会自动带上 created/updated，这里补上。

function ensureDates(collection) {
  if (!collection.fields.getByName("created")) {
    collection.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
  }
  if (!collection.fields.getByName("updated")) {
    collection.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
  }
}

migrate((app) => {
  const names = ["secrets", "email_codes", "sessions", "usage_events"]
  for (let i = 0; i < names.length; i++) {
    const collection = app.findCollectionByNameOrId(names[i])
    ensureDates(collection)
    app.save(collection)
  }
}, (app) => {
  const names = ["secrets", "email_codes", "sessions", "usage_events"]
  for (let i = 0; i < names.length; i++) {
    try {
      const collection = app.findCollectionByNameOrId(names[i])
      collection.fields.removeByName("created")
      collection.fields.removeByName("updated")
      app.save(collection)
    } catch (err) {
      // 集合可能已在上一支迁移回滚时删除。
    }
  }
})
