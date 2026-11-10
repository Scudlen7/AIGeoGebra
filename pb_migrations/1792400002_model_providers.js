migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const providers = new Collection({
    type: "base",
    name: "model_providers",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  })
  providers.fields.add(new RelationField({
    name: "owner",
    required: true,
    collectionId: users.id,
    cascadeDelete: true,
    maxSelect: 1,
  }))
  providers.fields.add(new TextField({ name: "name", required: true, max: 80 }))
  providers.fields.add(new TextField({ name: "baseUrl", required: true, max: 512 }))
  providers.fields.add(new SelectField({
    name: "protocol",
    required: true,
    maxSelect: 1,
    values: ["openai", "anthropic"],
  }))
  providers.fields.add(new JSONField({ name: "models", required: true, maxSize: 320000 }))
  providers.fields.add(new TextField({ name: "keyCiphertext", required: true, hidden: true, max: 5600 }))
  providers.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
  providers.addIndex("idx_model_providers_owner", false, "owner", "")
  app.save(providers)
}, (app) => {
  app.delete(app.findCollectionByNameOrId("model_providers"))
})
