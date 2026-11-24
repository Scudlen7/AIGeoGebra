migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  users.authToken.duration = 8 * 60 * 60
  app.save(users)
}, (app) => {
  const users = app.findCollectionByNameOrId("users")
  users.authToken.duration = 5 * 24 * 60 * 60
  app.save(users)
})
